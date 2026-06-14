// @yggdrasil/engine — the standalone artificial-life research engine.
// World physics + bodies (the BODY) and memory/learning/knowledge/
// consciousness (the MIND), self-contained: own ECS/EventBus/Transform in
// ./core, no external game engine. Hosts (the Lab) compose this.

// ── Core primitives (own, no Gahalla) ───────────────────────────────────────
export { World } from './core/World.js';
export type { WorldEvents } from './core/World.js';
export type { Entity } from './core/Entity.js';
export { EventBus } from './core/EventBus.js';
export type { Listener } from './core/EventBus.js';
export type { Transform2D } from './core/Transform2D.js';

// ── Body (world physics, needs, perception, intent execution, climate) ───────
export type { GahallianBody } from './body/GahallianBody.js';
export { createGahallianBody } from './body/GahallianBody.js';
export { SimEventBus } from './body/SimEventBus.js';
export type { ResourceNode } from './body/ResourceNodeSystem.js';
export {
  ResourceNodeSystem,
  createResourceNode,
  NODE_YIELD,
  SEED_EVERY_N_GATHERS,
  DEFAULT_REGROW,
} from './body/ResourceNodeSystem.js';
export type { SeedInGround } from './body/WorldRegularities.js';
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
} from './body/WorldRegularities.js';
export type { Structure, TerrainField } from './body/PerceptionSystem.js';
export { PerceptionSystem } from './body/PerceptionSystem.js';
export { YggdrasilSystem } from './body/YggdrasilSystem.js';
export { spawnGahallians } from './body/genesis.js';
export type { GenesisArea } from './body/genesis.js';
export { CANONICAL_IDENTITIES, identityAt } from './body/identities.js';
export type { Identity } from './body/identities.js';
export type { Weather } from './body/Climate.js';
export {
  seasonAt,
  growthFactor,
  coldPressure,
  hungerRateMultiplier,
  weatherAt,
  SEASON_DAYS,
  TICKS_PER_SEASON,
  TICKS_PER_YEAR,
} from './body/Climate.js';

// ── World geography (regions / unequal continent) ────────────────────────────
export { WORLD, EDGE, SEA_HEIGHT, regionAt, heightAt, elevationBand, riverY, tributaryY, inRiver, LAKE_CENTERS, clampToWorld, isWater, isDeepWater } from './world/regions.js';
export type { Region } from './world/regions.js';

// ── Experiment runner (headless sim host) ────────────────────────────────────
export { Experiment } from './runner/Experiment.js';
export type { ExperimentOptions, AgentInfo } from './runner/Experiment.js';

// ── Mind (memory · learning · knowledge · consciousness) ─────────────────────

export type {
  NeedKey,
  Needs,
  Traits,
  ObjectKind,
  ResourceNodeKind,
  ContextFeatures,
  ContextFeatureKey,
  IntentKind,
  Intent,
  BuildKind,
  SpeechAct,
  Utterance,
  SimEventType,
  SimEvent,
  MemoryOrigin,
  MemoryRecord,
  KnowledgeRule,
  KnowledgeStatus,
  KnowledgeRecord,
  AgentSnapshot,
  ObservedAgent,
  ObservedResource,
  ObservedStructure,
  WorldView,
  Goal,
  ThinkTrigger,
  RelationshipRecord,
  ThinkInput,
  MindOutput,
  Season,
} from './contract/types.js';
export { NEED_PRESSING, NEED_CRITICAL } from './contract/types.js';

export type { MaterialProps, MaterialTier } from './world/materials.js';
export { MATERIAL_PROPERTIES, isEdible, isPoisonous } from './world/materials.js';

export { MemoryStream } from './memory/MemoryStream.js';
export type { RetrievalQuery } from './memory/MemoryStream.js';
export { importanceOf } from './memory/importance.js';
export { memoryFromEvent } from './memory/memoryFromEvent.js';
export type { IEmbedder } from './memory/IEmbedder.js';
export { NullEmbedder, cosineSimilarity } from './memory/IEmbedder.js';

export type { ILearner, EvidenceReport } from './learning/ILearner.js';
export { ProvenanceSample } from './learning/ILearner.js';
export { ContextMiner } from './learning/ContextMiner.js';
export { SuccessionMiner } from './learning/SuccessionMiner.js';
export type { SuccessionMinerOptions } from './learning/SuccessionMiner.js';
export { SocialMiner } from './learning/SocialMiner.js';
export { OutcomeMiner } from './learning/OutcomeMiner.js';
export { ruleKey } from './learning/ruleKey.js';
export { renderStatement } from './learning/templates.js';

export { KnowledgeStore } from './knowledge/KnowledgeStore.js';
export { RelationshipStore } from './relationships/RelationshipStore.js';

export type { IMind } from './consciousness/IMind.js';
export type { IMindBackend } from './consciousness/IMindBackend.js';
export { ReflexMind } from './consciousness/ReflexMind.js';
export { LlmMind } from './consciousness/LlmMind.js';
export type { CognitionRecord, LlmMindOptions } from './consciousness/LlmMind.js';
export { FireworksMindBackend } from './consciousness/FireworksMindBackend.js';
export type { FireworksMindBackendOptions } from './consciousness/FireworksMindBackend.js';
export { MockMindBackend } from './consciousness/MockMindBackend.js';
export type { MockMindBackendOptions } from './consciousness/MockMindBackend.js';
export { buildThinkPrompt, knowledgeText } from './consciousness/prompt.js';
export type { ThinkPrompt } from './consciousness/prompt.js';
export { parseMindOutput, MindOutputError } from './consciousness/schema.js';

export { CognitionScheduler } from './scheduler/CognitionScheduler.js';
export type { CognitionSchedulerOptions } from './scheduler/CognitionScheduler.js';
export { CognitionLog } from './scheduler/CognitionLog.js';

export { cognitionToExample, curateCorpus } from './training/corpus.js';
export type { TrainingExample, CurateOptions, CurationResult } from './training/corpus.js';
export { evalJsonValidity, evalKnowledgeFidelity } from './training/eval.js';
export type { ValidityResult, FidelityResult, FidelityViolation } from './training/eval.js';

export { AgentMind } from './agent/AgentMind.js';
export type { AgentMindOptions } from './agent/AgentMind.js';

export { classifyRuleTruth } from './analysis/groundTruth.js';
export type { RuleTruth } from './analysis/groundTruth.js';
export { analyzeDiffusion, analyzeBeliefAccuracy } from './analysis/diffusion.js';
export type { AgentKnowledge, BeliefHolder, BeliefCluster, BeliefAccuracy } from './analysis/diffusion.js';
export { classifyArchetype } from './analysis/archetype.js';
export type { Archetype, ArchetypeResult } from './analysis/archetype.js';
export { analyzeSociety } from './analysis/society.js';
export type { SocietySignals, SocietyReport } from './analysis/society.js';
export { analyzeCulture } from './analysis/culture.js';
export type { CultureReport, TribeBelief } from './analysis/culture.js';
