/**
 * W1-E — THE INSTRUMENT that decides whether a being is more ALIVE than a plain
 * LLM agent. Read `eval/README.md` first: it says what each piece measures, the
 * blinding rules, the spend guard, the four arms, and the capped recipe for the
 * first paid pilot.
 *
 * Nothing in here writes to a world, and nothing in here is read by one. It is
 * instrument, in the sense `ARCHITECTURE.md` §2 means: it reads everything and
 * is read by nothing in L1–L7.
 */

// ── The spend guard (decision D1) ────────────────────────────────────────────
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
} from './budget.js';
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
} from './budget.js';

// ── The one door: descriptions in, guarded objects out ───────────────────────
export { openBackend, openTraceJudge, openLeakJudge, describeBackendSpec, isPaidSpec, isPaidJudgeSpec, DEFAULT_PAID_MODEL } from './door.js';
export type { BackendSpec, TraceJudgeSpec, LeakJudgeSpec, DoorContext, FetchLike } from './door.js';

// ── The arms, and the one sentence they are a factor of ──────────────────────
export { buildArm, familyOf, carriesInstruction, contrastsFor, yggdrasilInterviewee } from './arms.js';
export type { ArmSpec, BuiltArm } from './arms.js';
export {
  EPISTEMIC_INSTRUCTION_LINES,
  EPISTEMIC_INSTRUCTION_TEXT,
  EpistemicAblationFailed,
  stripEpistemicInstruction,
  carriesEpistemicInstruction,
  epistemicFactorDiff,
} from './epistemic.js';
export type { EpistemicFactorDiff } from './epistemic.js';

// ── The runner ───────────────────────────────────────────────────────────────
export { runAb } from './ab.js';
export type {
  AbSpec,
  AbConfig,
  AbResult,
  AbVerdict,
  AbUnusable,
  AbManifest,
  ContrastResult,
  PreRegisteredQuestion,
  RunIntegrity,
} from './ab.js';

// ── Arm B, the control ───────────────────────────────────────────────────────
export { BaselineAgentBackend } from './baseline/BaselineAgentBackend.js';
export type { BaselineAgentOptions } from './baseline/BaselineAgentBackend.js';
export { BaselineMemory } from './baseline/memory.js';
export type { BaselineMemoryOptions } from './baseline/memory.js';
export { buildBaselinePrompt, buildBaselineInterviewPrompt, DEFAULT_PERSONA, BASELINE_CLOSING } from './baseline/prompt.js';
export type { BaselinePersona } from './baseline/prompt.js';

// ── Objective metrics ────────────────────────────────────────────────────────
export { computeArmMetrics, metricValues, integrityBreaches, ANSWER_WINDOW_TICKS, INTEGRITY_THRESHOLDS } from './metrics.js';
export type { ArmIntegrity, ArmMetrics, ArmObservation, MetricValue } from './metrics.js';

// ── Blinding ─────────────────────────────────────────────────────────────────
export { buildTraces, blindTraces, renderTrace, traceFeatures, SealedTraceKey } from './trace.js';
export type { TraceSource, BlindOptions, BlindResult, BlindingManifest } from './trace.js';
export { commitTo, verifyCommitment, randomBlindSecret, keyedStream, sha256Hex } from './commit.js';
export { pairTraces } from './pairing.js';
export type { TracePair, PairPlacement, PairingResult, PairingManifest } from './pairing.js';

// ── Judging, and the statistics that decide what a judgement is worth ────────
export { MockTraceJudge, LlmTraceJudge, TRACE_CRITERIA } from './judge.js';
export type { ITraceJudge, TraceJudgement, TraceCriterion, Side, MockTraceJudgeOptions } from './judge.js';
// `swapArmLabels` is NOT exported (S4). It maps handles to arms in one import,
// and the reviewer opened the whole blinding with it: `swapArmLabels(key)`
// returned a key with its own fresh seal, so `.unseal()` gave up all twelve
// arms and `.disclose()` gave up the run secret while the original went on
// reporting `unsealed === false`. It lives on in `aggregate.ts` as the
// label-swap control, over a DERIVED key that shares the parent's seal and can
// never disclose, and the tests that need it import it from there.
export { judgeTraces } from './aggregate.js';
export type {
  JudgeAggregate,
  PairOutcome,
  CriterionTally,
  PositionCheck,
  AggregateOptions,
  ExploratoryGate,
} from './aggregate.js';

// ── The run's own attestation, bound to the run ──────────────────────────────
export { ATTESTATION_THRESHOLDS, attestRun, verifyAttestation, thinkOutcomeBreaches, watchThinkOutcomes, reportOf } from './attest.js';
export type { RunAttestation, AttestationBinding, AttestationCheck, AttestationClaim, ThinkOutcomeReport } from './attest.js';

// ── The unit of analysis: the run, not the pair ──────────────────────────────
export { CLUSTER_RHO_GRID, betweenRunIcc, clusterJudgeGate, clustersOf, sweepP } from './cluster.js';
export type { ClusterGate, SeedCluster } from './cluster.js';

// ── The pilot: estimation, never confirmation ────────────────────────────────
export { PILOT_RECIPE, allowanceFor, designConfirmatory, dryRunPilot, estimatePilot, runPilotEstimation } from './pilot.js';
export type {
  ConfirmatoryDesign,
  ConfirmatoryTargets,
  Estimate,
  PilotArtefact,
  PilotCallBlock,
  PilotCallTable,
  PilotEstimates,
  PilotRecipe,
} from './pilot.js';

export {
  wilsonInterval,
  exactBinomialTwoSided,
  formatP,
  pairedBootstrap,
  signFlipPermutation,
  signTest,
  minimumPairedSeeds,
  MIN_PAIRED_SEEDS,
  DECLARED_CONTRAST_FAMILY,
  minimumDetectableEffect,
  minimumDetectableWins,
  pairsForSweep,
  multipleComparisonNote,
  holmAdjusted,
  normalQuantile,
  studentTQuantile,
  JUDGE_GATE,
  JUDGE_GATE_HASH,
  hashJudgeGate,
  judgeGateOverrides,
  judgeGatePower,
  judgeGateDesign,
  pairsForJudgePower,
} from './stats.js';
export type {
  Interval,
  PairedSample,
  PairedResult,
  PermutationTest,
  SignTest,
  BootstrapOptions,
  DesignPower,
  JudgeDesignPower,
  JudgeGateRule,
  JudgeGateConditions,
  JudgeGateObserved,
  JudgeGatePower,
  JudgeGateDesign,
  MultipleComparisonNote,
} from './stats.js';

// ── The ignorance probe ──────────────────────────────────────────────────────
export { DISAVOWALS, DISAVOWAL_PATTERNS, admitsIgnorance, disavowalIn, assertsAbsence, normaliseSpeech } from './disavowal.js';
export { runIgnoranceProbe, echoStems, withoutEcho, citesOthers } from './ignorance.js';
export type { IgnoranceOptions, IgnoranceReport, ProbeAnswer, ProbeSubject } from './ignorance.js';
export { FORAGER_PROBES, splitProbes } from './probes/forager.js';
export type { IgnoranceProbe, ControlGround, ControlSlice } from './probes/forager.js';

// ── The shared interview frame ───────────────────────────────────────────────
export { INTERVIEW_INSTRUCTION, QUESTION_PREFIX, YGGDRASIL_CLOSING, isInterview, questionIn, askOver } from './interview.js';

// ── Scripted minds and adversaries: the instrument's own controls ────────────
export { FaithfulMockBackend, OmniscientMockBackend } from './mocks.js';
export {
  ADVERSARIAL_PROFILES,
  HONEST_STRATEGIES,
  LEAKING_STRATEGIES,
  TIER2_BLIND_STRATEGIES,
  adversarialInterviewees,
  scriptedInterviewee,
} from './probeMocks.js';
export type { AdversarialProfile } from './probeMocks.js';

export type {
  ArmId,
  ArmFamily,
  AbMode,
  IInterviewee,
  InterviewRequest,
  TraceMoment,
  MomentOutcome,
  RawBeingTrace,
  BlindTrace,
  TraceKey,
  TraceFeatures,
  SentPrompt,
} from './types.js';
