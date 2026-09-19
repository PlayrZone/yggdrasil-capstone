import type { WorldAdapter } from '../contract/adapter.js';
import type { ThinkInput } from '../contract/types.js';
import type { IMindBackend } from '../consciousness/IMindBackend.js';
import type { ThinkPrompt } from '../consciousness/prompt.js';
import type { ProvenanceLevel } from '../learning/ILearner.js';
import type { CognitionOutcome, CognitionRecordV2, ICognitionSink, RunManifest, RunSummary } from '../record/types.js';
import { Experiment } from '../runner/Experiment.js';
import type { ScenarioId } from '../runner/options.js';
import { foragerAdapter } from '../worlds/forager/adapter.js';
import { buildArm, contrastsFor } from './arms.js';
import type { ArmSpec, BuiltArm } from './arms.js';
import { ArmRouterBackend } from './baseline/BaselineAgentBackend.js';
import { BudgetExhaustedError, RunHalt } from './budget.js';
import type { CallBudget } from './budget.js';
import { describeBackendSpec, isPaidSpec } from './door.js';
import { computeArmMetrics, metricValues } from './metrics.js';
import type { ArmMetrics, ArmObservation } from './metrics.js';
import type { ProbeSubject } from './ignorance.js';
import { minimumDetectableEffect, multipleComparisonNote, pairedBootstrap } from './stats.js';
import type { DesignPower, MultipleComparisonNote, PairedResult, PairedSample } from './stats.js';
import { blindTraces, buildTraces } from './trace.js';
import type { BlindingManifest, SealedTraceKey } from './trace.js';
import type { AbMode, ArmId, BlindTrace, RawBeingTrace, SentPrompt } from './types.js';

/**
 * THE A/B RUNNER.
 *
 * Same scenario, same seed, same population, same body; the arms differ in mind
 * and in whether their prompt carries the epistemic instruction (`arms.ts`).
 * Two modes:
 *
 *   POPULATION — one run per arm per seed. Clean, and the whole society differs,
 *     so second-order effects (who teaches whom) are in it.
 *   MIXED — ONE run per seed, the cohort split, the backend routing on the
 *     being's id. Matched beings then share a world, a tick, a winter and a set
 *     of neighbours, and differ only in mind.
 *
 * TWO THINGS ROUND 1 GOT WRONG ABOUT WHAT COMES OUT OF IT.
 *
 *   IT RAN ONE SEED AND CALLED THE RESULT PAIRED. `AbSpec.seed` was a single
 *   string and the "paired" table was a subtraction of two pooled scalars. A
 *   paired difference needs one difference PER SEED, so the spec takes `seeds`
 *   and the runner loops; with one seed the result says n = 1 and ships no
 *   interval, which is the honest answer.
 *
 *   IT FINISHED RUNS THAT HAD RUN OUT OF MONEY. `LlmMind` catches everything a
 *   backend throws and carries the being on the world's reflex policy, so a cap
 *   of 3 produced a FULL metric table over a population that had stopped
 *   thinking after three calls. The guarded backend latches a `RunHalt` one line
 *   before it throws; the slice loop checks it; and a halted run returns
 *   `{usable: false, reason: 'budget-exhausted'}` with NO verdict fields on the
 *   object at all — not a flag beside a metric table, which somebody would read
 *   anyway.
 */

/** One question this run was designed to answer, declared BEFORE it ran. */
export interface PreRegisteredQuestion {
  /** The question in words. */
  question: string;
  /** The ONE metric that answers it. Everything else in the table is exploratory. */
  primaryMetric: string;
  /** Which two arms it contrasts. */
  contrast: [ArmId, ArmId];
  /** Which sign of the difference would support the hypothesis. */
  direction: 'higher' | 'lower';
}

export interface AbSpec {
  /**
   * The seeds. A paired difference is per seed, so this is the n of every
   * interval in the result. One seed is legal and reports n = 1.
   */
  seeds: readonly string[];
  /** Ticks to run. Kept small enough that a mock A/B is a unit test. */
  ticks: number;
  /** How many beings get a slow mind. The first N ids, in every arm. */
  cohortSize: number;
  agentCount?: number;
  scenario?: ScenarioId;
  /** Ticks per `advance` slice — the scheduler's promises land between slices. Default 10. */
  chunk?: number;
  provenance?: ProvenanceLevel;
  outcomeWindowTicks?: number;
  /** The world every arm is held to. Default the forager continent. */
  world?: WorldAdapter;
  /** Traces shorter than this are dropped before blinding. Default 2. */
  minTraceMoments?: number;
  /** Prefix for run ids, so two A/B runs in one process do not collide. */
  runIdPrefix?: string;
  /** The PUBLIC label of the blinding. Default: the seeds, joined. It keys nothing. */
  blindSeed?: string;
  /**
   * The secret the blinding permutation is drawn from. Omitted in a real run,
   * where it is drawn from the host's CSPRNG, held inside the sealed key and
   * published only as a hash. TESTS pass it, because they need the handles to
   * be reproducible and are entitled to know the answer.
   *
   * *Round 2 keyed the permutation on `blindSeed` and printed it in the
   * manifest, so anyone holding the result recovered every arm by re-running
   * `blindTraces`.*
   */
  blindSecret?: string;
  /** Declared before the run and echoed verbatim in the result. */
  preRegistered?: readonly PreRegisteredQuestion[];
}

export interface AbConfig {
  /** Two or more arms. `arms.ts` says what each id means. */
  arms: readonly ArmSpec[];
  /** Required by every paid arm. The door refuses without it. */
  budget?: CallBudget;
  /** The provider key, from the host. The engine reads no environment of its own. */
  apiKey?: string;
}

/** One named contrast between two arms, over every metric, across every seed. */
export interface ContrastResult {
  label: string;
  /** What this contrast holds constant and what it varies. */
  isolates: string;
  pair: [ArmId, ArmId];
  /** The pre-registered row, when this contrast has one. */
  primary: PairedResult | null;
  /** Every other row. Hypothesis-generating; not a finding. */
  exploratory: PairedResult[];
  multipleComparisons: MultipleComparisonNote;
  /** What this many seeds could ever have detected. */
  design: DesignPower;
}

export interface RunIntegrity {
  /** Every backend error the run saw. Surfaced, never folded into behaviour. */
  backendErrors: readonly { at: string; message: string }[];
  /** Share of thinks that fell back to the world's reflex policy, per arm. */
  fallbackRateByArm: Record<string, number>;
  /** True when any arm fell back at all: those moments are policy, not mind. */
  degraded: boolean;
  note: string;
}

export interface AbManifest {
  mode: AbMode;
  seeds: readonly string[];
  ticks: number;
  cohortSize: number;
  agentCount: number;
  world: string;
  arms: { id: ArmId; family: string; epistemicInstruction: boolean; backend: string; paid: boolean }[];
  blinding: BlindingManifest;
  /** The ceiling in force and whether a human file raised it. */
  ceiling: { limit: number; source: string; path?: string; note?: string } | null;
  budget: { id: string; limit: number; spentBefore: number; spentAfter: number } | null;
  preRegistered: readonly PreRegisteredQuestion[];
}

/** A run that cannot answer anything, and says so instead of printing numbers. */
export interface AbUnusable {
  usable: false;
  reason: 'budget-exhausted';
  detail: string;
  mode: AbMode;
  seeds: readonly string[];
  manifest: AbManifest;
  integrity: RunIntegrity;
}

export interface AbVerdict {
  usable: true;
  mode: AbMode;
  seeds: readonly string[];
  ticks: number;
  arms: readonly ArmId[];
  /** Per seed, per arm. The raw material every interval below is computed from. */
  perSeed: { seed: string; metrics: Partial<Record<ArmId, ArmMetrics>> }[];
  contrasts: ContrastResult[];
  /** Every arm's traces, blinded together under one permutation. */
  traces: BlindTrace[];
  /** Which handle was which arm. Sealed; the judging path never reads it. */
  key: SealedTraceKey;
  /**
   * Interview subjects per arm. Split, not pooled: in population mode the arms
   * hold the SAME being ids (same seed, same founders), so a caller filtering a
   * pooled list by id would silently interview several arms at once.
   */
  subjects: Partial<Record<ArmId, ProbeSubject[]>>;
  /** What the prompt-composing arms actually sent. Arm-private, never traced. */
  sentPrompts: Partial<Record<ArmId, readonly SentPrompt[]>>;
  manifest: AbManifest;
  integrity: RunIntegrity;
}

export type AbResult = AbVerdict | AbUnusable;

/** Everything one arm produced in one seed, before blinding. */
interface ArmRun {
  arm: ArmId;
  observation: ArmObservation;
  traces: RawBeingTrace[];
  subjects: ProbeSubject[];
}

export async function runAb(spec: AbSpec, config: AbConfig, mode: AbMode = 'population'): Promise<AbResult> {
  const world = spec.world ?? foragerAdapter;
  const prefix = spec.runIdPrefix ?? 'ab';
  const seeds = spec.seeds;
  if (seeds.length === 0) throw new Error('an A/B run needs at least one seed');
  if (config.arms.length < 2) throw new Error('an A/B run needs at least two arms');
  if (mode === 'mixed' && config.arms.length !== 2) throw new Error('mixed mode splits one cohort, so it takes exactly two arms');

  const halt = new RunHalt();
  const spentBefore = config.budget?.spent ?? 0;
  // ONE set of arm objects for the whole run: the baseline agents keep per-being
  // memories, and rebuilding them per seed would hand every seed an amnesiac.
  // Memories are keyed by being id, which repeats across seeds, so each seed
  // gets its own arms instead — see `armsForSeed`.
  const armIds = config.arms.map((a) => a.id);

  const perSeed: { seed: string; metrics: Partial<Record<ArmId, ArmMetrics>> }[] = [];
  const rawTraces: RawBeingTrace[] = [];
  const subjects: Partial<Record<ArmId, ProbeSubject[]>> = {};
  const sentPrompts: Partial<Record<ArmId, SentPrompt[]>> = {};
  const fallbackByArm = new Map<ArmId, { fell: number; thinks: number }>();

  let built: BuiltArm[] = [];
  for (const seed of seeds) {
    built = config.arms.map((armSpec) => buildArm(armSpec, { world, budget: config.budget, apiKey: config.apiKey, halt }));
    const runs =
      mode === 'population'
        ? await runPopulation(spec, world, prefix, seed, built, halt)
        : await runMixed(spec, world, prefix, seed, built, halt);
    if (halt.stopped) break;

    const metrics: Partial<Record<ArmId, ArmMetrics>> = {};
    for (const run of runs) {
      const computed = computeArmMetrics(run.observation, world);
      metrics[run.arm] = computed;
      rawTraces.push(...run.traces);
      (subjects[run.arm] ??= []).push(...run.subjects);
      const tally = fallbackByArm.get(run.arm) ?? { fell: 0, thinks: 0 };
      tally.fell += computed.fallbackRate * computed.thinks;
      tally.thinks += computed.thinks;
      fallbackByArm.set(run.arm, tally);
    }
    for (const arm of built) {
      const sent = arm.sentPrompts();
      if (sent.length > 0) (sentPrompts[arm.id] ??= []).push(...sent);
    }
    perSeed.push({ seed, metrics });
  }

  const blindSeed = spec.blindSeed ?? seeds.join('+');
  const blinded = blindTraces(rawTraces, world, {
    seed: blindSeed,
    ...(spec.blindSecret !== undefined ? { secret: spec.blindSecret } : {}),
    minMoments: spec.minTraceMoments ?? 2,
  });
  const manifest = buildManifest(spec, config, mode, world, blinded.manifest, spentBefore);
  const integrity = integrityOf(halt, fallbackByArm);

  if (halt.stopped) {
    // NO verdict fields. A flag next to a metric table is a table somebody
    // quotes; an object with no table is not.
    return {
      usable: false,
      reason: 'budget-exhausted',
      detail: halt.detail,
      mode,
      seeds,
      manifest,
      integrity,
    };
  }

  return {
    usable: true,
    mode,
    seeds,
    ticks: spec.ticks,
    arms: armIds,
    perSeed,
    contrasts: contrastsOf(armIds, perSeed, spec),
    traces: blinded.traces,
    key: blinded.key,
    subjects,
    sentPrompts,
    manifest,
    integrity,
  };
}

// ─── Contrasts and their statistics ──────────────────────────────────────────

function contrastsOf(
  armIds: readonly ArmId[],
  perSeed: { seed: string; metrics: Partial<Record<ArmId, ArmMetrics>> }[],
  spec: AbSpec,
): ContrastResult[] {
  const preRegistered = spec.preRegistered ?? [];
  return contrastsFor(armIds).map(({ label, isolates, pair }) => {
    const names = new Set<string>();
    for (const row of perSeed) {
      for (const arm of pair) {
        const m = row.metrics[arm];
        if (m) for (const v of metricValues(m)) names.add(v.metric);
      }
    }
    const declared = preRegistered.find((q) => q.contrast[0] === pair[0] && q.contrast[1] === pair[1]);
    const rows: PairedResult[] = [];
    for (const metric of [...names].sort()) {
      const samples: PairedSample[] = [];
      for (const row of perSeed) {
        const a = row.metrics[pair[0]];
        const b = row.metrics[pair[1]];
        if (!a || !b) continue;
        samples.push({ seed: row.seed, a: valueOf(a, metric), b: valueOf(b, metric) });
      }
      const result = pairedBootstrap(metric, samples, { seed: `${label}:${metric}` });
      const primary = declared?.primaryMetric === metric;
      rows.push({
        ...result,
        role: primary ? 'primary' : 'exploratory',
        ...(primary && declared ? { question: declared.question } : {}),
      });
    }
    const primary = rows.find((r) => r.role === 'primary') ?? null;
    const exploratory = rows.filter((r) => r.role === 'exploratory');
    return {
      label,
      isolates,
      pair,
      primary,
      exploratory,
      multipleComparisons: multipleComparisonNote(exploratory.length),
      design: minimumDetectableEffect(perSeed.length),
    };
  });
}

function valueOf(metrics: ArmMetrics, metric: string): number {
  return metricValues(metrics).find((v) => v.metric === metric)?.value ?? 0;
}

function integrityOf(halt: RunHalt, byArm: ReadonlyMap<ArmId, { fell: number; thinks: number }>): RunIntegrity {
  const fallbackRateByArm: Record<string, number> = {};
  let anyFallback = false;
  for (const [arm, tally] of byArm) {
    const rate = tally.thinks > 0 ? Math.round((tally.fell / tally.thinks) * 10000) / 10000 : 0;
    fallbackRateByArm[arm] = rate;
    if (rate > 0) anyFallback = true;
  }
  const notes: string[] = [];
  if (halt.backendErrors.length > 0) {
    notes.push(`${halt.backendErrors.length} backend errors, first: ${halt.backendErrors[0]?.message ?? ''}`);
  }
  if (anyFallback) {
    notes.push(
      'some thinks fell back to the world\'s reflex policy: those moments are the WORLD acting, not the arm\'s mind, ' +
        'and both arms share that policy, so a difference in fallback rate is a difference in how often each mind failed.',
    );
  }
  return {
    backendErrors: halt.backendErrors,
    fallbackRateByArm,
    degraded: anyFallback,
    note: notes.length > 0 ? notes.join(' ') : 'no backend errors, no fallbacks: every moment is the arm\'s own mind.',
  };
}

function buildManifest(
  spec: AbSpec,
  config: AbConfig,
  mode: AbMode,
  world: WorldAdapter,
  blinding: BlindingManifest,
  spentBefore: number,
): AbManifest {
  const budget = config.budget;
  return {
    mode,
    seeds: spec.seeds,
    ticks: spec.ticks,
    cohortSize: spec.cohortSize,
    agentCount: spec.agentCount ?? 24,
    world: `${world.id}@${world.version}`,
    arms: config.arms.map((a) => ({
      id: a.id,
      family: a.id === 'A' || a.id === 'A-' ? 'yggdrasil' : 'baseline',
      epistemicInstruction: a.id === 'A' || a.id === 'B+',
      backend: describeBackendSpec(a.backend),
      paid: isPaidSpec(a.backend),
    })),
    blinding,
    ceiling: budget ? { ...budget.ceiling } : null,
    budget: budget ? { id: budget.id, limit: budget.limit, spentBefore, spentAfter: budget.spent } : null,
    preRegistered: spec.preRegistered ?? [],
  };
}

// ─── The runs themselves ─────────────────────────────────────────────────────

async function runPopulation(
  spec: AbSpec,
  world: WorldAdapter,
  prefix: string,
  seed: string,
  arms: readonly BuiltArm[],
  halt: RunHalt,
): Promise<ArmRun[]> {
  const runs: ArmRun[] = [];
  for (const arm of arms) {
    if (halt.stopped) break;
    runs.push(await runOneArm(spec, world, `${prefix}-${seed}-${arm.id}`, seed, arm, halt));
  }
  return runs;
}

async function runOneArm(
  spec: AbSpec,
  world: WorldAdapter,
  runId: string,
  seed: string,
  arm: BuiltArm,
  halt: RunHalt,
): Promise<ArmRun> {
  const capture = new CapturingBackend(arm.mind);
  const sink = new CollectingSink();
  const exp = buildExperiment(spec, seed, runId, capture, sink);
  const cohort = exp.agentIds.slice(0, spec.cohortSize);
  for (const id of cohort) exp.makeConscious(id);
  const positions = new PositionLedger();
  positions.sample(exp, cohort);
  await advance(exp, spec, positions, cohort, halt);

  return {
    arm: arm.id,
    observation: observe(exp, spec, runId, seed, arm, cohort, sink, positions),
    traces: buildTraces({ runId, arm: arm.id, records: sink.records, outcomes: sink.outcomes, events: exp.eventLog }, world),
    subjects: subjectsFrom(cohort, capture, arm),
  };
}

/** Mixed cohort: one Experiment, two minds behind one backend. */
async function runMixed(
  spec: AbSpec,
  world: WorldAdapter,
  prefix: string,
  seed: string,
  arms: readonly BuiltArm[],
  halt: RunHalt,
): Promise<ArmRun[]> {
  const runId = `${prefix}-${seed}-mixed`;
  const sink = new CollectingSink();
  const [first, second] = [arms[0]!, arms[1]!];
  // Deferred: the split is by position in the cohort, and the cohort is only
  // known once the Experiment has spawned its founders — which needs a backend.
  let armOf: (beingId: number) => ArmId = () => first.id;
  const router = new ArmRouterBackend(
    (id) => (armOf(id) === first.id ? 'A' : 'B'),
    first.mind,
    second.mind,
  );
  const capture = new CapturingBackend(router);
  const exp = buildExperiment(spec, seed, runId, capture, sink);
  const cohort = exp.agentIds.slice(0, spec.cohortSize);
  const assignment = new Map<number, BuiltArm>(cohort.map((id, at) => [id, at % 2 === 0 ? first : second]));
  armOf = (id) => (assignment.get(id) ?? first).id;
  for (const id of cohort) exp.makeConscious(id);
  const positions = new PositionLedger();
  positions.sample(exp, cohort);
  await advance(exp, spec, positions, cohort, halt);

  const runs: ArmRun[] = [];
  for (const arm of arms) {
    const mine = cohort.filter((id) => assignment.get(id)?.id === arm.id);
    const records = sink.records.filter((r) => mine.includes(r.beingId));
    const outcomes = sink.outcomes.filter((o) => mine.includes(o.beingId));
    runs.push({
      arm: arm.id,
      observation: observe(exp, spec, runId, seed, arm, mine, { records, outcomes }, positions),
      traces: buildTraces({ runId, arm: arm.id, records, outcomes, events: exp.eventLog }, world),
      subjects: subjectsFrom(mine, capture, arm),
    });
  }
  return runs;
}

function buildExperiment(spec: AbSpec, seed: string, runId: string, backend: IMindBackend, sink: ICognitionSink): Experiment {
  return new Experiment({
    seed,
    agentCount: spec.agentCount ?? 24,
    ...(spec.scenario ? { scenario: spec.scenario } : {}),
    mindBackend: backend,
    ...(spec.provenance ? { provenance: spec.provenance } : {}),
    // A fixed clock: latency is wall time and would make a "deterministic"
    // result differ run to run in the one field nobody looks at.
    now: () => 0,
    recording: {
      sink,
      runId,
      scenarioId: 'w1e-ab',
      ...(spec.outcomeWindowTicks !== undefined ? { outcomeWindowTicks: spec.outcomeWindowTicks } : {}),
      nowMs: () => 0,
    },
  });
}

async function advance(
  exp: Experiment,
  spec: AbSpec,
  positions: PositionLedger,
  cohort: readonly number[],
  halt: RunHalt,
): Promise<void> {
  const chunk = spec.chunk ?? 10;
  for (let done = 0; done < spec.ticks; done += chunk) {
    // The cap is checked between slices as well as inside the door: a slice
    // that has already started will finish its in-flight thinks, and nothing
    // after it is allowed to look like behaviour.
    if (halt.stopped) return;
    exp.advance(Math.min(chunk, spec.ticks - done));
    // The scheduler resolves a think in a microtask; a synchronous advance
    // would never let one land, so a slow mind would never act at all.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    positions.sample(exp, cohort);
  }
  if (halt.stopped) return;
  try {
    await exp.settleCognition();
  } catch (err) {
    // An exhausted budget reaches here only if the scheduler re-throws; the
    // latch is already set, and swallowing anything else would be the exact
    // silence this item is closing.
    if (!(err instanceof BudgetExhaustedError)) throw err;
  }
  positions.sample(exp, cohort);
  exp.endRecording();
}

function observe(
  exp: Experiment,
  spec: AbSpec,
  runId: string,
  seed: string,
  arm: BuiltArm,
  cohort: readonly number[],
  sink: { records: readonly CognitionRecordV2[]; outcomes: readonly CognitionOutcome[] },
  positions: PositionLedger,
): ArmObservation {
  const deathsByCause = { ...exp.deathsByCause };
  return {
    arm: arm.id,
    seed: `${seed}:${runId}`,
    ticks: exp.tick,
    cohort: [...cohort],
    knowledgeReachesMind: arm.knowledgeReachesMind,
    population: {
      founders: spec.agentCount ?? 24,
      alive: exp.aliveCount(),
      births: exp.birthCount,
      deaths: Object.values(deathsByCause).reduce((sum, n) => sum + n, 0),
      deathsByCause,
    },
    knowledgeFormed: exp.totalKnowledge(),
    records: sink.records,
    outcomes: sink.outcomes,
    positions: positions.entries(),
  };
}

function subjectsFrom(cohort: readonly number[], capture: CapturingBackend, arm: BuiltArm): ProbeSubject[] {
  const subjects: ProbeSubject[] = [];
  for (const beingId of cohort) {
    const input = capture.lastInput(beingId);
    if (input) subjects.push({ beingId, input, interviewee: arm.interviewee });
  }
  return subjects;
}

/**
 * Keeps the LAST situation each being was handed, so a probe can interview it
 * without rebuilding one. Rebuilding would mean calling into the mind
 * (`AgentMind.buildThinkInput` runs the world gate and a retrieval) and then
 * re-deriving the culture the runner adds — both of which are inside the causal
 * flow the probe is supposed to stand outside of.
 */
class CapturingBackend implements IMindBackend {
  private readonly inputs = new Map<number, ThinkInput>();

  constructor(private readonly inner: IMindBackend) {}

  get modelId(): string {
    return this.inner.modelId;
  }

  complete(prompt: ThinkPrompt, input: ThinkInput): Promise<string> {
    this.inputs.set(input.snapshot.id, input);
    return this.inner.complete(prompt, input);
  }

  lastInput(beingId: number): ThinkInput | undefined {
    return this.inputs.get(beingId);
  }
}

/** Where each cohort being was first and last seen. */
class PositionLedger {
  private readonly seen = new Map<number, { firstX: number; firstY: number; lastX: number; lastY: number }>();

  sample(exp: Experiment, cohort: readonly number[]): void {
    const wanted = new Set(cohort);
    for (const info of exp.agentInfos()) {
      if (!wanted.has(info.id)) continue;
      const known = this.seen.get(info.id);
      if (known) {
        known.lastX = info.x;
        known.lastY = info.y;
      } else {
        this.seen.set(info.id, { firstX: info.x, firstY: info.y, lastX: info.x, lastY: info.y });
      }
    }
  }

  entries(): ReadonlyMap<number, { firstX: number; firstY: number; lastX: number; lastY: number }> {
    return this.seen;
  }
}

/** Keeps every row in memory. The A/B runner writes no files. */
class CollectingSink implements ICognitionSink {
  readonly records: CognitionRecordV2[] = [];
  readonly outcomes: CognitionOutcome[] = [];
  manifest: RunManifest | null = null;
  summary: RunSummary | null = null;

  openRun(manifest: RunManifest): void {
    this.manifest = manifest;
  }
  cognition(record: CognitionRecordV2): void {
    this.records.push(record);
  }
  outcome(outcome: CognitionOutcome): void {
    this.outcomes.push(outcome);
  }
  closeRun(summary: RunSummary): void {
    this.summary = summary;
  }
}
