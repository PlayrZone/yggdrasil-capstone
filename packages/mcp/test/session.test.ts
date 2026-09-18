import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ResearchDB } from '@yggdrasil/db';
import { MockMindBackend } from '@yggdrasil/engine';
import type { CognitionOutcome, CognitionRecordV2, ICognitionSink, RunManifest, RunSummary } from '@yggdrasil/engine';
import { SessionManager, corpusRunId } from '../src/SessionManager.js';

class CapturingSink implements ICognitionSink {
  manifest: RunManifest | null = null;
  summary: RunSummary | null = null;
  readonly records: CognitionRecordV2[] = [];
  readonly outcomes: CognitionOutcome[] = [];
  openRun(manifest: RunManifest): void {
    this.manifest = manifest;
  }
  cognition(record: CognitionRecordV2): void {
    this.records.push(record);
  }
  outcome(outcome: CognitionOutcome): void {
    this.outcomes.push(outcome);
  }
  closeRun(summary: RunSummary): void {
    this.summary = summary;
  }
}

describe('SessionManager (engine ⇄ db wiring)', () => {
  let db: ResearchDB;
  let sessions: SessionManager;
  beforeEach(() => {
    db = new ResearchDB(':memory:');
    sessions = new SessionManager(db);
  });
  afterEach(() => db.close());

  it('creates a live run, advances it, and records metrics + events', async () => {
    const runId = sessions.create('mcp-smoke', 40, 0);
    expect(db.getRun(runId)!.status).toBe('running');

    await sessions.advance(runId, 4000);
    const metrics = db.getMetrics(runId);
    // tick 0 snapshot + the advance snapshot
    expect(metrics.length).toBeGreaterThanOrEqual(2);
    const last = metrics[metrics.length - 1]!;
    expect(last.tick).toBe(4000);
    expect(last.alive).toBeGreaterThanOrEqual(0);
    expect(db.getEvents(runId).length).toBeGreaterThan(0);
  });

  it('logs give_idea to the audit trail and reaches living agents', async () => {
    const runId = sessions.create('mcp-idea', 25, 0);
    await sessions.advance(runId, 200);
    const reached = sessions.giveIdea(runId, 'water is by the river', 'all');
    expect(reached).toBeGreaterThan(0);
    const actions = db.readonlyQuery('SELECT action, at, detail FROM actions WHERE run_id = ?', [runId]) as Array<{ action: string; at: number; detail: string }>;
    const idea = actions.find((a) => a.action === 'give_idea');
    expect(idea).toBeDefined();
    // `at` is a wall clock, not the sim tick it used to hold — the audit trail
    // has to be orderable against real time.
    expect(idea!.at).toBeGreaterThan(1_700_000_000_000);
    expect(JSON.parse(idea!.detail)).toMatchObject({ tick: 200, reached });
  });

  it('finishes a run: snapshots knowledge and marks it finished', async () => {
    const runId = sessions.create('mcp-finish', 30, 0);
    await sessions.advance(runId, 3000);
    await sessions.finish(runId);
    expect(db.getRun(runId)!.status).toBe('finished');
    await expect(sessions.advance(runId, 1)).rejects.toThrow(); // session released
  });

  /**
   * The lossy `appendCorpus` path is replaced for new data: a conscious run
   * emits the full record through the sink, and the manifest closes with the
   * run. A reflex run has no cognition at all, so it opens no corpus.
   */
  it('records a conscious run losslessly and a reflex run not at all', async () => {
    const sink = new CapturingSink();
    let made = 0;
    const conscious = new SessionManager(
      db,
      () => new MockMindBackend(),
      () => {
        made++;
        return sink;
      },
    );
    const runId = conscious.create('mcp-corpus', 12, 0);
    // The sanctioned route: without this the backend is wired but never called.
    const woken = conscious.makeConscious(runId, { count: 4 });
    expect(woken).toHaveLength(4);
    await conscious.advance(runId, 600);
    await conscious.finish(runId);

    expect(made).toBe(1);
    expect(sink.manifest).toMatchObject({ runId: corpusRunId(runId), seed: 'mcp-corpus', scenarioId: 'mcp-corpus' });
    expect(sink.records.length).toBeGreaterThan(0);
    expect(sink.records.every((r) => r.prompt.system.length > 0 && r.attempts.length > 0)).toBe(true);
    expect(sink.outcomes.length).toBeGreaterThan(0);
    // finish() closes every open window, so no act is left without a result.
    expect(sink.records.map((r) => r.beingId).every((id) => woken.includes(id))).toBe(true);
    expect(sink.records.every((r) => r.scaffold.madeConsciousAtTick === 0)).toBe(true);
    const counts = sink.summary!.counts;
    expect(counts.recordsWritten).toBe(sink.records.length);
    expect(counts.outcomesWritten).toBe(sink.outcomes.length);
    // Drained before closing, so nothing was left unanswered and nothing dropped.
    expect(counts.promptsSent).toBe(counts.recordsWritten + counts.recordsDropped);
    expect(counts.unanswered).toBe(0);
    expect(counts.recordsDropped).toBe(0);
    expect(sink.summary!.status).toBe('ok');
    // Every act has a result, and every result points at a record on disk.
    const ids = new Set(sink.records.map((r) => r.id));
    for (const o of sink.outcomes) expect(ids.has(o.cognitionId)).toBe(true);

    let reflexSinks = 0;
    const reflex = new SessionManager(db, () => null, () => {
      reflexSinks++;
      return sink;
    });
    const plainRun = reflex.create('mcp-reflex', 12, 0);
    await reflex.advance(plainRun, 200);
    await reflex.finish(plainRun);
    expect(reflexSinks).toBe(0);
  }, 30_000);

  it('is reproducible for a given seed (same recorded metrics)', async () => {
    const a = new SessionManager(new ResearchDB(':memory:'));
    const b = new SessionManager(new ResearchDB(':memory:'));
    const ra = a.create('repro', 30, 0);
    const rb = b.create('repro', 30, 0);
    await a.advance(ra, 2000);
    await b.advance(rb, 2000);
    // Compare via the live sessions' deterministic state.
    expect(a.get(ra)!.exp.aliveCount()).toBe(b.get(rb)!.exp.aliveCount());
    expect(a.get(ra)!.exp.eventCount).toBe(b.get(rb)!.exp.eventCount);
  });
});
