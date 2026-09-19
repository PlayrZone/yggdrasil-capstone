import type { ThinkInput } from '../contract/types.js';
import type { ThinkPrompt } from '../consciousness/prompt.js';

/**
 * THE VOCABULARY OF THE INSTRUMENT (W1-E).
 *
 * Two arms, one world, one seed. Arm A is the Yggdrasil mind; arm B is a plain
 * frontier-LLM role-play agent in the SAME body, reached through the same
 * transport and holding the same action vocabulary. Everything below is written
 * so that a reader of a trace, a judge, or a metric table cannot tell which is
 * which from anything but the behaviour.
 */

/**
 * THE FOUR ARMS. Round 1 had two, and the difference between them was the
 * architecture AND one sentence of prompt at the same time, so no result could
 * tell those two things apart (`epistemic.ts` has the full argument).
 *
 *   A    Yggdrasil mind, epistemic instruction present
 *   A−   Yggdrasil mind, epistemic instruction REMOVED
 *   B    plain LLM agent, no instruction
 *   B+   plain LLM agent, the SAME instruction added
 */
export type ArmId = 'A' | 'A-' | 'B' | 'B+';

/** Which family an arm belongs to — what its mind IS, apart from the prompt. */
export type ArmFamily = 'yggdrasil' | 'baseline';

/** Whole-population arms, or matched beings inside one run. */
export type AbMode = 'population' | 'mixed';

/**
 * Someone who can be interviewed in its own voice, outside the causal flow of
 * the simulation.
 *
 * It exists because arm B's mind does NOT reason over the prompt `LlmMind`
 * composes — the baseline agent builds its own from its own window — so an
 * interviewer that appended a question to a Yggdrasil prompt would be
 * interviewing arm A's epistemics with arm B's model. A subject supplies the
 * one thing an interview needs: turn this situation plus this question into an
 * answer the way THIS mind would.
 */
export interface IInterviewee {
  readonly id: string;
  interview(request: InterviewRequest): Promise<string>;
}

export interface InterviewRequest {
  /** The being's situation, exactly as its mind would be given it. */
  input: ThinkInput;
  /** One question, in the interviewer's words. */
  question: string;
}

/** What one moment of a life looked like, with nothing in it that names an arm. */
export interface TraceMoment {
  /** Ticks since this trace began. Absolute ticks would pair a trace to its run. */
  t: number;
  /** Day of the run, as the world counts days. */
  day: number;
  night: boolean;
  season: string;
  /** Pressure per drive, in the world's declared order. */
  felt: { drive: string; pressure: number }[];
  /** What it could see, counted by kind. */
  perceived: { kind: string; count: number }[];
  /** How many other beings were within its senses. */
  others: number;
  /** What it carried. */
  carried: { kind: string; count: number }[];
  /** Its own words. Empty when it thought nothing aloud. */
  thought: string;
  /** What it decided to do, rendered as verb + arguments. */
  did: string[];
  /** What it said. `to` is a per-trace ordinal, never a run-wide being id. */
  said: { act: string; to: number | null; text: string }[];
  /** What the world did with the decision. Null while the act was still open. */
  happened: MomentOutcome | null;
}

export interface MomentOutcome {
  steps: { act: string; executed: boolean; rejected: boolean; reason?: string }[];
  /** Change in pressure over the act's window; negative is relief. */
  reliefs: { drive: string; delta: number }[];
  healthDelta: number;
  alive: boolean;
}

/** One being's life as the instrument recorded it, BEFORE blinding. */
export interface RawBeingTrace {
  runId: string;
  arm: ArmId;
  beingId: number;
  moments: TraceMoment[];
}

/** The same life with every arm-identifying artefact removed. */
export interface BlindTrace {
  /** An opaque handle. Derived from a seeded counter, never from the arm. */
  traceId: string;
  /** The neutral plain-text timeline a judge reads. */
  text: string;
  /** Arm-free measurements a rule-based judge can score. */
  features: TraceFeatures;
  /** Moment count, so a caller can drop traces too short to judge. */
  moments: number;
}

/** Which blind handle was which arm. Held by the aggregator; never by a judge. */
export interface TraceKey {
  traceId: string;
  arm: ArmId;
  beingId: number;
  runId: string;
}

/**
 * What a trace shows, as numbers. Computed from the neutral moments only — no
 * prompt, no model id, no knowledge store — so the same function produces them
 * for either arm and a judge scoring them is scoring behaviour.
 */
export interface TraceFeatures {
  moments: number;
  /** Mean number of consecutive moments a decision's shape survived. */
  goalPersistence: number;
  /** Share of moments whose words refer to something earlier in this trace. */
  pastReference: number;
  /** Share of moments where what it did changed after a rejection or a new sight. */
  reactivity: number;
  /** Share of moments in which it addressed someone who was actually present. */
  socialCoherence: number;
  /** Distinct decision shapes over the life. */
  distinctActs: number;
  /** Shannon entropy of decision shapes, in bits. */
  actEntropy: number;
  /** Share of plan steps the body executed. */
  planSuccessRate: number;
  /** Assertions reaching past anything this trace shows it was given. */
  unsupportedClaims: number;
  /** Times it said, in some form, that it did not know. */
  ignoranceAdmissions: number;
}

/** The prompt a backend actually SENT, kept by the arm that composed it. */
export interface SentPrompt {
  beingId: number;
  tick: number;
  prompt: ThinkPrompt;
}
