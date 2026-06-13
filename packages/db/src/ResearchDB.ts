import { createRequire } from 'node:module';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { SCHEMA } from './schema.js';

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

  constructor(path = ':memory:') {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.exec(SCHEMA);
  }

  close(): void {
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

  recordAction(actor: string, action: string, detail?: unknown, runId?: number, at = 0): void {
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
   * Read-only query escape hatch. Rejects anything that isn't a single
   * SELECT (no semicolons, no writes) — the MCP server exposes this so Claude
   * can ask novel research questions without write risk.
   */
  readonlyQuery(sql: string, params: unknown[] = []): unknown[] {
    const trimmed = sql.trim().replace(/;+\s*$/, '');
    if (
      !/^select\b/i.test(trimmed) ||
      /;/.test(trimmed) ||
      /\b(insert|update|delete|drop|alter|create|attach|pragma|replace)\b/i.test(trimmed)
    ) {
      throw new Error('readonlyQuery accepts a single SELECT statement only');
    }
    return this.db.prepare(trimmed).all(...(params as never[])) as unknown[];
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
