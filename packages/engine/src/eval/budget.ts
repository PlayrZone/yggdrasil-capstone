import { FireworksMindBackend } from '../consciousness/FireworksMindBackend.js';
import type { IMindBackend } from '../consciousness/IMindBackend.js';
import type { ThinkInput } from '../contract/types.js';
import type { ThinkPrompt } from '../consciousness/prompt.js';
import type { ILeakJudge, LeakJudgeRequest, LeakJudgeVerdict } from '../training/leakJudge.js';

/**
 * DECISION D1, IN CODE (docs/rework/CAMPAIGN.md → "Decisions delegated").
 *
 * "None until the evaluation harness exists and is proven on the mock backend.
 *  Then ONE hard-capped pilot: ≤ 2,000 calls total on the slow-mind model, call
 *  count enforced in code, spend logged."
 *
 * Three rules follow from that sentence and are implemented here:
 *
 *   1. A CAP THAT OUTLIVES THE PROCESS. A budget is identified by a string and
 *      its counter is written through to a store on every call, so a crashed run
 *      or a second process resumes the same count rather than starting at zero.
 *      The store is an interface because the engine writes no files (see
 *      `record/types.ts`, `ICognitionSink`); `packages/mcp` supplies the one
 *      that lives under the shared home.
 *   2. RAISING THE CAP IS AN EVENT. Anything above `DEFAULT_CALL_BUDGET`, or
 *      above whatever this budget id was last opened with, needs a written
 *      `ownerOverride` and that string is persisted and logged.
 *   3. THE PAID PATH CANNOT BE REACHED WITHOUT ONE. `accessBackend` is the only
 *      way an eval instrument gets a backend, and a backend that is not
 *      DECLARED free is refused unless a budget came with it. Declaring is
 *      explicit (`free: true`) and a real provider client is refused even when
 *      it lies about being free.
 */

/** The pilot's ceiling. A budget may be smaller; larger needs an owner override. */
export const DEFAULT_CALL_BUDGET = 2000;

export interface BudgetState {
  id: string;
  limit: number;
  spent: number;
  tokensIn: number;
  tokensOut: number;
  /** The last override that raised this budget's ceiling, if any. */
  ownerOverride?: string;
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
  ownerOverride?: string;
}

/**
 * Where a budget's counter lives. Synchronous on purpose: a spend must be
 * durable BEFORE the call goes out, and an async write would let a process die
 * between the two with the money gone and the counter unmoved.
 */
export interface IBudgetStore {
  read(id: string): BudgetState | undefined;
  write(state: BudgetState): void;
  appendSpend(entry: SpendLogEntry): void;
}

/** A store in memory. Two `CallBudget`s over ONE of these are two processes over one file. */
export class MemoryBudgetStore implements IBudgetStore {
  private readonly states = new Map<string, BudgetState>();
  readonly spend: SpendLogEntry[] = [];

  read(id: string): BudgetState | undefined {
    const state = this.states.get(id);
    return state ? { ...state } : undefined;
  }
  write(state: BudgetState): void {
    this.states.set(state.id, { ...state });
  }
  appendSpend(entry: SpendLogEntry): void {
    this.spend.push({ ...entry });
  }
}

export class BudgetExhaustedError extends Error {
  constructor(readonly budgetId: string, readonly limit: number, readonly spent: number, readonly wanted: number) {
    super(
      `budget "${budgetId}" is exhausted: ${spent} of ${limit} calls already spent, ${wanted} more asked for. ` +
        `Open a budget with a higher limit and an explicit ownerOverride, or stop here.`,
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

export interface BudgetSpec {
  /** Stable across processes — this is what the persisted counter is keyed by. */
  id: string;
  /** What the calls are for. Goes in the spend log. */
  purpose: string;
  /** This run's id, so one budget's log says which runs spent it. */
  runId: string;
  /** Default `DEFAULT_CALL_BUDGET`. Lower is free; higher needs `ownerOverride`. */
  limit?: number;
  /** The owner saying, in writing, that a larger cap is intended. Persisted and logged. */
  ownerOverride?: string;
}

/** A backend that reports what the provider billed. Optional — most do not. */
export interface UsageReporting {
  lastUsage(): { promptTokens: number; completionTokens: number } | undefined;
}

function reportsUsage(value: object): value is UsageReporting {
  return typeof (value as Partial<UsageReporting>).lastUsage === 'function';
}

export class CallBudget {
  private state: BudgetState;
  private callsThisRun = 0;
  private tokensInThisRun = 0;
  private tokensOutThisRun = 0;
  private usageSeen = false;
  private models = new Set<string>();

  private constructor(
    private readonly store: IBudgetStore,
    private readonly spec: BudgetSpec,
    state: BudgetState,
  ) {
    this.state = state;
  }

  /**
   * Open (or resume) a budget. Resuming keeps the spend already on record — the
   * whole point of persisting it — and only an explicit override may raise the
   * ceiling, either above the default or above what this id was opened with.
   */
  static open(store: IBudgetStore, spec: BudgetSpec): CallBudget {
    const wanted = spec.limit ?? DEFAULT_CALL_BUDGET;
    if (!Number.isInteger(wanted) || wanted < 0) {
      throw new PaidCallRefused(`a call budget must be a non-negative whole number of calls, not ${String(spec.limit)}`);
    }
    const previous = store.read(spec.id);
    const ceiling = Math.max(DEFAULT_CALL_BUDGET, previous?.limit ?? 0);
    const override = spec.ownerOverride?.trim();
    if (wanted > ceiling && !override) {
      throw new PaidCallRefused(
        `refused: budget "${spec.id}" asks for ${wanted} calls, above the standing cap of ${ceiling} ` +
          `(decision D1 sets ${DEFAULT_CALL_BUDGET}). Pass ownerOverride with the owner's reason to raise it.`,
      );
    }
    const state: BudgetState = {
      id: spec.id,
      limit: wanted,
      spent: previous?.spent ?? 0,
      tokensIn: previous?.tokensIn ?? 0,
      tokensOut: previous?.tokensOut ?? 0,
      ...(override ? { ownerOverride: override } : previous?.ownerOverride ? { ownerOverride: previous.ownerOverride } : {}),
    };
    store.write(state);
    return new CallBudget(store, spec, state);
  }

  get id(): string {
    return this.state.id;
  }
  get limit(): number {
    return this.state.limit;
  }
  get spent(): number {
    return this.state.spent;
  }
  get remaining(): number {
    return Math.max(0, this.state.limit - this.state.spent);
  }
  /** Calls this CallBudget instance has spent, as opposed to the persisted total. */
  get spentThisRun(): number {
    return this.callsThisRun;
  }

  /**
   * Charge for calls that are about to go out. Written through BEFORE the call:
   * a provider bills a request it never answered, so a budget that counted on
   * success would under-count exactly when a run is going wrong.
   */
  spend(calls = 1): void {
    if (calls <= 0) return;
    if (this.state.spent + calls > this.state.limit) {
      throw new BudgetExhaustedError(this.state.id, this.state.limit, this.state.spent, calls);
    }
    this.state = { ...this.state, spent: this.state.spent + calls };
    this.callsThisRun += calls;
    this.store.write(this.state);
  }

  /** What the provider said it billed, when it says. */
  recordUsage(modelId: string, usage: { promptTokens: number; completionTokens: number } | undefined): void {
    this.models.add(modelId);
    if (!usage) return;
    this.usageSeen = true;
    this.tokensInThisRun += usage.promptTokens;
    this.tokensOutThisRun += usage.completionTokens;
    this.state = {
      ...this.state,
      tokensIn: this.state.tokensIn + usage.promptTokens,
      tokensOut: this.state.tokensOut + usage.completionTokens,
    };
    this.store.write(this.state);
  }

  /** Append this run's line to the spend log. Safe to call once per run. */
  closeRun(): SpendLogEntry {
    const entry: SpendLogEntry = {
      budgetId: this.state.id,
      runId: this.spec.runId,
      purpose: this.spec.purpose,
      modelId: [...this.models].sort().join('+') || 'none',
      calls: this.callsThisRun,
      tokensIn: this.tokensInThisRun,
      tokensOut: this.tokensOutThisRun,
      usageReported: this.usageSeen,
      spentAfter: this.state.spent,
      limit: this.state.limit,
      ...(this.state.ownerOverride ? { ownerOverride: this.state.ownerOverride } : {}),
    };
    this.store.appendSpend(entry);
    return entry;
  }
}

// ─── The guard every paid entry point goes through ───────────────────────────

/**
 * A backend that costs nothing, said out loud. The marker is a literal on the
 * object rather than a name pattern, so "is this free?" is a question about
 * what the author declared and not about how they spelled a model id.
 */
export interface FreeBackend extends IMindBackend {
  readonly free: true;
}

export interface BackendAccess {
  backend: IMindBackend;
  /** Absent only for a declared-free backend. */
  budget?: CallBudget;
}

/** Is this object declaring itself free of charge? */
export function isDeclaredFree(backend: IMindBackend): boolean {
  // A real provider client is never free, whatever it says about itself. This
  // is the one bypass worth closing by name: everything else that reaches a
  // network in this repo goes through `FireworksMindBackend`.
  if (backend instanceof FireworksMindBackend) return false;
  return (backend as Partial<FreeBackend>).free === true;
}

/**
 * THE ONLY DOOR. Every instrument in `eval/**` takes its backend from here, so
 * there is one place where "this will cost money" is decided, and constructing
 * a backend and handing it straight to `runAb`/`runIgnoranceProbe`/`judgeTraces`
 * cannot reach a provider without a budget attached.
 */
export function accessBackend(access: BackendAccess): IMindBackend {
  // Already through the door. Composition is the normal case here — `runAb`
  // hands its budgeted backend to the baseline agent, which hands it to an
  // interviewee — and wrapping twice would charge twice for one call.
  if (access.backend instanceof BudgetedBackend) return access.backend;
  if (!access.budget) {
    if (isDeclaredFree(access.backend)) return access.backend;
    throw new PaidCallRefused(
      `refused: "${access.backend.modelId}" is not a declared-free backend and no CallBudget came with it. ` +
        'Open a budget (decision D1: ≤ 2,000 calls) and pass it, or use a free mock.',
    );
  }
  return new BudgetedBackend(access.backend, access.budget);
}

/** A backend that charges the budget before every call it makes. */
class BudgetedBackend implements IMindBackend {
  constructor(
    private readonly inner: IMindBackend,
    private readonly budget: CallBudget,
  ) {}

  get modelId(): string {
    return this.inner.modelId;
  }

  async complete(prompt: ThinkPrompt, input: ThinkInput): Promise<string> {
    this.budget.spend(1);
    try {
      return await this.inner.complete(prompt, input);
    } finally {
      this.budget.recordUsage(this.inner.modelId, reportsUsage(this.inner) ? this.inner.lastUsage() : undefined);
    }
  }
}

export interface JudgeAccess {
  judge: ILeakJudge;
  budget?: CallBudget;
}

/** The same door for a leak judge — a judge is a model too. */
export function accessLeakJudge(access: JudgeAccess): ILeakJudge {
  if (!access.budget) {
    if ((access.judge as { free?: boolean }).free === true) return access.judge;
    throw new PaidCallRefused(
      `refused: leak judge "${access.judge.id}" is not declared free and no CallBudget came with it.`,
    );
  }
  const { judge, budget } = access;
  return {
    id: judge.id,
    judge(request: LeakJudgeRequest): Promise<LeakJudgeVerdict> {
      budget.spend(1);
      return judge.judge(request);
    },
  };
}
