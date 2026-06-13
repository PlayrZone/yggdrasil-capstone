// The Body side of Yggdrasil — the physical existence of Gahallians.
// Experiences reality; never thinks. The Mind side lives alongside it in
// this package (memory/learning/knowledge/consciousness); the runner
// composes the two. Canonical design: docs/yggdrasil_civilization_design.md.

export type {
  NeedKey,
  Needs,
  Traits,
  ObjectKind,
  ResourceNodeKind,
  BuildKind,
  ContextFeatures,
  IntentKind,
  Intent,
  EngineUtterance,
  SimEventType,
  SimEvent,
  AgentSnapshot,
  ObservedAgent,
  ObservedResource,
  ObservedStructure,
  WorldView,
  Season,
} from './contract.js';
export { NEED_PRESSING, NEED_CRITICAL } from './contract.js';

export type { Weather } from './Climate.js';
export {
  seasonAt,
  growthFactor,
  coldPressure,
  hungerRateMultiplier,
  weatherAt,
  SEASON_DAYS,
  TICKS_PER_SEASON,
  TICKS_PER_YEAR,
} from './Climate.js';

export type { GahallianBody } from './GahallianBody.js';
export { createGahallianBody } from './GahallianBody.js';

export { SimEventBus } from './SimEventBus.js';

export type { ResourceNode } from './ResourceNodeSystem.js';
export {
  ResourceNodeSystem,
  createResourceNode,
  NODE_YIELD,
  SEED_EVERY_N_GATHERS,
  DEFAULT_REGROW,
} from './ResourceNodeSystem.js';

export type { SeedInGround } from './WorldRegularities.js';
export {
  WorldRegularitiesSystem,
  TICKS_PER_DAY,
  isNight,
  SEED_SPROUT_TICKS,
  SPROUTED_PLANT_STOCK,
  SICKNESS_TICKS,
  PERCEPTION_RADIUS_DAY,
  PERCEPTION_RADIUS_NIGHT,
  NUTRITIOUS_FOODS,
  SICKENING_FOODS,
} from './WorldRegularities.js';

export type { Structure, TerrainField } from './PerceptionSystem.js';
export { PerceptionSystem } from './PerceptionSystem.js';

export { YggdrasilSystem } from './YggdrasilSystem.js';

export { spawnGahallians } from './genesis.js';
export type { GenesisArea } from './genesis.js';

export { CANONICAL_IDENTITIES, identityAt } from './identities.js';
export type { Identity } from './identities.js';
