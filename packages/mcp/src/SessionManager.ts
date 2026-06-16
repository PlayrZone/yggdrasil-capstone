import { Experiment } from '@yggdrasil/engine';
import type { IMindBackend } from '@yggdrasil/engine';
import type { ResearchDB, EventRow, KnowledgeRow } from '@yggdrasil/db';

interface Session {
  exp: Experiment;
  runId: number;
  agentCount: number;
  lastRecordedEventCount: number;
  startedAt: number;
}

/**
 * Holds the live experiments the MCP server is running. Sessions persist
 * across tool calls for the life of the server process, so a client can
 * create a world, advance it, watch it, and whisper ideas into it over time
 * — then finalize it into a permanent DB record. Recording is incremental:
 * every advance snapshots metrics + drains new events into the store.
 */
export class SessionManager {
  private readonly sessions = new Map<number, Session>();

  constructor(
    private readonly db: ResearchDB,
    private readonly makeBackend: () => IMindBackend | null = () => null,
  ) {}

  create(seed: string, agentCount: number, startedAt: number, craftLearning = false): number {
    const mindBackend = this.makeBackend() ?? undefined;
    const exp = new Experiment({ seed, agentCount, mindBackend, craftLearning });
    const runId = this.db.createRun({ seed, agentCount, backend: exp.backendLabel, startedAt });
    this.sessions.set(runId, { exp, runId, agentCount, lastRecordedEventCount: 0, startedAt });
    this.snapshotMetrics(runId);
    return runId;
  }

  /**
   * Phase 3 setup: give the craft of `output` to the `count` most-central
   * founders (their kin cluster around them, so descendants can apprentice).
   * Returns the maker ids. Logged to the audit trail as an MCP action.
   */
  seedRecipe(runId: number, output: string, count = 1): number[] {
    const s = this.require(runId);
    const exp = s.exp;
    const founders = exp.agentIds
      .map((id) => {
        const t = exp.agentEntity(id)?.components['Transform2D'] as { x: number; y: number } | undefined;
        return t ? { id, x: t.x, y: t.y } : null;
      })
      .filter((a): a is { id: number; x: number; y: number } => a !== null);
    const cx = founders.reduce((a, f) => a + f.x, 0) / founders.length;
    const cy = founders.reduce((a, f) => a + f.y, 0) / founders.length;
    founders.sort((a, b) => (a.x - cx) ** 2 + (a.y - cy) ** 2 - ((b.x - cx) ** 2 + (b.y - cy) ** 2));
    const makers = founders.slice(0, Math.max(1, count)).map((f) => f.id);
    exp.seedRecipe(output as never, makers);
    // (The tool handler logs this mutation via logMutation; no double-record here.)
    return makers;
  }

  /** Phase 3 measure: makers (beings who completed a craft) by generation, plus
   *  living recipe-holders — the spread of a learned technology. */
  craftStats(runId: number, output = 'spear'): {
    makersByGeneration: Record<number, number>;
    recipeHolders: number;
    totalMakers: number;
    totalCrafts: number;
  } {
    const exp = this.require(runId).exp;
    const byGen: Record<number, number> = {};
    let totalCrafts = 0;
    let totalMakers = 0;
    for (const [id, c] of exp.craftsByAgent) {
      totalCrafts += c;
      if (c > 0) {
        totalMakers++;
        const g = exp.generationOf(id);
        byGen[g] = (byGen[g] ?? 0) + 1;
      }
    }
    return { makersByGeneration: byGen, recipeHolders: exp.recipeHolders(output as never).length, totalMakers, totalCrafts };
  }

  get(runId: number): Session | undefined {
    return this.sessions.get(runId);
  }

  liveRunIds(): number[] {
    return [...this.sessions.keys()];
  }

  /**
   * Advance in chunks, yielding to the event loop between them so the LLM's
   * async cognition (network round-trips, dispatched by the scheduler) can
   * resolve and its plans land. Reflex keeps agents acting in the meantime, so
   * the sim never blocks; over many chunks the LLM progressively takes over.
   */
  async advance(runId: number, ticks: number): Promise<void> {
    const s = this.require(runId);
    const CHUNK = 50;
    let remaining = ticks;
    while (remaining > 0) {
      const n = Math.min(CHUNK, remaining);
      s.exp.advance(n);
      remaining -= n;
      this.drainEvents(s);
      // Yield so resolved cognition promises fire their apply callbacks.
      await new Promise<void>((r) => setTimeout(r, 0));
    }
    this.snapshotMetrics(runId);
  }

  giveIdea(runId: number, text: string, target: number | 'all'): number {
    const s = this.require(runId);
    const n = s.exp.giveIdea(text, target);
    this.db.recordAction('mcp', 'give_idea', { text, target, reached: n }, runId, s.exp.tick);
    return n;
  }

  finish(runId: number): void {
    const s = this.require(runId);
    this.drainEvents(s);
    this.snapshotMetrics(runId);
    this.snapshotKnowledge(s);
    this.db.finishRun(runId, s.exp.tick, s.startedAt + s.exp.tick);
    this.sessions.delete(runId);
  }

  private require(runId: number): Session {
    const s = this.sessions.get(runId);
    if (!s) throw new Error(`no live session for run ${runId} (create one, or it was already finished)`);
    return s;
  }

  private snapshotMetrics(runId: number): void {
    const s = this.require(runId);
    const exp = s.exp;
    this.db.recordMetrics(runId, {
      tick: exp.tick,
      day: exp.day(),
      alive: exp.aliveCount(),
      totalKnowledge: exp.totalKnowledge(),
      exchanges: exp.exchangeCount,
      conflicts: exp.conflictCount,
      sickness: exp.sicknessCount,
      shares: exp.shareCount,
      seedPlants: exp.seedPlantCount,
      sprouts: exp.sproutCount,
      builds: exp.buildCount,
    });
  }

  // Drain the engine's capped event log into the DB. The engine caps its
  // in-memory log; we persist everything we haven't seen yet (best-effort —
  // a very long advance between calls can outrun the cap, which we note).
  private drainEvents(s: Session): void {
    const newCount = s.exp.eventCount - s.lastRecordedEventCount;
    if (newCount <= 0) return;
    const buffered = s.exp.eventLog.length;
    const take = Math.min(newCount, buffered);
    const slice = s.exp.eventLog.slice(buffered - take);
    const rows: EventRow[] = slice.map((e) => ({
      tick: e.tick,
      type: e.type,
      actor: typeof e.actorId === 'number' ? e.actorId : null,
      payload: e.payload,
    }));
    this.db.recordEvents(s.runId, rows);
    s.lastRecordedEventCount = s.exp.eventCount;
  }

  private snapshotKnowledge(s: Session): void {
    const rows: KnowledgeRow[] = [];
    for (const info of s.exp.agentKnowledge()) {
      if (!info.alive) continue;
      for (const k of info.knowledge) {
        rows.push({
          tick: s.exp.tick,
          agentId: info.agentId,
          ruleKey: k.ruleKey,
          status: k.status,
          confidence: k.confidence,
        });
      }
    }
    if (rows.length) this.db.recordKnowledge(s.runId, rows);
  }
}
