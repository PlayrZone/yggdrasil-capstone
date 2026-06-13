/**
 * Body-local copy of the Body⇄Mind boundary types.
 *
 * The Mind owns the canonical contract in `../contract/types.ts`; this file
 * mirrors the subset the Body needs. The two sides stay decoupled so the
 * Body can run with no Mind attached. The copies are structurally identical;
 * the runner relies on that (engine events/snapshots flow INTO the mind,
 * mind intents flow INTO the body) and tsc enforces assignability there.
 *
 * Doctrine (yggdrasil_civilization_design V2): nothing here may ever gain
 * a role/job/class/faction/rank field, and the Body only describes
 * physical reality — no social meaning, no knowledge.
 */

export type NeedKey = 'hunger' | 'rest' | 'safety' | 'socialConnection';
export type Needs = Record<NeedKey, number>;

export const NEED_PRESSING = 60;
export const NEED_CRITICAL = 85;

export interface Traits {
  curiosity: number;
  aggression: number;
  compassion: number;
  ambition: number;
  loyalty: number;
  riskTolerance: number;
}

export type ObjectKind =
  | 'water'
  | 'wood'
  | 'stone'
  | 'clay'
  | 'fiber'
  | 'berry'
  | 'tuber'
  | 'seed'
  | 'mushroomRed'
  | 'nightshade'
  | 'meat'
  | 'hide'
  | 'charcoal'
  | 'leather'
  | 'rope'
  | 'brick'
  | 'copper'
  | 'tin'
  | 'iron'
  | 'bronze'
  | 'copperOre'
  | 'tinOre'
  | 'ironOre'
  | 'coal'
  | 'salt'
  | 'silver'
  | 'gold'
  | 'gemstone'
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
  | 'gemVein';

export type BuildKind = 'shelter' | 'wall' | 'container';

export interface ContextFeatures {
  nearWater: boolean;
  night: boolean;
  inShelter: boolean;
  elevationBand: number;
}

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
  | 'Speak'
  | 'Follow'
  | 'Flee'
  | 'Idle';

/**
 * Speech payloads transit the Body opaquely: the engine transports
 * utterances, it never interprets them (knowledge rules mean nothing to
 * physics). Hence `rule?: unknown` where the package types it precisely.
 */
export interface EngineUtterance {
  targetId?: number;
  speechAct: string;
  rule?: unknown;
  ruleConfidence?: number;
  text?: string;
}

export interface Intent {
  kind: IntentKind;
  x?: number;
  y?: number;
  targetId?: number;
  objectKind?: ObjectKind;
  buildKind?: BuildKind;
  durationTicks?: number;
  utterance?: EngineUtterance;
}

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
  payload: Record<string, unknown>;
}

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

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

export interface WorldView {
  tick: number;
  night: boolean;
  season: Season;
  agents: ObservedAgent[];
  resources: ObservedResource[];
  structures: ObservedStructure[];
}
