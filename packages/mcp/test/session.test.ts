import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ResearchDB } from '@yggdrasil/db';
import { SessionManager } from '../src/SessionManager.js';

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
    const actions = db.readonlyQuery('SELECT action, detail FROM actions WHERE run_id = ?', [runId]) as Array<{ action: string }>;
    expect(actions.some((a) => a.action === 'give_idea')).toBe(true);
  });

  it('finishes a run: snapshots knowledge and marks it finished', async () => {
    const runId = sessions.create('mcp-finish', 30, 0);
    await sessions.advance(runId, 3000);
    sessions.finish(runId);
    expect(db.getRun(runId)!.status).toBe('finished');
    await expect(sessions.advance(runId, 1)).rejects.toThrow(); // session released
  });

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
