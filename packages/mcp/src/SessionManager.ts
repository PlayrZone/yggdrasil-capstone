import { Experiment } from '@yggdrasil/engine';
import type { ICognitionSink, IMindBackend } from '@yggdrasil/engine';
import { JsonlCognitionSink } from '@yggdrasil/home';
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
export function corpusRunId(runId: number): string {
  return `run-${runId}`;
}

export class SessionManager {
  private readonly sessions = new Map<number, Session>();
  /** Finishes in flight, so a second `finish` joins the first rather than racing it. */
  private readonly finishing = new Map<number, Promise<void>>();

  constructor(
    private readonly db: ResearchDB,
    private readonly makeBackend: () => IMindBackend | null = () => null,
    /** Where the lossless cognition record goes. Tests inject a capturing sink. */
    private readonly makeSink: (runId: number) => ICognitionSink | null = (runId) =>
      new JsonlCognitionSink(corpusRunId(runId)),
  ) {}

  create(seed: string, agentCount: number, startedAt: number, craftLearning = false): number {
    const mindBackend = this.makeBackend() ?? undefined;
    // The run row comes first so the corpus and the DB agree on the run's id.
    const runId = this.db.createRun({ seed, agentCount, backend: mindBackend?.modelId ?? 'reflex', startedAt });
    // Only a conscious run produces cognition; a reflex run would open an empty
    // corpus for every advance the lab ever makes.
    const sink = mindBackend ? this.makeSink(runId) : null;
    const exp = new Experiment({
      seed,
      agentCount,
      mindBackend,
      craftLearning,
      ...(sink ? { recording: { sink, runId: corpusRunId(runId), scenarioId: seed } } : {}),
    });
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

  /**
   * Switch beings to LLM cognition — without this the backend is wired but
   * never called, so an MCP run produced no cognition and no corpus at all.
   * Either explicit ids, or the `count` living beings closest to the population
   * centroid (so they can perceive and speak to each other). Recorded in the
   * scaffold ledger, so every row says when its being became conscious.
   */
  makeConscious(runId: number, opts: { ids?: number[]; count?: number } = {}): number[] {
    const exp = this.require(runId).exp;
    const living = exp.agentIds.filter((id) => exp.agentBody(id)?.alive);
    let candidates = living;
    if (opts.ids && opts.ids.length > 0) {
      const wanted = new Set(opts.ids);
      candidates = living.filter((id) => wanted.has(id));
    } else {
      const positioned = living
        .map((id) => {
          const t = exp.agentEntity(id)?.components['Transform2D'] as { x: number; y: number } | undefined;
          return t ? { id, x: t.x, y: t.y } : null;
        })
        .filter((a): a is { id: number; x: number; y: number } => a !== null);
      if (positioned.length === 0) return [];
      const cx = positioned.reduce((a, p) => a + p.x, 0) / positioned.length;
      const cy = positioned.reduce((a, p) => a + p.y, 0) / positioned.length;
      positioned.sort((a, b) => (a.x - cx) ** 2 + (a.y - cy) ** 2 - ((b.x - cx) ** 2 + (b.y - cy) ** 2));
      candidates = positioned.slice(0, Math.max(1, opts.count ?? 1)).map((p) => p.id);
    }
    // Already-conscious beings are filtered out rather than re-reported: the
    // engine happily returns true for a being that was made conscious an hour
    // ago, so an overlapping call announced "made 7 conscious" for a no-op. The
    // scaffold ledger keeps only the FIRST tick, so this is also the only
    // reading that agrees with the rows.
    return candidates.filter((id) => !exp.conscious.has(id) && exp.makeConscious(id));
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
    // `at` is wall-clock so the audit trail can be ordered; the sim tick is a
    // different clock and belongs in the detail.
    this.db.recordAction('mcp', 'give_idea', { text, target, reached: n, tick: s.exp.tick }, runId, Date.now());
    return n;
  }

  /**
   * Finalize a run. Idempotent: a second call after the run is gone does
   * nothing, and a concurrent one joins the first instead of being rejected —
   * both used to throw, which is safe but noisy over MCP and makes a retry
   * look like a failure.
   */
  async finish(runId: number): Promise<void> {
    const inFlight = this.finishing.get(runId);
    if (inFlight) return inFlight;
    if (!this.sessions.has(runId)) return;
    const done = this.finishOnce(runId);
    this.finishing.set(runId, done);
    try {
      await done;
    } finally {
      this.finishing.delete(runId);
    }
  }

  private async finishOnce(runId: number): Promise<void> {
    const s = this.require(runId);
    // Drain first: a think still in flight would otherwise be applied to a world
    // whose recording has closed, i.e. a change with no row anywhere.
    await s.exp.settleCognition();
    this.drainEvents(s);
    this.snapshotMetrics(runId);
    this.snapshotKnowledge(s);
    // Open outcome windows resolve here, so no act is left without its result.
    s.exp.endRecording();
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
