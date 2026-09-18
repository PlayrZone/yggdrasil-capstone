import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

  it('timestamps an action with the wall clock by default (it used to default to 0)', () => {
    const before = Date.now();
    db.recordAction('mcp', 'advance', { ticks: 96 });
    const after = Date.now();
    const [row] = db.readonlyQuery('SELECT at FROM actions') as { at: number }[];
    expect(row!.at).toBeGreaterThanOrEqual(before);
    expect(row!.at).toBeLessThanOrEqual(after);
  });

  it('orders the audit trail by time', () => {
    db.recordAction('mcp', 'create_experiment', {}, undefined, 1_700_000_000_000);
    db.recordAction('mcp', 'advance', {}, undefined, 1_700_000_001_000);
    db.recordAction('mcp', 'finish_run', {}, undefined, 1_700_000_002_000);
    const rows = db.readonlyQuery('SELECT action FROM actions ORDER BY at') as { action: string }[];
    expect(rows.map((r) => r.action)).toEqual(['create_experiment', 'advance', 'finish_run']);
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

describe('readonlyQuery', () => {
  let db: ResearchDB;
  beforeEach(() => {
    db = new ResearchDB(':memory:');
    db.createRun({ seed: 'rq', agentCount: 1, backend: 'reflex', startedAt: 0 });
  });
  afterEach(() => db.close());

  it('runs the reads a researcher actually writes', () => {
    expect(db.readonlyQuery('SELECT seed FROM runs')).toEqual([{ seed: 'rq' }]);
    expect(db.readonlyQuery('  select count(*) AS n from runs ')).toEqual([{ n: 1 }]);
    expect(db.readonlyQuery('SELECT seed FROM runs WHERE seed = ?', ['rq'])).toEqual([{ seed: 'rq' }]);
    expect(db.readonlyQuery('WITH c AS (SELECT seed FROM runs) SELECT seed FROM c')).toEqual([{ seed: 'rq' }]);
    expect(db.readonlyQuery('SELECT 1 AS one;')).toEqual([{ one: 1 }]);
    expect(db.readonlyQuery('SELECT\n  seed\nFROM runs')).toEqual([{ seed: 'rq' }]);
  });

  it('no longer rejects a SELECT that merely mentions a write keyword', () => {
    // False positives of the old regex denylist — all perfectly safe reads.
    expect(db.readonlyQuery("SELECT 'update' AS x")).toEqual([{ x: 'update' }]);
    expect(db.readonlyQuery("SELECT 'drop table' AS x")).toEqual([{ x: 'drop table' }]);
    expect(db.readonlyQuery("SELECT seed FROM runs WHERE seed != 'delete'")).toEqual([{ seed: 'rq' }]);
  });

  it('refuses statements that are not a single query', () => {
    for (const sql of [
      'DELETE FROM runs',
      'UPDATE runs SET seed = 1',
      'DROP TABLE runs',
      "INSERT INTO runs (seed, agent_count, backend, started_at) VALUES ('x',1,'r',0)",
      "ATTACH DATABASE 'other.db' AS other",
      'PRAGMA table_info(runs)',
      'SELECT 1; DROP TABLE runs',
      "SELECT 1; INSERT INTO runs (seed, agent_count, backend, started_at) VALUES ('x',1,'r',0)",
      '-- comment\nDELETE FROM runs',
      '/* block */ DELETE FROM runs',
      '',
    ]) {
      expect(() => db.readonlyQuery(sql), sql).toThrow();
    }
    expect(db.readonlyQuery('SELECT COUNT(*) AS n FROM runs')).toEqual([{ n: 1 }]);
  });

  it('is enforced by SQLite, not by text matching: a CTE write is blocked at execution', () => {
    // `WITH` has to be allowed for real research queries, and a `WITH … INSERT`
    // passes every prefix check — so the guarantee has to come from the
    // connection, and it does.
    expect(() => db.readonlyQuery("WITH c AS (SELECT 1) INSERT INTO runs (seed, agent_count, backend, started_at) VALUES ('pwned',1,'r',0)")).toThrow();
    expect(db.readonlyQuery('SELECT COUNT(*) AS n FROM runs')).toEqual([{ n: 1 }]);
  });

  it('leaves the connection writable afterwards', () => {
    expect(() => db.readonlyQuery('SELECT 1 AS one')).not.toThrow();
    expect(() => db.readonlyQuery('DELETE FROM runs')).toThrow();
    const id = db.createRun({ seed: 'after', agentCount: 1, backend: 'reflex', startedAt: 0 });
    expect(db.getRun(id)!.seed).toBe('after');
  });

  it('falls back to the synchronous path for an in-memory database', async () => {
    expect(await db.readonlyQueryBounded('SELECT seed FROM runs')).toEqual([{ seed: 'rq' }]);
    await expect(db.readonlyQueryBounded('DELETE FROM runs')).rejects.toThrow();
  });

  it('uses a real read-only connection for a file-backed database', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ygg-db-'));
    const file = new ResearchDB(join(dir, 'research.db'));
    try {
      const id = file.createRun({ seed: 'onDisk', agentCount: 2, backend: 'reflex', startedAt: 7 });
      expect(file.readonlyQuery('SELECT seed FROM runs')).toEqual([{ seed: 'onDisk' }]);
      expect(() => file.readonlyQuery("WITH c AS (SELECT 1) INSERT INTO runs (seed, agent_count, backend, started_at) VALUES ('pwned',1,'r',0)")).toThrow();
      // The reader sees writes committed after it was opened.
      file.finishRun(id, 96, 8);
      expect(file.readonlyQuery('SELECT status FROM runs')).toEqual([{ status: 'finished' }]);
    } finally {
      file.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
