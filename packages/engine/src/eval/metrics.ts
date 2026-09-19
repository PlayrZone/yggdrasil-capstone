import { wireFieldsOf } from '../contract/actions.js';
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
  /** Did anything this arm decided actually HAPPEN? See `ArmIntegrity`. */
  integrity: ArmIntegrity;
}

/**
 * DID ANYTHING THE ARM DECIDED ACTUALLY HAPPEN.
 *
 * Round 3 had no channel for this at all. Across twelve traces of the run that
 * gates the whole pilot, the arms decided **104 Craft (104 refused), 52 Gather
 * (52 refused) and 52 Idle** — every non-Idle act in the run was refused by the
 * body — and `integrity` said `degraded: false`, `fallbackRateByArm {A:0,B:0}`,
 * *"every moment is the arm's own mind"*. It was: the minds were simply doing
 * nothing, and the headline `planSuccessRate` delta of 0.8769 was one arm idling
 * against the other being refused.
 *
 * Worse, the failure that would have INVERTED the proof was invisible for the
 * same reason. `ScriptedBackend` stringified its own `MindOutput`, so
 * `{"kind":"MoveTo","place":{…}}` parsed to `{"kind":"MoveTo"}` — the
 * destination silently dropped — and nothing noticed, because no arm ever
 * emitted a place. `parsedIntact` is the counter that would have: it compares
 * the ARGUMENTS in the raw model text against the arguments that survived the
 * parser, per act, and any loss is a wire-format break.
 */
export interface ArmIntegrity {
  /** Decisions this arm made — one per think that came back. */
  decisions: number;
  /** …of which carried a place on at least one act. 0 with a broken codec. */
  placeBearingDecisions: number;
  /** Decisions whose every raw argument survived the parser. */
  parsedIntact: number;
  parsedIntactRate: number;
  /** The first act whose arguments were lost, for a reader who wants the case. */
  firstArgumentLoss?: { act: string; lost: string[]; raw: string };
  /** Plan steps the body carried out. */
  accepted: number;
  /** Plan steps the body refused, with its own reason. */
  refused: number;
  refusalRate: number;
  /** The body's reasons, most frequent first — what the arm kept being told. */
  refusalsByReason: { reason: string; count: number }[];
  /** Decisions whose whole plan was a wait, or nothing at all. */
  idle: number;
  idleShare: number;
  /** Thinks that fell back to the world's reflex policy: those are not this mind. */
  llmFallbacks: number;
  fallbackRate: number;
}

/**
 * THE PRE-REGISTERED INTEGRITY THRESHOLDS. Declared here, once, with the
 * reasoning — the same discipline `JUDGE_GATE` is under, because a threshold
 * chosen after the counts are in is not a threshold.
 */
export const INTEGRITY_THRESHOLDS = Object.freeze({
  /**
   * Four acts in five refused means the arm is not operating in this world —
   * it is being told "no" and carrying on. Round 3's proof ran at 1.00.
   */
  maxRefusalRate: 0.8,
  /** Four decisions in five doing nothing is not behaviour to judge. Round 3's faithful arm: 1.00. */
  maxIdleShare: 0.8,
  /**
   * More than one think in twenty replaced by the world's reflex policy and the
   * arm is partly the world. Not zero: a single flaky transport error voiding a
   * 1,500-call block creates pressure to re-run until clean, which is a worse
   * failure than a stated 5% floor. The exact count always travels beside it.
   */
  maxFallbackRate: 0.05,
  /**
   * ANY argument lost between what the mind decided and what the parser read is
   * a broken wire format, and there is no acceptable rate of it.
   */
  minParsedIntactRate: 1,
});

/** Which pre-registered thresholds this arm crossed, in words. Empty is clean. */
export function integrityBreaches(arm: ArmId, integrity: ArmIntegrity): string[] {
  const out: string[] = [];
  if (integrity.decisions === 0) {
    out.push(`arm ${arm} made no decisions at all`);
    return out;
  }
  if (integrity.refusalRate > INTEGRITY_THRESHOLDS.maxRefusalRate) {
    out.push(
      `arm ${arm} had ${integrity.refused} of ${integrity.accepted + integrity.refused} plan steps REFUSED by the body ` +
        `(${integrity.refusalRate} > ${INTEGRITY_THRESHOLDS.maxRefusalRate})` +
        (integrity.refusalsByReason[0] ? `, mostly "${integrity.refusalsByReason[0].reason}"` : ''),
    );
  }
  if (integrity.idleShare > INTEGRITY_THRESHOLDS.maxIdleShare) {
    out.push(
      `arm ${arm} did nothing in ${integrity.idle} of ${integrity.decisions} decisions ` +
        `(idle share ${integrity.idleShare} > ${INTEGRITY_THRESHOLDS.maxIdleShare})`,
    );
  }
  if (integrity.fallbackRate > INTEGRITY_THRESHOLDS.maxFallbackRate) {
    out.push(
      `arm ${arm} fell back to the world's reflex policy on ${integrity.llmFallbacks} of ${integrity.decisions} thinks ` +
        `(${integrity.fallbackRate} > ${INTEGRITY_THRESHOLDS.maxFallbackRate}): those moments are the WORLD acting, not this mind`,
    );
  }
  if (integrity.parsedIntactRate < INTEGRITY_THRESHOLDS.minParsedIntactRate) {
    const loss = integrity.firstArgumentLoss;
    out.push(
      `arm ${arm} LOST ARGUMENTS between decision and parse in ${integrity.decisions - integrity.parsedIntact} of ` +
        `${integrity.decisions} decisions` +
        (loss ? `, first: ${loss.act} lost [${loss.lost.join(', ')}] from ${loss.raw}` : '') +
        ' — the wire format is broken and every act in this arm is suspect',
    );
  }
  return out;
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
  const refusalsByReason = new Map<string, number>();
  const eaten = new Set<string>();
  for (const outcome of outcomes) {
    for (const intent of outcome.intents) {
      steps++;
      if (intent.executed) executed++;
      if (intent.rejected) {
        rejected++;
        const reason = intent.rejectionReason ?? 'no reason given';
        refusalsByReason.set(reason, (refusalsByReason.get(reason) ?? 0) + 1);
      }
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
    integrity: armIntegrity(records, world, { executed, rejected, fellBack, refusalsByReason }),
  };
}

/**
 * The integrity counters, read from the RECORD rather than from the mock.
 *
 * `attempts[last].raw` is the bytes the model (or the thing standing in for
 * one) actually wrote; `parsedOutput` is what the parser made of them. Holding
 * the two against each other, per act, is the only way to see an argument go
 * missing — and an argument going missing is exactly how a mock stringifying
 * its own `MindOutput` deleted every destination in the run without any metric
 * moving.
 */
function armIntegrity(
  records: readonly CognitionRecordV2[],
  world: WorldAdapter,
  tally: { executed: number; rejected: number; fellBack: number; refusalsByReason: ReadonlyMap<string, number> },
): ArmIntegrity {
  const placeFields = placeWireFields(world);
  const waiting = new Set(world.actions.filter((a) => a.core === 'Wait').map((a) => a.id));
  let placeBearing = 0;
  let intact = 0;
  let idle = 0;
  let firstLoss: ArmIntegrity['firstArgumentLoss'] | undefined;

  for (const record of records) {
    const parsedPlan = record.parsedOutput.plan;
    if (parsedPlan.length === 0 || parsedPlan.every((step) => waiting.has(step.kind))) idle++;

    const rawPlan = rawPlanOf(record);
    if (rawPlan === null) {
      // Nothing readable came back, which `unparsedRate` already reports. It is
      // not an argument LOSS — there was no argument to lose.
      intact++;
      continue;
    }
    if (rawPlan.some((step) => placeFields.some((field) => field in step) || 'place' in step)) placeBearing++;

    let lostHere: { act: string; lost: string[]; raw: string } | null = null;
    for (let at = 0; at < rawPlan.length && lostHere === null; at++) {
      const raw = rawPlan[at]!;
      const parsed = (parsedPlan[at] ?? {}) as Record<string, unknown>;
      const lost = Object.keys(raw).filter((key) => raw[key] !== undefined && !(key in parsed));
      if (lost.length > 0) {
        lostHere = { act: String(raw['kind'] ?? '(no kind)'), lost, raw: JSON.stringify(raw).slice(0, 200) };
      }
    }
    if (lostHere === null) intact++;
    else firstLoss ??= lostHere;
  }

  const attempted = tally.executed + tally.rejected;
  return {
    decisions: records.length,
    placeBearingDecisions: placeBearing,
    parsedIntact: intact,
    parsedIntactRate: rate(intact, records.length),
    ...(firstLoss ? { firstArgumentLoss: firstLoss } : {}),
    accepted: tally.executed,
    refused: tally.rejected,
    refusalRate: rate(tally.rejected, attempted),
    refusalsByReason: [...tally.refusalsByReason]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count || (a.reason < b.reason ? -1 : 1)),
    idle,
    idleShare: rate(idle, records.length),
    llmFallbacks: tally.fellBack,
    fallbackRate: rate(tally.fellBack, records.length),
  };
}

/**
 * The plan as the MODEL wrote it, out of the last attempt's raw bytes. Null
 * when nothing JSON-shaped came back.
 */
function rawPlanOf(record: CognitionRecordV2): Record<string, unknown>[] | null {
  const raw = record.attempts[record.attempts.length - 1]?.raw ?? '';
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(raw.slice(start, end + 1));
    if (typeof parsed !== 'object' || parsed === null) return null;
    const plan = (parsed as Record<string, unknown>)['plan'];
    if (!Array.isArray(plan)) return null;
    return plan.filter((step): step is Record<string, unknown> => typeof step === 'object' && step !== null);
  } catch {
    return null;
  }
}

/**
 * The field names this world writes a place as, asked of the world's own
 * declarations. Nothing here opens a place: a `PlaceRef` is opaque and the only
 * thing read is which ARGUMENT NAMES a place expands into on the wire.
 */
function placeWireFields(world: WorldAdapter): string[] {
  for (const action of world.actions) {
    for (const param of action.params) {
      if (param.type === 'place') return wireFieldsOf(world, param).map((field) => field.id);
    }
  }
  return [];
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
