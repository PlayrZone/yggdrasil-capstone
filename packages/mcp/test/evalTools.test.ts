import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

/**
 * THE THREE EVAL TOOLS, exercised through the same registrar the server uses.
 *
 * NOTHING HERE REACHES A NETWORK. The "paid" path is the REAL provider client
 * over a stub `fetch` — which is the point: round 1's paid code path was
 * exercised by nothing at all, and the one test that stood in for it passed a
 * fake BACKEND, which is exactly the shape the guard turned out not to check.
 * A fetch is a function; no zod schema in `evalTools.ts` can express one; so
 * the seam it travels cannot be reached by any argument an agent sends.
 *
 * What is asserted here is what an agent CANNOT do: pass a client, raise the
 * cap, create the override file, or get a metric table out of a run that ran
 * out of money.
 */

interface Registered {
  config: { title: string; description: string; inputSchema: Record<string, unknown> };
  handler: (args: unknown) => Promise<unknown>;
}

let tools: Map<string, Registered>;
let audits: { tool: string; detail: unknown }[];
let announcements: string[];
let fetchCalls: number;
let keyed: boolean;
let home: string;
let ceilingOverridePath: typeof import('../src/budget.js').ceilingOverridePath;
let spendLogPath: typeof import('../src/budget.js').spendLogPath;
const hadHome = process.env['YGG_HOME'];

/** Answers like Fireworks, counts the calls, and never opens a socket. */
const stubFetch = ((): Promise<Response> => {
  fetchCalls++;
  return Promise.resolve({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: () => Promise.resolve({ choices: [{ message: { content: '{"goals":[],"plan":[],"utterances":[]}' } }] }),
    text: () => Promise.resolve(''),
  } as unknown as Response);
}) as unknown as typeof fetch;

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), 'ygg-evaltools-'));
  process.env['YGG_HOME'] = home;
  const { registerEvalTools } = await import('../src/evalTools.js');
  const budget = await import('../src/budget.js');
  ceilingOverridePath = budget.ceilingOverridePath;
  spendLogPath = budget.spendLogPath;
  tools = new Map();
  audits = [];
  announcements = [];
  registerEvalTools({
    registerTool: (name, config, handler) =>
      tools.set(name, { config: config as Registered['config'], handler: handler as Registered['handler'] }),
    text: (s) => ({ kind: 'text', text: s }),
    json: (v) => ({ kind: 'json', value: v }),
    audit: (tool, detail) => audits.push({ tool, detail }),
    announce: (_kind, summary) => announcements.push(summary),
    hasLlmKey: () => keyed,
    llmModelId: () => 'accounts/fireworks/models/gpt-oss-120b',
    // The engine's door builds the REAL client around this. The server never
    // passes one, and no tool argument could carry it.
    testFetch: stubFetch,
  });
});

beforeEach(() => {
  audits.length = 0;
  announcements.length = 0;
  fetchCalls = 0;
  keyed = false;
});

afterAll(() => {
  if (hadHome === undefined) delete process.env['YGG_HOME'];
  else process.env['YGG_HOME'] = hadHome;
});

async function call(name: string, args: Record<string, unknown>): Promise<{ kind: string; text?: string; value?: unknown }> {
  const tool = tools.get(name);
  if (!tool) throw new Error(`no tool ${name}`);
  return (await tool.handler(args)) as { kind: string; text?: string; value?: unknown };
}

describe('the eval tools are registered and free by default', () => {
  it('registers all three, and none of them has a way to raise the cap', () => {
    for (const name of ['run_ab', 'ignorance_probe', 'judge_traces']) {
      const tool = tools.get(name);
      expect(tool, name).toBeDefined();
      const keys = Object.keys(tool!.config.inputSchema);
      expect(keys).toContain('budgetId');
      expect(keys).toContain('allowPaid');
      // Round 1: `ownerOverride` was free text, any non-empty string bought a
      // million-call cap, and the raised ceiling persisted.
      expect(keys, name).not.toContain('ownerOverride');
      expect(JSON.stringify(tool!.config)).not.toContain('ownerOverride');
      expect(tool!.config.description).toContain('allowPaid');
    }
    expect(tools.get('run_ab')!.config.description).toContain('Read-only');
  });

  it('runs an A/B on the free mocks and reports paired differences with a manifest', async () => {
    const result = await call('run_ab', { seed: 'mcp-ab', ticks: 320, cohortSize: 3, agentCount: 12 });
    expect(result.kind).toBe('json');
    const value = result.value as {
      paid: boolean;
      usable: boolean;
      budget: unknown;
      perSeed: { metrics: Record<string, { thinks: number }> }[];
      contrasts: { label: string; primary: { metric: string } | null; exploratory: unknown[] }[];
      manifest: {
        arms: { id: string; paid: boolean }[];
        ceiling: unknown;
        blinding: { scheme: string; publicSeed: string; commitment: string };
      };
      traceCount: number;
      traces: { traceId: string }[];
    };
    expect(value.paid).toBe(false);
    expect(value.usable).toBe(true);
    expect(value.budget).toBeNull();
    expect(value.perSeed[0]!.metrics['A']!.thinks).toBeGreaterThan(0);
    expect(value.perSeed[0]!.metrics['B']!.thinks).toBeGreaterThan(0);
    expect(value.contrasts[0]!.label).toBe('A vs B');
    expect(value.contrasts[0]!.primary?.metric).toBe('planSuccessRate');
    expect(value.contrasts[0]!.exploratory.length).toBeGreaterThan(5);
    expect(value.manifest.arms.every((a) => a.paid === false)).toBe(true);
    expect(value.manifest.blinding.scheme).toBe('sealed-secret-permutation/opaque-handle');
    expect(value.traceCount).toBeGreaterThan(0);
    expect(audits).toHaveLength(0);
    expect(fetchCalls).toBe(0);

    // P3. THE TOOL OUTPUT IS AN ARTEFACT LIKE ANY OTHER, and a reader holding
    // it must not be able to re-derive the permutation. Round 2 returned the
    // manifest beside the traces with `handleSeed` in it — the key to the
    // blinding — and re-running the public `blindTraces` with it recovered 8 of
    // 8 arms. What ships now is a commitment and nothing else.
    expect(value.manifest.blinding.commitment).toMatch(/^[0-9a-f]{64}$/);
    const json = JSON.stringify(value);
    expect(json).not.toMatch(/"(secret|blindSecret|handleSeed)"/);
    // …and no arm label travels with any handle.
    for (const trace of value.traces) expect(json).not.toContain(`"${trace.traceId}":"A"`);
  }, 90_000);

  it('runs the four-arm decomposition when asked for it', async () => {
    const result = await call('run_ab', { seed: 'mcp-arms', ticks: 240, cohortSize: 2, agentCount: 10, arms: ['A', 'A-', 'B', 'B+'] });
    const value = result.value as { arms: string[]; contrasts: { label: string; isolates: string }[] };
    expect(value.arms).toEqual(['A', 'A-', 'B', 'B+']);
    expect(value.contrasts.map((c) => c.label)).toEqual(['A vs B', 'A vs A-', 'B+ vs B', 'A- vs B', 'A vs B+']);
    expect(value.contrasts.find((c) => c.label === 'A- vs B')!.isolates).toContain('architecture');
  }, 90_000);

  it('separates the mock populations through the probe tool', async () => {
    const result = await call('ignorance_probe', { seed: 'mcp-probe', ticks: 320, cohortSize: 2 });
    const value = result.value as {
      usable: boolean;
      detector: { recall: number; caveat: string };
      arms: Record<string, { absent: { leaked: number; admissionRate: number }; controls: { missRate: number }; separation: number }>;
    };
    expect(value.usable).toBe(true);
    expect(value.arms['A']!.absent.leaked).toBe(0);
    expect(value.arms['A']!.absent.admissionRate).toBe(1);
    expect(value.arms['B']!.absent.leaked).toBeGreaterThan(0);
    expect(value.arms['A']!.separation).toBeGreaterThan(value.arms['B']!.separation);
    expect(value.detector.recall).toBeLessThan(1);
    expect(value.detector.caveat).toContain('UPPER BOUND');
  }, 90_000);

  it('judges blinded traces by the PAIR, and says what that many pairs could decide', async () => {
    const result = await call('judge_traces', { seed: 'mcp-judge', ticks: 320, cohortSize: 3 });
    const value = result.value as {
      judge: string;
      pairs: number;
      showings: number;
      winRateA: number;
      exactP: number;
      bothOrdersConsistencyRate: number;
      usableForVerdict: boolean;
      position: { biased: boolean; leftRate: number };
      pairing: { balancedPlacement: boolean };
      whatThisManyPairsCouldDecide: {
        underpowered: boolean;
        pairs: number;
        decisivePairs: number;
        minimumWins: number | null;
        power: number;
        typeIError: number;
      };
      ifEveryPairHadBeenDecisive: { minimumWins: number | null };
    };
    expect(value.judge).toBe('mock-feature-judge');
    expect(value.showings).toBe(value.pairs * 2);
    expect(value.winRateA).toBeGreaterThan(0.5);
    expect(value.position.biased).toBe(false);
    expect(value.position.leftRate).toBeCloseTo(0.5, 6);
    expect(value.bothOrdersConsistencyRate).toBe(1);
    expect(value.pairing.balancedPlacement).toBe(true);
    // Round 1 quoted a Wilson interval from a doubled n and never said that
    // three pairs cannot reach significance whatever they say.
    expect(value.whatThisManyPairsCouldDecide.underpowered).toBe(true);
    expect(value.usableForVerdict).toBe(false);
    // P2. The sizing the tool prints is now the sizing the verdict USED: the
    // threshold is over DECISIVE pairs, not over every pair judged. Round 2
    // printed `minimumDetectableWins(pairs)` here and gated on it, which is a
    // threshold for a count the verdict never computed.
    const design = value.whatThisManyPairsCouldDecide;
    expect(design.decisivePairs).toBeLessThanOrEqual(design.pairs);
    expect(design.typeIError).toBeLessThanOrEqual(0.05);
    // At three pairs the power at the declared effect is exactly ZERO — no
    // outcome of this design could ever print USABLE — and the tool says so in
    // a number rather than leaving the caller to work it out from `underpowered`.
    expect(design.power).toBe(0);
    expect(value.ifEveryPairHadBeenDecisive.minimumWins).toBe(null);
  }, 90_000);
});

describe('the paid path needs allowPaid AND a named budget', () => {
  it('audits a paid attempt even when the lab has no model, and falls back to the mocks', async () => {
    // No key and no stub would mean nothing paid exists; the stub stands in for
    // a configured lab, so this case is forced by asking with no budget below.
    keyed = false;
    const result = await call('run_ab', { seed: 'mcp-nobudget', ticks: 200, cohortSize: 2, agentCount: 8, allowPaid: true });
    expect(result.kind).toBe('text');
    expect(result.text).toContain('budgetId');
    expect(audits).toHaveLength(1);
    expect(audits[0]?.detail).toMatchObject({ attempted: 'paid', budgetId: null });
    expect(fetchCalls).toBe(0);
  }, 90_000);

  it('audits the ceiling in force on every paid attempt', async () => {
    await call('run_ab', { seed: 'mcp-ceiling', ticks: 200, cohortSize: 2, allowPaid: true });
    expect(audits[0]?.detail).toMatchObject({ ceiling: { limit: 2000, source: 'constant' } });
  }, 90_000);

  it('refuses when the named budget cannot cover the run it was asked for, and never calls the model', async () => {
    const result = await call('run_ab', {
      seed: 'mcp-tiny',
      ticks: 2000,
      cohortSize: 8,
      allowPaid: true,
      budgetId: 'mcp-tiny-budget',
      budgetLimit: 5,
    });
    expect(result.kind).toBe('text');
    expect(result.text).toContain('5 calls left');
    expect(fetchCalls).toBe(0);
  }, 90_000);

  it('refuses a cap above the constant ceiling, with no override to offer', async () => {
    const result = await call('judge_traces', {
      seed: 'mcp-over',
      ticks: 200,
      cohortSize: 2,
      allowPaid: true,
      budgetId: 'mcp-over-budget',
      budgetLimit: 50_000,
    });
    expect(result.kind).toBe('text');
    expect(result.text).toContain('refused');
    expect(result.text).toContain('ceiling');
    // The schema itself caps it, so a well-formed call cannot even ask.
    const limit = tools.get('judge_traces')!.config.inputSchema['budgetLimit'] as { _def?: unknown };
    expect(JSON.stringify(limit)).toContain('2000');
  }, 90_000);

  it('runs the real provider client over the stub and charges every call', async () => {
    const result = await call('run_ab', {
      seed: 'mcp-paid',
      ticks: 300,
      cohortSize: 2,
      agentCount: 8,
      allowPaid: true,
      budgetId: 'mcp-paid-budget',
      budgetLimit: 400,
    });
    const value = result.value as { paid: boolean; usable: boolean; budget: { spent: number; ceiling: { source: string } } };
    expect(value.paid).toBe(true);
    expect(value.usable).toBe(true);
    expect(fetchCalls).toBeGreaterThan(0);
    // Charged before the call, so the counter is never behind the bill.
    expect(value.budget.spent).toBe(fetchCalls);
    expect(value.budget.ceiling.source).toBe('constant');
    // …and the spend line is on disk.
    const lines = readFileSync(spendLogPath(), 'utf8').trim().split('\n');
    const last: unknown = JSON.parse(lines[lines.length - 1] ?? '{}');
    expect(last).toMatchObject({ budgetId: 'mcp-paid-budget', calls: fetchCalls });
  }, 90_000);

  it('stops a run that exhausts its budget, emits no metric table, and still logs the spend', async () => {
    const result = await call('run_ab', {
      seed: 'mcp-exhaust',
      ticks: 900,
      cohortSize: 4,
      agentCount: 12,
      allowPaid: true,
      budgetId: 'mcp-exhaust-budget',
      budgetLimit: 3,
    });
    const value = result.value as { usable: boolean; reason?: string; perSeed?: unknown; contrasts?: unknown };
    // The estimate refuses before the run in the normal case; this budget is
    // small enough to pass the estimate only because the run is short, so the
    // outcome is either a refusal or a halted run — never a metric table.
    if (result.kind === 'text') {
      expect(result.text).toContain('refused');
      return;
    }
    expect(value.usable).toBe(false);
    expect(value.reason).toBe('budget-exhausted');
    expect(value.perSeed).toBeUndefined();
    expect(value.contrasts).toBeUndefined();
    const lines = readFileSync(spendLogPath(), 'utf8').trim().split('\n');
    expect(lines.some((l) => l.includes('mcp-exhaust-budget'))).toBe(true);
  }, 90_000);
});

describe('the MCP surface cannot touch the human override file', () => {
  it('never creates it, whatever is asked of any tool', async () => {
    expect(existsSync(ceilingOverridePath())).toBe(false);
    await call('run_ab', { seed: 'o1', ticks: 200, cohortSize: 2, agentCount: 8 });
    await call('run_ab', { seed: 'o2', ticks: 200, cohortSize: 2, allowPaid: true, budgetId: 'o-budget', budgetLimit: 2000 });
    await call('judge_traces', { seed: 'o3', ticks: 200, cohortSize: 2, allowPaid: true, budgetId: 'o-budget', budgetLimit: 50_000 });
    await call('ignorance_probe', { seed: 'o4', ticks: 200, cohortSize: 2 });
    // Round 1's equivalent of this file was a string parameter on every tool.
    expect(existsSync(ceilingOverridePath())).toBe(false);
  }, 120_000);
});
