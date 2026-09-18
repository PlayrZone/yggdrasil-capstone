import { Worker } from 'node:worker_threads';

/**
 * A wall-clock bound on a read-only query.
 *
 * `node:sqlite` runs a statement inside one synchronous native call and exposes
 * no progress handler or `sqlite3_interrupt`, so a runaway query — the classic
 * being `WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c) SELECT
 * count(*) FROM c` — pins the thread it runs on for good. On the MCP server's
 * only thread that means the server never answers again. So the query runs on a
 * worker with its OWN read-only connection to the database file, and the caller
 * gets a timeout while the main thread stays responsive.
 *
 * Honest limit: `terminate()` cannot unwind a thread that is inside a blocking
 * native call — the terminate promise never settles and the thread keeps
 * spinning until the process exits, holding a read handle on the DB file. That
 * is why leaked workers are counted and capped: two runaway queries degrade the
 * `query_db` tool, they do not get to consume the machine.
 */

/**
 * The worker body, inlined as source rather than shipped as a file. A separate
 * `.ts` worker would need a TypeScript loader registered per-thread (tsx's hook
 * is thread-local), and a separate `.js` worker would have to be resolved
 * differently under `tsx src/index.ts` than from `dist/`. An eval'd CommonJS
 * string resolves identically everywhere — dev, built output and vitest.
 */
const WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads');
const { DatabaseSync } = require('node:sqlite');
try {
  const db = new DatabaseSync(workerData.path, { readOnly: true });
  try {
    const stmt = db.prepare(workerData.sql);
    if (stmt.sourceSQL.replace(/[\\s;]+$/, '') !== workerData.sql) {
      throw new Error('readonlyQuery accepts a single statement only');
    }
    parentPort.postMessage({ rows: stmt.all(...workerData.params) });
  } finally {
    db.close();
  }
} catch (e) {
  parentPort.postMessage({ error: String((e && e.message) || e) });
}
`;

export const DEFAULT_QUERY_TIMEOUT_MS = 5_000;
/** How many threads a stream of runaway queries may strand before we refuse. */
const MAX_STRANDED = 2;

let stranded = 0;

/** For tests and diagnostics: threads a timeout left spinning. */
export function strandedQueryWorkers(): number {
  return stranded;
}

export class QueryTimeoutError extends Error {}

export function runBoundedQuery(path: string, sql: string, params: unknown[], timeoutMs = DEFAULT_QUERY_TIMEOUT_MS): Promise<unknown[]> {
  if (stranded >= MAX_STRANDED) {
    return Promise.reject(
      new QueryTimeoutError(`too many queries have timed out (${stranded} threads still stuck); restart the server before running another one`),
    );
  }
  return new Promise<unknown[]>((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(WORKER_SOURCE, { eval: true, workerData: { path, sql, params } });
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
      return;
    }
    // Never let a query hold the process open.
    worker.unref();

    let settled = false;
    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    const timer = setTimeout(() => {
      stranded++;
      // Fire and forget: awaiting this would reintroduce the very hang we are
      // bounding, because terminate() cannot interrupt the native call.
      void worker.terminate().then(
        () => {
          stranded--;
        },
        () => {
          stranded--;
        },
      );
      settle(() => reject(new QueryTimeoutError(`query exceeded ${timeoutMs} ms and was abandoned`)));
    }, timeoutMs);

    worker.on('message', (m: { rows?: unknown[]; error?: string }) => {
      settle(() => {
        void worker.terminate();
        if (m.error !== undefined) reject(new Error(m.error));
        else resolve(m.rows ?? []);
      });
    });
    worker.on('error', (e: Error) => settle(() => reject(e)));
    worker.on('exit', (code) => settle(() => reject(new Error(`query worker exited (${code})`))));
  });
}
