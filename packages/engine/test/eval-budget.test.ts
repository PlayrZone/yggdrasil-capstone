import { describe, expect, it } from 'vitest';
import {
  BudgetExhaustedError,
  CallBudget,
  DEFAULT_CALL_BUDGET,
  FaithfulMockBackend,
  FireworksMindBackend,
  MemoryBudgetStore,
  MockMindBackend,
  OmniscientMockBackend,
  PaidCallRefused,
  accessBackend,
  accessLeakJudge,
  foragerAdapter,
  isDeclaredFree,
  runAb,
  runIgnoranceProbe,
  yggdrasilInterviewee,
} from '../src/index.js';
import type { IBudgetStore, IMindBackend, ThinkInput, ThinkPrompt } from '../src/index.js';

/**
 * DECISION D1, TESTED AS CODE.
 *
 * Three claims, and each is a separate failure if it stops holding:
 *   1. the cap is hard and SURVIVES A PROCESS — a restart resumes the count;
 *   2. raising it above 2,000 needs a written override, which is persisted and
 *      logged;
 *   3. nothing in `eval/**` can reach a paid backend without a budget, however
 *      the backend is constructed or handed in.
 */

/** A backend that looks exactly like a provider client to everything but the guard. */
class PretendPaidBackend implements IMindBackend {
  readonly modelId = 'accounts/fireworks/models/gpt-oss-120b';
  calls = 0;
  complete(_prompt: ThinkPrompt, _input: ThinkInput): Promise<string> {
    this.calls++;
    return Promise.resolve('{"goals":[],"plan":[],"utterances":[]}');
  }
}

const EMPTY_PROMPT: ThinkPrompt = { system: '', user: '' };
const EMPTY_INPUT = { snapshot: { id: 1 } } as unknown as ThinkInput;

describe('W1-E · the spend guard (decision D1)', () => {
  it('defaults to 2,000 calls and refuses more without an owner override', () => {
    const store = new MemoryBudgetStore();
    expect(CallBudget.open(store, { id: 'pilot', purpose: 'p', runId: 'r' }).limit).toBe(DEFAULT_CALL_BUDGET);
    expect(CallBudget.open(store, { id: 'small', purpose: 'p', runId: 'r', limit: 50 }).limit).toBe(50);
    expect(() => CallBudget.open(store, { id: 'big', purpose: 'p', runId: 'r', limit: 5000 })).toThrow(PaidCallRefused);
  });

  it('logs the override that raised the cap, and keeps it on the persisted state', () => {
    const store = new MemoryBudgetStore();
    const budget = CallBudget.open(store, {
      id: 'big',
      purpose: 'pilot',
      runId: 'r1',
      limit: 5000,
      ownerOverride: 'Hakim said 5k on 2026-09-19',
    });
    budget.spend(3);
    budget.closeRun();
    expect(store.read('big')?.ownerOverride).toBe('Hakim said 5k on 2026-09-19');
    expect(store.spend[0]?.ownerOverride).toBe('Hakim said 5k on 2026-09-19');
    expect(store.spend[0]).toMatchObject({ budgetId: 'big', runId: 'r1', purpose: 'pilot', calls: 3, limit: 5000 });
  });

  it('holds the cap across two processes-worth of state', () => {
    const disk = new MemoryBudgetStore();
    // "Process one" spends most of a small budget and dies without closing it.
    const first = CallBudget.open(disk, { id: 'pilot', purpose: 'p', runId: 'run-1', limit: 10 });
    first.spend(8);
    expect(first.remaining).toBe(2);

    // "Process two" opens the same id from the same store and inherits the count.
    const second = CallBudget.open(disk, { id: 'pilot', purpose: 'p', runId: 'run-2', limit: 10 });
    expect(second.spent).toBe(8);
    expect(second.remaining).toBe(2);
    second.spend(2);
    expect(() => second.spend(1)).toThrow(BudgetExhaustedError);
    expect(disk.read('pilot')?.spent).toBe(10);
  });

  it('cannot be reset by reopening with a bigger number', () => {
    const disk = new MemoryBudgetStore();
    CallBudget.open(disk, { id: 'pilot', purpose: 'p', runId: 'r', limit: 5 }).spend(5);
    const reopened = CallBudget.open(disk, { id: 'pilot', purpose: 'p', runId: 'r', limit: 2000 });
    expect(reopened.spent).toBe(5);
    expect(() => CallBudget.open(disk, { id: 'pilot', purpose: 'p', runId: 'r', limit: 2001 })).toThrow(PaidCallRefused);
  });

  it('charges before the call, so a failed call still counts', async () => {
    const store = new MemoryBudgetStore();
    const budget = CallBudget.open(store, { id: 'b', purpose: 'p', runId: 'r', limit: 2 });
    const exploding: IMindBackend = {
      modelId: 'accounts/fireworks/models/whatever',
      complete: () => Promise.reject(new Error('transport died')),
    };
    const guarded = accessBackend({ backend: exploding, budget });
    await expect(guarded.complete(EMPTY_PROMPT, EMPTY_INPUT)).rejects.toThrow('transport died');
    expect(budget.spent).toBe(1);
    expect(store.read('b')?.spent).toBe(1);
  });

  it('records reported usage and says when none was reported', () => {
    const store = new MemoryBudgetStore();
    const budget = CallBudget.open(store, { id: 'u', purpose: 'p', runId: 'r' });
    budget.spend(1);
    budget.recordUsage('model-x', undefined);
    expect(budget.closeRun().usageReported).toBe(false);

    const withUsage = CallBudget.open(store, { id: 'u2', purpose: 'p', runId: 'r' });
    withUsage.spend(1);
    withUsage.recordUsage('model-x', { promptTokens: 40, completionTokens: 7 });
    const entry = withUsage.closeRun();
    expect(entry).toMatchObject({ usageReported: true, tokensIn: 40, tokensOut: 7, modelId: 'model-x' });
  });

  it('a store that cannot be read is not a fresh allowance', () => {
    const broken: IBudgetStore = {
      read: () => {
        throw new Error('budget file is corrupt');
      },
      write: () => {},
      appendSpend: () => {},
    };
    expect(() => CallBudget.open(broken, { id: 'x', purpose: 'p', runId: 'r' })).toThrow('corrupt');
  });
});

describe('W1-E · the guard cannot be walked around', () => {
  it('refuses a backend that is not declared free and brought no budget', () => {
    expect(() => accessBackend({ backend: new PretendPaidBackend() })).toThrow(PaidCallRefused);
  });

  it('refuses a real provider client even when it claims to be free', () => {
    const lying = Object.assign(new FireworksMindBackend({ apiKey: 'not-used', model: 'm' }), { free: true });
    expect(isDeclaredFree(lying)).toBe(false);
    expect(() => accessBackend({ backend: lying })).toThrow(PaidCallRefused);
  });

  it('lets the declared-free mocks through and never charges them', () => {
    expect(isDeclaredFree(new FaithfulMockBackend(foragerAdapter))).toBe(true);
    expect(isDeclaredFree(new MockMindBackend({ world: foragerAdapter }))).toBe(false);
    expect(() => accessBackend({ backend: new OmniscientMockBackend(foragerAdapter) })).not.toThrow();
  });

  it('never wraps twice, so a composed instrument is charged once per call', async () => {
    const store = new MemoryBudgetStore();
    const budget = CallBudget.open(store, { id: 'once', purpose: 'p', runId: 'r', limit: 5 });
    const inner = new PretendPaidBackend();
    const once = accessBackend({ backend: inner, budget });
    const twice = accessBackend({ backend: once, budget });
    await twice.complete(EMPTY_PROMPT, EMPTY_INPUT);
    expect(inner.calls).toBe(1);
    expect(budget.spent).toBe(1);
  });

  it('refuses through the A/B entry point, not only at construction', async () => {
    await expect(
      runAb(
        { seed: 'guard', ticks: 10, cohortSize: 1, agentCount: 4 },
        { a: { backend: new PretendPaidBackend() }, b: { backend: new FaithfulMockBackend(foragerAdapter) } },
      ),
    ).rejects.toThrow(PaidCallRefused);
  });

  it('refuses through the interviewee an ignorance probe would use', () => {
    expect(() => yggdrasilInterviewee({ backend: new PretendPaidBackend() }, foragerAdapter)).toThrow(PaidCallRefused);
  });

  it('refuses a leak judge with no budget, and charges one that has it', async () => {
    const paidJudge = { id: 'llm-judge:x', judge: () => Promise.resolve({ judgement: 'clean' as const }) };
    expect(() => accessLeakJudge({ judge: paidJudge })).toThrow(PaidCallRefused);
    const store = new MemoryBudgetStore();
    const budget = CallBudget.open(store, { id: 'j', purpose: 'p', runId: 'r', limit: 1 });
    const guarded = accessLeakJudge({ judge: paidJudge, budget });
    await guarded.judge({ domain: 'fire', temptation: 't', input: EMPTY_INPUT, output: { goals: [], plan: [], utterances: [] }, raw: '' });
    expect(budget.spent).toBe(1);
  });

  it('stops an ignorance probe dead when the budget runs out mid-run', async () => {
    const store = new MemoryBudgetStore();
    const budget = CallBudget.open(store, { id: 'tiny', purpose: 'p', runId: 'r', limit: 2 });
    const inner = new PretendPaidBackend();
    const interviewee = yggdrasilInterviewee({ backend: inner, budget }, foragerAdapter);
    const input = await smallThinkInput();
    await expect(
      runIgnoranceProbe([{ beingId: 1, input, interviewee }], { limit: 4 }),
    ).rejects.toThrow(BudgetExhaustedError);
    expect(inner.calls).toBe(2);
  });
});

/** A real ThinkInput, taken from a two-tick run — cheaper than hand-building one. */
async function smallThinkInput(): Promise<ThinkInput> {
  const result = await runAb(
    { seed: 'probe-input', ticks: 220, cohortSize: 1, agentCount: 6 },
    { a: { backend: new FaithfulMockBackend(foragerAdapter) }, b: { backend: new FaithfulMockBackend(foragerAdapter) } },
  );
  const subject = result.subjects.A[0];
  if (!subject) throw new Error('no subject produced');
  return subject.input;
}
