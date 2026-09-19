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
export { judgeTraces, swapArmLabels } from './aggregate.js';
export type {
  JudgeAggregate,
  PairOutcome,
  CriterionTally,
  PositionCheck,
  AggregateOptions,
  ExploratoryGate,
  RunAttestation,
} from './aggregate.js';
export {
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
  BootstrapOptions,
  DesignPower,
  JudgeDesignPower,
  JudgeGateRule,
  JudgeGateConditions,
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
