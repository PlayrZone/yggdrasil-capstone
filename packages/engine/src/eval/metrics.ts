import type { WorldAdapter } from '../contract/adapter.js';
import type { CognitionOutcome, CognitionRecordV2 } from '../record/types.js';
import { planShape } from '../training/corpus.js';
import type { ArmId } from './types.js';

/**
 * OBJECTIVE METRICS, SEED-PAIRED.
 *
 * Every number here is a fact about the world or about the record — never a
 * judgement, never a prose score. They are computed over the COHORT (the beings
 * whose mind differs between arms) plus the population context around them,
 * because a reflex neighbour behaves identically in both arms and would only
 * dilute the difference.
 *
 * The one metric that is not symmetric is knowledge: arm A's mind reads the
 * beliefs its miners form and arm B's does not, so the count is reported for
 * both with a flag saying whether it reached a mind at all. Printing it as a
 * head-to-head number would be the same kind of closed loop audit 01 §3 failed
 * the old results for.
 */

export interface ArmObservation {
  arm: ArmId;
  seed: string;
  ticks: number;
  /** The beings whose mind is this arm's. */
  cohort: readonly number[];
  /** True when this arm's mind actually reads the being's mined knowledge. */
  knowledgeReachesMind: boolean;
  population: {
    founders: number;
    alive: number;
    births: number;
    deaths: number;
    deathsByCause: Readonly<Record<string, number>>;
  };
  knowledgeFormed: number;
  records: readonly CognitionRecordV2[];
  outcomes: readonly CognitionOutcome[];
  /** Where each cohort being was first and last seen, in world units. */
  positions: ReadonlyMap<number, { firstX: number; firstY: number; lastX: number; lastY: number }>;
}

export interface ArmMetrics {
  arm: ArmId;
  seed: string;
  ticks: number;
  cohortSize: number;
  thinks: number;
  /**
   * Cohort beings alive at the end, over cohort size — read from each being's
   * LAST closed outcome, which is the only place the record says whether it was
   * still alive. A being with no closed outcome at all counts as alive: it never
   * died in this run's record, and calling that a death would invent one.
   */
  cohortSurvival: number;
  population: ArmObservation['population'];
  survivalRate: number;
  knowledge: { formed: number; reachesMind: boolean };
  plans: { steps: number; executed: number; rejected: number; successRate: number };
  behaviour: { distinctShapes: number; shapeEntropy: number };
  dietBreadth: number;
  diet: string[];
  dispersal: { meanUnits: number; p90Units: number };
  speech: { spoken: number; requests: number; answered: number; answerRate: number };
  /** Outputs the parser refused, over thinks — a mind that cannot be read is not a mind. */
  unparsedRate: number;
  fallbackRate: number;
}

/** One comparable scalar out of an arm's metrics, named. */
export interface MetricValue {
  metric: string;
  value: number;
}

/** Ticks within which a reply counts as an answer to a request. */
export const ANSWER_WINDOW_TICKS = 400;

export function computeArmMetrics(observation: ArmObservation, world: WorldAdapter): ArmMetrics {
  const cohort = new Set(observation.cohort);
  const records = observation.records.filter((r) => cohort.has(r.beingId));
  const outcomes = observation.outcomes.filter((o) => cohort.has(o.beingId));

  let steps = 0;
  let executed = 0;
  let rejected = 0;
  const eaten = new Set<string>();
  for (const outcome of outcomes) {
    for (const intent of outcome.intents) {
      steps++;
      if (intent.executed) executed++;
      if (intent.rejected) rejected++;
      if (!intent.executed || intent.objectKind === undefined) continue;
      const action = world.actionById.get(intent.kind);
      const kind = world.kindById.get(intent.objectKind);
      // "Diet" is world-neutral by construction: a USE of something the world
      // tags edible. A town world's `BuyLunch` lands in exactly the same bucket.
      if (action?.core === 'Use' && kind?.tags.includes('edible')) eaten.add(intent.objectKind);
    }
  }

  const shapes = new Map<string, number>();
  for (const record of records) {
    const shape = planShape(record);
    shapes.set(shape, (shapes.get(shape) ?? 0) + 1);
  }

  const distances: number[] = [];
  for (const id of observation.cohort) {
    const p = observation.positions.get(id);
    if (p) distances.push(Math.hypot(p.lastX - p.firstX, p.lastY - p.firstY));
  }
  distances.sort((a, b) => a - b);

  const speech = speechMetrics(records);
  const unparsed = records.filter((r) => !r.parse.valid).length;
  const fellBack = records.filter((r) => r.parse.fellBackToReflex).length;
  const aliveCohort = observation.cohort.filter((id) => {
    const last = [...outcomes].reverse().find((o) => o.beingId === id);
    return last ? last.aliveAtEnd : true;
  }).length;

  return {
    arm: observation.arm,
    seed: observation.seed,
    ticks: observation.ticks,
    cohortSize: observation.cohort.length,
    thinks: records.length,
    cohortSurvival: rate(aliveCohort, observation.cohort.length),
    population: observation.population,
    survivalRate: rate(observation.population.alive, observation.population.founders + observation.population.births),
    knowledge: { formed: observation.knowledgeFormed, reachesMind: observation.knowledgeReachesMind },
    plans: { steps, executed, rejected, successRate: rate(executed, steps) },
    behaviour: { distinctShapes: shapes.size, shapeEntropy: entropy([...shapes.values()], records.length) },
    dietBreadth: eaten.size,
    diet: [...eaten].sort(),
    dispersal: { meanUnits: round(mean(distances)), p90Units: round(quantile(distances, 0.9)) },
    speech,
    unparsedRate: rate(unparsed, records.length),
    fallbackRate: rate(fellBack, records.length),
  };
}

/**
 * A request is ANSWERED when the being it was addressed to speaks back to the
 * asker within the window. Computed from the records alone — both parties'
 * decisions are in there — so it needs no second pass over the world and is the
 * same measurement in either arm.
 */
function speechMetrics(records: readonly CognitionRecordV2[]): ArmMetrics['speech'] {
  interface Said { tick: number; from: number; to: number | undefined; act: string }
  const said: Said[] = [];
  for (const record of records) {
    const decided = record.resolvedOutput ?? record.parsedOutput;
    for (const u of decided.utterances) {
      said.push({ tick: record.appliedTick ?? record.tick, from: record.beingId, to: u.targetId, act: u.speechAct });
    }
  }
  said.sort((a, b) => a.tick - b.tick || a.from - b.from);
  const requests = said.filter((s) => s.act === 'request' && s.to !== undefined);
  let answered = 0;
  for (const request of requests) {
    const reply = said.find(
      (s) => s.from === request.to && s.to === request.from && s.tick > request.tick && s.tick - request.tick <= ANSWER_WINDOW_TICKS,
    );
    if (reply) answered++;
  }
  return { spoken: said.length, requests: requests.length, answered, answerRate: rate(answered, requests.length) };
}

/**
 * One arm's comparable scalars, flat and named.
 *
 * It returns VALUES, not a difference. Round 1's `pairMetrics(a, b)` subtracted
 * two already-pooled numbers from ONE seed and called the result "seed-paired";
 * a paired difference is one difference PER SEED, so the subtraction belongs
 * where the seeds are known (`ab.ts` → `stats.pairedBootstrap`) and not here.
 *
 * Knowledge is deliberately absent: both arms' BODIES mine beliefs and only the
 * Yggdrasil arm's MIND is shown them, so a head-to-head number would be
 * measuring the body twice. It is reported per arm with its own flag instead.
 */
export function metricValues(m: ArmMetrics): MetricValue[] {
  const rows: MetricValue[] = [
    { metric: 'cohortSurvival', value: m.cohortSurvival },
    { metric: 'survivalRate', value: m.survivalRate },
    { metric: 'births', value: m.population.births },
    { metric: 'deaths', value: m.population.deaths },
    { metric: 'thinks', value: m.thinks },
    { metric: 'planSuccessRate', value: m.plans.successRate },
    { metric: 'planStepsRejected', value: m.plans.rejected },
    { metric: 'behaviourEntropy', value: m.behaviour.shapeEntropy },
    { metric: 'distinctPlanShapes', value: m.behaviour.distinctShapes },
    { metric: 'dietBreadth', value: m.dietBreadth },
    { metric: 'dispersalMean', value: m.dispersal.meanUnits },
    { metric: 'dispersalP90', value: m.dispersal.p90Units },
    { metric: 'speechAnswerRate', value: m.speech.answerRate },
    { metric: 'unparsedRate', value: m.unparsedRate },
    { metric: 'fallbackRate', value: m.fallbackRate },
  ];
  for (const [cause, n] of Object.entries(m.population.deathsByCause).sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
    rows.push({ metric: `deaths:${cause}`, value: n });
  }
  return rows;
}

function mean(values: readonly number[]): number {
  return values.length > 0 ? values.reduce((s, v) => s + v, 0) / values.length : 0;
}

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const at = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[at] ?? 0;
}

function entropy(counts: readonly number[], total: number): number {
  if (total <= 0) return 0;
  let h = 0;
  for (const c of counts) {
    const p = c / total;
    if (p > 0) h -= p * Math.log2(p);
  }
  return round(h);
}

function rate(n: number, d: number): number {
  return d > 0 ? round(n / d) : 0;
}

function round(v: number): number {
  return Math.round(v * 10000) / 10000;
}
