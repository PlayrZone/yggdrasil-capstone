import { spawn, type ChildProcess } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';

/**
 * A wall-clock bound on a read-only query, enforced by a process we can kill.
 *
 * `node:sqlite` runs a statement inside one synchronous native call and exposes
 * no progress handler or `sqlite3_interrupt`, so a runaway query — the classic
 * being `WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c) SELECT
 * count(*) FROM c` — pins whatever thread it runs on for good. On the MCP
 * server's only thread that means the server never answers again.
 *
 * A worker thread was the first attempt and was wrong: `terminate()` cannot
 * unwind a blocking native call, so every timeout stranded a thread spinning a
 * core and holding a read handle on the DB for the life of the process. A child
 * process can simply be killed, and the OS reclaims the CPU and the handle.
 *
 * The child is kept WARM (Node startup measured ~57 ms on this machine, versus
 * ~2 ms for a query on a warm one) but opens and closes its read-only
 * connection per query, so an idle runner holds no handle on the database file.
 * It is respawned only after a kill.
 */

/**
 * The child program, inlined as source and run with `node -e`. A separate file
 * would have to be resolved differently under `tsx src/index.ts`, from `dist/`
 * and under Vitest; a string has no path to resolve. It is plain CommonJS and
 * requires nothing but Node built-ins.
 *
 * Exported so a test can spawn the same child the runner does.
 * @internal
 */
export const QUERY_CHILD_SOURCE = `
'use strict';
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

function writeAll(text) {
  const b = Buffer.from(text, 'utf8');
  let off = 0;
  while (off < b.length) {
    try { off += fs.writeSync(1, b, off, b.length - off); }
    catch (e) { if (e.code === 'EAGAIN') continue; return; }
  }
}
function send(obj) { writeAll(JSON.stringify(obj) + '\\n'); }

// The parent dying closes this pipe. Exiting on EOF is what keeps a killed
// parent from leaving an orphan spinning inside SQLite forever.
const bye = () => process.exit(0);
process.stdin.on('end', bye);
process.stdin.on('close', bye);
process.stdin.on('error', bye);
process.stdin.setEncoding('utf8');

let buf = '';
process.stdin.on('data', (d) => {
  buf += d;
  for (;;) {
    const nl = buf.indexOf('\\n');
    if (nl < 0) break;
    const line = buf.slice(0, nl);
    buf = buf.slice(nl + 1);
    if (line) handle(line);
  }
});

function handle(line) {
  let req = null;
  let db = null;
  try {
    req = JSON.parse(line);
    db = new DatabaseSync(req.path, { readOnly: true });
    const stmt = db.prepare(req.sql);
    // prepare() compiles only the first statement and discards the rest, so
    // comparing what it took proves nothing rode in behind a semicolon.
    if (stmt.sourceSQL.replace(/[\\s;]+$/, '') !== req.sql) {
      throw new Error('readonlyQuery accepts a single statement only');
    }
    const parts = [];
    let bytes = 2;
    // iterate(), not all(): rows are counted and measured as they arrive, so an
    // unbounded SELECT is refused instead of being materialised in full.
    for (const row of stmt.iterate(...req.params)) {
      const s = JSON.stringify(row);
      bytes += s.length + 1;
      if (parts.length >= req.maxRows) throw new Error('result exceeds ' + req.maxRows + ' rows — add a LIMIT');
      if (bytes > req.maxBytes) throw new Error('result exceeds ' + req.maxBytes + ' bytes — add a LIMIT');
      parts.push(s);
    }
    writeAll('{"id":' + req.id + ',"rows":[' + parts.join(',') + ']}\\n');
  } catch (e) {
    send({ id: req && req.id, error: String((e && e.message) || e) });
  } finally {
    if (db) { try { db.close(); } catch (e) { /* already closed */ } }
  }
}
`;

export const DEFAULT_QUERY_TIMEOUT_MS = 5_000;
/** Ceilings on what one query may hand back, enforced in the child. */
export const MAX_RESULT_ROWS = 100_000;
export const MAX_RESULT_BYTES = 8 * 1024 * 1024;

export class QueryTimeoutError extends Error {}

const livePids = new Set<number>();

/**
 * PIDs of query children this process currently owns. Self-cleaning: a child's
 * `exit` event lands a turn or more after the OS has reaped it, and a stale
 * entry here would be exactly the lie this rework exists to remove.
 */
export function liveQueryChildPids(): number[] {
  for (const pid of [...livePids]) {
    try {
      process.kill(pid, 0);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EPERM') livePids.delete(pid);
    }
  }
  return [...livePids];
}

interface Reply {
  id?: number;
  rows?: unknown[];
  error?: string;
}

/**
 * With `stdio: 'pipe'` the child's streams are `net.Socket`s and really do have
 * `unref`, but ChildProcess only types them as Readable/Writable — hence the cast.
 */
function unrefStream(s: Readable | Writable | null): void {
  (s as { unref?: () => void } | null)?.unref?.();
}

/**
 * Owns one warm child for a single database file. Queries are serialized: the
 * protocol is one request line in, one reply line out, and `query_db` is a
 * human-paced research tool, not a hot path.
 */
export class BoundedQueryRunner {
  private child: ChildProcess | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private nextId = 1;
  private stderrTail = '';

  constructor(private readonly dbPath: string) {}

  /** The warm child's pid, or undefined when none is running. */
  get childPid(): number | undefined {
    return this.child?.pid;
  }

  run(sql: string, params: unknown[], timeoutMs: number): Promise<unknown[]> {
    const attempt = (): Promise<unknown[]> => this.runOne(sql, params, timeoutMs);
    const task = this.queue.then(attempt, attempt);
    this.queue = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }

  close(): void {
    this.killChild();
  }

  private alive(c: ChildProcess | null): c is ChildProcess {
    return !!c && c.exitCode === null && c.signalCode === null;
  }

  private ensureChild(): ChildProcess {
    if (this.alive(this.child)) return this.child;
    const env = { ...process.env };
    // The child is self-contained CommonJS; a loader the parent happens to be
    // running under (tsx) must not be injected into it.
    delete env['NODE_OPTIONS'];
    const child = spawn(process.execPath, ['-e', QUERY_CHILD_SOURCE], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env,
    });
    // An idle warm child must not hold the parent open. While a query is in
    // flight its timeout timer keeps the loop alive.
    child.unref();
    // The stdio streams are pipes (net.Socket) and do have unref, but the
    // ChildProcess types only promise Readable/Writable, hence the soft call.
    unrefStream(child.stdin);
    unrefStream(child.stdout);
    unrefStream(child.stderr);
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (d: string) => {
      this.stderrTail = (this.stderrTail + d).slice(-2048);
    });
    if (child.pid !== undefined) livePids.add(child.pid);
    child.on('exit', () => {
      if (child.pid !== undefined) livePids.delete(child.pid);
      if (this.child === child) this.child = null;
    });
    child.on('error', () => {
      if (this.child === child) this.child = null;
    });
    this.child = child;
    return child;
  }

  private killChild(): void {
    const c = this.child;
    this.child = null;
    if (!c) return;
    const pid = c.pid;
    // Disown it now rather than when the `exit` event eventually arrives.
    if (pid !== undefined) livePids.delete(pid);
    try {
      c.stdin?.destroy();
    } catch {
      /* already gone */
    }
    try {
      // Windows maps this to TerminateProcess; on POSIX the child installs no
      // SIGTERM handler, so the default action kills it even mid-syscall.
      c.kill();
    } catch {
      /* already gone */
    }
    if (pid === undefined) return;
    const sigkill = setTimeout(() => {
      if (c.exitCode !== null || c.signalCode !== null) return;
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        /* already gone */
      }
    }, 250);
    sigkill.unref();
  }

  private runOne(sql: string, params: unknown[], timeoutMs: number): Promise<unknown[]> {
    return new Promise<unknown[]>((resolve, reject) => {
      let child: ChildProcess;
      try {
        child = this.ensureChild();
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
        return;
      }
      const id = this.nextId++;
      let out = '';
      let settled = false;

      const detach = (): void => {
        clearTimeout(timer);
        child.stdout?.off('data', onData);
        child.off('exit', onExit);
        child.off('error', onError);
      };
      const finish = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        detach();
        fn();
      };

      const onData = (d: Buffer): void => {
        out += d.toString('utf8');
        // The child caps its own reply; this is the parent's independent guard
        // against a child that does not.
        if (out.length > MAX_RESULT_BYTES * 2) {
          this.killChild();
          finish(() => reject(new Error('query result exceeded the transfer limit')));
          return;
        }
        const nl = out.indexOf('\n');
        if (nl < 0) return;
        const line = out.slice(0, nl);
        let msg: Reply;
        try {
          msg = JSON.parse(line) as Reply;
        } catch {
          this.killChild();
          finish(() => reject(new Error('query child sent a malformed reply')));
          return;
        }
        if (msg.id !== id) return; // a stale reply cannot happen (we serialize), but never mix them up
        finish(() => {
          if (msg.error !== undefined) reject(new Error(msg.error));
          else resolve(msg.rows ?? []);
        });
      };

      const onExit = (code: number | null, signal: string | null): void => {
        const why = this.stderrTail.trim();
        finish(() => reject(new Error(`query child exited (${signal ?? code})${why ? `: ${why}` : ''}`)));
      };
      const onError = (e: Error): void => finish(() => reject(e));

      const timer = setTimeout(() => {
        this.killChild();
        finish(() => reject(new QueryTimeoutError(`query exceeded ${timeoutMs} ms and was killed`)));
      }, timeoutMs);

      child.stdout?.on('data', onData);
      child.once('exit', onExit);
      child.once('error', onError);

      const request = { id, path: this.dbPath, sql, params, maxRows: MAX_RESULT_ROWS, maxBytes: MAX_RESULT_BYTES };
      try {
        child.stdin?.write(`${JSON.stringify(request)}\n`);
      } catch (e) {
        this.killChild();
        finish(() => reject(e instanceof Error ? e : new Error(String(e))));
      }
    });
  }
}
