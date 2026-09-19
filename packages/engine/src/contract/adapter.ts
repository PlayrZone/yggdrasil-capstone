import type {
  ContextFeatureKey,
  ContextFeatures,
  NeedKey,
  RelationshipRecord,
  SimEventType,
  Traits,
} from './types.js';

/**
 * THE SEAM (docs/rework/W1-B-worldadapter.md). One object of DATA, supplied by
 * the host, describing a world to a mind that knows nothing about it. The mind
 * holds no tables of its own: every salience, every scalar a person feels, every
 * context feature the miners look for and every threshold a drive acts on is
 * read from here.
 *
 * Principles it is held to:
 *  - DATA, not behaviour. Nothing here is a callback the mind asks for a
 *    decision. `time.seasonAt` is a pure projection of a tick, not a choice.
 *  - The adapter DECLARES what exists; the body enforces what happens; the mind
 *    discovers the consequences. Nothing here may be shown to a mind as a fact.
 *  - It is handed over explicitly. There is no module-level current world, so
 *    two experiments with two different worlds can run in one process.
 *
 * STEP B1 ONLY. The ids below are still the forager world's own unions, because
 * B1 moves the tables and B2 retypes the mind against opaque ids. Everything
 * marked with a later step is declared and empty.
 */

/** B2 widens these three to opaque strings; until then the mind's own records
 *  are typed against the forager unions and these must agree with them. */
export type EventId = SimEventType;
export type ContextFeatureId = ContextFeatureKey;
export type DriveId = NeedKey;

/** The scalars one person's record of another can move. */
export type RelationshipDeltas = Partial<
  Omit<RelationshipRecord, 'interactionCount' | 'lastInteractionTick'>
>;

export interface DriveSchema {
  readonly id: DriveId;
  /** Pressure at or above which this drive is pressing. */
  readonly pressingAt: number;
  /** Pressure at or above which it is critical. */
  readonly criticalAt: number;
  /**
   * Pressure at or above which this world's reflex policy acts on the drive.
   * Distinct from `pressingAt` on purpose — a policy may be hungrier than the
   * world's own notion of pressing. Moves onto `reflexPolicy` at B3, when
   * `ReflexMind` becomes the forager world's policy.
   */
  readonly actsAt: number;
}

export interface ContextSchema {
  readonly id: ContextFeatureId;
  /** Which field of a memory's context record carries it. */
  readonly source: keyof ContextFeatures;
  /** `flag`: the field is the feature. `band`: the feature is `field === band`. */
  readonly kind: 'flag' | 'band';
  readonly band?: number;
}

/** What one perspective on an event records, where it differs from the event. */
export interface EventRoleSchema {
  /** This perspective forms no memory at all. */
  readonly ignores?: boolean;
  /** The memory type this perspective records, when not the event's own id. */
  readonly recordsAs?: EventId;
  /** This perspective HEARD it said: the actor becomes the memory's `toldBy`. */
  readonly heard?: boolean;
  /** Fill `causedBy` from this payload field, when it names someone else. */
  readonly causedByFrom?: string;
}

/**
 * One physical event, N subjective memories. Who you were in it decides what
 * you remember: the giver remembers giving, the receiver receiving, a bystander
 * an observation. Only the differences are declared — the parts that are the
 * same for every event (who the subjects are, the observation discount) are the
 * mechanism, and stay in the mind.
 */
export interface EventRoles {
  readonly actor?: EventRoleSchema;
  readonly target?: EventRoleSchema;
  readonly bystander?: EventRoleSchema;
}

/** Respect the actor earns from each being that sees this done. */
export interface PrestigeSchema {
  readonly respect: number;
  /** Only when this payload field holds this value. */
  readonly whenPayload?: { readonly key: string; readonly equals: unknown };
}

export interface EventSchema {
  readonly id: EventId;
  /** Base salience in [0, 1], before the need-change magnitude scales it. */
  readonly salience: number;
  /** How a memory of it reads. Omitted = neutral. */
  readonly outcome?: 'success' | 'failure';
  /**
   * What it moves in a PARTICIPANT's record of the other party. Present but
   * empty means "an interaction that moves no scalar" — it still counts as
   * having met, which absent does not.
   */
  readonly relationshipDeltas?: RelationshipDeltas;
  /**
   * What it moves in a WITNESS's record of whoever dealt it. Present at all is
   * what makes an event observer-applicable; watching is otherwise miner input,
   * not a relationship event.
   */
  readonly observerDeltas?: RelationshipDeltas;
  readonly prestige?: PrestigeSchema;
  readonly roles?: EventRoles;
  /** The actor's life ends here. */
  readonly endsLife?: boolean;
  /** This world can retell it as a story. */
  readonly narratable?: boolean;
  /** Carries causal signal. `false` keeps it out of succession mining. Default true. */
  readonly causal?: boolean;
}

export interface TimeOps {
  readonly ticksPerDay: number;
  readonly ticksPerSeason: number;
  readonly ticksPerYear: number;
  /** Ticks from birth to adulthood. */
  readonly adultAge: number;
  /** The season a tick falls in — a projection, not a decision. */
  seasonAt(tick: number): string;
}

/**
 * A cognition parameter as a curve over a being's temperament:
 * `round(base + scale × Σ(trait × weight))`, the weights summed IN ORDER.
 *
 * The shape looks fussier than `base + Σ` would, and it is deliberate: the
 * arithmetic has to be the same operations in the same order as the expression
 * it replaced, or a rounding boundary moves a think cadence and the whole run
 * diverges. `test/world-adapter.test.ts` pins each curve against its original.
 */
export interface TraitCurve {
  readonly base: number;
  readonly scale: number;
  readonly weights: readonly (readonly [keyof Traits, number])[];
}

/** Cognition varies by personality, so no two minds are equal. */
export interface CognitionDefaults {
  readonly thinkInterval: TraitCurve;
  readonly consolidateInterval: TraitCurve;
  readonly memoryHotCapacity: TraitCurve;
}

export interface WorldAdapter {
  readonly id: string;
  readonly version: string;
  readonly drives: readonly DriveSchema[];
  /** The feature space the miners look for associations in. Order is load
   *  bearing: it decides the order evidence reports are emitted in. */
  readonly context: readonly ContextSchema[];
  readonly events: readonly EventSchema[];
  /** The same schemas, by id. Built by `defineWorld`, so it cannot disagree. */
  readonly eventById: ReadonlyMap<EventId, EventSchema>;
  readonly time: TimeOps;
  readonly cognitionDefaults: CognitionDefaults;

  /**
   * DECLARED, NOT YET BUILT. Each is typed `unknown` on purpose: giving them a
   * shape now would pre-empt the step that owns them, and `unknown` cannot be
   * read by accident. See docs/rework/W1-B-worldadapter.md for each step.
   */
  /** B3 — this world's verbs, bound to the closed core action vocabulary. */
  readonly actions?: unknown;
  /** B3 — the kinds of thing that exist, and what they afford. */
  readonly kinds?: unknown;
  /** B4 — distance, direction and place refs, replacing every x/y in the mind. */
  readonly space?: unknown;
  /** B5 — every word a being could say or read. */
  readonly lexicon?: unknown;
  /** B3 — the world's hand-written survival policy, until W1-D replaces it. */
  readonly reflexPolicy?: unknown;
  /** B6 — declared regularities. INSTRUMENT ONLY; no mind may read it. */
  readonly mechanics?: unknown;
}

/** A world as its author writes it; `defineWorld` derives the rest. */
export type WorldSpec = Omit<WorldAdapter, 'eventById'>;

/**
 * Seal a world. The result is deeply frozen, so a mind cannot write back into
 * the world it was handed, and carries an id index the author cannot forget to
 * update.
 */
export function defineWorld(spec: WorldSpec): WorldAdapter {
  deepFreeze(spec);
  const eventById = new Map<EventId, EventSchema>();
  for (const event of spec.events) eventById.set(event.id, event);
  return Object.freeze({ ...spec, eventById });
}

function deepFreeze(value: unknown): void {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return;
  for (const child of Object.values(value)) deepFreeze(child);
  Object.freeze(value);
}

/** Is this feature active in the context a memory was formed in? */
export function featureActive(context: ContextFeatures, feature: ContextSchema): boolean {
  const raw = context[feature.source];
  return feature.kind === 'band' ? raw === feature.band : raw === true;
}

/** The cognition parameter this curve gives a being of this temperament. */
export function traitCurveValue(curve: TraitCurve, traits: Traits): number {
  let sum = 0;
  for (const [trait, weight] of curve.weights) sum += traits[trait] * weight;
  return Math.round(curve.base + curve.scale * sum);
}
