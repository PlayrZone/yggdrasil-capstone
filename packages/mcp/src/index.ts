#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { ResearchDB } from '@yggdrasil/db';
import { MATERIAL_PROPERTIES, WORLD } from '@yggdrasil/engine';
import { SessionManager } from './SessionManager.js';
import { dbPath, yggHome } from './home.js';
import { appendActivity } from './activity.js';
import { listReports, readReport, writeReport } from './reports.js';
import { hasLlmKey, llmModelId, makeLlmBackend } from './llm.js';

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

const DB_PATH = dbPath();
const db = new ResearchDB(DB_PATH);
const sessions = new SessionManager(db, makeLlmBackend);

/** Compact agent positions for the lab minimap (state: 0 ok,1 hungry,2 sleep,3 sick). */
function agentSnapshot(runId: number): { id: number; x: number; y: number; state: number }[] {
  const s = sessions.get(runId);
  if (!s) return [];
  return s.exp
    .agentInfos()
    .filter((a) => a.alive)
    .map((a) => ({ id: a.id, x: Math.round(a.x), y: Math.round(a.y), state: a.sick ? 3 : a.sleeping ? 2 : a.hungerCritical ? 1 : 0 }));
}

const server = new McpServer({ name: 'yggdrasil-lab', version: '0.1.0' });

const text = (s: string): { content: { type: 'text'; text: string }[] } => ({
  content: [{ type: 'text', text: s }],
});
const json = (v: unknown): { content: { type: 'text'; text: string }[] } => text(JSON.stringify(v, null, 2));

const MUTATING = new Set(['create_experiment', 'advance', 'give_idea', 'finish_run', 'run_experiment', 'write_report']);
function logMutation(tool: string, detail: unknown, runId?: number): void {
  if (!MUTATING.has(tool)) return;
  db.recordAction('mcp', tool, detail, runId);
}

const ACTOR = process.env['YGG_ACTOR'] ?? 'ai-engineer';

/** Push a line onto the shared feed the lab tails — so the human sees it live. */
function announce(kind: string, summary: string, opts: { runId?: number; data?: Record<string, unknown>; withAgents?: boolean } = {}): void {
  const at = opts.runId !== undefined ? (sessions.get(opts.runId)?.exp.tick ?? 0) : 0;
  appendActivity({
    at,
    actor: ACTOR,
    kind,
    runId: opts.runId,
    summary,
    data: opts.data,
    agents: opts.withAgents && opts.runId !== undefined ? agentSnapshot(opts.runId) : undefined,
  });
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
        `The LLM consciousness is REQUIRED — it is what the lab exists to TRAIN.`,
        `Model: ${hasLlmKey() ? llmModelId() : '(no FIREWORKS_API_KEY set — set it to run real minds)'}.`,
        'Reflex is only a non-blocking fallback while the LLM is mid-thought.',
        '',
        'Shared with the human, live: an activity feed (every run/advance/idea/',
        'report streams to the lab) and a Reports section both sides read+write',
        '(list_reports / read_report / write_report).',
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
        `World size: ${WORLD}×${WORLD} — a medium continent (west sea → eastern mountains).`,
        'Regions (deliberately unequal — the inequality drives trade/migration/conflict):',
        '- coast (west): sea water, salt, reeds, light shore forage',
        '- wetland: reeds (fiber), clay, tubers, standing water — coastal + lake edges',
        '- river valley + tributary: drinking water + abundant berry/tuber food (breadbasket)',
        '- lake (×3): freshwater + fertile shores',
        '- forest (×5 belts): wood-rich, decent food, poison-plant danger (nightshade)',
        '- plains: modest forage, open ground',
        '- hills (foothills): stone + clay, a little wood',
        '- mountain (east): ore-rich (copper/iron/coal/tin/gem/silver/gold) but FOOD-POOR',
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
    const n = agentCount ?? 100;
    const runId = sessions.create(seed, n, 0);
    logMutation('create_experiment', { seed, agentCount: n }, runId);
    announce('create', `Created experiment "${seed}" with ${n} Gahallians`, { runId, data: { seed, agentCount: n }, withAgents: true });
    return json({ runId, seed, agentCount: n, message: 'created (tick 0). Use advance to run it.' });
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
    await sessions.advance(runId, ticks);
    logMutation('advance', { ticks }, runId);
    const s = sessions.get(runId);
    if (s) {
      const exp = s.exp;
      announce('advance', `Day ${exp.day()} — ${exp.aliveCount()}/${s.agentCount} alive, ${exp.totalKnowledge()} knowledge`, {
        runId,
        data: { exchanges: exp.exchangeCount, conflicts: exp.conflictCount, shares: exp.shareCount, builds: exp.buildCount },
        withAgents: true,
      });
    }
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
    announce('idea', `Idea given to ${reached} Gahallian(s): "${idea}"`, { runId, data: { target } });
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
    const s = sessions.get(runId);
    const summary = s ? `Finished run ${runId} at day ${s.exp.day()} — ${s.exp.aliveCount()} survived, ${s.exp.totalKnowledge()} knowledge` : `Finished run ${runId}`;
    announce('finish', summary, { runId });
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
    const n = agentCount ?? 100;
    const runId = sessions.create(seed, n, 0);
    logMutation('run_experiment', { seed, ticks, agentCount: n }, runId);
    announce('create', `Batch run "${seed}" with ${n} Gahallians for ${ticks} ticks`, { runId, withAgents: true });
    await sessions.advance(runId, ticks);
    const s = sessions.get(runId);
    if (s) announce('advance', `Day ${s.exp.day()} — ${s.exp.aliveCount()}/${n} alive, ${s.exp.totalKnowledge()} knowledge`, { runId, withAgents: true });
    const snap = snapshot(runId);
    announce('finish', `Batch run ${runId} complete`, { runId });
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

// ── get_analysis (live diffusion / culture / archetypes) ────────────────────────
server.registerTool(
  'get_analysis',
  {
    title: 'Analyze a live run',
    description: 'Post-hoc analysis of a LIVE run: knowledge diffusion (top beliefs + how they spread), belief accuracy + superstitions, culture (beliefs that outlived their discoverer), and emergent behavioral archetypes. Nothing is read back into the sim.',
    inputSchema: { runId: z.number().int().positive(), topBeliefs: z.number().int().positive().max(60).optional() },
  },
  async ({ runId, topBeliefs }) => {
    const s = sessions.get(runId);
    if (!s) return text(`no live session for run ${runId} (analysis runs on live runs)`);
    const a = s.exp.analysis();
    return json({
      cultureCount: a.cultureCount,
      accuracy: { ...a.accuracy, falseBeliefs: a.accuracy.falseBeliefs.map((c) => ({ statement: c.statement, holders: c.livingHolders })) },
      archetypes: a.archetypes,
      topBeliefs: a.diffusion.slice(0, topBeliefs ?? 25).map((c) => ({
        statement: c.statement,
        truth: c.truth,
        livingHolders: c.livingHolders,
        byExperience: c.byExperience,
        byObservation: c.byObservation,
        byTestimony: c.byTestimony,
        outlivedOriginator: c.outlivedOriginator,
      })),
    });
  },
);

// ── get_society (emergent institutions — analysis only) ─────────────────────────
server.registerTool(
  'get_society',
  {
    title: 'Detect emergent institutions',
    description: 'The INFLUENCE layer for a LIVE run: detects POSSIBLE mentors, innovators, leaders (most influential), families (kinship), tribes (social clusters), and resource-holders from who taught whom, whose discoveries spread, who is bonded, and who descends from whom. Pure analysis — it labels patterns, never creates institutions.',
    inputSchema: { runId: z.number().int().positive() },
  },
  async ({ runId }) => {
    const s = sessions.get(runId);
    if (!s) return text(`no live session for run ${runId}`);
    const r = s.exp.society();
    return json({
      detections: r.labels,
      topInfluence: r.influence.slice(0, 8),
      mentors: r.mentors.slice(0, 6),
      innovators: r.innovators.slice(0, 6),
      families: r.families.map((f) => f.size),
      tribes: r.tribes.map((t) => t.size),
      trustedSources: r.trustedSources.slice(0, 6),
      knowledgeLineages: r.knowledgeLineages,
      mentorBonds: r.mentorBonds.slice(0, 8),
      tribeKnowledge: r.tribeKnowledge.slice(0, 8),
      propertyHolders: r.propertyHolders.slice(0, 6),
      specialists: r.specialists.slice(0, 8),
    });
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

// ── reports (shared read/write channel between the human and the AI) ────────────
server.registerTool(
  'list_reports',
  { title: 'List reports', description: 'The shared reports (Markdown) both you and the human read and write. Most recently updated first.', inputSchema: {} },
  async () => json(listReports()),
);

server.registerTool(
  'read_report',
  { title: 'Read a report', description: 'Read one shared report by slug (from list_reports).', inputSchema: { slug: z.string() } },
  async ({ slug }) => {
    const r = readReport(slug);
    return r ? json(r) : text(`no report "${slug}"`);
  },
);

server.registerTool(
  'write_report',
  {
    title: 'Write a report (MUTATING)',
    description: 'Create or overwrite a shared report (Markdown body). The human sees it in the lab Reports tab and can edit it back. Use this to record findings, plans, and hypotheses.',
    inputSchema: {
      title: z.string(),
      body: z.string().describe('Markdown body.'),
      slug: z.string().optional().describe('Omit to derive from the title; pass an existing slug to overwrite.'),
    },
  },
  async ({ title, body, slug }) => {
    const finalSlug = writeReport(title, body, ACTOR, slug);
    announce('report', `Wrote report "${title}"`, { data: { slug: finalSlug } });
    return json({ slug: finalSlug, title });
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
const llmStatus = hasLlmKey() ? `LLM minds: ${llmModelId()}` : 'LLM minds: NO KEY (set FIREWORKS_API_KEY) — running reflex';
// eslint-disable-next-line no-console
console.error(`yggdrasil-lab mcp ready (read-first; mutations allowlisted+logged) — db ${DB_PATH} — home ${yggHome()} — ${llmStatus}`);
