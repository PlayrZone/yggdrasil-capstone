/**
 * Body⇄Yggdrasil contract types.
 *
 * The Gahalla Engine keeps a structurally-identical copy of the boundary
 * subset in `engine/src/yggdrasil/contract.ts` — neither side imports the
 * other (repo rule: engine and packages never cross-import; same precedent
 * as worldgen). Drift between the two copies is caught by the assignability
 * test in `test/contract-compat.test.ts`.
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

// ─── Needs & traits ──────────────────────────────────────────────────────────

/**
 * Needs are PRESSURE values in [0, 100]: 0 = fully satisfied, rising over
 * time; "hunger = 95" means nearly starving. Thresholds: pressing ≥ 60,
 * critical ≥ 85.
 */
export type NeedKey = 'hunger' | 'rest' | 'safety' | 'socialConnection';

export type Needs = Record<NeedKey, number>;

export const NEED_PRESSING = 60;
export const NEED_CRITICAL = 85;

/** Six fixed traits, 0–100, rolled at genesis, immutable for life. */
export interface Traits {
  curiosity: number;
  aggression: number;
  compassion: number;
  ambition: number;
  loyalty: number;
  riskTolerance: number;
}

// ─── World vocabulary ────────────────────────────────────────────────────────

/**
 * Kinds of physical stuff — materials with PROPERTIES, never recipes
 * (see world/materials.ts). Purely physical, no social meaning. Tiers per
 * yggdrasil_world_design.md: basic → intermediate → advanced → rare. The
 * intermediate/metal kinds exist as data now; their discovery mechanics
 * (fire/smelting) arrive in world Slice 2.
 */
export type ObjectKind =
  // basic
  | 'water'
  | 'wood'
  | 'stone'
  | 'clay'
  | 'fiber'
  | 'berry' // edible forage
  | 'tuber' // edible root
  | 'seed'
  | 'mushroomRed' // poisonous
  | 'nightshade' // poisonous plant
  | 'meat' // from animals (Slice 2)
  | 'hide' // from animals (Slice 2)
  // intermediate (outcomes of applying properties under heat/force/time — Slice 2)
  | 'charcoal'
  | 'leather'
  | 'rope'
  | 'spear' // tool/weapon — discovered by combining materials (a point + a shaft)
  | 'club'
  | 'handaxe'
  | 'brick'
  | 'copper'
  | 'tin'
  | 'iron'
  | 'bronze'
  // advanced (ores + fuels + salt)
  | 'copperOre'
  | 'tinOre'
  | 'ironOre'
  | 'coal'
  | 'salt'
  // rare
  | 'silver'
  | 'gold'
  | 'gemstone'
  // built structures / world objects
  | 'shelter'
  | 'wall'
  | 'container'
  | 'corpse';

export type ResourceNodeKind =
  | 'berryBush'
  | 'tree'
  | 'stoneDeposit'
  | 'waterSource'
  | 'river'
  | 'foodPlant'
  | 'mushroomPatch'
  | 'tuberPlant'
  | 'nightshadePlant'
  | 'clayDeposit'
  | 'fiberPlant'
  | 'copperVein'
  | 'tinVein'
  | 'ironVein'
  | 'coalSeam'
  | 'saltFlat'
  | 'silverVein'
  | 'goldVein'
  | 'gemVein'
  | 'game'; // a wild animal — moves; hunting (gathering) it yields meat

/**
 * Context features captured AT THE MOMENT a memory forms — the learning
 * system's feature space. Extending this vocabulary widens what is
 * discoverable; it must only ever grow (old runs stay minable).
 */
export interface ContextFeatures {
  nearWater: boolean;
  night: boolean;
  inShelter: boolean;
  /** Coarse terrain elevation band: 0 lowland · 1 midland · 2 highland. */
  elevationBand: number;
}

export type ContextFeatureKey = 'nearWater' | 'night' | 'inShelter' | 'highland';

// ─── Intents (closed vocabulary, body-validated) ─────────────────────────────

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

export type BuildKind = 'shelter' | 'wall' | 'container';

export interface Intent {
  kind: IntentKind;
  /** Target position for MoveTo / Flee-from / Build / Deposit-on-ground. */
  x?: number;
  y?: number;
  /** Target entity (resource node, agent, container) where relevant. */
  targetId?: number;
  /** Item kind for Eat / Deposit / Withdraw / Give. */
  objectKind?: ObjectKind;
  /** Structure kind for Build. */
  buildKind?: BuildKind;
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
  /** share-knowledge: the rule being taught + the speaker's confidence. */
  rule?: KnowledgeRule;
  ruleConfidence?: number;
  /** share-episode / inform / request: free-ish summary text. */
  text?: string;
  /** share-episode: a shared story — stable id (so retellings cluster) + words. */
  narrativeId?: string;
  narrativeText?: string;
}

// ─── Events ──────────────────────────────────────────────────────────────────

export type SimEventType =
  | 'GatherSucceeded'
  | 'GatherFailed'
  | 'AteFood'
  | 'DrankWater'
  | 'BecameSick'
  | 'RecoveredFromSickness'
  | 'SleptSafely'
  | 'SleptExposed'
  | 'SufferedExposure'
  | 'ReceivedItem'
  | 'GaveItem'
  | 'WasAttacked'
  | 'AttackedAgent'
  | 'AttackedByPredator'
  | 'FoughtPredator'
  | 'KilledPredator'
  | 'Crafted'
  | 'ChildBorn'
  | 'AgentDied'
  | 'WitnessedDeath'
  | 'SeedDeposited'
  | 'PlantSprouted'
  | 'BuiltStructure'
  | 'DepositedItem'
  | 'WithdrewItem'
  | 'UtteranceSpoken'
  | 'IntentRejected'
  | 'SawAgent'
  | 'FoundResource';

export interface SimEvent {
  tick: number;
  type: SimEventType;
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
  type: SimEventType;
  /** Agent ids involved, excluding the rememberer. */
  subjects: number[];
  objectKind?: ObjectKind;
  /** For Crafted events: the materials that were combined (seen in a demonstration). */
  craftInputs?: Partial<Record<ObjectKind, number>>;
  context: ContextFeatures;
  /** Need pressure deltas this event caused (negative = relief). */
  needDeltas: Partial<Needs>;
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
      event: SimEventType;
      objectKind?: ObjectKind;
      feature: ContextFeatureKey;
      direction: 'positive' | 'negative';
    }
  | {
      kind: 'succession';
      causeType: SimEventType;
      causeObject?: ObjectKind;
      effectType: SimEventType;
      effectObject?: ObjectKind;
    }
  | {
      kind: 'social-contingency';
      partnerId: number;
      pattern: 'reciprocates' | 'generous' | 'dangerous' | 'helpful';
    }
  | {
      kind: 'outcome-association';
      actionType: SimEventType;
      feature: ContextFeatureKey | null;
      need: NeedKey;
      direction: 'relieves' | 'worsens';
    }
  | {
      // A learned PRACTICE: the materials, worked together, become a tool.
      // Unlike the other rules (correlations mined from need-deltas), this is
      // a recipe a being can ACT on — and learn by watching it done. The
      // output is the recipe's identity; inputs are what the demonstration
      // showed going in. This is the transmissible unit of technology.
      kind: 'craft-recipe';
      output: ObjectKind;
      inputs: Partial<Record<ObjectKind, number>>;
    };

export type KnowledgeStatus = 'hypothesis' | 'held' | 'contested' | 'abandoned';

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
  /** Sampled provenance — enough to audit "why do you believe that?". */
  sourceMemoryIds: number[];
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
  needs: Needs;
  health: number;
  sick: boolean;
  x: number;
  y: number;
  inventory: Partial<Record<ObjectKind, number>>;
  context: ContextFeatures;
}

export interface ObservedAgent {
  id: number;
  x: number;
  y: number;
}

export interface ObservedResource {
  id: number;
  kind: ResourceNodeKind;
  x: number;
  y: number;
  stock: number;
}

export interface ObservedStructure {
  id: number;
  kind: BuildKind;
  x: number;
  y: number;
}

/** What the agent can currently perceive. */
export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

export interface WorldView {
  tick: number;
  night: boolean;
  /** Current season — winter collapses forage and raises cold pressure. */
  season: Season;
  agents: ObservedAgent[];
  resources: ObservedResource[];
  structures: ObservedStructure[];
}

export interface Goal {
  id: number;
  description: string;
  /** The need this goal serves, when it serves one. */
  need?: NeedKey;
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
