import type { IMindBackend } from '../consciousness/IMindBackend.js';
import type { ProvenanceLevel } from '../learning/ILearner.js';
import type { ICognitionSink } from '../record/types.js';

/**
 * The one world this engine generates. A record carries it so a held-out-world
 * transfer score has something to split on the day a second adapter exists.
 */
export const FORAGER_CONTINENT = 'forager-continent-v1';

/** Default bound on an outcome window — a plan that neither finishes nor is
 *  replaced within this many ticks is scored on what it did get done. */
export const DEFAULT_OUTCOME_WINDOW = 400;

export interface ExperimentOptions {
  seed: string;
  agentCount?: number;
  mindBackend?: IMindBackend;
  /** A/B control for Cycle 10: when false, held stories don't steer movement. Default true. */
  mythBehavior?: boolean;
  /** A/B control for Cycle 13: when false, respect doesn't grow from witnessed
   * competence, so no prestige hierarchy can form. Default true. */
  leadership?: boolean;
  /** Phase 2 Exp 10: when false, the consciousness prompt does NOT offer "try
   * making" — so a seeded culture, not an engine incentive, must steer making.
   * Default true. */
  offerMaking?: boolean;
  /** Phase 3 Exp 1: when true, a being can LEARN a craft-recipe by watching it
   * done enough times (the apprenticeship channel). Off (default) = a seeded
   * maker still crafts, but the skill cannot spread by observation — the A/B
   * control isolating whether technological inheritance happens. */
  craftLearning?: boolean;
  /** Wall-clock source for cognition latency, supplied by the host. Purely
   * observational — nothing in the sim reads it, so it cannot affect
   * determinism. Tests inject a fake; omitted = the real clock. */
  now?: () => number;
  /**
   * How much evidence each belief keeps about itself — an INSTRUMENT, read by
   * nothing in the simulation, so its cost is the host's to choose. 'off' for
   * bulk and scale runs, 'full' for observatory deep-dives, 'compact' (the
   * default) in between. Total heap at 150 agents / day 16, against the
   * 97.1 MB of the commit before provenance existed: off 98.5, compact 114.5,
   * full 123.5 — see `ProvenanceLevel`. Every level simulates identically;
   * `test/provenance.test.ts` fingerprints one golden config at all three.
   */
  provenance?: ProvenanceLevel;
  /** Where the lossless cognition record goes. Absent = nothing is recorded,
   * and no recording code runs at all. */
  recording?: RecordingOptions;
}

export interface RecordingOptions {
  sink: ICognitionSink;
  /** Stable id for this run; every record and outcome carries it. */
  runId: string;
  /** The experiment this run belongs to (the old corpus's `experiment` tag). */
  scenarioId?: string;
  worldId?: string;
  outcomeWindowTicks?: number;
  /** Wall clock for the run manifest. Tests inject a fake. */
  nowMs?: () => number;
  /** Called once with the first sink error; the corpus is incomplete from there. */
  onFailure?: (error: string) => void;
}

/**
 * The A/B switches and instrumentation level a run was started with. The
 * runtime hands these to every mind it creates and to the recorder's manifest;
 * they are settings, never state.
 */
export interface RunFlags {
  /** Cycle 10 A/B: do held stories steer movement? (pilgrimage + tragedy-avoidance) */
  readonly mythBehavior: boolean;
  /** Cycle 13 A/B: does respect grow from witnessed competence? (prestige) */
  readonly leadership: boolean;
  /** Exp 10: does the prompt offer "try making"? When false, only culture can steer it. */
  readonly offerMaking: boolean;
  /** Phase 3 Exp 1 A/B: can a craft-recipe be learned by watching it done? */
  readonly craftLearning: boolean;
  /** Instrumentation level for belief evidence — see ExperimentOptions. */
  readonly provenance: ProvenanceLevel;
}

export function runFlagsFrom(options: ExperimentOptions): RunFlags {
  return {
    mythBehavior: options.mythBehavior ?? true,
    leadership: options.leadership ?? true,
    offerMaking: options.offerMaking ?? true,
    craftLearning: options.craftLearning ?? false,
    provenance: options.provenance ?? 'compact',
  };
}
