import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ResearchDB } from '../src/index.js';

describe('ResearchDB', () => {
  let db: ResearchDB;
  beforeEach(() => {
    db = new ResearchDB(':memory:');
  });
  afterEach(() => db.close());

  it('creates a run and reads it back', () => {
    const id = db.createRun({ seed: 's1', agentCount: 50, backend: 'reflex', startedAt: 1000, notes: 'first' });
    const run = db.getRun(id);
    expect(run).not.toBeNull();
    expect(run!.seed).toBe('s1');
    expect(run!.agentCount).toBe(50);
    expect(run!.status).toBe('running');
    expect(db.listRuns()).toHaveLength(1);
  });

  it('records and reads a metrics time-series', () => {
    const id = db.createRun({ seed: 's', agentCount: 10, backend: 'reflex', startedAt: 0 });
    for (let t = 0; t < 5; t++) {
      db.recordMetrics(id, {
        tick: t * 100, day: t + 1, alive: 10 - t, totalKnowledge: t * 2,
        exchanges: t, conflicts: 0, sickness: t, shares: 0, seedPlants: 0, sprouts: 0, builds: 0,
      });
    }
    const metrics = db.getMetrics(id);
    expect(metrics).toHaveLength(5);
    expect(metrics[0]!.alive).toBe(10);
    expect(metrics[4]!.totalKnowledge).toBe(8);
  });

  it('records events and filters by type', () => {
    const id = db.createRun({ seed: 's', agentCount: 10, backend: 'reflex', startedAt: 0 });
    db.recordEvents(id, [
      { tick: 1, type: 'GaveItem', actor: 3, payload: { to: 4 } },
      { tick: 2, type: 'AttackedAgent', actor: 5, payload: { target: 6 } },
      { tick: 3, type: 'GaveItem', actor: 7, payload: { to: 8 } },
    ]);
    expect(db.getEvents(id)).toHaveLength(3);
    const gifts = db.getEvents(id, { type: 'GaveItem' });
    expect(gifts).toHaveLength(2);
    expect(gifts[0]!.payload).toEqual({ to: 8 });
  });

  it('records knowledge snapshots and returns the latest tick', () => {
    const id = db.createRun({ seed: 's', agentCount: 10, backend: 'reflex', startedAt: 0 });
    db.recordKnowledge(id, [{ tick: 100, agentId: 1, ruleKey: 'eat:berryBush', status: 'held', confidence: 0.8 }]);
    db.recordKnowledge(id, [{ tick: 200, agentId: 1, ruleKey: 'eat:berryBush', status: 'held', confidence: 0.9 }]);
    const latest = db.getKnowledge(id);
    expect(latest).toHaveLength(1);
    expect(latest[0]!.tick).toBe(200);
    expect(latest[0]!.confidence).toBe(0.9);
  });

  it('logs mutating actions (audit trail)', () => {
    const id = db.createRun({ seed: 's', agentCount: 10, backend: 'reflex', startedAt: 0 });
    db.recordAction('mcp', 'give_idea', { text: 'water is near the river', target: 'all' }, id, 500);
    const rows = db.readonlyQuery('SELECT actor, action FROM actions WHERE run_id = ?', [id]) as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].actor).toBe('mcp');
    expect(rows[0].action).toBe('give_idea');
  });

  it('finishes a run', () => {
    const id = db.createRun({ seed: 's', agentCount: 10, backend: 'reflex', startedAt: 0 });
    db.finishRun(id, 8000, 9999);
    const run = db.getRun(id)!;
    expect(run.status).toBe('finished');
    expect(run.ticks).toBe(8000);
    expect(run.finishedAt).toBe(9999);
  });

  it('rejects non-SELECT readonly queries', () => {
    expect(() => db.readonlyQuery('DELETE FROM runs')).toThrow();
    expect(() => db.readonlyQuery('SELECT 1; DROP TABLE runs')).toThrow();
    expect(() => db.readonlyQuery('UPDATE runs SET seed = 1')).toThrow();
    expect(db.readonlyQuery('SELECT 1 AS one')).toEqual([{ one: 1 }]);
  });
});
