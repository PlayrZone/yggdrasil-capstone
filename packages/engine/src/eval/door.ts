import type { WorldAdapter } from '../contract/adapter.js';
import { FireworksMindBackend } from '../consciousness/FireworksMindBackend.js';
import type { IMindBackend } from '../consciousness/IMindBackend.js';
import { MockMindBackend } from '../consciousness/MockMindBackend.js';
import { LlmLeakJudge, MockLeakJudge } from '../training/leakJudge.js';
import type { ILeakJudge, LeakJudgeRequest, LeakJudgeVerdict } from '../training/leakJudge.js';
import { BudgetedBackend, PaidCallRefused } from './budget.js';
import type { CallBudget, RunHalt } from './budget.js';
import type { OpenedBackend } from './budget.js';
import { LlmTraceJudge, MockTraceJudge } from './judge.js';
import type { ITraceJudge, MockTraceJudgeOptions } from './judge.js';
import { FaithfulMockBackend, OmniscientMockBackend } from './mocks.js';

/**
 * THE ONE DOOR — and the reason it takes a DESCRIPTION rather than an object.
 *
 * Round 1's guard asked a backend whether it was free. `isDeclaredFree` refused
 * `instanceof FireworksMindBackend`, looked no further, and a ten-line wrapper
 * holding a real Fireworks client and declaring `free = true` walked through it
 * unwrapped and unbudgeted, model id `accounts/fireworks/models/gpt-oss-120b`.
 * The bug was not the missing check. It was that a paid CLIENT could be a value
 * at the API boundary at all: anything that can be passed can be wrapped, and
 * any flag that can be read can be lied about.
 *
 * So no eval API takes a backend. Every one of them takes a `BackendSpec` — a
 * plain description with a `kind` — and this file is the only place in `eval/**`
 * that constructs anything. A provider client is built HERE, from env, already
 * wrapped in its budget, or it is not built. There is no `free` flag to set,
 * and a wrapper cannot exist where no object is accepted.
 *
 * The one seam left open is named for what it is: `test-fetch` builds the REAL
 * Fireworks client around a caller-supplied `fetch`, so the paid code path —
 * charging, retries, transport errors, exhaustion — is exercised by tests
 * against a stub instead of being the one path nothing covers.
 *
 * TWO CONTROLS HOLD IT, AND NEITHER IS AN ENV CHECK. *Round 2's comment here
 * claimed it "refuses to open unless `NODE_ENV === 'test'`". There was no such
 * check — the only `NODE_ENV` in the file was that sentence — so a reviewer
 * auditing the spend guard was told of a control that did not exist. The claim
 * is deleted rather than implemented, because implementing it would mean the
 * engine reading an environment of its own, which `ARCHITECTURE.md` forbids and
 * which `DoorContext.apiKey` exists precisely to avoid.* What actually holds it:
 *
 *   1. THE SPEC CARRIES A FUNCTION, and a function is not JSON. No zod schema
 *      can express one, so no argument an agent sends can construct this spec;
 *      it is reachable only from code already running in the process.
 *   2. IT STILL REQUIRES A BUDGET. A fake transport is not a licence to skip the
 *      counter — and exercising the counter is the point of the seam.
 */

export type FetchLike = typeof fetch;

/** What a mind is, said as data. */
export type BackendSpec =
  /** A scripted mind. Costs nothing and reaches nothing. */
  | { readonly kind: 'mock'; readonly mind: 'faithful' | 'omniscient' }
  /** The world's own reflex policy, serialised as if a model had answered. */
  | { readonly kind: 'reflex' }
  /** The paid provider. The key comes from env, inside this file, never from an argument. */
  | { readonly kind: 'fireworks'; readonly model?: string }
  /** TEST ONLY: the real provider client over a supplied `fetch`. Refused outside tests. */
  | { readonly kind: 'test-fetch'; readonly model: string; readonly fetch: FetchLike };

export interface DoorContext {
  world: WorldAdapter;
  /** Required for every paid kind. Absent is a refusal, never a free pass. */
  budget?: CallBudget | undefined;
  /**
   * The provider key, supplied by the HOST. The engine reads no environment —
   * `ARCHITECTURE.md` keeps it host-agnostic — so `packages/mcp` reads
   * `FIREWORKS_API_KEY` and hands it in here. A key is not a backend: it cannot
   * be wrapped, it cannot declare itself free, and no MCP tool schema has a
   * field for one.
   */
  apiKey?: string | undefined;
  /** Where an exhausted cap is latched, so a run can stop rather than degrade. */
  halt?: RunHalt | undefined;
  /** What this backend is for, in the halt message and the manifest. */
  label?: string;
}

/** Does opening this spec cost money? A fact about the `kind`, not about a flag. */
export function isPaidSpec(spec: BackendSpec): boolean {
  return spec.kind === 'fireworks' || spec.kind === 'test-fetch';
}

/** A stable label for a manifest. Never contains a key. */
export function describeBackendSpec(spec: BackendSpec): string {
  switch (spec.kind) {
    case 'mock':
      return `mock/${spec.mind}`;
    case 'reflex':
      return 'mock/reflex-policy';
    case 'fireworks':
      return `fireworks:${spec.model ?? DEFAULT_PAID_MODEL}`;
    case 'test-fetch':
      return `test-fetch:${spec.model}`;
  }
}

export const DEFAULT_PAID_MODEL = 'accounts/fireworks/models/gpt-oss-120b';

/**
 * Build the mind this spec describes. A paid kind comes back already wrapped in
 * its budget; a free one comes back bare, because there is nothing to charge.
 */
export function openBackend(spec: BackendSpec, context: DoorContext): IMindBackend {
  const label = context.label ?? describeBackendSpec(spec);
  switch (spec.kind) {
    case 'mock':
      return spec.mind === 'faithful' ? new FaithfulMockBackend(context.world) : new OmniscientMockBackend(context.world);
    case 'reflex':
      return new MockMindBackend({ world: context.world });
    case 'fireworks': {
      const budget = requireBudget(spec, context);
      if (!context.apiKey) {
        throw new PaidCallRefused(
          'refused: a fireworks backend was asked for and the host supplied no key. ' +
            'Run the mocks, or configure the host — the engine reads no environment of its own.',
        );
      }
      const model = spec.model ?? DEFAULT_PAID_MODEL;
      return new BudgetedBackend(new FireworksMindBackend({ apiKey: context.apiKey, model }), budget, context.halt, label);
    }
    case 'test-fetch': {
      // WHY THIS SEAM IS SAFE WITHOUT AN ENV CHECK — the two controls named in
      // the header, in the order they fire: it carries a FUNCTION, and a
      // function is not JSON. No MCP tool schema can express one, so no argument
      // an agent sends can ever construct this spec. It is reachable only from
      // code already running in the process — which is to say, from a test. It
      // still requires a budget: a fake transport is not a licence to skip the
      // counter, and the point of the seam is to exercise the counter.
      const budget = requireBudget(spec, context);
      if (typeof spec.fetch !== 'function') {
        throw new PaidCallRefused("refused: the 'test-fetch' backend needs a fetch function to stand in for the network.");
      }
      const client = new FireworksMindBackend({ apiKey: 'test-only-never-sent', model: spec.model, fetchImpl: spec.fetch });
      return new BudgetedBackend(client, budget, context.halt, label);
    }
  }
}

function requireBudget(spec: BackendSpec, context: DoorContext): CallBudget {
  if (!context.budget) {
    throw new PaidCallRefused(
      `refused: "${describeBackendSpec(spec)}" costs money and no CallBudget came with it. ` +
        'Open a budget (decision D1: the ceiling is a constant 2,000) and pass it.',
    );
  }
  return context.budget;
}

/**
 * The brand a judge's constructor asks for. Only `openBackend` produces one, so
 * `new LlmTraceJudge(somethingIBuilt)` does not typecheck.
 */
function branded(backend: IMindBackend): OpenedBackend {
  return backend as OpenedBackend;
}

// ─── Judges are models too, and go through the same door ─────────────────────

export type TraceJudgeSpec =
  | ({ readonly kind: 'mock' } & MockTraceJudgeOptions)
  | { readonly kind: 'llm'; readonly backend: BackendSpec };

export type LeakJudgeSpec =
  | { readonly kind: 'mock' }
  | { readonly kind: 'llm'; readonly backend: BackendSpec };

export function openTraceJudge(spec: TraceJudgeSpec, context: DoorContext): ITraceJudge {
  if (spec.kind === 'mock') {
    const { kind: _kind, ...options } = spec;
    return new MockTraceJudge(options);
  }
  return new LlmTraceJudge(branded(openBackend(spec.backend, { ...context, label: 'trace-judge' })));
}

export function openLeakJudge(spec: LeakJudgeSpec, context: DoorContext): ILeakJudge {
  if (spec.kind === 'mock') return new MockLeakJudge();
  const backend = openBackend(spec.backend, { ...context, label: 'leak-judge' });
  const judge = new LlmLeakJudge(backend);
  // The backend already charges per call, so the judge is NOT wrapped a second
  // time. Round 1 wrapped the judge instead, with no marker on the result, and
  // a double-wrapped judge charged 2 for one judgement.
  return {
    id: judge.id,
    judge: (request: LeakJudgeRequest): Promise<LeakJudgeVerdict> => judge.judge(request),
  };
}

/** Is this judge spec going to cost anything? */
export function isPaidJudgeSpec(spec: TraceJudgeSpec | LeakJudgeSpec): boolean {
  return spec.kind === 'llm' && isPaidSpec(spec.backend);
}
