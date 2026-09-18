import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MAX_RESULT_ROWS, QUERY_CHILD_SOURCE, QueryTimeoutError, ResearchDB, liveQueryChildPids } from '../src/index.js';

/**
 * The bounded path runs a query in a child process we can actually kill. A
 * worker thread could not be: `terminate()` cannot unwind a blocking native
 * call, so every timeout stranded a thread spinning a core for the life of the
 * process. Every assertion below is about a PID, because "it timed out" is not
 * the same claim as "the CPU came back".
 */

const RUNAWAY = 'WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c) SELECT count(*) n FROM c';

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

async function waitForExit(pid: number, ms = 5000): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (!isAlive(pid)) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return !isAlive(pid);
}

/** Last resort so a failing assertion never leaves a process on a shared PC. */
function reap(pids: Iterable<number>): void {
  for (const pid of pids) {
    if (!isAlive(pid)) continue;
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
  }
}

describe('time-bounded query (killable child)', () => {
  let dir: string;
  let db: ResearchDB;
  const spawned = new Set<number>();

  const note = (): void => {
    const pid = db.queryChildPid();
    if (pid !== undefined) spawned.add(pid);
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ygg-bq-'));
    db = new ResearchDB(join(dir, 'research.db'));
    db.createRun({ seed: 'bq', agentCount: 1, backend: 'reflex', startedAt: 0 });
  });

  afterEach(async () => {
    const pid = db.queryChildPid();
    db.close();
    if (pid !== undefined) {
      spawned.add(pid);
      await waitForExit(pid, 3000);
    }
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      /* a handle lingering here would itself be a bug the tests below catch */
    }
  });

  afterAll(() => {
    reap(spawned);
    expect(liveQueryChildPids()).toEqual([]);
  });

  it('answers a normal query and keeps the child warm', async () => {
    expect(await db.readonlyQueryBounded('SELECT seed FROM runs', [], 5000)).toEqual([{ seed: 'bq' }]);
    const pid = db.queryChildPid()!;
    note();
    expect(pid).toBeGreaterThan(0);
    expect(isAlive(pid)).toBe(true);

    expect(await db.readonlyQueryBounded('SELECT COUNT(*) AS n FROM runs', [], 5000)).toEqual([{ n: 1 }]);
    expect(db.queryChildPid()).toBe(pid); // reused, not respawned
  });

  it('kills the child on a runaway query and the PID is really gone', async () => {
    await db.readonlyQueryBounded('SELECT 1 AS one', [], 5000);
    const pid = db.queryChildPid()!;
    note();
    expect(isAlive(pid)).toBe(true);

    await expect(db.readonlyQueryBounded(RUNAWAY, [], 800)).rejects.toBeInstanceOf(QueryTimeoutError);
    expect(await waitForExit(pid), `pid ${pid} survived the kill`).toBe(true);
    expect(liveQueryChildPids()).not.toContain(pid);

    // ...and the next query respawns and succeeds.
    expect(await db.readonlyQueryBounded('SELECT seed FROM runs', [], 5000)).toEqual([{ seed: 'bq' }]);
    const next = db.queryChildPid()!;
    note();
    expect(next).not.toBe(pid);
  });

  it('leaves zero extra processes after ten runaway queries in a row', async () => {
    const pids: number[] = [];
    for (let i = 0; i < 10; i++) {
      await expect(db.readonlyQueryBounded(RUNAWAY, [], 300)).rejects.toBeInstanceOf(QueryTimeoutError);
      const pid = db.queryChildPid();
      if (pid !== undefined) {
        pids.push(pid);
        spawned.add(pid);
      }
    }
    for (const pid of pids) expect(await waitForExit(pid), `pid ${pid} still alive`).toBe(true);
    expect(liveQueryChildPids()).toEqual([]);

    expect(await db.readonlyQueryBounded('SELECT seed FROM runs', [], 5000)).toEqual([{ seed: 'bq' }]);
    note();
  }, 30_000);

  it('still refuses writes, stacked statements, ATTACH, PRAGMA and load_extension', async () => {
    for (const sql of [
      'DELETE FROM runs',
      'UPDATE runs SET seed = 1',
      'DROP TABLE runs',
      "INSERT INTO runs (seed, agent_count, backend, started_at) VALUES ('x',1,'r',0)",
      "WITH c AS (SELECT 1) INSERT INTO runs (seed, agent_count, backend, started_at) VALUES ('pwned',1,'r',0)",
      "WITH c AS (SELECT 1) UPDATE runs SET seed = 'pwned'",
      'SELECT 1; DROP TABLE runs',
      "SELECT 1; INSERT INTO runs (seed, agent_count, backend, started_at) VALUES ('x',1,'r',0)",
      "ATTACH DATABASE 'other.db' AS other",
      'PRAGMA table_info(runs)',
      "SELECT load_extension('evil')",
      "SELECT 1 WHERE pragma_query_only(0)",
      '-- comment\nDELETE FROM runs',
      '/* block */ DELETE FROM runs',
    ]) {
      await expect(db.readonlyQueryBounded(sql, [], 5000), sql).rejects.toThrow();
    }
    note();
    expect(await db.readonlyQueryBounded('SELECT COUNT(*) AS n FROM runs', [], 5000)).toEqual([{ n: 1 }]);
    expect(db.getRun(1)!.seed).toBe('bq');
  });

  it('refuses a result too large to hand back instead of ballooning the parent', async () => {
    const before = process.memoryUsage().heapUsed;
    await expect(
      db.readonlyQueryBounded(`WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c WHERE x < 2000000) SELECT x FROM c`, [], 20_000),
    ).rejects.toThrow(/rows|bytes/);
    note();
    expect(process.memoryUsage().heapUsed - before).toBeLessThan(64 * 1024 * 1024);
    expect(await db.readonlyQueryBounded('SELECT seed FROM runs', [], 5000)).toEqual([{ seed: 'bq' }]);
  }, 40_000);

  it('returns a result that fits', async () => {
    const rows = (await db.readonlyQueryBounded(
      `WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c WHERE x < 5000) SELECT x FROM c`,
      [],
      10_000,
    )) as { x: number }[];
    note();
    expect(rows).toHaveLength(5000);
    expect(rows[4999]!.x).toBe(5000);
    expect(MAX_RESULT_ROWS).toBeGreaterThan(5000);
  }, 20_000);

  it('honours a per-call timeout and passes parameters through', async () => {
    expect(await db.readonlyQueryBounded('SELECT seed FROM runs WHERE seed = ?', ['bq'], 5000)).toEqual([{ seed: 'bq' }]);
    expect(await db.readonlyQueryBounded('SELECT seed FROM runs WHERE seed = ?', ['nope'], 5000)).toEqual([]);
    note();
    const t0 = Date.now();
    await expect(db.readonlyQueryBounded(RUNAWAY, [], 400)).rejects.toBeInstanceOf(QueryTimeoutError);
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeGreaterThanOrEqual(350);
    expect(elapsed).toBeLessThan(4000);
  });
});

/**
 * If the PARENT is killed while a query runs, the child must not be left
 * spinning. Its guard is the stdin pipe: when the parent's handle closes, the
 * child sees EOF and exits. Driven through a real intermediate process that we
 * kill externally, since nothing else proves it.
 */
describe('orphan safety', () => {
  const started: number[] = [];
  afterAll(() => reap(started));

  it('the query child exits when its parent is killed mid-query', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ygg-orphan-'));
    try {
      const db = new ResearchDB(join(dir, 'research.db'));
      db.createRun({ seed: 'orphan', agentCount: 1, backend: 'reflex', startedAt: 0 });
      db.close();

      // A generic middle process that spawns the REAL query child the same way
      // BoundedQueryRunner does, reports its pid, then waits to be killed.
      const sourceFile = join(dir, 'child-source.js');
      writeFileSync(sourceFile, QUERY_CHILD_SOURCE);
      const helperFile = join(dir, 'helper.mjs');
      writeFileSync(
        helperFile,
        [
          "import { spawn } from 'node:child_process';",
          "import { readFileSync, writeSync } from 'node:fs';",
          'const [sourceFile, dbFile, sql] = process.argv.slice(2);',
          "const child = spawn(process.execPath, ['-e', readFileSync(sourceFile, 'utf8')], { stdio: ['pipe', 'pipe', 'pipe'] });",
          "child.stdin.write(JSON.stringify({ id: 1, path: dbFile, sql, params: [], maxRows: 1000, maxBytes: 1000000 }) + '\\n');",
          "writeSync(1, child.pid + '\\n');",
          'setTimeout(() => {}, 120000);',
        ].join('\n'),
      );

      const helper = spawn(process.execPath, [helperFile, sourceFile, join(dir, 'research.db'), RUNAWAY], { stdio: ['ignore', 'pipe', 'pipe'] });
      if (helper.pid !== undefined) started.push(helper.pid);

      const childPid = await new Promise<number>((resolve, reject) => {
        let buf = '';
        const to = setTimeout(() => reject(new Error('helper never reported a pid')), 15_000);
        helper.stdout.on('data', (d: Buffer) => {
          buf += d.toString('utf8');
          const nl = buf.indexOf('\n');
          if (nl < 0) return;
          clearTimeout(to);
          resolve(Number.parseInt(buf.slice(0, nl), 10));
        });
        helper.on('error', reject);
      });
      started.push(childPid);
      expect(isAlive(childPid)).toBe(true);

      // Kill the parent, by PID, the way a crash would.
      process.kill(helper.pid!, 'SIGKILL');
      expect(await waitForExit(helper.pid!, 5000)).toBe(true);
      expect(await waitForExit(childPid, 10_000), `orphan ${childPid} survived its parent`).toBe(true);
    } finally {
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
      } catch {
        /* nothing should still hold it */
      }
    }
  }, 40_000);
});
