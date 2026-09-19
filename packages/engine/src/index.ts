// @yggdrasil/engine — the standalone artificial-life research engine.
// World physics + bodies (the BODY) and memory/learning/knowledge/
// consciousness (the MIND), self-contained: own ECS/EventBus/Transform in
// ./core, no external game engine. Hosts (the Lab) compose this.

// ── Core primitives (own, no Gahalla) ───────────────────────────────────────
export { World } from './core/World.js';
export type { WorldEvents } from './core/World.js';
export { SpatialIndex } from './core/SpatialIndex.js';
export type { VisitCounter } from './core/SpatialIndex.js';
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
  regrowthCount,
} from './body/ResourceNodeSystem.js';
export type { SeedInGround } from './body/WorldRegularities.js';
export {
  WorldRegularitiesSystem,
  TICKS_PER_DAY,
  isNight,
  SEED_SPROUT_TICKS,
  SPROUTED_PLANT_STOCK,
  SICKNESS_TICKS,
  NUTRITIOUS_FOODS,
  SICKENING_FOODS,
} from './body/WorldRegularities.js';
export type { Structure, TerrainField } from './body/PerceptionSystem.js';
export { PerceptionSystem } from './body/PerceptionSystem.js';
export { YggdrasilSystem } from './body/YggdrasilSystem.js';
export { WildlifeSystem } from './body/WildlifeSystem.js';
export type { Animal, AnimalKind, HomeRange, WildlifeRules } from './body/WildlifeSystem.js';
export { ContinentWildlife, WILDLIFE_PER_KM2 } from './body/ContinentWildlife.js';
export { homePosition } from './body/animals.js';
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

// ── The ground, as a scenario supplies it (M1 — "one metre is one metre") ────
export { classicGeography, CLASSIC_SCALE, slopeOf } from './world/geography.js';
export type { WorldGeography, BodyScale } from './world/geography.js';
export {
  continentGeography,
  continentHeightAt,
  continentElevationBand,
  continentRegionAt,
  freshWaterNearness,
  inFoundingValley,
  riverCourse,
  CONTINENT_SPAN,
  CONTINENT_TILE,
  CONTINENT_LAKES,
  FOUNDING_VALLEY,
  HIGHLAND_M,
  UPLAND_M,
  RIVER_COUNT,
} from './world/continent.js';
export { ActivityRegions, TiledEntities } from './world/activity.js';
export { valueNoise, smoothstep01 } from './world/noise.js';
export { scaleReport, SCALE_TABLE, CONTINENT_SCALE, ADULT_HEIGHT_M } from './worlds/forager/scale.js';
export type { ScaleReport, ScaleRow, ScenarioId } from './worlds/forager/scale.js';

// ── Experiment runner (headless sim host) ────────────────────────────────────
export { Experiment, FORAGER_CONTINENT, TRUE_SCALE_CONTINENT } from './runner/Experiment.js';
export type { ExperimentOptions, RecordingOptions, AgentInfo } from './runner/Experiment.js';
export { scenarioFor, ForagerScenario, CONTINENT_ACTIVITY_RADIUS } from './runner/Scenario.js';
export type { Scenario, ScenarioWorld, ActivitySettings, Demography } from './runner/Scenario.js';
export { ContinentScenario } from './worlds/forager/continentScenario.js';

// ── Lossless cognition record (W0-B) ─────────────────────────────────────────
export { ENGINE_VERSION } from './version.js';
export { COGNITION_SCHEMA_VERSION, NullCognitionSink } from './record/types.js';
export type {
  ICognitionSink,
  CognitionRecordV2,
  CognitionOutcome,
  CognitionStatus,
  CognitionAttempt as CognitionAttemptRecord,
  IntentOutcome,
  UtteranceOutcome,
  InterventionDuringThink,
  OutcomeCloseReason,
  ResolvedOutput,
  RecordedRunOptions,
  RecordedRunOptionsInput,
  RecordedBody,
  RecorderWorld,
  RunManifest,
  RunSummary,
  RunCounts,
  RunScaffoldSummary,
  ScaffoldState,
  ScaffoldKind,
  ScaffoldEvent,
  AttemptPromptDelta,
  SerializedThinkInput,
  SerializedMemoryRecord,
  SerializedKnowledgeRecord,
  NonFiniteToken,
  NonFiniteSubstitution,
  PeekedMemoryRecord,
  UnvalidatedThinkInput,
} from './record/types.js';
export { DEFAULT_RECORDED_PROVENANCE } from './record/types.js';
export { serializeThinkInput, deserializeThinkInput, peekThinkInput, attemptPrompt, attemptPromptDelta } from './record/serialize.js';
export { ScaffoldLedger } from './record/ScaffoldLedger.js';
export { CognitionRecorder } from './record/CognitionRecorder.js';
export type { CognitionRecorderOptions, CompletedAct } from './record/CognitionRecorder.js';
export { OutcomeTracker } from './record/OutcomeTracker.js';

// ── Mind (memory · learning · knowledge · consciousness) ─────────────────────

export type {
  Traits,
  Intent,
  SpeechAct,
  Utterance,
  SimEvent,
  MemoryOrigin,
  MemoryRecord,
  KnowledgeRule,
  KnowledgeStatus,
  KnowledgeRecord,
  EvidenceSnapshot,
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
} from './contract/types.js';

// ── The WorldAdapter seam (W1-B) — one brain, any world ──────────────────────
export type {
  ActionId,
  EventId,
  DriveId,
  ContextFeatureId,
  KindId,
  DriveLevels,
  DriveDeltas,
  ContextRecord,
  ItemCounts,
} from './contract/ids.js';
export type {
  WorldAdapter,
  WorldSpec,
  DriveSchema,
  ContextSchema,
  EventSchema,
  EventRoles,
  EventRoleSchema,
  PrestigeSchema,
  SocialRole,
  DemonstrationSchema,
  RelationshipDeltas,
  TimeOps,
  TraitCurve,
  CognitionDefaults,
  ReflexPolicy,
  ReflexPolicyFactory,
} from './contract/adapter.js';
export { defineWorld, featureActive, traitCurveValue, emptyContext, heardEvent } from './contract/adapter.js';
export type {
  CoreVerb,
  AffordanceTag,
  KindSchema,
  ParamType,
  ParamSchema,
  ActionBinding,
  IntentRefusal,
} from './contract/actions.js';
export {
  PARAM_TYPE_ORDER,
  actionVocabulary,
  actionForCore,
  kindsWithTag,
  kindsFor,
  planArguments,
  checkIntent,
} from './contract/actions.js';
export { WorldGate } from './contract/gate.js';
export type { WorldGateCounts } from './contract/gate.js';
// W1-B4 — where things are, and the only way to ask. `SpaceOps` is the mind's
// half; `SpaceCodec` is the edges', and it is reached through `codecFor(space)`
// rather than off the adapter, so nothing a mind holds leads to it.
export type { PlaceRef, DirectionId, SpaceOps, SpaceCodec, SpaceDefinition } from './contract/space.js';
export { ForeignPlaceError, codecFor, defineSpace, placeFieldNames } from './contract/space.js';
export type { WireIntent, WireOutput, SentThinkInput } from './contract/wire.js';
export {
  PLACE_FIELD,
  encodeIntent,
  encodePlan,
  encodeOutput,
  encodeThinkInputPlaces,
  decodeThinkInputPlaces,
} from './contract/wire.js';

// ── The forager continent's own vocabulary (W1-B2 — no longer the mind's) ────
export type {
  NeedKey,
  Needs,
  ObjectKind,
  ResourceNodeKind,
  BuildKind,
  ForagerKind,
  IntentKind,
  ContextFeatures,
  ContextFeatureKey,
  SimEventType,
  Season,
} from './worlds/forager/types.js';
export { NEED_PRESSING, NEED_CRITICAL } from './worlds/forager/types.js';
export { foragerAdapter } from './worlds/forager/adapter.js';
export { FORAGER_ACTIONS } from './worlds/forager/actions.js';
export { FORAGER_KINDS } from './worlds/forager/kinds.js';
// This world's plane, and the two ways in and out of one of its places. A host
// that is ALREADY in the forager world (the lab, the instrument, a driver) may
// open a place; a mind never can.
export { foragerSpace, at, pointOf, xOf, yOf } from './worlds/forager/space.js';
export type { Point } from './worlds/forager/space.js';
export { createPlaneSpace } from './worlds/plane.js';
export type { PlaneSpace } from './worlds/plane.js';
export { defineForagerWorld } from './worlds/forager/define.js';
export type { ForagerWorldSpec } from './worlds/forager/define.js';

export type { MaterialProps, MaterialTier } from './world/materials.js';
export { MATERIAL_PROPERTIES, isEdible, isPoisonous } from './world/materials.js';

export { MemoryStream, episodicKey } from './memory/MemoryStream.js';
export type { RetrievalQuery } from './memory/MemoryStream.js';
export { importanceOf } from './memory/importance.js';
export { memoryFromEvent } from './memory/memoryFromEvent.js';
export type { IEmbedder } from './memory/IEmbedder.js';
export { NullEmbedder, cosineSimilarity } from './memory/IEmbedder.js';

export type { ILearner, EvidenceReport, ProvenanceLevel } from './learning/ILearner.js';
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
export { WaitingMind, policyFor } from './consciousness/policy.js';
export { ReflexMind, foragerReflexPolicy } from './worlds/forager/reflexPolicy.js';
export { LlmMind } from './consciousness/LlmMind.js';
export type { CognitionRecord, CognitionAttempt, LlmMindOptions } from './consciousness/LlmMind.js';
export { FireworksMindBackend } from './consciousness/FireworksMindBackend.js';
export type { FireworksMindBackendOptions } from './consciousness/FireworksMindBackend.js';
export { MockMindBackend } from './consciousness/MockMindBackend.js';
export type { MockMindBackendOptions } from './consciousness/MockMindBackend.js';
export { buildThinkPrompt, retryPrompt, knowledgeText } from './consciousness/prompt.js';
export type { ThinkPrompt } from './consciousness/prompt.js';
export { parseMindOutput, parseMindOutputDetailed, MindOutputError } from './consciousness/schema.js';
export type { MindOutputRejection, JsonSalvage, ParsedMindOutput } from './consciousness/schema.js';

export { CognitionScheduler } from './scheduler/CognitionScheduler.js';
export type { CognitionSchedulerOptions } from './scheduler/CognitionScheduler.js';
export { CognitionLog } from './scheduler/CognitionLog.js';

export { cognitionToExample, curateCorpus, acceptedAttempt, acceptedCompletion, planShape, needRegime } from './training/corpus.js';
export type {
  TrainingExample,
  CurateOptions,
  CurationResult,
  CurationDrops,
  NeedRegime,
  PlanShapeCapReport,
} from './training/corpus.js';
export { NearDuplicateIndex, contentHash, shingleJaccard, NEAR_DUPLICATE_COMPLETION_WEIGHT } from './training/dedupe.js';
export type { NearDuplicateOptions, DuplicateDocument } from './training/dedupe.js';
export { summarizeCorpus } from './training/summarize.js';
export type { DatasetCard, ScaffoldCounts, PlanShapeSuccess, Share } from './training/summarize.js';
export { evalJsonValidity } from './training/eval.js';
export type { ValidityResult } from './training/eval.js';
export { evalKnowledgeFidelity } from './training/fidelity.js';
export type {
  FidelityResult,
  FidelityViolation,
  FidelityDomainScore,
  FidelityOptions,
  FidelityVerdict,
} from './training/fidelity.js';
export { detectLeak, detectLexicalLeaks, domainMatcher, domainStems, stemWord, suppliedVocabulary, suppliedNames, isOrdinaryWord, DECISIVE_SURFACES, LEAK_DOMAINS } from './training/leakMatch.js';
export type { LeakDomain, LeakEvidence, LeakEvidenceKind, LeakContext, DomainMatcher, ClaimRule } from './training/leakMatch.js';
export { detectActLeak, holdsGround, PLANTS_THE_SEED, worksTheMaterials } from './training/leakActs.js';
export type { ActLeakRule, IntentPattern } from './training/leakActs.js';
export { MockLeakJudge, LlmLeakJudge } from './training/leakJudge.js';
export type { ILeakJudge, LeakJudgement, LeakJudgeRequest, LeakJudgeVerdict } from './training/leakJudge.js';
export { calibrateDetector, lexicalDetector, ownDomainDetector, judgeDetector, unionDetector } from './training/leakCalibration.js';
export type { CalibrationItem, LeakDetector, CalibrationResult, CalibrationDomainScore, CalibrationConfusion } from './training/leakCalibration.js';
export { LEXICAL_CALIBRATION, quotableRecall } from './training/leakCalibrationCard.js';
export type { CalibrationCard, CalibrationPR, BlindMeasurement } from './training/leakCalibrationCard.js';
export { COMMON_WORD_FORMS } from './training/commonWords.js';
export { leakTrapBattery } from './training/leakTraps.js';
export type { LeakTrap, BatteryOptions } from './training/leakTraps.js';

// ── The evaluation instrument (W1-E) — see src/eval/README.md ───────────────
// Listed rather than `export *`: in ESM a star re-export silently DROPS a name
// that two modules both provide, so a collision would remove an export instead
// of failing the build.
export {
  HARD_CALL_CEILING,
  DEFAULT_CALL_BUDGET,
  CONSTANT_CEILING,
  CallBudget,
  BudgetStoreBase,
  MemoryBudgetStore,
  BudgetExhaustedError,
  PaidCallRefused,
  RunHalt,
  openBackend,
  openTraceJudge,
  openLeakJudge,
  describeBackendSpec,
  isPaidSpec,
  isPaidJudgeSpec,
  DEFAULT_PAID_MODEL,
  buildArm,
  familyOf,
  carriesInstruction,
  contrastsFor,
  yggdrasilInterviewee,
  EPISTEMIC_INSTRUCTION_LINES,
  EPISTEMIC_INSTRUCTION_TEXT,
  EpistemicAblationFailed,
  stripEpistemicInstruction,
  carriesEpistemicInstruction,
  epistemicFactorDiff,
  runAb,
  BaselineAgentBackend,
  BaselineMemory,
  buildBaselinePrompt,
  buildBaselineInterviewPrompt,
  DEFAULT_PERSONA,
  BASELINE_CLOSING,
  computeArmMetrics,
  metricValues,
  integrityBreaches,
  ANSWER_WINDOW_TICKS,
  INTEGRITY_THRESHOLDS,
  buildTraces,
  blindTraces,
  renderTrace,
  traceFeatures,
  SealedTraceKey,
  commitTo,
  verifyCommitment,
  randomBlindSecret,
  keyedStream,
  sha256Hex,
  pairTraces,
  DISAVOWALS,
  DISAVOWAL_PATTERNS,
  admitsIgnorance,
  disavowalIn,
  assertsAbsence,
  normaliseSpeech,
  runIgnoranceProbe,
  echoStems,
  withoutEcho,
  citesOthers,
  FORAGER_PROBES,
  splitProbes,
  MockTraceJudge,
  LlmTraceJudge,
  TRACE_CRITERIA,
  judgeTraces,
  ATTESTATION_THRESHOLDS,
  attestRun,
  verifyAttestation,
  thinkOutcomeBreaches,
  watchThinkOutcomes,
  reportOf,
  CLUSTER_RHO_GRID,
  betweenRunIcc,
  clusterJudgeGate,
  clustersOf,
  sweepP,
  PILOT_RECIPE,
  allowanceFor,
  designConfirmatory,
  dryRunPilot,
  estimatePilot,
  runPilotEstimation,
  wilsonInterval,
  exactBinomialTwoSided,
  pairedBootstrap,
  signFlipPermutation,
  minimumPairedSeeds,
  MIN_PAIRED_SEEDS,
  minimumDetectableEffect,
  minimumDetectableWins,
  pairsForSweep,
  multipleComparisonNote,
  formatP,
  holmAdjusted,
  normalQuantile,
  signTest,
  studentTQuantile,
  JUDGE_GATE,
  DECLARED_CONTRAST_FAMILY,
  JUDGE_GATE_HASH,
  hashJudgeGate,
  judgeGateOverrides,
  judgeGatePower,
  judgeGateDesign,
  pairsForJudgePower,
  INTERVIEW_INSTRUCTION,
  QUESTION_PREFIX,
  YGGDRASIL_CLOSING,
  isInterview,
  questionIn,
  askOver,
  FaithfulMockBackend,
  OmniscientMockBackend,
  ADVERSARIAL_PROFILES,
  HONEST_STRATEGIES,
  LEAKING_STRATEGIES,
  TIER2_BLIND_STRATEGIES,
  adversarialInterviewees,
  scriptedInterviewee,
} from './eval/index.js';
export type {
  BudgetSpec,
  BudgetState,
  CeilingRuling,
  SpendLogEntry,
  IBudgetStore,
  MemoryBudgetStoreOptions,
  UsageReporting,
  OpenedBackend,
  HaltReason,
  BackendSpec,
  TraceJudgeSpec,
  LeakJudgeSpec,
  DoorContext,
  FetchLike,
  ArmSpec,
  BuiltArm,
  EpistemicFactorDiff,
  AbSpec,
  AbConfig,
  AbResult,
  AbVerdict,
  AbUnusable,
  AbManifest,
  ContrastResult,
  PreRegisteredQuestion,
  RunIntegrity,
  BaselineAgentOptions,
  BaselineMemoryOptions,
  BaselinePersona,
  ArmIntegrity,
  ArmMetrics,
  ArmObservation,
  MetricValue,
  TraceSource,
  BlindOptions,
  BlindResult,
  BlindingManifest,
  TracePair,
  PairPlacement,
  PairingResult,
  PairingManifest,
  IgnoranceOptions,
  IgnoranceReport,
  ProbeAnswer,
  ProbeSubject,
  IgnoranceProbe,
  ControlGround,
  ControlSlice,
  ITraceJudge,
  TraceJudgement,
  TraceCriterion,
  Side,
  MockTraceJudgeOptions,
  JudgeAggregate,
  PairOutcome,
  CriterionTally,
  PositionCheck,
  AggregateOptions,
  ExploratoryGate,
  RunAttestation,
  Interval,
  PairedSample,
  PairedResult,
  PermutationTest,
  BootstrapOptions,
  DesignPower,
  JudgeDesignPower,
  JudgeGateRule,
  AttestationBinding,
  AttestationCheck,
  AttestationClaim,
  ThinkOutcomeReport,
  ClusterGate,
  SeedCluster,
  ConfirmatoryDesign,
  ConfirmatoryTargets,
  Estimate,
  PilotArtefact,
  PilotCallBlock,
  PilotCallTable,
  PilotEstimates,
  PilotRecipe,
  JudgeGateConditions,
  JudgeGatePower,
  JudgeGateDesign,
  MultipleComparisonNote,
  SignTest,
  AdversarialProfile,
  ArmId,
  ArmFamily,
  AbMode,
  IInterviewee,
  JudgeGateObserved,
  InterviewRequest,
  TraceMoment,
  MomentOutcome,
  RawBeingTrace,
  BlindTrace,
  TraceKey,
  TraceFeatures,
  SentPrompt,
} from './eval/index.js';

export { AgentMind } from './agent/AgentMind.js';
export type { AgentMindOptions } from './agent/AgentMind.js';

export { classifyRuleTruth } from './analysis/groundTruth.js';
export type { RuleTruth } from './analysis/groundTruth.js';
export { analyzeDiffusion, analyzeBeliefAccuracy } from './analysis/diffusion.js';
export type { AgentKnowledge, BeliefHolder, BeliefCluster, BeliefAccuracy } from './analysis/diffusion.js';
export { classifyArchetype, classifyFromCounts } from './analysis/archetype.js';
export type { Archetype, ArchetypeResult } from './analysis/archetype.js';
export { analyzeSociety } from './analysis/society.js';
export type { SocietySignals, SocietyReport } from './analysis/society.js';
export { analyzeCulture } from './analysis/culture.js';
export type { CultureReport, TribeBelief } from './analysis/culture.js';
export { analyzeMyth } from './analysis/myth.js';
export type { MythReport } from './analysis/myth.js';
export { analyzeSacredPlaces } from './analysis/sacredPlaces.js';
export type { SacredPlace, SacredPlacesReport, StorySite } from './analysis/sacredPlaces.js';
export { mutateNarrative, narrativeRefOf } from './narrative/NarrativeStore.js';
