/**
 * W1-E — THE INSTRUMENT that decides whether a being is more ALIVE than a plain
 * LLM agent. Read `eval/README.md` first: it says what each piece measures, the
 * blinding rules, how to run a mock A/B, and the capped recipe for the first
 * paid pilot.
 *
 * Nothing in here writes to a world, and nothing in here is read by one. It is
 * instrument, in the sense `ARCHITECTURE.md` §2 means: it reads everything and
 * is read by nothing in L1–L7.
 */

export { DEFAULT_CALL_BUDGET, CallBudget, MemoryBudgetStore, BudgetExhaustedError, PaidCallRefused, accessBackend, accessLeakJudge, isDeclaredFree } from './budget.js';
export type { BudgetSpec, BudgetState, SpendLogEntry, IBudgetStore, BackendAccess, JudgeAccess, FreeBackend, UsageReporting } from './budget.js';

export { runAb } from './ab.js';
export type { AbSpec, AbBackends, AbResult } from './ab.js';

export { BaselineAgentBackend, ArmRouterBackend } from './baseline/BaselineAgentBackend.js';
export type { BaselineAgentOptions } from './baseline/BaselineAgentBackend.js';
export { BaselineMemory } from './baseline/memory.js';
export type { BaselineMemoryOptions } from './baseline/memory.js';
export { buildBaselinePrompt, buildBaselineInterviewPrompt, DEFAULT_PERSONA, BASELINE_CLOSING } from './baseline/prompt.js';
export type { BaselinePersona } from './baseline/prompt.js';

export { computeArmMetrics, pairMetrics, ANSWER_WINDOW_TICKS } from './metrics.js';
export type { ArmMetrics, ArmObservation, PairedDiff } from './metrics.js';

export { buildTraces, blindTraces, renderTrace, traceFeatures } from './trace.js';
export type { TraceSource, BlindOptions } from './trace.js';

export { DISAVOWALS, admitsIgnorance, normaliseSpeech } from './disavowal.js';

export { runIgnoranceProbe } from './ignorance.js';
export type { IgnoranceOptions, IgnoranceReport, ProbeAnswer, ProbeSubject } from './ignorance.js';
export { FORAGER_PROBES, splitProbes } from './probes/forager.js';
export type { IgnoranceProbe } from './probes/forager.js';

export { MockTraceJudge, LlmTraceJudge, pairTraces, TRACE_CRITERIA } from './judge.js';
export type { ITraceJudge, TracePair, TraceJudgement, TraceCriterion, Side, MockTraceJudgeOptions } from './judge.js';
export { judgeTraces, wilsonInterval, swapArmLabels } from './aggregate.js';
export type { JudgeAggregate, JudgedPair, CriterionTally, PositionCheck, AggregateOptions } from './aggregate.js';

export { INTERVIEW_INSTRUCTION, QUESTION_PREFIX, isInterview, questionIn, askOver, yggdrasilInterviewee } from './interview.js';

export { FaithfulMockBackend, OmniscientMockBackend } from './mocks.js';

export type {
  ArmId,
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
