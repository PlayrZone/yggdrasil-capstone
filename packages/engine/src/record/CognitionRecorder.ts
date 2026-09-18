import type { Intent, MindOutput, SimEvent, ThinkInput } from '../contract/types.js';
import type { CognitionRecord } from '../consciousness/LlmMind.js';
import { ENGINE_VERSION } from '../version.js';
import { OutcomeTracker } from './OutcomeTracker.js';
import { ScaffoldLedger } from './ScaffoldLedger.js';
import { serializeThinkInput, snapshotJson } from './serialize.js';
import type {
  CognitionOutcome,
  CognitionRecordV2,
  ICognitionSink,
  RecordedRunOptions,
  RecorderWorld,
  ResolvedOutput,
  RunCounts,
  ScaffoldState,
  SerializedThinkInput,
} from './types.js';
import { COGNITION_SCHEMA_VERSION } from './types.js';

export interface CognitionRecorderOptions {
  sink: ICognitionSink;
  runId: string;
  scenarioId: string;
  worldId: string;
  seed: string;
  modelId: string;
  backendLabel: string;
  options: RecordedRunOptions;
  scaffold: ScaffoldLedger;
  world: RecorderWorld;
  /** Wall clock for the run manifest only; nothing in the sim reads it. */
  nowMs: () => number;
  /** Called once, with the first sink error. The corpus is incomplete from there. */
  onFailure?: (error: string) => void;
}

/** What the host knows about an act once the scheduler has handed it back. */
export interface CompletedAct {
  beingId: number;
  parsed: MindOutput;
  /** The plan as handed to the body, or null when it was never applied. */
  appliedPlan: readonly Intent[] | null;
  resolved: MindOutput | null;
  /** The tick the result landed on, which is not the tick it was asked at. */
  tick: number;
}

/** The prompt-build half: the conditions the model actually reasoned under. */
interface FrozenPrompt {
  input: SerializedThinkInput;
  prompt: { system: string; user: string };
  scaffold: ScaffoldState;
  beingName: string;
  generation: number;
}

interface PendingAct {
  frozen?: FrozenPrompt;
  attempt?: CognitionRecord;
}

/**
 * Assembles the lossless record. Three moments go into one row and they are
 * hours of sim time apart: the run's constants, the instant the prompt was
 * built, and the instant the answer came back. The prompt-build half is frozen
 * at `freezeInput` — the input AND the scaffold AND who the being was — because
 * anything read later describes a world the model never saw.
 *
 * It also reconciles: every prompt sent ends as a written record or a counted
 * drop, and a sink that throws stops the recorder loudly instead of inflating
 * a manifest over rows that never landed.
 */
export class CognitionRecorder {
  private readonly pending = new Map<number, PendingAct>();
  private readonly tracker: OutcomeTracker;
  private readonly counts: RunCounts = {
    promptsSent: 0,
    recordsWritten: 0,
    unanswered: 0,
    outcomesWritten: 0,
    recordsDropped: 0,
    outcomesDropped: 0,
  };
  private failure: string | null = null;
  private finalTick = 0;
  private closed = false;

  constructor(private readonly options: CognitionRecorderOptions) {
    this.tracker = new OutcomeTracker(options.world, options.runId, options.options.outcomeWindowTicks, (outcome) => {
      this.writeOutcome(outcome);
    });
    this.guard(() =>
      options.sink.openRun({
        runId: options.runId,
        schemaVersion: COGNITION_SCHEMA_VERSION,
        engineVersion: ENGINE_VERSION,
        scenarioId: options.scenarioId,
        worldId: options.worldId,
        seed: options.seed,
        modelId: options.modelId,
        backendLabel: options.backendLabel,
        options: options.options,
        openedAtMs: options.nowMs(),
      }),
    );
  }

  /** Non-null once a sink write has thrown; the corpus is then incomplete. */
  get failureReason(): string | null {
    return this.failure;
  }

  /**
   * The prompt-build half, frozen at the instant the prompt was built.
   * Everything after this point is a different world: by the time the backend
   * answers, the miners have rewritten the knowledge the prompt quoted and a
   * driver may have provisioned the being — so a scaffold read then would
   * claim interventions that had not happened when the model decided.
   *
   * Keyed by being: the scheduler allows one think per being at a time, so a
   * slot is never contended, and a stale one is superseded.
   */
  readonly freezeInput = (input: ThinkInput, prompt: { system: string; user: string }): void => {
    const beingId = input.snapshot.id;
    const tick = input.worldView.tick;
    this.counts.promptsSent++;
    this.slot(beingId).frozen = {
      input: serializeThinkInput(input),
      prompt: { ...prompt },
      scaffold: {
        ...this.options.scaffold.beingState(beingId, tick, (narrativeId) =>
          this.options.world.carriesNarrative(beingId, narrativeId),
        ),
        mythBehavior: this.options.options.mythBehavior,
        leadership: this.options.options.leadership,
        offerMaking: this.options.options.offerMaking,
        craftLearning: this.options.options.craftLearning,
      },
      beingName: this.options.world.name(beingId),
      generation: this.options.world.generation(beingId),
    };
  };

  /** The backend half, straight off `LlmMind`. */
  readonly attempt = (record: CognitionRecord): void => {
    this.slot(record.agentId).attempt = record;
  };

  readonly observeBefore = (event: SimEvent): void => {
    this.tracker.observeBefore(event);
  };

  readonly observeAfter = (event: SimEvent): void => {
    this.tracker.observeAfter(event);
  };

  /** The world half. Called after the plan has been handed to the body. */
  complete(act: CompletedAct): void {
    const slot = this.pending.get(act.beingId);
    const frozen = slot?.frozen;
    const attempt = slot?.attempt;
    // No frozen prompt means this act predates the recording; no attempt means
    // the answer never reached the log, and `end()` will file it as unanswered
    // — either way the slot must NOT be dropped here, or a prompt goes missing.
    if (!frozen || !attempt) return;
    this.pending.delete(act.beingId);

    const record = this.buildRecord(frozen, act.beingId, {
      status: 'answered',
      attempts: attempt.attempts.map((a) => ({ ...a, prompt: { ...a.prompt } })),
      modelId: attempt.modelId,
      parse: {
        valid: attempt.valid,
        retried: attempt.retried,
        fellBackToReflex: attempt.fellBackToReflex,
        ...(attempt.error !== undefined ? { error: attempt.error } : {}),
      },
      parsedOutput: snapshotJson(act.parsed),
      resolvedOutput: resolvedOf(act),
      appliedTick: act.appliedPlan ? act.tick : null,
      latencyMs: attempt.latencyMs,
    });

    // Written FIRST. Counting or opening an outcome before the row is durable
    // is how a manifest ends up claiming 69 rows over 5 on disk, with 64
    // outcomes pointing at records that never landed.
    if (!this.writeRecord(record)) return;
    this.tracker.beginAct(
      record.id,
      act.beingId,
      act.tick,
      act.appliedPlan,
      act.resolved?.goals ?? null,
      this.options.scaffold.interventionsBetween(act.beingId, record.tick, act.tick),
    );
  }

  tick(tick: number): void {
    this.finalTick = tick;
    if (this.failure) return;
    this.tracker.tick(tick);
  }

  /**
   * Close the run. Every prompt still in flight gets an explicit row saying so
   * — a prompt that simply vanishes is one that was paid for and cannot be
   * audited — and the manifest carries counts that must reconcile.
   */
  end(): void {
    if (this.closed) return;
    this.closed = true;
    for (const [beingId, slot] of this.pending) {
      if (!slot.frozen) continue;
      this.counts.unanswered++;
      this.writeRecord(this.buildRecord(slot.frozen, beingId, UNANSWERED(this.options.modelId)));
    }
    this.pending.clear();
    this.tracker.flush(this.finalTick);
    // Attempted even after a failure, and outside `guard`: only one file may be
    // broken, and a manifest that can still be written is the one place a
    // reader learns the corpus beside it is incomplete.
    try {
      this.options.sink.closeRun({
        closedAtMs: this.options.nowMs(),
        finalTick: this.finalTick,
        counts: { ...this.counts },
        status: this.failure ? 'failed' : 'ok',
        ...(this.failure ? { firstError: this.failure } : {}),
        scaffold: this.options.scaffold.summary(),
      });
    } catch {
      /* the manifest is unwritable too; `failureReason` is the host's channel */
    }
  }

  private buildRecord(
    frozen: FrozenPrompt,
    beingId: number,
    answer: Pick<
      CognitionRecordV2,
      'status' | 'attempts' | 'modelId' | 'parse' | 'parsedOutput' | 'resolvedOutput' | 'appliedTick' | 'latencyMs'
    >,
  ): CognitionRecordV2 {
    const tick = frozen.input.worldView.tick;
    return {
      id: `${this.options.runId}:${tick}:${beingId}`,
      schemaVersion: COGNITION_SCHEMA_VERSION,
      engineVersion: ENGINE_VERSION,
      runId: this.options.runId,
      scenarioId: this.options.scenarioId,
      worldId: this.options.worldId,
      seed: this.options.seed,
      options: { ...this.options.options },
      backendLabel: this.options.backendLabel,
      tick,
      simDay: this.options.world.day(tick),
      beingId,
      beingName: frozen.beingName,
      generation: frozen.generation,
      ageTicks: frozen.input.snapshot.ageTicks,
      trigger: frozen.input.trigger,
      thinkInput: frozen.input,
      prompt: frozen.prompt,
      scaffold: frozen.scaffold,
      ...answer,
    };
  }

  private writeRecord(record: CognitionRecordV2): boolean {
    if (!this.guard(() => this.options.sink.cognition(record))) {
      this.counts.recordsDropped++;
      return false;
    }
    this.counts.recordsWritten++;
    return true;
  }

  private writeOutcome(outcome: CognitionOutcome): void {
    if (!this.guard(() => this.options.sink.outcome(outcome))) {
      this.counts.outcomesDropped++;
      return;
    }
    this.counts.outcomesWritten++;
  }

  /**
   * The one place the host's sink is called. A sink is foreign code on the hot
   * path of a simulation that must not care whether the disk is full: a throw
   * stops the recorder, is reported once, and never reaches the scheduler
   * (where it became an unhandled rejection nobody saw).
   */
  private guard(write: () => void): boolean {
    if (this.failure) return false;
    try {
      write();
      return true;
    } catch (err) {
      this.failure = err instanceof Error ? err.message : String(err);
      this.options.onFailure?.(this.failure);
      return false;
    }
  }

  private slot(beingId: number): PendingAct {
    let slot = this.pending.get(beingId);
    if (!slot) this.pending.set(beingId, (slot = {}));
    return slot;
  }
}

const UNANSWERED = (
  modelId: string,
): Pick<
  CognitionRecordV2,
  'status' | 'attempts' | 'modelId' | 'parse' | 'parsedOutput' | 'resolvedOutput' | 'appliedTick' | 'latencyMs'
> => ({
  status: 'unanswered-at-run-end',
  attempts: [],
  modelId,
  parse: { valid: false, retried: false, fellBackToReflex: false, error: 'no answer before the run ended' },
  parsedOutput: { goals: [], plan: [], utterances: [] },
  resolvedOutput: null,
  appliedTick: null,
  latencyMs: 0,
});

function resolvedOf(act: CompletedAct): ResolvedOutput | null {
  if (!act.resolved || !act.appliedPlan) return null;
  return snapshotJson({
    goals: act.resolved.goals,
    plan: [...act.appliedPlan],
    utterances: act.resolved.utterances,
    ...(act.resolved.name !== undefined ? { name: act.resolved.name } : {}),
    ...(act.resolved.thought !== undefined ? { thought: act.resolved.thought } : {}),
  });
}
