import type { ThinkInput } from '../contract/types.js';
import type { IMindBackend } from '../consciousness/IMindBackend.js';
import type { ThinkPrompt } from '../consciousness/prompt.js';

/**
 * DECISION D1, IN CODE (docs/rework/CAMPAIGN.md → "Decisions delegated").
 *
 * "None until the evaluation harness exists and is proven on the mock backend.
 *  Then ONE hard-capped pilot: ≤ 2,000 calls total on the slow-mind model, call
 *  count enforced in code, spend logged."
 *
 * Four rules follow from that sentence. The first three are here; the fourth is
 * `door.ts`.
 *
 *   1. THE STORE IS THE AUTHORITY, NOT THE OBJECT IN THIS PROCESS. Every charge
 *      is an atomic check-and-increment against the PERSISTED counter, taken
 *      under the store's lock. A `CallBudget` holds no allowance of its own: N
 *      instances, two overlapping MCP tool calls and two operating-system
 *      processes all queue behind one counter. (Round 1 tested and mutated an
 *      in-memory copy: cap 10, two instances → 20 calls made, counter 10.)
 *   2. THE CEILING IS A CONSTANT, AND NO ARGUMENT CAN RAISE IT. `HARD_CALL_CEILING`
 *      is 2,000. A caller may ask for LESS. Asking for more is refused, full
 *      stop — there is no `ownerOverride` parameter on any function here, on any
 *      eval API, or on any MCP tool. Raising it takes a file a HUMAN creates
 *      under the shared home, which this code only ever READS, and whose
 *      presence and contents are copied into the spend log and the run manifest.
 *   3. SPENT NEVER GOES DOWN. Re-opening a budget resumes its count; a lower
 *      limit is honoured; nothing anywhere writes a smaller `spent`.
 */

/**
 * A backend that came out of `door.ts`. The brand is a symbol nothing declares a
 * value for, so the only way to hold one of these is to have called
 * `openBackend` — which means a judge whose constructor asks for one cannot be
 * handed a client somebody built themselves.
 */
declare const OPENED_BY_THE_DOOR: unique symbol;
export interface OpenedBackend extends IMindBackend {
  readonly [OPENED_BY_THE_DOOR]: true;
}

/** The ceiling. A constant, on purpose: a number no argument can move. */
export const HARD_CALL_CEILING = 2000;

/** What a budget gets when it asks for nothing in particular. */
export const DEFAULT_CALL_BUDGET = HARD_CALL_CEILING;

/**
 * How the ceiling in force was decided. Copied onto the budget state, into
 * every spend-log line and into the run manifest, so a reader of either can see
 * that a run was capped at 2,000 by the constant — or that a human file raised
 * it, and what that file said.
 */
export interface CeilingRuling {
  limit: number;
  source: 'constant' | 'override-file';
  /** Where the override was read from. Present only with `override-file`. */
  path?: string;
  /** The override file's own words, verbatim. Present only with `override-file`. */
  note?: string;
}

export const CONSTANT_CEILING: CeilingRuling = Object.freeze({ limit: HARD_CALL_CEILING, source: 'constant' as const });

export interface BudgetState {
  id: string;
  limit: number;
  spent: number;
  tokensIn: number;
  tokensOut: number;
  /** The ceiling this budget was last opened under. */
  ceiling: CeilingRuling;
}

/** One run's spend, appended when the run closes. */
export interface SpendLogEntry {
  budgetId: string;
  runId: string;
  purpose: string;
  modelId: string;
  calls: number;
  tokensIn: number;
  tokensOut: number;
  /** False when no backend in this run reported usage — the token counts are then floors. */
  usageReported: boolean;
  spentAfter: number;
  limit: number;
  /** The ceiling in force, and whether a human file raised it. */
  ceiling: CeilingRuling;
  /** Set when the run stopped because the cap was reached. */
  haltedBy?: string;
}

/**
 * Where a budget's counter lives, and the only thing allowed to decide whether
 * a call may go out.
 *
 * Synchronous on purpose, twice over: a spend must be durable BEFORE the call
 * goes out, and an `await` inside a check-and-increment is exactly the window
 * two overlapping tool calls in one process slipped through.
 */
export interface IBudgetStore {
  /**
   * The ceiling in force. Read from a human-created file where one exists;
   * NOTHING in this repo writes that file.
   */
  ceiling(): CeilingRuling;
  read(id: string): BudgetState | undefined;
  /** Create or resume, under the lock. Never lowers `spent`. Refuses above the ceiling. */
  open(id: string, limit: number): BudgetState;
  /** ATOMIC check-and-increment against the persisted counter. Throws at the cap. */
  charge(id: string, calls: number): BudgetState;
  /** Atomic merge of what the provider said it billed. */
  addUsage(id: string, tokensIn: number, tokensOut: number): BudgetState;
  appendSpend(entry: SpendLogEntry): void;
}

export class BudgetExhaustedError extends Error {
  constructor(
    readonly budgetId: string,
    readonly limit: number,
    readonly spent: number,
    readonly wanted: number,
  ) {
    super(
      `budget "${budgetId}" is exhausted: ${spent} of ${limit} calls already spent, ${wanted} more asked for. ` +
        `The run stops here and its result is not usable for a verdict.`,
    );
    this.name = 'BudgetExhaustedError';
  }
}

export class PaidCallRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaidCallRefused';
  }
}

/**
 * The shared half of every store: the check-and-increment itself, written once
 * so that a store which only knows how to read a file, write a file and take a
 * lock cannot get the arithmetic wrong.
 */
export abstract class BudgetStoreBase implements IBudgetStore {
  protected abstract load(id: string): BudgetState | undefined;
  protected abstract save(state: BudgetState): void;
  /** Run `body` with exclusive access to this budget id, across processes. */
  protected abstract withLock<T>(id: string, body: () => T): T;

  abstract ceiling(): CeilingRuling;
  abstract appendSpend(entry: SpendLogEntry): void;

  read(id: string): BudgetState | undefined {
    return this.load(id);
  }

  open(id: string, limit: number): BudgetState {
    if (!Number.isInteger(limit) || limit < 0) {
      throw new PaidCallRefused(`a call budget must be a non-negative whole number of calls, not ${String(limit)}`);
    }
    const ceiling = this.ceiling();
    if (limit > ceiling.limit) {
      throw new PaidCallRefused(
        `refused: budget "${id}" asks for ${limit} calls and the ceiling is ${ceiling.limit} ` +
          `(decision D1). No argument raises it: a smaller cap may be requested, and a larger one needs a file ` +
          `a human creates under the lab home. See eval/README.md → "Raising the cap".`,
      );
    }
    return this.withLock(id, () => {
      const previous = this.load(id);
      const state: BudgetState = {
        id,
        limit,
        // Never lowered. A reopen resumes; it does not forgive.
        spent: previous?.spent ?? 0,
        tokensIn: previous?.tokensIn ?? 0,
        tokensOut: previous?.tokensOut ?? 0,
        ceiling,
      };
      this.save(state);
      return state;
    });
  }

  charge(id: string, calls: number): BudgetState {
    if (!Number.isInteger(calls) || calls <= 0) {
      throw new PaidCallRefused(`a charge must be a positive whole number of calls, not ${String(calls)}`);
    }
    return this.withLock(id, () => {
      // RE-READ UNDER THE LOCK. This line is the whole fix: the counter on disk,
      // not the copy this process opened with, decides.
      const state = this.load(id);
      if (!state) {
        throw new PaidCallRefused(`refused: budget "${id}" has no counter on record; open it before charging it.`);
      }
      if (state.spent + calls > state.limit) {
        throw new BudgetExhaustedError(id, state.limit, state.spent, calls);
      }
      const next: BudgetState = { ...state, spent: state.spent + calls };
      this.save(next);
      return next;
    });
  }

  addUsage(id: string, tokensIn: number, tokensOut: number): BudgetState {
    return this.withLock(id, () => {
      const state = this.load(id);
      if (!state) throw new PaidCallRefused(`refused: budget "${id}" has no counter on record.`);
      const next: BudgetState = {
        ...state,
        tokensIn: state.tokensIn + Math.max(0, tokensIn),
        tokensOut: state.tokensOut + Math.max(0, tokensOut),
      };
      this.save(next);
      return next;
    });
  }
}

export interface MemoryBudgetStoreOptions {
  /**
   * Stand in for the human-created override file. Test-only: the real store
   * reads a file on disk that nothing in this repo can write.
   */
  overrideCeiling?: { limit: number; note: string; path?: string };
}

/**
 * A store in memory. Two `CallBudget`s over ONE of these are two processes over
 * one file — and now that is true rather than aspirational, because both of
 * them charge through `BudgetStoreBase.charge`.
 */
export class MemoryBudgetStore extends BudgetStoreBase {
  private readonly states = new Map<string, BudgetState>();
  readonly spend: SpendLogEntry[] = [];
  private readonly override: MemoryBudgetStoreOptions['overrideCeiling'];

  constructor(options: MemoryBudgetStoreOptions = {}) {
    super();
    this.override = options.overrideCeiling;
  }

  ceiling(): CeilingRuling {
    if (!this.override) return CONSTANT_CEILING;
    return {
      limit: this.override.limit,
      source: 'override-file',
      path: this.override.path ?? '(memory store)',
      note: this.override.note,
    };
  }

  protected load(id: string): BudgetState | undefined {
    const state = this.states.get(id);
    return state ? { ...state } : undefined;
  }
  protected save(state: BudgetState): void {
    this.states.set(state.id, { ...state });
  }
  protected withLock<T>(_id: string, body: () => T): T {
    // One thread, and every operation on this store is synchronous, so the
    // body cannot be interleaved with another. The lock is the call stack.
    return body();
  }
  appendSpend(entry: SpendLogEntry): void {
    this.spend.push({ ...entry });
  }
}

export interface BudgetSpec {
  /** Stable across processes — this is what the persisted counter is keyed by. */
  id: string;
  /** What the calls are for. Goes in the spend log. */
  purpose: string;
  /** This run's id, so one budget's log says which runs spent it. */
  runId: string;
  /**
   * Calls this budget may spend. Defaults to `DEFAULT_CALL_BUDGET`; LOWER is
   * free. Higher is refused — there is deliberately no second parameter that
   * would let a caller talk its way past the ceiling.
   */
  limit?: number;
}

/** A backend that reports what the provider billed. Optional — most do not. */
export interface UsageReporting {
  lastUsage(): { promptTokens: number; completionTokens: number } | undefined;
}

function reportsUsage(value: object): value is UsageReporting {
  return typeof (value as Partial<UsageReporting>).lastUsage === 'function';
}

/**
 * A handle on a budget. It holds NO allowance: `spend` asks the store, and the
 * store's answer is the only answer. What it does hold is this run's share of
 * the spending, so the spend log can say which run spent what.
 */
export class CallBudget {
  private callsThisRun = 0;
  private tokensInThisRun = 0;
  private tokensOutThisRun = 0;
  private usageSeen = false;
  private closed = false;
  private readonly models = new Set<string>();
  private snapshot: BudgetState;

  private constructor(
    private readonly store: IBudgetStore,
    private readonly spec: BudgetSpec,
    state: BudgetState,
  ) {
    this.snapshot = state;
  }

  /** Open (or resume) a budget. Resuming keeps the spend already on record. */
  static open(store: IBudgetStore, spec: BudgetSpec): CallBudget {
    const limit = spec.limit ?? DEFAULT_CALL_BUDGET;
    return new CallBudget(store, spec, store.open(spec.id, limit));
  }

  get id(): string {
    return this.spec.id;
  }
  get limit(): number {
    return this.current().limit;
  }
  /** The PERSISTED count, re-read: another instance may have spent since. */
  get spent(): number {
    return this.current().spent;
  }
  get remaining(): number {
    const state = this.current();
    return Math.max(0, state.limit - state.spent);
  }
  get ceiling(): CeilingRuling {
    return this.current().ceiling;
  }
  /** Calls this handle has spent, as opposed to the persisted total. */
  get spentThisRun(): number {
    return this.callsThisRun;
  }

  private current(): BudgetState {
    const live = this.store.read(this.spec.id);
    if (live) this.snapshot = live;
    return this.snapshot;
  }

  /**
   * Charge for calls that are about to go out. Written through BEFORE the call:
   * a provider bills a request it never answered, so a budget that counted on
   * success would under-count exactly when a run is going wrong.
   */
  spend(calls = 1): void {
    if (calls <= 0) return;
    this.snapshot = this.store.charge(this.spec.id, calls);
    this.callsThisRun += calls;
  }

  /** What the provider said it billed, when it says. */
  recordUsage(modelId: string, usage: { promptTokens: number; completionTokens: number } | undefined): void {
    this.models.add(modelId);
    if (!usage) return;
    this.usageSeen = true;
    this.tokensInThisRun += usage.promptTokens;
    this.tokensOutThisRun += usage.completionTokens;
    this.snapshot = this.store.addUsage(this.spec.id, usage.promptTokens, usage.completionTokens);
  }

  /**
   * Append this run's line to the spend log. Idempotent, because the caller is
   * required to put it in a `finally` and a thrown run would otherwise be the
   * one run that spent money and logged nothing (round 1's D6).
   */
  closeRun(halt?: RunHalt): SpendLogEntry | null {
    if (this.closed) return null;
    this.closed = true;
    const state = this.current();
    const entry: SpendLogEntry = {
      budgetId: state.id,
      runId: this.spec.runId,
      purpose: this.spec.purpose,
      modelId: [...this.models].sort().join('+') || 'none',
      calls: this.callsThisRun,
      tokensIn: this.tokensInThisRun,
      tokensOut: this.tokensOutThisRun,
      usageReported: this.usageSeen,
      spentAfter: state.spent,
      limit: state.limit,
      ceiling: state.ceiling,
      ...(halt?.stopped ? { haltedBy: halt.detail } : {}),
    };
    this.store.appendSpend(entry);
    return entry;
  }
}

// ─── What a run does when the money runs out ─────────────────────────────────

export type HaltReason = 'budget-exhausted';

/**
 * WHY AN ARM MAY NOT SILENTLY BECOME A REFLEX.
 *
 * `LlmMind` catches everything its backend throws and carries the being with
 * the world's hand-written policy. That is right for a flaky transport and
 * catastrophic for an exhausted budget: round 1 measured a cap of 3 producing a
 * FULL metric table — plan success 0.4091 over 6 traces — of a population that
 * had stopped thinking after three calls and was running on reflexes.
 *
 * The latch is set inside the guarded door, one line before the error is
 * thrown, so it is recorded whether or not anything downstream swallows it. The
 * A/B runner checks it between slices, stops, and emits a result with NO verdict
 * fields at all.
 */
export class RunHalt {
  private stopped_: { reason: HaltReason; detail: string } | null = null;
  private readonly errors_: { at: string; message: string }[] = [];

  halt(reason: HaltReason, detail: string): void {
    this.stopped_ ??= { reason, detail };
  }

  /** A backend error that is NOT the cap. Recorded, never hidden, never fatal. */
  noteError(at: string, message: string): void {
    this.errors_.push({ at, message });
  }

  get stopped(): boolean {
    return this.stopped_ !== null;
  }
  get reason(): HaltReason | null {
    return this.stopped_?.reason ?? null;
  }
  get detail(): string {
    return this.stopped_?.detail ?? '';
  }
  /** Every backend error this run saw, in order. */
  get backendErrors(): readonly { at: string; message: string }[] {
    return this.errors_;
  }
}

/**
 * A backend that charges the persisted counter before every call it makes, and
 * latches the halt when the counter says no.
 *
 * Not exported and not constructible from outside `door.ts`: the only way to
 * hold one is to have gone through the door.
 */
export class BudgetedBackend implements IMindBackend {
  /** The marker that makes wrapping idempotent, for a judge as well as a mind. */
  readonly budgeted = true as const;

  constructor(
    private readonly inner: IMindBackend,
    private readonly budget: CallBudget,
    private readonly halt: RunHalt | undefined,
    private readonly label: string,
  ) {}

  get modelId(): string {
    return this.inner.modelId;
  }

  async complete(prompt: ThinkPrompt, input: ThinkInput): Promise<string> {
    try {
      this.budget.spend(1);
    } catch (err) {
      if (err instanceof BudgetExhaustedError) {
        this.halt?.halt('budget-exhausted', `${this.label}: ${err.message}`);
      }
      throw err;
    }
    try {
      return await this.inner.complete(prompt, input);
    } catch (err) {
      this.halt?.noteError(this.label, err instanceof Error ? err.message : String(err));
      throw err;
    } finally {
      this.budget.recordUsage(
        this.inner.modelId,
        reportsUsage(this.inner) ? (this.inner as unknown as UsageReporting).lastUsage() : undefined,
      );
    }
  }
}
