import type { ContextFeatureId, ContextRecord, DriveId, EventId } from './ids.js';
import type { RelationshipRecord, Traits } from './types.js';

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
 * W1-B2: every id below is an opaque string (`./ids.ts`) and nothing in the
 * mind is typed against this world's unions any more. What remains marked with
 * a later step is declared and empty.
 */

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
  /** Which slot of a memory's context record carries it. */
  readonly source: string;
  /** `flag`: the slot is the feature. `band`: the feature is `slot === band`. */
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

/**
 * WHAT A MEMORY OF THIS MEANS BETWEEN TWO PEOPLE, from the rememberer's side.
 *
 * `SocialMiner` used to switch on this world's event names to decide what a
 * memory was — a gift, a blow, a word. It reads this instead, so the pattern it
 * mines ("who gives back", "who is dangerous") is about ROLES and works in a
 * world whose gifts are called something else. The miner still decides what a
 * PATTERN of these amounts to; the world only says which role each event is.
 */
export type SocialRole =
  /** I gave them something. */
  | 'gave'
  /** They gave me something. */
  | 'received'
  /** They harmed me. */
  | 'harmed'
  /** I harmed them. */
  | 'harmedOther'
  /** We had dealings, and nothing more is claimed. */
  | 'engaged';

/**
 * THIS EVENT SHOWS SOMETHING BEING MADE. `CraftObservationMiner` used to test
 * the event name; it reads this, and then reads the two parts of the memory
 * this names. The field names are narrow literals because `MemoryRecord` has
 * exactly these two carriers today — a world that needs another says so when
 * B3 widens the memory shape, not by writing a name the mind would have to
 * trust.
 */
export interface DemonstrationSchema {
  /** Which part of a memory names the thing that was made. */
  readonly output: 'objectKind';
  /** Which part carries what was seen going into it. */
  readonly inputs: 'craftInputs';
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
  /** What a memory of this is between the rememberer and the other party. */
  readonly social?: SocialRole;
  /** Set when this event is a making others can learn the practice from. */
  readonly demonstrates?: DemonstrationSchema;
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
  const index = new Map<EventId, EventSchema>();
  for (const event of spec.events) index.set(event.id, event);
  return Object.freeze({ ...spec, eventById: new SealedMap(index) });
}

function deepFreeze(value: unknown): void {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return;
  for (const child of Object.values(value)) deepFreeze(child);
  Object.freeze(value);
}

/**
 * A lookup a mind genuinely cannot write to. `Object.freeze` does not touch a
 * Map's contents, so the frozen world handed to every mind used to sit behind a
 * live `Map` whose `set` rewrote that world for all of them (W1-B1 verifier,
 * backlog 1). The mutators exist so that a cast to `Map` reaches THESE and
 * throws, rather than silently succeeding.
 */
class SealedMap<K, V> implements ReadonlyMap<K, V> {
  constructor(private readonly entries_: ReadonlyMap<K, V>) {
    Object.freeze(this);
  }

  get(key: K): V | undefined {
    return this.entries_.get(key);
  }
  has(key: K): boolean {
    return this.entries_.has(key);
  }
  get size(): number {
    return this.entries_.size;
  }
  forEach(visit: (value: V, key: K, map: ReadonlyMap<K, V>) => void, thisArg?: unknown): void {
    this.entries_.forEach((value, key) => visit.call(thisArg, value, key, this));
  }
  keys(): IterableIterator<K> {
    return this.entries_.keys();
  }
  values(): IterableIterator<V> {
    return this.entries_.values();
  }
  entries(): IterableIterator<[K, V]> {
    return this.entries_.entries();
  }
  [Symbol.iterator](): IterableIterator<[K, V]> {
    return this.entries_[Symbol.iterator]();
  }

  set(): never {
    throw new TypeError('a world is read-only: its event table cannot be written to');
  }
  delete(): never {
    throw new TypeError('a world is read-only: its event table cannot be written to');
  }
  clear(): never {
    throw new TypeError('a world is read-only: its event table cannot be written to');
  }
}

/** Is this feature active in the context a memory was formed in? */
export function featureActive(context: ContextRecord, feature: ContextSchema): boolean {
  const raw = context[feature.source];
  return feature.kind === 'band' ? raw === feature.band : raw === true;
}

/**
 * A context in which NOTHING this world can notice is the case — what an
 * intervention reaching in from outside the world has to supply when it authors
 * a memory that did not happen anywhere (`AgentMind.injectIdea`). Built from
 * the declared features, so it is a fact about the world rather than a literal
 * a host had to know.
 */
export function emptyContext(world: WorldAdapter): ContextRecord {
  const context: ContextRecord = {};
  for (const feature of world.context) {
    // A band's empty value is any number the band is not.
    context[feature.source] = feature.kind === 'band' ? (feature.band === 0 ? 1 : 0) : false;
  }
  return context;
}

/**
 * The event this world uses to carry something SAID — the one whose roles
 * record it as heard. Undefined in a world with no speech, which is a world
 * where an idea cannot be whispered in.
 */
export function heardEvent(world: WorldAdapter): EventId | undefined {
  for (const event of world.events) {
    if (event.roles?.target?.heard || event.roles?.bystander?.heard) return event.id;
  }
  return undefined;
}

/** The cognition parameter this curve gives a being of this temperament. */
export function traitCurveValue(curve: TraitCurve, traits: Traits): number {
  let sum = 0;
  for (const [trait, weight] of curve.weights) sum += traits[trait] * weight;
  return Math.round(curve.base + curve.scale * sum);
}
