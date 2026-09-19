/**
 * Body⇄Yggdrasil contract types — the single source of truth in this repo.
 *
 * `body/contract.ts` re-exports the subset the Body needs instead of copying
 * it, so the two sides cannot drift; only the speech payload differs there
 * (physics transports an utterance without ever interpreting it).
 *
 * W1-B2: the shapes here are WORLD-NEUTRAL. Every name a world supplies —
 * events, drives, context features, kinds of thing — arrives as one of the
 * opaque ids in `./ids.ts`, and this file names none of the forager
 * continent's own vocabulary. That vocabulary now lives in
 * `worlds/forager/types.ts` and is imported by the body, the world systems and
 * the instrument, never by the mind.
 *
 * Doctrine reminders enforced by these shapes (yggdrasil_civilization_design V2):
 * - No role/job/class/faction/rank field exists anywhere. Ever.
 * - Genesis carries zero social identity and zero knowledge.
 * - MindOutput carries goals, plan, utterances, and (Phase 2) an OBSERVED-ONLY
 *   `thought`. It still carries no belief updates and no relationship deltas:
 *   `thought` is logged to the observatory and the civilization corpus but is
 *   never read back into knowledge or relationships. Consciousness EXPRESSES;
 *   the learning system alone FORMS belief.
 */

import type {
  ContextFeatureId,
  ContextRecord,
  DriveDeltas,
  DriveId,
  DriveLevels,
  EventId,
  ItemCounts,
  KindId,
} from './ids.js';

// ─── Traits ──────────────────────────────────────────────────────────────────

/** Six fixed traits, 0–100, rolled at genesis, immutable for life. */
export interface Traits {
  curiosity: number;
  aggression: number;
  compassion: number;
  ambition: number;
  loyalty: number;
  riskTolerance: number;
}

// ─── Intents (closed vocabulary, body-validated) ─────────────────────────────

/**
 * B3 REPLACES THIS with `{ core: CoreVerb, action: ActionId, args }` bound
 * through the adapter's `actions`. It stays in the contract rather than moving
 * to the forager world because it is the CORE verb set every world binds to,
 * not a table of this world's nouns — and because widening it now would cost
 * the body its exhaustive dispatch for no gain the next step does not deliver
 * properly. The arguments that DO name things are already opaque.
 */
export type IntentKind =
  | 'MoveTo'
  | 'Gather'
  | 'Dig'
  | 'Eat'
  | 'Drink'
  | 'Sleep'
  | 'Build'
  | 'Deposit'
  | 'Withdraw'
  | 'Give'
  | 'Attack'
  | 'Craft' // try to combine the materials you hold into something new
  | 'Speak'
  | 'Follow'
  | 'Flee'
  | 'Idle';

export interface Intent {
  kind: IntentKind;
  /** Target position for MoveTo / Flee-from / Build / Deposit-on-ground. */
  x?: number;
  y?: number;
  /** Target entity (resource node, agent, container) where relevant. */
  targetId?: number;
  /** Item kind for Eat / Deposit / Withdraw / Give. */
  objectKind?: KindId;
  /** Structure kind for Build. */
  buildKind?: KindId;
  /** Tick count for Sleep / Idle duration. */
  durationTicks?: number;
  /** Utterance payload for Speak. */
  utterance?: Utterance;
}

// ─── Communication ───────────────────────────────────────────────────────────

/**
 * Constrained speech acts with machine-comparable payloads (V2 decision —
 * knowledge transfer needs payloads the diffusion analyzer can equate).
 */
export type SpeechAct = 'share-knowledge' | 'share-episode' | 'inform' | 'request';

export interface Utterance {
  /** Listener agent id; omitted = addressed to everyone in earshot. */
  targetId?: number;
  speechAct: SpeechAct;
  /**
   * share-knowledge: the rule being taught + the speaker's confidence.
   * ENGINE-SET — resolved from the speaker's own KnowledgeStore
   * (`AgentMind.resolveSpeech`), never taken from a model's words.
   */
  rule?: KnowledgeRule;
  ruleConfidence?: number;
  /** share-episode / inform / request: free-ish summary text. */
  text?: string;
  /** share-episode: a shared story — stable id (so retellings cluster) + words
   *  + the story's origin tick, so a retelling does not reset its age.
   *  ENGINE-SET from the speaker's NarrativeStore, like `rule`. */
  narrativeId?: string;
  narrativeText?: string;
  narrativeFirstTick?: number;
  /**
   * What a MODEL may say about content: WHICH held belief (`ruleRef` — the
   * KnowledgeRecord id shown in its prompt) and WHICH carried story
   * (`narrativeRef` — the opaque `narrativeRefOf` handle shown in its prompt)
   * it is passing on. The engine resolves
   * these against the speaker's own stores and drops them; an unresolvable
   * reference leaves plain speech. Consciousness chooses what to say; only
   * the stores decide what is actually transmitted.
   */
  ruleRef?: number;
  narrativeRef?: string;
}

// ─── Events ──────────────────────────────────────────────────────────────────

export interface SimEvent {
  tick: number;
  type: EventId;
  actorId: number;
  targetIds: number[];
  x: number;
  y: number;
  /** Physical payload only (objectKind, amount, cause, utterance, …). */
  payload: Record<string, unknown>;
}

// ─── Memory ──────────────────────────────────────────────────────────────────

/** Where a memory came from. Testimony/observation feed the same miners. */
export type MemoryOrigin = 'experience' | 'observation' | 'testimony';

export interface MemoryRecord {
  id: number;
  tick: number;
  type: EventId;
  /** Agent ids involved, excluding the rememberer. */
  subjects: number[];
  objectKind?: KindId;
  /** For a demonstration of making: what was seen going in. */
  craftInputs?: ItemCounts;
  context: ContextRecord;
  /** Need pressure deltas this event caused (negative = relief). */
  needDeltas: DriveDeltas;
  outcome: 'success' | 'failure' | 'neutral';
  /** Where it happened (world units) — succession mining matches locality. */
  x?: number;
  y?: number;
  summaryText: string;
  /** Deterministic heuristic (event-type base × magnitude). Never LLM-set. */
  importance: number;
  origin: MemoryOrigin;
  /** For origin=testimony: who told the rememberer. */
  toldBy?: number;
  /**
   * Who DEALT what this memory is about, when that is a person and is not the
   * rememberer — a killing's killer. Distinct from `subjects` (who it happened
   * TO) on purpose: a witnessed death is about the one who died, and the hand
   * behind it is a separate fact. Absent when nobody dealt it (a starvation, a
   * beast).
   */
  causedBy?: number;
  /** For heard speech: what was said (share-knowledge rules ride here). */
  utterance?: Utterance;
  /** Retrieval embedding — optional, filled by an IEmbedder when present. */
  embedding?: Float32Array;
}

// ─── Knowledge ───────────────────────────────────────────────────────────────

/**
 * The structured truth-claim a knowledge record asserts. Machine-comparable
 * by design: two agents hold "the same" belief iff their rules are equal.
 * Statements are TEMPLATED from rules (see learning/templates.ts) — never
 * free-generated.
 */
export type KnowledgeRule =
  | {
      kind: 'context-association';
      event: EventId;
      objectKind?: KindId;
      feature: ContextFeatureId;
      direction: 'positive' | 'negative';
    }
  | {
      kind: 'succession';
      causeType: EventId;
      causeObject?: KindId;
      effectType: EventId;
      effectObject?: KindId;
    }
  | {
      kind: 'social-contingency';
      partnerId: number;
      pattern: 'reciprocates' | 'generous' | 'dangerous' | 'helpful';
    }
  | {
      kind: 'outcome-association';
      actionType: EventId;
      feature: ContextFeatureId | null;
      need: DriveId;
      direction: 'relieves' | 'worsens';
    }
  | {
      // A learned PRACTICE: the materials, worked together, become a tool.
      // Unlike the other rules (correlations mined from need-deltas), this is
      // a recipe a being can ACT on — and learn by watching it done. The
      // output is the recipe's identity; inputs are what the demonstration
      // showed going in. This is the transmissible unit of technology.
      kind: 'craft-recipe';
      output: KindId;
      inputs: ItemCounts;
    };

export type KnowledgeStatus = 'hypothesis' | 'held' | 'contested' | 'abandoned';

/**
 * One episode a belief rests on, copied out of the memory it came from so the
 * belief survives the memory. Episodic records are evicted while a being lives
 * and released when it dies, so an id into that store dangles; these are the
 * fields someone auditing "why do you believe that?" actually needs — what
 * happened, when, where, who was in it, whose hand it was, and whether you
 * lived it, watched it or were told it.
 *
 * DERIVABLE FIELDS ARE NOT STORED. The memory's `summaryText` is a pure
 * template over `type`, `objectKind`, `subjects` and `causedBy`; the same
 * function that wrote it renders it back (`describeEpisode`), so keeping the
 * string would be a second copy of these fields for every belief in the world.
 *
 * Every field is always present — `undefined` rather than absent — so the whole
 * population's snapshots share one object shape instead of one per combination
 * of what happened to be known.
 *
 * Bookkeeping only: no prompt, miner or decision reads it, so it cannot steer
 * the simulation.
 */
export interface EvidenceSnapshot {
  /** The memory it was taken from. May no longer exist — that is the point. */
  memoryId: number;
  tick: number;
  type: EventId;
  objectKind: KindId | undefined;
  outcome: 'success' | 'failure' | 'neutral';
  origin: MemoryOrigin;
  /** For origin=testimony: who said so. */
  toldBy: number | undefined;
  /** Whose hand it was, when that is a person and not the rememberer. */
  causedBy: number | undefined;
  /** The others it involved, excluding the rememberer. */
  subjects: readonly number[];
  x: number | undefined;
  y: number | undefined;
  /** The engine's deterministic salience for the episode. */
  importance: number;
}

export interface KnowledgeRecord {
  id: number;
  /** Canonical string key derived from the rule — dedupe + diffusion compare. */
  ruleKey: string;
  rule: KnowledgeRule;
  /** Templated natural-language rendering, for prompts and the Observatory. */
  statement: string;
  /** Evidence-driven (Laplace-smoothed). Never set by hand or by an LLM. */
  confidence: number;
  evidenceCount: number;
  contradictionCount: number;
  /**
   * Sampled provenance by id. Kept because it is the record's long-standing
   * identity of its evidence, but the ids dangle once those memories are
   * evicted or released — read `provenance` instead.
   */
  sourceMemoryIds: number[];
  /**
   * The same evidence, self-describing and outliving the memories. Bounded
   * (see `ProvenanceSample`). Absent when a record was formed with no episode
   * behind it at all — a seeded recipe, or a hand-built record in a test.
   */
  provenance?: readonly EvidenceSnapshot[];
  status: KnowledgeStatus;
  origin: MemoryOrigin;
  /** For origin=testimony: the informant. Provenance chains live here. */
  testimonyFrom?: number;
  firstFormed: number;
  lastReinforced: number;
}

// ─── Agent snapshot, goals, mind I/O ─────────────────────────────────────────

export interface AgentSnapshot {
  id: number;
  name: string;
  ageTicks: number;
  traits: Traits;
  needs: DriveLevels;
  health: number;
  sick: boolean;
  x: number;
  y: number;
  inventory: ItemCounts;
  context: ContextRecord;
}

export interface ObservedAgent {
  id: number;
  x: number;
  y: number;
}

export interface ObservedResource {
  id: number;
  kind: KindId;
  x: number;
  y: number;
  stock: number;
}

export interface ObservedStructure {
  id: number;
  kind: KindId;
  x: number;
  y: number;
}

/** What the agent can currently perceive. */
export interface WorldView {
  tick: number;
  night: boolean;
  /** The phase of the world's year, as `TimeOps.seasonAt` names it. */
  season: string;
  agents: ObservedAgent[];
  resources: ObservedResource[];
  structures: ObservedStructure[];
}

export interface Goal {
  id: number;
  description: string;
  /** The drive this goal serves, when it serves one. */
  need?: DriveId;
  createdTick: number;
}

export type ThinkTrigger =
  | 'periodic'
  | 'planCompleted'
  | 'planFailed'
  | 'wasAttacked'
  | 'witnessedDeath'
  | 'conversation'
  | 'needCritical';

export interface RelationshipRecord {
  trust: number;
  respect: number;
  friendship: number;
  fear: number;
  interactionCount: number;
  lastInteractionTick: number;
}

/** A story this being carries — its myths and history. Label-free. */
export interface KnownStory {
  /** Stable narrative id. Engine-side only: a prompt renders `narrativeRefOf(id)`,
   *  never the id, which encodes how the engine filed the event. */
  id?: string;
  text: string;
  /** True if it witnessed the event; false if it was only told the story. */
  firsthand: boolean;
}

/** Family this being knows it has. */
export interface KinTie {
  name: string;
  relation: 'parent' | 'child';
}

/** A person this being knows, with how it FEELS — never a role label. */
export interface KnownPerson {
  name: string;
  /** Felt, plain-language: "you trust them", "you have long kept their company". */
  feeling: string;
}

export interface ThinkInput {
  snapshot: AgentSnapshot;
  recalledMemories: MemoryRecord[];
  /** Held knowledge, confidence-qualified — the agent's worldview. */
  knowledge: KnowledgeRecord[];
  relationships: Map<number, RelationshipRecord>;
  worldView: WorldView;
  goals: Goal[];
  trigger: ThinkTrigger;
  /** A place a held story draws this being to (a founder/hero site) — belief steering behaviour. */
  sacredPlace?: { x: number; y: number };
  /** Places a held tragedy makes this being shun. */
  tragedyPlaces?: { x: number; y: number }[];
  // ─── Phase 2: the culture a conscious being is born into (LLM path only) ───
  /** Stories/myths this being carries (most-told first). */
  stories?: KnownStory[];
  /** The single tale this being has heard most — its people's best-known story. */
  mostTold?: string;
  /** Family this being knows it has. */
  kin?: KinTie[];
  /** People this being knows and how it feels about them (no role labels). */
  social?: KnownPerson[];
  /** When false, the prompt does NOT offer "try making something" — used to test
   * whether CULTURE (a seeded myth) steers curiosity toward making, with no
   * engine-side crafting incentive present. Default (undefined) offers it. */
  offerMaking?: boolean;
}

/**
 * Everything consciousness is allowed to produce. Deliberately small:
 * thinking yields goals, plans, and words — nothing else (V2).
 */
export interface MindOutput {
  goals: Goal[];
  plan: Intent[];
  utterances: Utterance[];
  /** A name the Gahallian chooses for itself (only meaningful while unnamed). */
  name?: string;
  /**
   * Phase 2: the being's own first-person thought — what it is thinking and WHY
   * it chose this, in its own words (incl. how it reads a story or another
   * being). OBSERVED ONLY: surfaced in the observatory and the civilization
   * corpus, never read back into knowledge or relationships.
   */
  thought?: string;
}
