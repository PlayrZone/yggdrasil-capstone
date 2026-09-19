import type { GahallianBody } from '../body/GahallianBody.js';
import type { Narrative } from '../narrative/NarrativeStore.js';
import type {
  Goal,
  KnowledgeRecord,
  Needs,
  ObjectKind,
  RelationshipRecord,
  SimEvent,
  Traits,
} from '../contract/types.js';

/** One birth as the kinship ledger records it (the event log is capped). */
export interface BirthRecord {
  child: number;
  parents: [number, number];
  tick: number;
}

/**
 * An entity as the instrument is allowed to look at one: an id and a bag of
 * components to read. Assignable FROM `Entity`, never back to it, so a report
 * cannot be handed a live handle it could write through.
 */
export interface ObservedEntity {
  readonly id: number;
  readonly components: Readonly<Record<string, unknown>>;
}

/**
 * A body as a report may read it. A PROJECTION, not `GahallianBody`: the
 * fields the instrument actually uses, every one of them readonly, and none of
 * the plan/step/flag state the body writes as it lives.
 */
export interface BodyView {
  readonly name: string;
  readonly alive: boolean;
  readonly birthTick: number;
  readonly health: number;
  readonly sleepingUntil: number;
  readonly sickUntil: number;
  readonly needs: Readonly<Needs>;
  readonly traits: Readonly<Traits>;
  readonly inventory: Readonly<Partial<Record<ObjectKind, number>>>;
}

export interface KnowledgeView {
  /** Held + forming, id order. A fresh array of LIVE records — readonly so a
   *  report cannot edit a belief it is measuring. */
  all(): Readonly<KnowledgeRecord>[];
  held(): Readonly<KnowledgeRecord>[];
  get(ruleKey: string): Readonly<KnowledgeRecord> | undefined;
}

export interface RelationshipsView {
  /** The store's LIVE map — handed out as a ReadonlyMap of readonly records. */
  asMap(): ReadonlyMap<number, Readonly<RelationshipRecord>>;
}

export interface NarrativesView {
  all(): Readonly<Narrative>[];
}

export interface MemoryTallyView {
  experienceCounts(): ReadonlyMap<string, number>;
}

/**
 * A mind as a report may read it. This is the load-bearing half of the seam:
 * it is a projection of `AgentMind`, so `observe`, `consolidate`, `entomb`,
 * `injectIdea`, `applyOutput`, `think` and `learners` are not merely
 * discouraged — they do not exist on the type, and a report that reaches for
 * one does not compile. `test/runner-view-readonly.test.ts` holds that.
 */
export interface MindView {
  readonly knowledge: KnowledgeView;
  readonly relationships: RelationshipsView;
  readonly narratives: NarrativesView;
  readonly memory: MemoryTallyView;
  readonly goals: readonly Readonly<Goal>[];
}

/**
 * THE INSTRUMENT'S WINDOW ON THE RUNTIME — the whole of it.
 *
 * Every analysis facade and observatory accessor takes one of these instead of
 * the runtime itself. The direction is one-way and enforced by
 * `test/runner-layering.test.ts`: the runtime never imports the instrument, so
 * nothing measured here can be read back into the simulation. Widening this
 * interface is how the measurement would start touching the mechanism again —
 * a new member is a decision, not a convenience.
 *
 * Read-only by TYPE, not by convention: the bodies and minds reachable here
 * are projections (`BodyView`, `MindView`) that carry no mutator, so an
 * instrument that tries to write is a compile error rather than a review note.
 * The one unchecked seam left is `ObservedEntity.components`, whose values are
 * `unknown` and must be cast by the reader.
 */
export interface RuntimeView {
  readonly seed: string;
  readonly tick: number;
  /** Every being ever spawned, founders first then children, in birth order. */
  readonly agentIds: readonly number[];
  /** Every mind, living and entombed, in the same order as `agentIds`. */
  readonly minds: ReadonlyMap<number, MindView>;
  readonly births: readonly Readonly<BirthRecord>[];
  readonly conscious: ReadonlySet<number>;
  readonly lastThought: ReadonlyMap<number, string>;
  /** The capped tail of emitted events. */
  readonly eventLog: readonly Readonly<SimEvent>[];

  agentBody(id: number): BodyView | undefined;
  positionOf(id: number): Readonly<{ x: number; y: number }> | undefined;
  nameOf(id: number): string;
  generationOf(id: number): number;
  aliveCount(): number;
  /** Visit every entity carrying `component`, in spatial-index order. */
  each(component: string, visit: (entity: ObservedEntity) => void): void;
}

/** Compile-time proof that the real classes satisfy the projections above —
 *  so widening a projection cannot silently stop matching the runtime. */
export type BodySatisfiesView = GahallianBody extends BodyView ? true : never;
