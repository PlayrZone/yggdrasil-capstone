import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { IMindBackend } from '@yggdrasil/engine';

/**
 * THE THREE EVAL TOOLS, exercised through the same registrar the server uses.
 *
 * Nothing here reaches a network: the "paid" backend is a local object that
 * would throw if it were ever called, and every assertion is about whether the
 * guard let it be reached. Mock by default, `allowPaid` AND a named budget for
 * anything else, and every paid ATTEMPT audited — allowed or refused.
 */

interface Registered {
  config: { title: string; description: string; inputSchema: Record<string, unknown> };
  handler: (args: unknown) => Promise<unknown>;
}

let tools: Map<string, Registered>;
let audits: { tool: string; detail: unknown }[];
let paidBackend: IMindBackend | null;
const hadHome = process.env['YGG_HOME'];

/** A "paid" client that fails loudly if the guard ever lets it through. */
const FORBIDDEN: IMindBackend = {
  modelId: 'accounts/fireworks/models/gpt-oss-120b',
  complete: () => {
    throw new Error('a paid call escaped the guard');
  },
};

beforeAll(async () => {
  process.env['YGG_HOME'] = mkdtempSync(join(tmpdir(), 'ygg-evaltools-'));
  const { registerEvalTools } = await import('../src/evalTools.js');
  tools = new Map();
  audits = [];
  paidBackend = null;
  registerEvalTools({
    registerTool: (name, config, handler) =>
      tools.set(name, { config: config as Registered['config'], handler: handler as Registered['handler'] }),
    text: (s) => ({ kind: 'text', text: s }),
    json: (v) => ({ kind: 'json', value: v }),
    audit: (tool, detail) => audits.push({ tool, detail }),
    announce: () => {},
    makeLlmBackend: () => paidBackend,
    llmModelId: () => FORBIDDEN.modelId,
  });
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
  it('registers all three, and every one says it is read-only and mock by default', () => {
    for (const name of ['run_ab', 'ignorance_probe', 'judge_traces']) {
      const tool = tools.get(name);
      expect(tool, name).toBeDefined();
      expect(tool!.config.description).toContain('allowPaid');
      expect(Object.keys(tool!.config.inputSchema)).toContain('budgetId');
    }
    expect(tools.get('run_ab')!.config.description).toContain('Read-only');
  });

  it('runs an A/B on the free mocks and reports both arms', async () => {
    paidBackend = null;
    const result = await call('run_ab', { seed: 'mcp-ab', ticks: 320, cohortSize: 3, agentCount: 12 });
    expect(result.kind).toBe('json');
    const value = result.value as { paid: boolean; budget: unknown; metrics: { A: { thinks: number }; B: { thinks: number } }; paired: unknown[]; traceCount: number };
    expect(value.paid).toBe(false);
    expect(value.budget).toBeNull();
    expect(value.metrics.A.thinks).toBeGreaterThan(0);
    expect(value.metrics.B.thinks).toBeGreaterThan(0);
    expect(value.paired.length).toBeGreaterThan(5);
    expect(value.traceCount).toBeGreaterThan(0);
    expect(audits).toHaveLength(0);
  }, 60_000);

  it('separates the mock populations through the probe tool', async () => {
    paidBackend = null;
    const result = await call('ignorance_probe', { seed: 'mcp-probe', ticks: 320, cohortSize: 2 });
    const value = result.value as {
      A: { absent: { leaked: number; admissionRate: number }; separation: number };
      B: { absent: { leaked: number }; separation: number };
      detector: { recall: number };
    };
    expect(value.A.absent.leaked).toBe(0);
    expect(value.A.absent.admissionRate).toBe(1);
    expect(value.B.absent.leaked).toBeGreaterThan(0);
    expect(value.A.separation).toBeGreaterThan(value.B.separation);
    expect(value.detector.recall).toBeLessThan(1);
  }, 60_000);

  it('judges blinded traces with the deterministic mock judge', async () => {
    paidBackend = null;
    const result = await call('judge_traces', { seed: 'mcp-judge', ticks: 320, cohortSize: 3 });
    const value = result.value as { judge: string; winRateA: number; wilson: { low: number }; position: { biased: boolean; leftRate: number } };
    expect(value.judge).toBe('mock-feature-judge');
    expect(value.winRateA).toBeGreaterThan(0.5);
    expect(value.position.biased).toBe(false);
    expect(value.position.leftRate).toBeCloseTo(0.5, 6);
  }, 60_000);
});

describe('the paid path needs allowPaid AND a named budget', () => {
  it('audits a paid attempt even when the lab has no key, and falls back to the mocks', async () => {
    paidBackend = null;
    audits.length = 0;
    const result = await call('run_ab', { seed: 'mcp-nokey', ticks: 200, cohortSize: 2, agentCount: 8, allowPaid: true });
    expect((result.value as { paid: boolean }).paid).toBe(false);
    expect(audits).toHaveLength(1);
    expect(audits[0]?.tool).toBe('run_ab');
    expect(audits[0]?.detail).toMatchObject({ attempted: 'paid', model: 'none-configured' });
  }, 60_000);

  it('refuses a keyed, allowPaid run that named no budget — and never calls the model', async () => {
    paidBackend = FORBIDDEN;
    audits.length = 0;
    const result = await call('run_ab', { seed: 'mcp-nobudget', ticks: 200, cohortSize: 2, allowPaid: true });
    expect(result.kind).toBe('text');
    expect(result.text).toContain('budgetId');
    expect(result.text).toContain('2000');
    expect(audits).toHaveLength(1);
    expect(audits[0]?.detail).toMatchObject({ attempted: 'paid', budgetId: null });
  });

  it('refuses when the named budget cannot cover the run it was asked for', async () => {
    paidBackend = FORBIDDEN;
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
  });

  it('refuses a cap above the standing 2,000 without an owner override', async () => {
    paidBackend = FORBIDDEN;
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
    expect(result.text).toContain('ownerOverride');
  });

  it('records the override in the audit trail when one is given', async () => {
    paidBackend = FORBIDDEN;
    audits.length = 0;
    await call('ignorance_probe', {
      seed: 'mcp-override',
      ticks: 200,
      cohortSize: 2,
      allowPaid: true,
      budgetId: 'mcp-override-budget',
      budgetLimit: 3,
      ownerOverride: 'owner approved on 2026-09-19',
    });
    expect(audits[0]?.detail).toMatchObject({ ownerOverride: 'owner approved on 2026-09-19' });
  });
});
