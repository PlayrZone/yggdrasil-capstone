import { describe, expect, it } from 'vitest';
import {
  BudgetExhaustedError,
  CallBudget,
  CONSTANT_CEILING,
  DEFAULT_CALL_BUDGET,
  HARD_CALL_CEILING,
  MemoryBudgetStore,
  PaidCallRefused,
  RunHalt,
  foragerAdapter,
  foragerWorld,
  openBackend,
  openLeakJudge,
  openTraceJudge,
  runAb,
  runIgnoranceProbe,
  yggdrasilInterviewee,
} from '../src/index.js';
import type { ArmSpec, BudgetSpec, IBudgetStore, ThinkInput, ThinkPrompt } from '../src/index.js';

/**
 * DECISION D1, TESTED AS AN ATTACK.
 *
 * Round 1 passed its own tests and lost both halves of the guard:
 *
 *   THE CAP WAS PER-INSTANCE. `spend()` tested and mutated a private copy and
 *   never re-read the store. Measured: cap 10, two `CallBudget`s over one
 *   store → 20 calls made, counter said 10. No attack was needed — the MCP
 *   server is async and opens a fresh budget per tool call, so two overlapping
 *   `run_ab` calls in ONE process overspent by construction.
 *
 *   THE DOOR OPENED FOR A WRAPPED PROVIDER. The guard asked a backend whether
 *   it was free; a ten-line wrapper holding a real `FireworksMindBackend` and
 *   declaring `free = true` came back unwrapped and unbudgeted.
 *
 *   AN AGENT COULD RAISE ITS OWN CAP. `ownerOverride` was free text and any
 *   non-empty string bought a million calls — and the raised ceiling persisted,
 *   so every later open needed no override at all.
 *
 *   EXHAUSTION WAS SILENT. Cap 3 produced a full metric table over a population
 *   that had stopped thinking after three calls and was running on reflexes.
 *
 * Every test below fails on that code.
 */

const world = foragerAdapter;
const EMPTY_PROMPT: ThinkPrompt = { system: '', user: '' };
/** The emptiest legal situation. Enough shape that a judge prompt can be built over it. */
const EMPTY_INPUT = {
  snapshot: { id: 1, name: '', inventory: {}, needs: {}, health: 100, sick: false, place: {}, context: {} },
  recalledMemories: [],
  knowledge: [],
  relationships: new Map(),
  worldView: { tick: 0, night: false, season: 'spring', agents: [], resources: [], structures: [] },
  goals: [],
  trigger: 'periodic',
} as unknown as ThinkInput;
const spec = (id: string, limit?: number): BudgetSpec => ({
  id,
  purpose: 'p',
  runId: 'r',
  ...(limit !== undefined ? { limit } : {}),
});

/** A fetch that answers like Fireworks and never touches a network. */
function fakeFireworks(body = '{"goals":[],"plan":[],"utterances":[]}'): { fetch: typeof fetch; calls: () => number } {
  let calls = 0;
  const impl = (): Promise<Response> => {
    calls++;
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ choices: [{ message: { content: body } }] }),
      text: () => Promise.resolve(''),
      statusText: 'OK',
    } as unknown as Response);
  };
  return { fetch: impl as unknown as typeof fetch, calls: () => calls };
}

function paidSpec(fetchImpl: typeof fetch): ArmSpec['backend'] {
  return { kind: 'test-fetch', model: 'accounts/fireworks/models/gpt-oss-120b', fetch: fetchImpl };
}

// ─── The store is the only authority ─────────────────────────────────────────

describe('W1-E · the cap belongs to the STORE, not to an object in this process', () => {
  it('holds one cap across N budget handles over one store', () => {
    const store = new MemoryBudgetStore();
    const handles = Array.from({ length: 5 }, (_, i) => CallBudget.open(store, spec('shared', 10) as BudgetSpec & { runId: string }));
    let landed = 0;
    let refused = 0;
    // Round-robin, 5 handles × 6 attempts = 30 attempts against a cap of 10.
    for (let attempt = 0; attempt < 6; attempt++) {
      for (const handle of handles) {
        try {
          handle.spend(1);
          landed++;
        } catch (err) {
          expect(err).toBeInstanceOf(BudgetExhaustedError);
          refused++;
        }
      }
    }
    // Round 1: 30 landed, counter 10.
    expect(landed).toBe(10);
    expect(refused).toBe(20);
    expect(store.read('shared')?.spent).toBe(10);
    for (const handle of handles) expect(handle.remaining).toBe(0);
  });

  it('stops two OVERLAPPING async tool calls from overspending in one process', async () => {
    const store = new MemoryBudgetStore();
    const { fetch: impl, calls } = fakeFireworks();
    // Exactly the MCP server's shape: a fresh budget handle per tool call,
    // both live at once, both awaiting between charges.
    const one = openBackend(paidSpec(impl), { world, budget: CallBudget.open(store, spec('overlap', 6)) });
    const two = openBackend(paidSpec(impl), { world, budget: CallBudget.open(store, spec('overlap', 6)) });

    const attempt = async (backend: { complete: (p: ThinkPrompt, i: ThinkInput) => Promise<string> }): Promise<number> => {
      let landed = 0;
      for (let i = 0; i < 5; i++) {
        try {
          await backend.complete(EMPTY_PROMPT, EMPTY_INPUT);
          landed++;
        } catch (err) {
          if (!(err instanceof BudgetExhaustedError)) throw err;
        }
      }
      return landed;
    };
    const [a, b] = await Promise.all([attempt(one), attempt(two)]);

    // Round 1 measured 8 made against a counter of 4 on this exact shape.
    expect(a + b).toBe(6);
    expect(calls()).toBe(6);
    expect(store.read('overlap')?.spent).toBe(6);
  });

  it('never lowers the persisted count, however a budget is reopened', () => {
    const store = new MemoryBudgetStore();
    CallBudget.open(store, spec('pilot', 5)).spend(5);
    const reopened = CallBudget.open(store, spec('pilot', DEFAULT_CALL_BUDGET));
    expect(reopened.spent).toBe(5);
    // A SMALLER cap is legal and still cannot forgive what was spent.
    const smaller = CallBudget.open(store, spec('pilot', 2));
    expect(smaller.spent).toBe(5);
    expect(smaller.remaining).toBe(0);
    expect(() => smaller.spend(1)).toThrow(BudgetExhaustedError);
  });

  it('charges before the call, so a failed call still counts, and charges every retry', async () => {
    const store = new MemoryBudgetStore();
    const budget = CallBudget.open(store, spec('b', 2));
    const exploding = (): Promise<Response> => Promise.reject(new Error('transport died'));
    const halt = new RunHalt();
    const guarded = openBackend(paidSpec(exploding as unknown as typeof fetch), { world, edges: foragerWorld.edges, budget, halt });
    await expect(guarded.complete(EMPTY_PROMPT, EMPTY_INPUT)).rejects.toThrow('transport died');
    expect(budget.spent).toBe(1);
    expect(store.read('b')?.spent).toBe(1);
    // A transport error is SURFACED on the halt, not folded into behaviour.
    expect(halt.backendErrors).toHaveLength(1);
    expect(halt.stopped).toBe(false);
  });

  it('a store that cannot be read is never a fresh allowance', () => {
    const broken: IBudgetStore = {
      ceiling: () => CONSTANT_CEILING,
      read: () => {
        throw new Error('budget file is corrupt');
      },
      open: () => {
        throw new Error('budget file is corrupt');
      },
      charge: () => {
        throw new Error('budget file is corrupt');
      },
      addUsage: () => {
        throw new Error('budget file is corrupt');
      },
      appendSpend: () => {},
    };
    expect(() => CallBudget.open(broken, spec('x'))).toThrow('corrupt');
  });
});

// ─── The door takes a description, never an object ───────────────────────────

describe('W1-E · a paid client cannot exist at the API boundary', () => {
  it('refuses every paid spec that brought no budget', () => {
    const { fetch: impl } = fakeFireworks();
    expect(() => openBackend({ kind: 'fireworks' }, { world, edges: foragerWorld.edges })).toThrow(PaidCallRefused);
    expect(() => openBackend(paidSpec(impl), { world, edges: foragerWorld.edges })).toThrow(PaidCallRefused);
    // …and a fireworks spec WITH a budget still needs a key, which the engine
    // never reads for itself.
    const budget = CallBudget.open(new MemoryBudgetStore(), spec('k', 5));
    expect(() => openBackend({ kind: 'fireworks' }, { world, edges: foragerWorld.edges, budget })).toThrow(/no key/);
  });

  it('lets the free scripted minds through and never charges them', async () => {
    const store = new MemoryBudgetStore();
    const budget = CallBudget.open(store, spec('free', 5));
    const mock = openBackend({ kind: 'mock', mind: 'faithful' }, { world, edges: foragerWorld.edges, budget });
    await mock.complete(EMPTY_PROMPT, EMPTY_INPUT);
    expect(budget.spent).toBe(0);
  });

  it('charges a judge once per judgement, not once per wrapping layer', async () => {
    const store = new MemoryBudgetStore();
    const budget = CallBudget.open(store, spec('judge', 4));
    const { fetch: impl, calls } = fakeFireworks('{"verdict":"clean"}');
    const judge = openLeakJudge({ kind: 'llm', backend: paidSpec(impl) }, { world, edges: foragerWorld.edges, budget });
    await judge.judge({
      domain: 'fire',
      temptation: 't',
      input: EMPTY_INPUT,
      output: { goals: [], plan: [], utterances: [] },
      raw: '',
    });
    // Round 1's `accessLeakJudge` left no marker, so a double-wrapped judge
    // charged 2 for one judgement.
    expect(budget.spent).toBe(1);
    expect(calls()).toBe(1);
  });

  it('refuses a trace judge and an interviewee that brought no budget', () => {
    const { fetch: impl } = fakeFireworks();
    expect(() => openTraceJudge({ kind: 'llm', backend: paidSpec(impl) }, { world, edges: foragerWorld.edges })).toThrow(PaidCallRefused);
    expect(() => yggdrasilInterviewee(openBackend(paidSpec(impl), { world, edges: foragerWorld.edges }), world)).toThrow(PaidCallRefused);
  });

  it('refuses through the A/B entry point, not only at construction', async () => {
    const { fetch: impl } = fakeFireworks();
    await expect(
      runAb(
        { seeds: ['guard'], ticks: 10, cohortSize: 1, agentCount: 4 },
        { arms: [{ id: 'A', backend: paidSpec(impl) }, { id: 'B', backend: { kind: 'mock', mind: 'faithful' } }] },
      ),
    ).rejects.toThrow(PaidCallRefused);
  });
});

// ─── The ceiling is a constant no argument can move ──────────────────────────

describe('W1-E · the cap cannot be raised by anything an agent can pass', () => {
  it('is a constant, and a bigger number is simply refused', () => {
    const store = new MemoryBudgetStore();
    expect(HARD_CALL_CEILING).toBe(2000);
    expect(CallBudget.open(store, spec('pilot')).limit).toBe(DEFAULT_CALL_BUDGET);
    expect(CallBudget.open(store, spec('small', 50)).limit).toBe(50);
    expect(() => CallBudget.open(store, spec('big', HARD_CALL_CEILING + 1))).toThrow(PaidCallRefused);
    expect(() => CallBudget.open(store, spec('big', 1_000_000))).toThrow(PaidCallRefused);
  });

  it('ignores an ownerOverride smuggled in through a cast — the parameter no longer exists', () => {
    const store = new MemoryBudgetStore();
    const smuggled = { id: 'big', purpose: 'p', runId: 'r', limit: 1_000_000, ownerOverride: 'ok' } as unknown as BudgetSpec;
    // Round 1: any non-empty string bought a million-call cap, and the raised
    // ceiling persisted so the next open needed nothing at all.
    expect(() => CallBudget.open(store, smuggled)).toThrow(PaidCallRefused);
    expect(store.read('big')).toBeUndefined();
    // …and no ceiling was raised on the way past.
    expect(CallBudget.open(store, spec('big', HARD_CALL_CEILING)).limit).toBe(HARD_CALL_CEILING);
    expect(() => CallBudget.open(store, spec('big', HARD_CALL_CEILING + 1))).toThrow(PaidCallRefused);
  });

  it('raises only for a human-created override, and reports it in the state and the spend log', () => {
    const note = '{"limit":2500,"reason":"Hakim approved a 2,500-call replication on 2026-09-19"}';
    const store = new MemoryBudgetStore({ overrideCeiling: { limit: 2500, note, path: '<home>/eval/ALLOW-ABOVE-CAP.json' } });
    const budget = CallBudget.open(store, spec('raised', 2500));
    expect(budget.limit).toBe(2500);
    expect(budget.ceiling.source).toBe('override-file');
    expect(budget.ceiling.note).toBe(note);
    budget.spend(2);
    budget.closeRun();
    expect(store.read('raised')?.ceiling.source).toBe('override-file');
    expect(store.spend[0]?.ceiling).toMatchObject({ limit: 2500, source: 'override-file', note });
    // Even a raised ceiling is a ceiling.
    expect(() => CallBudget.open(store, spec('raised', 2501))).toThrow(PaidCallRefused);
  });

  it('writes the spend line once, and writes it even when the run threw', () => {
    const store = new MemoryBudgetStore();
    const budget = CallBudget.open(store, spec('once', 5));
    budget.spend(2);
    budget.recordUsage('accounts/fireworks/models/gpt-oss-120b', { promptTokens: 40, completionTokens: 7 });
    const entry = budget.closeRun();
    expect(entry).toMatchObject({ calls: 2, tokensIn: 40, tokensOut: 7, usageReported: true, spentAfter: 2, limit: 5 });
    expect(entry?.ceiling).toMatchObject({ limit: HARD_CALL_CEILING, source: 'constant' });
    // Idempotent, because the caller is required to put it in a `finally`.
    expect(budget.closeRun()).toBeNull();
    expect(store.spend).toHaveLength(1);
  });
});

// ─── Exhaustion mid-run is loud ──────────────────────────────────────────────

describe('W1-E · a run that runs out of money produces no verdict', () => {
  it('stops, flags itself unusable, and emits NO metric table at all', async () => {
    const store = new MemoryBudgetStore();
    const budget = CallBudget.open(store, spec('tiny', 3));
    const { fetch: impl, calls } = fakeFireworks();
    const result = await runAb(
      { seeds: ['exhaust'], ticks: 900, cohortSize: 4, agentCount: 12 },
      {
        arms: [
          { id: 'A', backend: paidSpec(impl) },
          { id: 'B', backend: paidSpec(impl) },
        ],
        budget,
      },
    );

    // Round 1: this completed normally with a full metric table — plan success
    // 0.4091 over 6 traces — of a population running on reflexes.
    expect(result.usable).toBe(false);
    if (result.usable) throw new Error('unreachable');
    expect(result.reason).toBe('budget-exhausted');
    expect(result.detail).toContain('exhausted');
    // No verdict fields. Not a flag beside a table; no table.
    expect('perSeed' in result).toBe(false);
    expect('contrasts' in result).toBe(false);
    expect('traces' in result).toBe(false);
    expect('subjects' in result).toBe(false);
    // The manifest and the spend record survive, which is the point of them.
    expect(result.manifest.budget).toMatchObject({ id: 'tiny', limit: 3 });
    expect(calls()).toBeLessThanOrEqual(3);
    expect(store.read('tiny')?.spent).toBe(3);
  }, 120_000);

  it('stops an ignorance probe dead rather than interviewing on credit', async () => {
    const store = new MemoryBudgetStore();
    const budget = CallBudget.open(store, spec('probe-tiny', 2));
    const { fetch: impl, calls } = fakeFireworks('I do not know.');
    const interviewee = yggdrasilInterviewee(openBackend(paidSpec(impl), { world, edges: foragerWorld.edges, budget }), world);
    const input = await someThinkInput();
    await expect(runIgnoranceProbe([{ beingId: 1, input, interviewee }], { world, limit: 4 })).rejects.toThrow(
      BudgetExhaustedError,
    );
    expect(calls()).toBe(2);
  }, 120_000);
});

/** A real ThinkInput, taken from a short mock run — cheaper than hand-building one. */
async function someThinkInput(): Promise<ThinkInput> {
  const result = await runAb(
    { seeds: ['probe-input'], ticks: 300, cohortSize: 1, agentCount: 6 },
    {
      arms: [
        { id: 'A', backend: { kind: 'mock', mind: 'faithful' } },
        { id: 'B', backend: { kind: 'mock', mind: 'faithful' } },
      ],
    },
  );
  if (!result.usable) throw new Error(result.reason);
  const subject = result.subjects.A?.[0];
  if (!subject) throw new Error('no subject produced');
  return subject.input;
}
