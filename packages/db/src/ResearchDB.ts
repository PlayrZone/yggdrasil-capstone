import { createRequire } from 'node:module';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { SCHEMA } from './schema.js';
import { BoundedQueryRunner, DEFAULT_QUERY_TIMEOUT_MS } from './boundedQuery.js';

// Loaded via createRequire so bundlers (Vite/vitest) don't try to resolve the
// `node:sqlite` specifier at transform time — it's a recent built-in some
// toolchains don't recognize yet. The type import above is erased at compile.
const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

export interface RunConfig {
  seed: string;
  agentCount: number;
  backend: string;
  startedAt: number;
  notes?: string;
}

export interface MetricsRow {
  tick: number;
  day: number;
  alive: number;
  totalKnowledge: number;
  exchanges: number;
  conflicts: number;
  sickness: number;
  shares: number;
  seedPlants: number;
  sprouts: number;
  builds: number;
}

export interface EventRow {
  tick: number;
  type: string;
  actor: number | null;
  payload?: unknown;
}

export interface KnowledgeRow {
  tick: number;
  agentId: number;
  ruleKey: string;
  status: string;
  confidence: number;
}

export interface RunSummary extends RunConfig {
  id: number;
  status: string;
  finishedAt: number | null;
  ticks: number;
}

type SqlRow = Record<string, unknown>;

/**
 * The research store. One SQLite file (or `:memory:` for tests) holds every
 * run. Built on Node's own `node:sqlite` — zero native build step, runs on
 * the same Node as the engine. The store is deliberately dumb: it records
 * what the host hands it and answers queries. It never simulates and never
 * decides; that keeps the science reproducible and the writes auditable.
 */
export class ResearchDB {
  private readonly db: DatabaseSyncType;
  private readonly path: string;
  /** Lazily opened SQLITE_OPEN_READONLY handle used by `readonlyQuery`. */
  private reader: DatabaseSyncType | null = null;
  private readerUnavailable = false;
  /** Lazily spawned warm child that runs time-bounded queries. */
  private runner: BoundedQueryRunner | null = null;

  constructor(path = ':memory:') {
    this.path = path;
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.runner?.close();
    this.runner = null;
    if (this.reader) {
      try {
        this.reader.close();
      } catch {
        /* already closed */
      }
      this.reader = null;
    }
    this.db.close();
  }

  /** Create a run record; returns its id. */
  createRun(config: RunConfig): number {
    const info = this.db
      .prepare(`INSERT INTO runs (seed, agent_count, backend, started_at, notes) VALUES (?, ?, ?, ?, ?)`)
      .run(config.seed, config.agentCount, config.backend, config.startedAt, config.notes ?? null);
    return Number(info.lastInsertRowid);
  }

  recordMetrics(runId: number, row: MetricsRow): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO metrics
         (run_id, tick, day, alive, total_knowledge, exchanges, conflicts,
          sickness, shares, seed_plants, sprouts, builds)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        runId, row.tick, row.day, row.alive, row.totalKnowledge, row.exchanges,
        row.conflicts, row.sickness, row.shares, row.seedPlants, row.sprouts, row.builds,
      );
  }

  recordEvents(runId: number, rows: EventRow[]): void {
    const stmt = this.db.prepare(`INSERT INTO events (run_id, tick, type, actor, payload) VALUES (?, ?, ?, ?, ?)`);
    this.db.exec('BEGIN');
    try {
      for (const e of rows) {
        stmt.run(runId, e.tick, e.type, e.actor ?? null, e.payload === undefined ? null : JSON.stringify(e.payload));
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  recordKnowledge(runId: number, rows: KnowledgeRow[]): void {
    const stmt = this.db.prepare(
      `INSERT OR REPLACE INTO knowledge_snapshots (run_id, tick, agent_id, rule_key, status, confidence) VALUES (?, ?, ?, ?, ?, ?)`,
    );
    this.db.exec('BEGIN');
    try {
      for (const k of rows) stmt.run(runId, k.tick, k.agentId, k.ruleKey, k.status, k.confidence);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  /**
   * Append to the audit trail. `at` defaults to the wall clock: it used to
   * default to 0 and no caller ever passed one, so every mutation ever recorded
   * claimed to have happened at the epoch and the log could not be ordered.
   * Callers with a meaningful clock (a sim tick belongs in `detail`, not here)
   * may still pass one explicitly.
   */
  recordAction(actor: string, action: string, detail?: unknown, runId?: number, at: number = Date.now()): void {
    this.db
      .prepare(`INSERT INTO actions (run_id, at, actor, action, detail) VALUES (?, ?, ?, ?, ?)`)
      .run(runId ?? null, at, actor, action, detail === undefined ? null : JSON.stringify(detail));
  }

  finishRun(runId: number, ticks: number, finishedAt: number, status = 'finished'): void {
    this.db.prepare(`UPDATE runs SET status = ?, ticks = ?, finished_at = ? WHERE id = ?`).run(status, ticks, finishedAt, runId);
  }

  // ── reads ──────────────────────────────────────────────────────────────────
  listRuns(limit = 50): RunSummary[] {
    return (this.db.prepare(`SELECT * FROM runs ORDER BY id DESC LIMIT ?`).all(limit) as SqlRow[]).map(mapRun);
  }

  getRun(runId: number): RunSummary | null {
    const row = this.db.prepare(`SELECT * FROM runs WHERE id = ?`).get(runId) as SqlRow | undefined;
    return row ? mapRun(row) : null;
  }

  getMetrics(runId: number): MetricsRow[] {
    return (this.db.prepare(`SELECT * FROM metrics WHERE run_id = ? ORDER BY tick`).all(runId) as SqlRow[]).map((r) => ({
      tick: Number(r['tick']),
      day: Number(r['day']),
      alive: Number(r['alive']),
      totalKnowledge: Number(r['total_knowledge']),
      exchanges: Number(r['exchanges']),
      conflicts: Number(r['conflicts']),
      sickness: Number(r['sickness']),
      shares: Number(r['shares']),
      seedPlants: Number(r['seed_plants']),
      sprouts: Number(r['sprouts']),
      builds: Number(r['builds']),
    }));
  }

  getEvents(runId: number, opts: { type?: string; limit?: number; sinceTick?: number } = {}): EventRow[] {
    const clauses = ['run_id = ?'];
    const params: unknown[] = [runId];
    if (opts.type) {
      clauses.push('type = ?');
      params.push(opts.type);
    }
    if (opts.sinceTick !== undefined) {
      clauses.push('tick >= ?');
      params.push(opts.sinceTick);
    }
    params.push(opts.limit ?? 200);
    const rows = this.db
      .prepare(`SELECT tick, type, actor, payload FROM events WHERE ${clauses.join(' AND ')} ORDER BY id DESC LIMIT ?`)
      .all(...(params as never[])) as SqlRow[];
    return rows.map((r) => ({
      tick: Number(r['tick']),
      type: String(r['type']),
      actor: r['actor'] == null ? null : Number(r['actor']),
      payload: r['payload'] ? JSON.parse(String(r['payload'])) : undefined,
    }));
  }

  /** Latest knowledge snapshot tick for a run (or a specific tick). */
  getKnowledge(runId: number, tick?: number): KnowledgeRow[] {
    const atTick =
      tick ?? (this.db.prepare(`SELECT MAX(tick) AS t FROM knowledge_snapshots WHERE run_id = ?`).get(runId) as SqlRow | undefined)?.['t'];
    if (atTick == null) return [];
    const rows = this.db
      .prepare(`SELECT tick, agent_id, rule_key, status, confidence FROM knowledge_snapshots WHERE run_id = ? AND tick = ?`)
      .all(runId, Number(atTick)) as SqlRow[];
    return rows.map((r) => ({
      tick: Number(r['tick']),
      agentId: Number(r['agent_id']),
      ruleKey: String(r['rule_key']),
      status: String(r['status']),
      confidence: Number(r['confidence']),
    }));
  }

  /**
   * A genuinely read-only connection to the same file. `node:sqlite` supports
   * SQLITE_OPEN_READONLY, so the guarantee is SQLite's, not a regex's. An
   * in-memory database has no file to reopen (a second `:memory:` handle is a
   * different, empty database), so that case falls back to `PRAGMA query_only`
   * on the main connection — also enforced by SQLite, just not by the handle.
   */
  private readOnlyConnection(): DatabaseSyncType | null {
    if (this.path === ':memory:' || this.readerUnavailable) return null;
    if (!this.reader) {
      try {
        this.reader = new DatabaseSync(this.path, { readOnly: true });
      } catch {
        this.readerUnavailable = true;
        return null;
      }
    }
    return this.reader;
  }

  /**
   * Read-only query escape hatch — the MCP server exposes this so a client can
   * ask novel research questions without write risk.
   *
   * The old gate was a regex denylist over raw SQL: it rejected `SELECT
   * 'update'`, and it rejected every legitimate `WITH … SELECT` because the
   * prefix had to be `select`. Allowing `WITH` is what a researcher needs and
   * is exactly what a text check cannot make safe (`WITH x AS (…) INSERT …`
   * is a write), so the guarantee moves to SQLite:
   *  1. the statement must parse as a single query starting with SELECT/WITH —
   *     `prepare` compiles only the first statement, so `sourceSQL` proves
   *     nothing was smuggled behind a semicolon and silently dropped;
   *  2. it executes on a connection SQLite itself refuses writes on.
   */
  readonlyQuery(sql: string, params: unknown[] = []): unknown[] {
    const trimmed = normalizeReadQuery(sql);
    const reader = this.readOnlyConnection();
    const conn = reader ?? this.db;
    if (!reader) conn.exec('PRAGMA query_only = ON');
    try {
      const stmt = conn.prepare(trimmed);
      // `prepare` compiles the first statement and discards the rest; compare
      // what it actually compiled so a piggy-backed statement is an error and
      // never a silent no-op.
      if (stmt.sourceSQL.replace(/[\s;]+$/, '') !== trimmed) throw new Error('readonlyQuery accepts a single statement only');
      return stmt.all(...(params as never[])) as unknown[];
    } finally {
      if (!reader) conn.exec('PRAGMA query_only = OFF');
    }
  }

  /**
   * The same query, with a wall-clock bound — what every untrusted caller (the
   * MCP `query_db` tool) must use. `readonlyQuery` is synchronous and therefore
   * unbounded: one recursive CTE pins the thread for the life of the process.
   *
   * A file-backed database gets a worker with its own read-only connection (see
   * boundedQuery.ts). `:memory:` has no file for a second connection to open —
   * a second `:memory:` handle is a different, empty database — so it falls back
   * to the synchronous path. Tests use `:memory:`; the MCP server never does.
   */
  async readonlyQueryBounded(sql: string, params: unknown[] = [], timeoutMs = DEFAULT_QUERY_TIMEOUT_MS): Promise<unknown[]> {
    const trimmed = normalizeReadQuery(sql);
    if (this.path === ':memory:') return this.readonlyQuery(trimmed, params);
    this.runner ??= new BoundedQueryRunner(this.path);
    return this.runner.run(trimmed, params, timeoutMs);
  }

  /** The warm query child's pid, when one is running. Diagnostics and tests. */
  queryChildPid(): number | undefined {
    return this.runner?.childPid;
  }
}

/**
 * Shared front gate: a single statement that starts with SELECT or WITH, with
 * leading comments and trailing whitespace/semicolons removed. Enforcement of
 * read-onlyness is SQLite's job; this only decides what is worth running.
 */
function normalizeReadQuery(sql: string): string {
  if (typeof sql !== 'string') throw new Error('readonlyQuery expects SQL text');
  const trimmed = stripLeadingComments(sql).replace(/[\s;]+$/, '');
  if (!/^(select|with)\b/i.test(trimmed)) throw new Error('readonlyQuery accepts a single SELECT (or WITH … SELECT) statement only');
  return trimmed;
}

/** SQL comments before the first keyword would defeat a prefix check. */
function stripLeadingComments(sql: string): string {
  let s = sql;
  for (;;) {
    const before = s;
    s = s.trimStart();
    if (s.startsWith('--')) {
      const nl = s.indexOf('\n');
      s = nl < 0 ? '' : s.slice(nl + 1);
    } else if (s.startsWith('/*')) {
      const end = s.indexOf('*/');
      s = end < 0 ? '' : s.slice(end + 2);
    }
    if (s === before) return s;
  }
}

function mapRun(r: SqlRow): RunSummary {
  return {
    id: Number(r['id']),
    seed: String(r['seed']),
    agentCount: Number(r['agent_count']),
    backend: String(r['backend']),
    status: String(r['status']),
    startedAt: Number(r['started_at']),
    finishedAt: r['finished_at'] == null ? null : Number(r['finished_at']),
    ticks: Number(r['ticks']),
    notes: r['notes'] == null ? undefined : String(r['notes']),
  };
}
