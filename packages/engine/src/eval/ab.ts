import type { WorldAdapter } from '../contract/adapter.js';
import type { ThinkInput } from '../contract/types.js';
import type { IMindBackend } from '../consciousness/IMindBackend.js';
import type { ThinkPrompt } from '../consciousness/prompt.js';
import type { ProvenanceLevel } from '../learning/ILearner.js';
import type {
  CognitionOutcome,
  CognitionRecordV2,
  ICognitionSink,
  RunManifest,
  RunSummary,
} from '../record/types.js';
import { Experiment } from '../runner/Experiment.js';
import type { ScenarioId } from '../runner/options.js';
import { foragerAdapter } from '../worlds/forager/adapter.js';
import { ArmRouterBackend, BaselineAgentBackend } from './baseline/BaselineAgentBackend.js';
import type { BaselineAgentOptions } from './baseline/BaselineAgentBackend.js';
import { accessBackend } from './budget.js';
import type { BackendAccess } from './budget.js';
import { yggdrasilInterviewee } from './interview.js';
import { computeArmMetrics, pairMetrics } from './metrics.js';
import type { ArmMetrics, ArmObservation, PairedDiff } from './metrics.js';
import type { ProbeSubject } from './ignorance.js';
import { blindTraces, buildTraces } from './trace.js';
import type { ArmId, AbMode, BlindTrace, RawBeingTrace, SentPrompt, TraceKey } from './types.js';

/**
 * THE A/B RUNNER.
 *
 * Same scenario, same seed, same population, same body. Arm A's beings think
 * with the Yggdrasil mind; arm B's think with a plain LLM agent in the same
 * body (`baseline/BaselineAgentBackend.ts`). Two modes:
 *
 *   POPULATION — two runs of the same seed, one arm each. Clean, and the whole
 *     society differs, so second-order effects (who teaches whom) are in it.
 *   MIXED — ONE run, the cohort split, the backend routing on the being's id.
 *     Matched beings then share a world, a tick, a winter and a set of
 *     neighbours, and differ only in mind. No runner change was needed for it:
 *     `IMindBackend.complete` is handed the ThinkInput, and the ThinkInput says
 *     who is asking.
 *
 * Determinism: everything the host controls is pinned — the seed, the cohort
 * (the first N ids, which are the same ids in both arms of a seed), the slice
 * size, and a fixed clock so `latencyMs` is 0 rather than wall time. Given
 * deterministic backends the whole result is reproducible; given a model it is
 * as reproducible as the model.
 */

export interface AbSpec {
  seed: string;
  /** Ticks to run. Kept small enough that a mock A/B is a unit test. */
  ticks: number;
  /** How many beings get a slow mind. The first N ids, in both arms. */
  cohortSize: number;
  agentCount?: number;
  scenario?: ScenarioId;
  /** Ticks per `advance` slice — the scheduler's promises land between slices. Default 10. */
  chunk?: number;
  provenance?: ProvenanceLevel;
  outcomeWindowTicks?: number;
  /** The world the baseline agent is held to. Default the forager continent. */
  world?: WorldAdapter;
  /** Traces shorter than this are dropped before blinding. Default 2. */
  minTraceMoments?: number;
  /** Prefix for run ids, so two A/B runs in one process do not collide. */
  runIdPrefix?: string;
}

export interface AbBackends {
  /** Arm A's transport: what the Yggdrasil mind reasons through. */
  a: BackendAccess;
  /** Arm B's transport: what the plain agent reasons through. */
  b: BackendAccess;
  /** How ordinary the ordinary agent is. */
  baseline?: Omit<BaselineAgentOptions, 'world' | 'transport'>;
}

export interface AbResult {
  mode: AbMode;
  seed: string;
  ticks: number;
  metrics: { A: ArmMetrics; B: ArmMetrics };
  /** Seed-paired differences, a − b. */
  paired: PairedDiff[];
  traces: BlindTrace[];
  /** Which handle was which arm. The aggregator's; never a judge's. */
  key: TraceKey[];
  /**
   * Ready-made interview subjects, per arm. Split, not pooled: in population
   * mode both arms hold the SAME being ids (same seed, same founders), so a
   * caller filtering one pooled list by id would silently interview both.
   */
  subjects: { A: ProbeSubject[]; B: ProbeSubject[] };
  /** What arm B actually sent. Arm-private — see `BaselineAgentBackend`. */
  baselineSent: readonly SentPrompt[];
}

/** Everything one arm produced, before blinding. */
interface ArmRun {
  observation: ArmObservation;
  traces: RawBeingTrace[];
  subjects: ProbeSubject[];
}

export async function runAb(spec: AbSpec, backends: AbBackends, mode: AbMode = 'population'): Promise<AbResult> {
  const world = spec.world ?? foragerAdapter;
  const prefix = spec.runIdPrefix ?? 'ab';
  const armA = accessBackend(backends.a);
  const baseline = new BaselineAgentBackend({ ...(backends.baseline ?? {}), world, transport: backends.b });

  const runs: ArmRun[] =
    mode === 'population'
      ? [
          await runOneArm(spec, world, `${prefix}-A`, armA, 'A', true),
          await runOneArm(spec, world, `${prefix}-B`, baseline, 'B', false),
        ]
      : await runMixed(spec, world, `${prefix}-mixed`, armA, baseline);

  const byArm = new Map<ArmId, ArmRun>();
  for (const run of runs) byArm.set(run.observation.arm, run);
  const a = byArm.get('A');
  const b = byArm.get('B');
  if (!a || !b) throw new Error('an A/B run must produce both arms');

  const { traces, key } = blindTraces([...a.traces, ...b.traces], world, {
    minMoments: spec.minTraceMoments ?? 2,
  });

  const metricsA = computeArmMetrics(a.observation, world);
  const metricsB = computeArmMetrics(b.observation, world);
  return {
    mode,
    seed: spec.seed,
    ticks: spec.ticks,
    metrics: { A: metricsA, B: metricsB },
    paired: pairMetrics(metricsA, metricsB),
    traces,
    key,
    subjects: { A: a.subjects, B: b.subjects },
    baselineSent: baseline.sentPrompts(),
  };
}

/** One whole-population arm: its own Experiment, same seed as the other's. */
async function runOneArm(
  spec: AbSpec,
  world: WorldAdapter,
  runId: string,
  backend: IMindBackend,
  arm: ArmId,
  knowledgeReachesMind: boolean,
): Promise<ArmRun> {
  const capture = new CapturingBackend(backend);
  const sink = new CollectingSink();
  const exp = buildExperiment(spec, runId, capture, sink);
  const cohort = exp.agentIds.slice(0, spec.cohortSize);
  for (const id of cohort) exp.makeConscious(id);
  const positions = new PositionLedger();
  positions.sample(exp, cohort);
  await advance(exp, spec, positions, cohort);

  const observation = observe(exp, spec, runId, arm, cohort, sink, positions, knowledgeReachesMind);
  return {
    observation,
    traces: buildTraces({ runId, arm, records: sink.records, outcomes: sink.outcomes, events: exp.eventLog }, world),
    subjects: subjectsFrom(cohort, capture, interviewee(backend, world)),
  };
}

/** Mixed cohort: one Experiment, two minds behind one backend. */
async function runMixed(
  spec: AbSpec,
  world: WorldAdapter,
  runId: string,
  armA: IMindBackend,
  baseline: BaselineAgentBackend,
): Promise<ArmRun[]> {
  const sink = new CollectingSink();
  // Deferred: the split is by position in the cohort, and the cohort is only
  // known once the Experiment has spawned its founders — which needs a backend.
  let armOf: (beingId: number) => ArmId = () => 'A';
  const router = new ArmRouterBackend((id) => armOf(id), armA, baseline);
  const capture = new CapturingBackend(router);
  const exp = buildExperiment(spec, runId, capture, sink);
  const cohort = exp.agentIds.slice(0, spec.cohortSize);
  const arms = new Map<number, ArmId>(cohort.map((id, at) => [id, at % 2 === 0 ? 'A' : 'B']));
  armOf = (id) => arms.get(id) ?? 'A';
  for (const id of cohort) exp.makeConscious(id);
  const positions = new PositionLedger();
  positions.sample(exp, cohort);
  await advance(exp, spec, positions, cohort);

  const runs: ArmRun[] = [];
  for (const arm of ['A', 'B'] as const) {
    const mine = cohort.filter((id) => arms.get(id) === arm);
    const records = sink.records.filter((r) => mine.includes(r.beingId));
    const outcomes = sink.outcomes.filter((o) => mine.includes(o.beingId));
    runs.push({
      observation: observe(exp, spec, runId, arm, mine, { records, outcomes }, positions, arm === 'A'),
      traces: buildTraces({ runId, arm, records, outcomes, events: exp.eventLog }, world),
      subjects: subjectsFrom(mine, capture, arm === 'A' ? interviewee(armA, world) : baseline),
    });
  }
  return runs;
}

function buildExperiment(spec: AbSpec, runId: string, backend: IMindBackend, sink: ICognitionSink): Experiment {
  return new Experiment({
    seed: spec.seed,
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

async function advance(exp: Experiment, spec: AbSpec, positions: PositionLedger, cohort: readonly number[]): Promise<void> {
  const chunk = spec.chunk ?? 10;
  for (let done = 0; done < spec.ticks; done += chunk) {
    exp.advance(Math.min(chunk, spec.ticks - done));
    // The scheduler resolves a think in a microtask; a synchronous advance
    // would never let one land, so a slow mind would never act at all.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    positions.sample(exp, cohort);
  }
  await exp.settleCognition();
  positions.sample(exp, cohort);
  exp.endRecording();
}

function observe(
  exp: Experiment,
  spec: AbSpec,
  runId: string,
  arm: ArmId,
  cohort: readonly number[],
  sink: { records: readonly CognitionRecordV2[]; outcomes: readonly CognitionOutcome[] },
  positions: PositionLedger,
  knowledgeReachesMind: boolean,
): ArmObservation {
  const deathsByCause = { ...exp.deathsByCause };
  return {
    arm,
    seed: `${spec.seed}:${runId}`,
    ticks: exp.tick,
    cohort: [...cohort],
    knowledgeReachesMind,
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

function subjectsFrom(
  cohort: readonly number[],
  capture: CapturingBackend,
  interviewee: ProbeSubject['interviewee'],
): ProbeSubject[] {
  const subjects: ProbeSubject[] = [];
  for (const beingId of cohort) {
    const input = capture.lastInput(beingId);
    if (input) subjects.push({ beingId, input, interviewee });
  }
  return subjects;
}

/** A backend that can already answer an interview answers it itself. */
function interviewee(backend: IMindBackend, world: WorldAdapter): ProbeSubject['interviewee'] {
  const candidate = backend as Partial<ProbeSubject['interviewee']>;
  if (typeof candidate.interview === 'function' && typeof candidate.id === 'string') {
    return candidate as ProbeSubject['interviewee'];
  }
  // Already through `accessBackend` above, so no second budget is asked for.
  return yggdrasilInterviewee({ backend }, world);
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
