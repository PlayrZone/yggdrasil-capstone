import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BudgetExhaustedError, CallBudget, DEFAULT_CALL_BUDGET, PaidCallRefused } from '@yggdrasil/engine';

/**
 * THE DURABLE HALF OF DECISION D1.
 *
 * The engine's `CallBudget` holds the rule; this holds the file. What is tested
 * here is the thing a memory store cannot test: that a SECOND PROCESS, with a
 * fresh store object and no shared state but the directory, resumes the same
 * count — and that a counter it cannot read is never treated as unspent.
 *
 * `YGG_HOME` is pointed at a temp directory, so nothing touches the real lab.
 */

let home: string;
let FileBudgetStore: typeof import('../src/budget.js').FileBudgetStore;
let budgetPath: typeof import('../src/budget.js').budgetPath;
let spendLogPath: typeof import('../src/budget.js').spendLogPath;
const hadHome = process.env['YGG_HOME'];

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), 'ygg-budget-'));
  process.env['YGG_HOME'] = home;
  // Imported after YGG_HOME is set: the paths are read when a call is made,
  // but the import also creates the home, so order is kept explicit.
  const module = await import('../src/budget.js');
  FileBudgetStore = module.FileBudgetStore;
  budgetPath = module.budgetPath;
  spendLogPath = module.spendLogPath;
});

afterAll(() => {
  if (hadHome === undefined) delete process.env['YGG_HOME'];
  else process.env['YGG_HOME'] = hadHome;
});

describe('the call budget survives a process', () => {
  it('resumes the count from disk and still refuses past the cap', () => {
    const first = CallBudget.open(new FileBudgetStore(), { id: 'pilot', purpose: 'pilot', runId: 'run-1', limit: 6 });
    first.spend(4);
    first.closeRun();

    // A completely separate store object — everything the second process shares
    // with the first is the directory.
    const second = CallBudget.open(new FileBudgetStore(), { id: 'pilot', purpose: 'pilot', runId: 'run-2', limit: 6 });
    expect(second.spent).toBe(4);
    expect(second.remaining).toBe(2);
    second.spend(2);
    expect(() => second.spend(1)).toThrow(BudgetExhaustedError);

    const third = CallBudget.open(new FileBudgetStore(), { id: 'pilot', purpose: 'pilot', runId: 'run-3', limit: 6 });
    expect(third.remaining).toBe(0);
    expect(() => third.spend(1)).toThrow(BudgetExhaustedError);
  });

  it('appends one spend line per run, with the model and the purpose', () => {
    const budget = CallBudget.open(new FileBudgetStore(), { id: 'logged', purpose: 'the first paid pilot', runId: 'run-x', limit: 10 });
    budget.spend(3);
    budget.recordUsage('accounts/fireworks/models/gpt-oss-120b', { promptTokens: 4000, completionTokens: 600 });
    budget.closeRun();
    const lines = readFileSync(spendLogPath(), 'utf8').trim().split('\n');
    const last: unknown = JSON.parse(lines[lines.length - 1] ?? '{}');
    expect(last).toMatchObject({
      budgetId: 'logged',
      runId: 'run-x',
      purpose: 'the first paid pilot',
      modelId: 'accounts/fireworks/models/gpt-oss-120b',
      calls: 3,
      tokensIn: 4000,
      tokensOut: 600,
      usageReported: true,
      limit: 10,
    });
  });

  it('refuses a cap above the standing 2,000 without a written override, and keeps the override', () => {
    const store = new FileBudgetStore();
    expect(() => CallBudget.open(store, { id: 'big', purpose: 'p', runId: 'r', limit: DEFAULT_CALL_BUDGET + 1 })).toThrow(PaidCallRefused);
    CallBudget.open(store, { id: 'big', purpose: 'p', runId: 'r', limit: 5000, ownerOverride: 'owner said so' }).closeRun();
    expect(store.read('big')?.ownerOverride).toBe('owner said so');
    // The raised ceiling persists, so a later open at 5000 needs no second override.
    expect(CallBudget.open(store, { id: 'big', purpose: 'p', runId: 'r2', limit: 5000 }).limit).toBe(5000);
  });

  it('never reads a corrupt counter as a fresh allowance', () => {
    const store = new FileBudgetStore();
    CallBudget.open(store, { id: 'torn', purpose: 'p', runId: 'r', limit: 5 }).spend(5);
    writeFileSync(budgetPath('torn'), '{"id":"torn","limit":', 'utf8');
    expect(() => store.read('torn')).toThrow();
    expect(() => CallBudget.open(store, { id: 'torn', purpose: 'p', runId: 'r', limit: 5 })).toThrow();
  });

  it('refuses a budget id that is a path', () => {
    const store = new FileBudgetStore();
    for (const bad of ['../escape', 'a/b', '..', 'C:\\x']) {
      expect(() => store.read(bad)).toThrow();
    }
  });
});
