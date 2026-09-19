import type {
  Goal,
  Intent,
  KnowledgeStatus,
  SimEvent,
  Utterance,
} from '../contract/types.js';
import type { ActionId, EventId } from '../contract/ids.js';
import type { IntentKind, Needs, SimEventType } from '../worlds/forager/types.js';
import { ruleKey } from '../learning/ruleKey.js';
import { snapshotJson } from './serialize.js';
import type {
  CognitionOutcome,
  IntentOutcome,
  InterventionDuringThink,
  OutcomeCloseReason,
  RecorderWorld,
  UtteranceOutcome,
} from './types.js';
import { COGNITION_SCHEMA_VERSION } from './types.js';

/**
 * Which events an intent can yield. An event is attributed to the step the body
 * was on when it fired (the body emits, THEN advances), but only if the step
 * could have caused it — so an exposure or a sickness that lands mid-plan is
 * never credited to a MoveTo.
 */
// The read type is widened to opaque ids (an act's name is an `ActionId` and an
// event's type an `EventId` now); both literals are still checked against this
// world's own vocabulary by the `satisfies` below, so a typo in either is still
// a compile error. This table is the forager world's — B6 moves the recorder's
// world-specific parts out with the rest of the instrument.
const INTENT_YIELDS: Partial<Record<ActionId, readonly EventId[]>> = {
  Gather: ['GatherSucceeded', 'GatherFailed'],
  Dig: ['GatherSucceeded'],
  Eat: ['AteFood', 'BecameSick'],
  Drink: ['DrankWater'],
  Sleep: ['SleptSafely', 'SleptExposed'],
  Build: ['BuiltStructure'],
  Craft: ['Crafted'],
  Deposit: ['DepositedItem', 'SeedDeposited'],
  Withdraw: ['WithdrewItem'],
  Give: ['GaveItem'],
  Attack: ['AttackedAgent', 'AgentDied'],
  Speak: ['UtteranceSpoken'],
} satisfies Partial<Record<IntentKind, readonly SimEventType[]>>;

/**
 * Everything measured AT the tick the window closed. Taken there and kept,
 * because the window is only EMITTED at the being's next think — which can be
 * thousands of ticks later, and measuring then credits this act with all of
 * them.
 */
interface Measured {
  tick: number;
  reason: OutcomeCloseReason;
  needDeltas: Partial<Needs>;
  healthDelta: number;
  knowledgeFormed: CognitionOutcome['knowledgeFormed'];
  knowledgeChanged: CognitionOutcome['knowledgeChanged'];
  aliveAtEnd: boolean;
}

interface OpenWindow {
  cognitionId: string;
  beingId: number;
  openedTick: number;
  /** Identity of the array handed to the body — a new plan means a new array. */
  planRef: readonly unknown[];
  planLength: number;
  steps: IntentOutcome[];
  utterances: UtteranceOutcome[];
  interventions: InterventionDuringThink[];
  maxStep: number;
  interrupted: boolean;
  needsAt: Needs;
  healthAt: number;
  knowledgeAt: Map<string, { id: number; status: KnowledgeStatus }>;
  goals: string[];
  closed: Measured | null;
}

interface PendingUtterance {
  event: SimEvent;
  outcome: UtteranceOutcome;
  listeners: number[];
  key: string | undefined;
  narrativeId: string | undefined;
  before: Map<number, { reinforced: number | undefined; carries: boolean }>;
}

/**
 * The result term. Every act gets a window that closes when its plan finishes,
 * is replaced, the being dies, or the bound elapses — whichever comes first —
 * and the window records what the body did with each intent, what the needs and
 * health did, what knowledge formed, and who actually heard the speech.
 *
 * Strictly observational: it reads bodies and stores, subscribes to the event
 * bus, and writes nothing back. Turning it on cannot change a run.
 */
export class OutcomeTracker {
  private readonly open = new Map<number, OpenWindow>();
  private pendingUtterance: PendingUtterance | null = null;

  constructor(
    private readonly world: RecorderWorld,
    private readonly runId: string,
    private readonly windowTicks: number,
    private readonly emit: (outcome: CognitionOutcome) => void,
  ) {}

  /**
   * A new act for this being: close and finalize whatever it was doing (its
   * goals are now answerable — the next think is here), then watch the new plan.
   * `goals` is null when the act was never applied (the being died mid-thought),
   * in which case nothing was adopted and the previous window has no answer.
   */
  beginAct(
    cognitionId: string,
    beingId: number,
    tick: number,
    plan: readonly Intent[] | null,
    goals: Goal[] | null,
    interventions: InterventionDuringThink[] = [],
  ): void {
    // `tick` is the tick the new plan will FIRST run on, so the window it
    // replaces covered everything up to the tick before — measuring it at
    // `tick` would label state from before that tick with that tick's number.
    this.finalize(beingId, tick - 1, 'planReplaced', goals);
    if (!plan || !goals) return;
    const body = this.world.body(beingId);
    this.open.set(beingId, {
      cognitionId,
      beingId,
      openedTick: tick,
      planRef: plan,
      planLength: plan.length,
      steps: plan.map((intent, index) => stepOf(intent, index)),
      utterances: plan.flatMap((intent, index) => (intent.utterance ? [utteranceOf(intent.utterance, index)] : [])),
      interventions,
      maxStep: 0,
      interrupted: false,
      needsAt: { ...(body?.needs ?? ZERO_NEEDS) },
      healthAt: body?.health ?? 0,
      knowledgeAt: this.knowledgeSnapshot(beingId),
      goals: goals.map((g) => g.description),
      closed: null,
    });
  }

  /** Sample every open window once per tick, after the body has stepped. */
  tick(tick: number): void {
    for (const w of this.open.values()) {
      if (w.closed) continue;
      const body = this.world.body(w.beingId);
      if (!body || !body.alive) {
        // A dead being never thinks again, so there is no next-think answer to
        // wait for: measure and emit here rather than holding it to `flush`.
        this.close(w, tick, 'died');
        this.finalize(w.beingId, tick, 'died', null);
        continue;
      }
      if (body.plan !== w.planRef) {
        this.close(w, tick, 'planReplaced');
        continue;
      }
      // The body may splice an urgent Eat into the mind's plan; from there the
      // step indices are the body's, not the mind's, so attribution stops.
      if (body.plan.length !== w.planLength) w.interrupted = true;
      if (!w.interrupted && body.planStep > w.maxStep) w.maxStep = body.planStep;
      if (body.planDone) this.close(w, tick, 'planCompleted');
      else if (tick - w.openedTick >= this.windowTicks) this.close(w, tick, 'windowElapsed');
    }
  }

  /**
   * Before the world's listeners see an utterance: what did each being in
   * earshot already know and carry? Without this "did anyone take it in?" can
   * only be answered as "does anyone hold it now", which is not the same thing.
   */
  observeBefore(event: SimEvent): void {
    this.pendingUtterance = null;
    if (event.type !== 'UtteranceSpoken') return;
    const w = this.open.get(event.actorId);
    if (!w || w.closed || w.interrupted) return;
    const body = this.world.body(event.actorId);
    if (!body || body.plan !== w.planRef) return;
    const outcome = w.utterances.find((u) => u.index === body.planStep);
    if (!outcome) return;
    const spoken = event.payload['utterance'] as Utterance | undefined;
    if (!spoken) return;

    const key = spoken.rule ? ruleKey(spoken.rule) : undefined;
    const listeners = this.world.witnesses(event).filter((id) => id !== event.actorId);
    const before = new Map<number, { reinforced: number | undefined; carries: boolean }>();
    for (const id of listeners) {
      before.set(id, {
        reinforced: key ? this.world.knowledge(id).find((k) => k.ruleKey === key)?.lastReinforced : undefined,
        carries: spoken.narrativeId ? this.world.carriesNarrative(id, spoken.narrativeId) : false,
      });
    }
    this.pendingUtterance = { event, outcome, listeners, key, narrativeId: spoken.narrativeId, before };
  }

  /** After the world's listeners have had the event: what did it change? */
  observeAfter(event: SimEvent): void {
    const pending = this.pendingUtterance;
    this.pendingUtterance = null;
    const w = this.open.get(event.actorId);
    if (!w || w.closed || w.interrupted) return;
    const body = this.world.body(event.actorId);
    if (!body || body.plan !== w.planRef) return;
    const step = w.steps[body.planStep];
    if (!step) return;

    if (event.type === 'IntentRejected') {
      if (event.payload['intentKind'] === step.kind) {
        step.rejected = true;
        step.rejectionReason = String(event.payload['reason'] ?? '');
      }
      return;
    }
    if (INTENT_YIELDS[step.kind]?.includes(event.type)) {
      step.yielded.push({ tick: event.tick, type: event.type, payload: snapshotJson(event.payload) });
    }
    if (pending && pending.event === event) this.settleUtterance(pending, event.tick);
  }

  /** The run is over: everything still open closes, with no next think to ask. */
  flush(tick: number): void {
    for (const id of [...this.open.keys()]) {
      const w = this.open.get(id)!;
      if (!w.closed) this.close(w, tick, 'runEnded');
      this.finalize(id, tick, 'runEnded', null);
    }
  }

  private settleUtterance(pending: PendingUtterance, tick: number): void {
    const { outcome, listeners, key, narrativeId, before } = pending;
    outcome.spoken = true;
    outcome.listenersInHearing = listeners;
    outcome.targetInHearing = outcome.targetId === undefined ? null : listeners.includes(outcome.targetId);
    for (const id of listeners) {
      const was = before.get(id);
      if (key) {
        const now = this.world.knowledge(id).find((k) => k.ruleKey === key);
        if (now && now.lastReinforced === tick && was?.reinforced !== tick) outcome.testimonyIntakeBy.push(id);
      }
      if (narrativeId && !was?.carries && this.world.carriesNarrative(id, narrativeId)) {
        outcome.narrativeIntakeBy.push(id);
      }
    }
  }

  /**
   * Close AND measure, here, at this tick. Deferring the measurement to the
   * emit was the defect: a plan that finished in one tick and re-thought two
   * thousand ticks later reported those two thousand ticks as its own result.
   */
  private close(w: OpenWindow, tick: number, reason: OutcomeCloseReason): void {
    const body = this.world.body(w.beingId);
    const formed: CognitionOutcome['knowledgeFormed'] = [];
    const changed: CognitionOutcome['knowledgeChanged'] = [];
    for (const k of this.world.knowledge(w.beingId)) {
      const was = w.knowledgeAt.get(k.ruleKey);
      if (!was) formed.push({ id: k.id, ruleKey: k.ruleKey, status: k.status });
      else if (was.status !== k.status) changed.push({ id: k.id, ruleKey: k.ruleKey, from: was.status, to: k.status });
    }
    w.closed = {
      tick,
      reason,
      needDeltas: needDeltas(w.needsAt, body?.needs),
      healthDelta: (body?.health ?? w.healthAt) - w.healthAt,
      knowledgeFormed: formed,
      knowledgeChanged: changed,
      aliveAtEnd: body?.alive ?? false,
    };
  }

  /**
   * Emit a being's last window. `nextGoals` is the output of the think that
   * follows it — null when none ever came, which is the honest answer for a
   * being that died or a run that stopped.
   */
  private finalize(beingId: number, tick: number, reason: OutcomeCloseReason, nextGoals: Goal[] | null): void {
    const w = this.open.get(beingId);
    if (!w) return;
    this.open.delete(beingId);
    if (!w.closed) this.close(w, tick, reason);
    const closed = w.closed!;

    for (const step of w.steps) {
      step.reached = step.index <= w.maxStep;
      step.executed = step.index < w.maxStep && !step.rejected;
    }

    const held =
      nextGoals === null ? null : nextGoals.filter((g) => w.goals.includes(g.description)).length;

    this.emit({
      cognitionId: w.cognitionId,
      schemaVersion: COGNITION_SCHEMA_VERSION,
      runId: this.runId,
      beingId,
      openedTick: w.openedTick,
      closedTick: closed.tick,
      closedReason: closed.reason,
      interventionsDuringThink: w.interventions,
      interrupted: w.interrupted,
      // An interrupted window stops watching the bus (`observeBefore`/
      // `observeAfter` return early), so any utterance still unresolved is
      // UNKNOWN rather than unspoken. Said out loud instead of left to infer.
      speechTrackingStopped: w.interrupted && w.utterances.some((u) => !u.spoken),
      intents: w.steps,
      utterances: w.utterances,
      needDeltas: closed.needDeltas,
      healthDelta: closed.healthDelta,
      knowledgeFormed: closed.knowledgeFormed,
      knowledgeChanged: closed.knowledgeChanged,
      aliveAtEnd: closed.aliveAtEnd,
      goalsEmitted: w.goals.length,
      goalsHeldAtNextThink: held,
    });
  }

  private knowledgeSnapshot(beingId: number): Map<string, { id: number; status: KnowledgeStatus }> {
    const map = new Map<string, { id: number; status: KnowledgeStatus }>();
    for (const k of this.world.knowledge(beingId)) map.set(k.ruleKey, { id: k.id, status: k.status });
    return map;
  }
}

const ZERO_NEEDS: Needs = { hunger: 0, rest: 0, safety: 0, socialConnection: 0 };

function needDeltas(from: Needs, to: Needs | undefined): Partial<Needs> {
  if (!to) return {};
  return {
    hunger: to.hunger - from.hunger,
    rest: to.rest - from.rest,
    safety: to.safety - from.safety,
    socialConnection: to.socialConnection - from.socialConnection,
  };
}

function stepOf(intent: Intent, index: number): IntentOutcome {
  return {
    index,
    kind: intent.kind,
    ...(intent.objectKind !== undefined ? { objectKind: intent.objectKind } : {}),
    ...(intent.buildKind !== undefined ? { buildKind: intent.buildKind } : {}),
    ...(intent.targetId !== undefined ? { targetId: intent.targetId } : {}),
    ...(intent.durationTicks !== undefined ? { durationTicks: intent.durationTicks } : {}),
    reached: false,
    executed: false,
    rejected: false,
    yielded: [],
  };
}

function utteranceOf(u: Utterance, index: number): UtteranceOutcome {
  return {
    index,
    speechAct: u.speechAct,
    ...(u.targetId !== undefined ? { targetId: u.targetId } : {}),
    spoken: false,
    carriedRule: u.rule !== undefined,
    carriedNarrative: u.narrativeId !== undefined,
    listenersInHearing: [],
    targetInHearing: null,
    testimonyIntakeBy: [],
    narrativeIntakeBy: [],
  };
}
