#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { ResearchDB } from '@yggdrasil/db';
import { MATERIAL_PROPERTIES, WORLD } from '@yggdrasil/engine';
import { SessionManager } from './SessionManager.js';

/**
 * Yggdrasil Lab MCP server. Lets an MCP client (Claude) run, watch, query,
 * and steer artificial-life experiments — never the codebase shell.
 *
 * Safety contract (yggdrasil mcp plan):
 *  - Read-first: query tools are the default surface.
 *  - Mutations are an explicit, small allowlist (create/advance/give_idea/
 *    finish). No arbitrary shell, no file writes, no eval.
 *  - Every mutation is logged to the research DB's append-only `actions`
 *    table (auditable).
 *  - Doctrine: only the human gives ideas. `give_idea` is the human's channel
 *    (the client relays the human's words); the engine never seeds ideas.
 */

const DB_PATH = resolve(process.env['YGG_DB'] ?? '.yggdrasil/research.db');
mkdirSync(dirname(DB_PATH), { recursive: true });
const db = new ResearchDB(DB_PATH);
const sessions = new SessionManager(db);

const server = new McpServer({ name: 'yggdrasil-lab', version: '0.1.0' });

const text = (s: string): { content: { type: 'text'; text: string }[] } => ({
  content: [{ type: 'text', text: s }],
});
const json = (v: unknown): { content: { type: 'text'; text: string }[] } => text(JSON.stringify(v, null, 2));

const MUTATING = new Set(['create_experiment', 'advance', 'give_idea', 'finish_run', 'run_experiment']);
function logMutation(tool: string, detail: unknown, runId?: number): void {
  if (!MUTATING.has(tool)) return;
  db.recordAction('mcp', tool, detail, runId);
}

// ── describe_lab ───────────────────────────────────────────────────────────────
server.registerTool(
  'describe_lab',
  {
    title: 'Describe the lab',
    description: 'The Yggdrasil Lab architecture, the learning loop, the anti-NPC doctrine, and the MCP safety contract. Read this first.',
    inputSchema: {},
  },
  async () =>
    text(
      [
        'YGGDRASIL LAB — artificial-life & emergent-civilization research engine.',
        '',
        'The loop: World Physics → Body → Experience → Memory → Machine Learning',
        '→ Knowledge → LLM Consciousness → Action → World Physics.',
        '',
        'Four separated systems: BODY (deterministic world physics + needs),',
        'MEMORY (episodic stream), LEARNING (deterministic statistical miners',
        'form knowledge from experience), CONSCIOUSNESS (LLM reasons over learned',
        'knowledge only — it is not the source of knowledge; the world is).',
        '',
        'Anti-NPC doctrine: no roles, jobs, factions, leaders, governments, or',
        'religions are ever assigned. They may EMERGE through behavior and',
        'knowledge transfer. Analysis only labels observed patterns post-hoc;',
        'labels are never written back into the simulation.',
        '',
        'Only the human gives ideas (via give_idea). The engine seeds nothing.',
        '',
        'MCP safety: read-first; mutations are allowlisted (create_experiment,',
        'advance, give_idea, finish_run, run_experiment) and every one is logged',
        'to the research DB. No shell, no file writes, no eval.',
      ].join('\n'),
    ),
);

// ── list_materials / list_regions ──────────────────────────────────────────────
server.registerTool(
  'list_materials',
  {
    title: 'List world materials',
    description: 'The materials the world is made of, as PROPERTIES (edible/poisonous/tier/…) — never recipes. Gahallians must discover these; this is the ground truth, for the researcher.',
    inputSchema: {},
  },
  async () => json(MATERIAL_PROPERTIES),
);

server.registerTool(
  'list_regions',
  {
    title: 'Describe world geography',
    description: 'The unequal continent: which resources are keyed to which regions (river valley / coast / forest / mountains / hills / plains) and the world size.',
    inputSchema: {},
  },
  async () =>
    text(
      [
        `World size: ${WORLD}×${WORLD}.`,
        'Regions (deliberately unequal — the inequality drives trade/migration/conflict):',
        '- river valley: drinking water + abundant berry/tuber food (breadbasket)',
        '- coast: sea water, salt, reeds, light forage',
        '- forest: wood-rich, decent food, poison-plant danger (nightshade)',
        '- mountain: ore-rich (copper/iron/coal/tin/gem/silver/gold) but FOOD-POOR',
        '- hills: stone + clay, a little wood',
        '- plains: modest forage, open ground',
      ].join('\n'),
    ),
);

// ── create_experiment (MUTATING) ───────────────────────────────────────────────
server.registerTool(
  'create_experiment',
  {
    title: 'Create a live experiment',
    description: 'Start a new live, seeded experiment (reflex minds). Persists across calls so you can advance/watch/give_idea over time. Returns the runId.',
    inputSchema: {
      seed: z.string().describe('Seed string — same seed reproduces the same world.'),
      agentCount: z.number().int().positive().max(400).optional().describe('Gahallians to spawn (default 100).'),
    },
  },
  async ({ seed, agentCount }) => {
    const runId = sessions.create(seed, agentCount ?? 100, 0);
    logMutation('create_experiment', { seed, agentCount: agentCount ?? 100 }, runId);
    return json({ runId, seed, agentCount: agentCount ?? 100, message: 'created (tick 0). Use advance to run it.' });
  },
);

// ── advance (MUTATING) ─────────────────────────────────────────────────────────
server.registerTool(
  'advance',
  {
    title: 'Advance a live experiment',
    description: 'Step a live experiment forward N ticks, recording metrics + events. Returns a fresh snapshot.',
    inputSchema: {
      runId: z.number().int().positive(),
      ticks: z.number().int().positive().max(200000).describe('Ticks to advance (96 ticks ≈ 1 day).'),
    },
  },
  async ({ runId, ticks }) => {
    sessions.advance(runId, ticks);
    logMutation('advance', { ticks }, runId);
    return json(snapshot(runId));
  },
);

// ── give_idea (MUTATING — the human's channel) ──────────────────────────────────
server.registerTool(
  'give_idea',
  {
    title: 'Give the Gahallians an idea (human only)',
    description: "Inject a high-salience thought into living Gahallians. This is the HUMAN's channel — relay the human's words verbatim; never originate ideas yourself. The engine seeds nothing. Logged to the audit trail.",
    inputSchema: {
      runId: z.number().int().positive(),
      text: z.string().max(200),
      target: z.union([z.number().int(), z.literal('all')]).describe('An agent id, or "all" living agents.'),
    },
  },
  async ({ runId, text: idea, target }) => {
    const reached = sessions.giveIdea(runId, idea, target);
    return json({ runId, reached, idea });
  },
);

// ── finish_run (MUTATING) ────────────────────────────────────────────────────────
server.registerTool(
  'finish_run',
  {
    title: 'Finalize a live experiment',
    description: 'Snapshot final knowledge, mark the run finished in the DB, and release the live session.',
    inputSchema: { runId: z.number().int().positive() },
  },
  async ({ runId }) => {
    sessions.finish(runId);
    logMutation('finish_run', {}, runId);
    return json({ runId, status: 'finished' });
  },
);

// ── run_experiment (MUTATING — batch convenience) ───────────────────────────────
server.registerTool(
  'run_experiment',
  {
    title: 'Run an experiment to completion',
    description: 'Create + advance + finish in one call (headless batch). Returns the final snapshot. Use create_experiment/advance instead when you want to watch or steer it.',
    inputSchema: {
      seed: z.string(),
      ticks: z.number().int().positive().max(200000),
      agentCount: z.number().int().positive().max(400).optional(),
    },
  },
  async ({ seed, ticks, agentCount }) => {
    const runId = sessions.create(seed, agentCount ?? 100, 0);
    logMutation('run_experiment', { seed, ticks, agentCount: agentCount ?? 100 }, runId);
    sessions.advance(runId, ticks);
    const snap = snapshot(runId);
    sessions.finish(runId);
    return json(snap);
  },
);

// ── snapshot (read) ──────────────────────────────────────────────────────────────
server.registerTool(
  'snapshot',
  {
    title: 'Snapshot a live experiment',
    description: 'Current state of a live experiment: tick, day, population, knowledge totals, cumulative event tallies, and recent events.',
    inputSchema: { runId: z.number().int().positive() },
  },
  async ({ runId }) => json(snapshot(runId)),
);

// ── list_runs / get_run / get_metrics / get_events / get_knowledge ──────────────
server.registerTool(
  'list_runs',
  { title: 'List runs', description: 'Recorded experiments (most recent first).', inputSchema: { limit: z.number().int().positive().max(200).optional() } },
  async ({ limit }) => json(db.listRuns(limit ?? 50)),
);

server.registerTool(
  'get_run',
  { title: 'Get run', description: 'A run record by id (config, status, ticks).', inputSchema: { runId: z.number().int().positive() } },
  async ({ runId }) => {
    const run = db.getRun(runId);
    return run ? json(run) : text(`no run ${runId}`);
  },
);

server.registerTool(
  'get_metrics',
  { title: 'Get metrics time-series', description: 'The recorded population/knowledge/event metrics time-series for a run.', inputSchema: { runId: z.number().int().positive() } },
  async ({ runId }) => json(db.getMetrics(runId)),
);

server.registerTool(
  'get_events',
  {
    title: 'Get events',
    description: 'Recorded events for a run (most recent first). Optionally filter by type or since a tick.',
    inputSchema: {
      runId: z.number().int().positive(),
      type: z.string().optional(),
      sinceTick: z.number().int().nonnegative().optional(),
      limit: z.number().int().positive().max(1000).optional(),
    },
  },
  async ({ runId, type, sinceTick, limit }) => json(db.getEvents(runId, { type, sinceTick, limit })),
);

server.registerTool(
  'get_knowledge',
  {
    title: 'Get knowledge',
    description: 'Latest knowledge snapshot for a run (or a given tick): per-agent rules with status + confidence, plus a held-rule tally across the population.',
    inputSchema: { runId: z.number().int().positive(), tick: z.number().int().nonnegative().optional() },
  },
  async ({ runId, tick }) => {
    const rows = db.getKnowledge(runId, tick);
    const tally: Record<string, number> = {};
    for (const r of rows) if (r.status === 'held') tally[r.ruleKey] = (tally[r.ruleKey] ?? 0) + 1;
    const topHeld = Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 40);
    return json({ rowCount: rows.length, topHeldRules: topHeld, rows });
  },
);

// ── query_db (read-only SELECT escape hatch) ────────────────────────────────────
server.registerTool(
  'query_db',
  {
    title: 'Query the research DB (read-only)',
    description: 'Run a single read-only SELECT against the research DB for novel questions. Tables: runs, metrics, events, knowledge_snapshots, actions. Writes are rejected.',
    inputSchema: { sql: z.string(), params: z.array(z.union([z.string(), z.number(), z.null()])).optional() },
  },
  async ({ sql, params }) => {
    try {
      return json(db.readonlyQuery(sql, params ?? []));
    } catch (e) {
      return text(`query rejected: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
);

function snapshot(runId: number): unknown {
  const s = sessions.get(runId);
  if (!s) {
    const run = db.getRun(runId);
    return run ? { runId, live: false, run } : { runId, error: 'no such run' };
  }
  const exp = s.exp;
  return {
    runId,
    live: true,
    tick: exp.tick,
    day: exp.day(),
    population: { alive: exp.aliveCount(), total: s.agentCount },
    totalKnowledge: exp.totalKnowledge(),
    tallies: {
      exchanges: exp.exchangeCount,
      conflicts: exp.conflictCount,
      sickness: exp.sicknessCount,
      shares: exp.shareCount,
      seedPlants: exp.seedPlantCount,
      sprouts: exp.sproutCount,
      builds: exp.buildCount,
    },
    deathsByCause: exp.deathsByCause,
    recentEvents: exp.recentEvents(15).map((e) => ({ tick: e.tick, type: e.type, actorId: e.actorId })),
  };
}

const transport = new StdioServerTransport();
await server.connect(transport);
// eslint-disable-next-line no-console
console.error(`yggdrasil-lab mcp ready (read-first; mutations allowlisted+logged) — db ${DB_PATH}`);
