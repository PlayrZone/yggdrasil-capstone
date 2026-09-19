/**
 * THE FORAGER CONTINENT'S OWN VOCABULARY (moved here by W1-B2).
 *
 * Every literal union below used to live in `contract/types.ts`, where the mind
 * was typed against it — which meant one brain could only ever live in one
 * world. The mind now carries opaque ids (`contract/ids.ts`); these names are
 * this world's, and only this world's.
 *
 * WHO MAY STILL READ THEM: the body and the world systems (they enforce
 * physics, and physics is world-specific), this world's own files —
 * `reflexPolicy.ts`, `actions.ts`, `kinds.ts`, `define.ts` — `training/**`
 * (the forager eval pack), `record/**` and the instrument (B6). B3 took
 * `consciousness/schema.ts` off this list; `prompt.ts` is B5's, and reads none
 * of these types, only this world's prose. No file under `agent/ memory/
 * learning/ knowledge/ relationships/ narrative/ consciousness/` may name any
 * of them, and `test/world-tables-out.test.ts` fails the build if one starts
 * to.
 *
 * NOTHING HERE CHANGED IN THE MOVE. Same members, same order, same values.
 */

// ─── Needs ───────────────────────────────────────────────────────────────────

/**
 * Needs are PRESSURE values in [0, 100]: 0 = fully satisfied, rising over
 * time; "hunger = 95" means nearly starving. Thresholds: pressing ≥ 60,
 * critical ≥ 85.
 */
export type NeedKey = 'hunger' | 'rest' | 'safety' | 'socialConnection';

export type Needs = Record<NeedKey, number>;

export const NEED_PRESSING = 60;
export const NEED_CRITICAL = 85;

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

export type BuildKind = 'shelter' | 'wall' | 'container';

/** Every kind of thing this continent contains — stuff, and the sources it is
 *  won from. The adapter's `kinds` declares exactly these, in this order. */
export type ForagerKind = ObjectKind | ResourceNodeKind;

// ─── Verbs ───────────────────────────────────────────────────────────────────

/**
 * What a being can decide to do HERE. Moved out of `contract/types.ts` by
 * W1-B3: the mind carries `ActionId`, the adapter binds each of these to a core
 * verb, and the BODY keeps its exhaustive switch over this union because it
 * enforces this world's physics and physics is world-specific.
 *
 * NOTHING CHANGED IN THE MOVE: same members, same order, same spelling — and
 * the order is load bearing, because a prompt lists the vocabulary in it.
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

/**
 * Context features captured AT THE MOMENT a memory forms — the learning
 * system's feature space. Extending this vocabulary widens what is
 * discoverable; it must only ever grow (old runs stay minable).
 *
 * A type alias rather than an interface on purpose: the mind holds a memory's
 * circumstances as an opaque `ContextRecord` of named slots, and only an object
 * TYPE (not an interface) carries the implicit index signature that makes this
 * world's four slots assignable to it.
 */
export type ContextFeatures = {
  nearWater: boolean;
  night: boolean;
  inShelter: boolean;
  /** Coarse terrain elevation band: 0 lowland · 1 midland · 2 highland. */
  elevationBand: number;
};

export type ContextFeatureKey = 'nearWater' | 'night' | 'inShelter' | 'highland';

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

// ─── Time ────────────────────────────────────────────────────────────────────

/** The year this continent turns through. */
export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
