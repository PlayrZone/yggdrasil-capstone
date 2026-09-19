import { TRACE_CRITERIA } from './judge.js';
import type { ITraceJudge, Side, TraceCriterion, TraceJudgement } from './judge.js';
import type { TracePair } from './pairing.js';
import { JUDGE_GATE, exactBinomialTwoSided, judgeGateDesign, wilsonInterval } from './stats.js';
import type { Interval, JudgeGateDesign, JudgeGateRule } from './stats.js';
import type { SealedTraceKey } from './trace.js';
import type { ArmId } from './types.js';

/**
 * AGGREGATION — and the two things round 1 got wrong about it.
 *
 * FIRST, THE UNIT. Every pair is judged TWICE, once in each order. Round 1
 * tallied both showings as independent decisions, so five pairs read as ten
 * observations and a 5-of-5 sweep was quoted with the interval of an 8-of-8
 * one. Two showings of the same two traces are ONE observation about those two
 * traces. Here the pair is the unit: a pair is won only when both orders name
 * the same arm, and a pair whose orders disagree is reported as inconsistent
 * rather than silently halved.
 *
 * SECOND, THE UNBLINDING. Every judgement is taken BEFORE the key is touched.
 * Phase one calls the judge and records what it said; phase two unseals and
 * attributes. `SealedTraceKey` counts unsealings, so a test can hand this
 * function a judge that asserts the key is still sealed while it is being asked.
 *
 * The position check keeps its own interval now. A bare "is the left rate more
 * than 0.2 from a half" flag fires about 11% of the time at n = 10 under a
 * perfectly fair judge, and when it fired it changed nothing. It is an interval
 * that either excludes a half or does not, a judge with nothing but ties is
 * reported as UNDETERMINED rather than unbiased, and a biased judge makes the
 * whole aggregate `usableForVerdict: false`.
 *
 * THIRD, THE GATE COMPARED INCOMPARABLE COUNTS. Round 2 sized its threshold on
 * ALL pairs (`minimumDetectableWins(30)` = 21) and then compared it against
 * `wins.A`, which counts only pairs whose two orders agreed. At the stated 0.70
 * effect the expected `wins.A` is 14.7, so P(usable) was 1.6% while the sign
 * test on the same data was significant 82.7% of the time: the block would have
 * printed NOT USABLE almost whatever it saw. The threshold now shares a
 * denominator with the count — `judgeGateDesign(pairs, decisivePairs)`, the
 * exact sign test conditioned on the non-ties — a minimum decisive FRACTION is
 * required on top, and the power of the whole rule at the declared effect
 * travels on every result (`design.power`).
 */

/** One pair: two showings, one outcome. */
export interface PairOutcome {
  pairId: string;
  /** Which arm sat left and right in the forward showing. */
  forwardOrder: [ArmId, ArmId];
  forward: TraceJudgement;
  reversed: TraceJudgement;
  /** The arm BOTH orders preferred, or null when they disagreed or both tied. */
  preferred: ArmId | null;
  /** Did the two orders agree about the arm (two ties count as agreement)? */
  consistent: boolean;
}

export interface CriterionTally {
  /** Pairs where both orders preferred this arm on this criterion. */
  A: number;
  B: number;
  ties: number;
  /** Pairs whose two orders disagreed on this criterion. */
  inconsistent: number;
  /** A-wins over decisive PAIRS. 0 when nothing was decisive. */
  winRate: number;
}

export interface PositionCheck {
  /** Over all 2 × pairs showings — the right unit for a question about position. */
  leftWins: number;
  rightWins: number;
  ties: number;
  leftRate: number;
  wilson: Interval;
  exactP: number;
  /** Pairs whose preferred ARM survived the order swap. */
  consistentPairs: number;
  flippedPairs: number;
  consistencyRate: number;
  /** The interval on the left rate excludes a half. */
  biased: boolean;
  /** Nothing was decisive either way, so position bias is unmeasured — not absent. */
  undetermined: boolean;
}

/**
 * WHAT THE RUN SAID ABOUT ITSELF, and why an aggregate refuses a verdict
 * without it.
 *
 * Round 3 computed `integrity.degraded` on the A/B result and then never showed
 * it to the judge: a 1,120-call block in which arm B ran 60% on the world's
 * reflex policy would have printed `usableForVerdict: true` and read as a win
 * for the architecture. Detection that changes nothing is not detection. So an
 * aggregate is told, it refuses a verdict when the run is degraded, and it
 * refuses one when it has not been told at all — silence is not an attestation.
 */
export interface RunAttestation {
  /** True when any pre-registered integrity threshold was crossed. */
  degraded: boolean;
  /** Which ones, in words. Empty when it is not degraded. */
  reasons: readonly string[];
}

export interface JudgeAggregate {
  judge: string;
  /** Which two arms this aggregate contrasts. */
  arms: [ArmId, ArmId];
  pairs: number;
  /** Two per pair, by construction. Reported, never used as an n. */
  showings: number;
  /** PAIR-LEVEL outcomes — the unit of analysis. */
  wins: { A: number; B: number; ties: number; inconsistent: number };
  decisivePairs: number;
  /** The first arm's share of decisive PAIRS. */
  winRateA: number;
  wilson: Interval;
  /** Exact two-sided sign test over decisive pairs. */
  exactP: number;
  /** Share of pairs whose two orders agreed. Round 1's was structurally 0. */
  bothOrdersConsistencyRate: number;
  tieRate: number;
  meanConfidence: number;
  byCriterion: Record<TraceCriterion, CriterionTally>;
  position: PositionCheck;
  /**
   * The pre-registered gate: the threshold over DECISIVE pairs, the minimum
   * decisive fraction, and the power of the rule at the declared effect.
   */
  design: JudgeGateDesign;
  /**
   * Was this aggregate computed under the pre-registered rule, untouched? False
   * on the exploratory path, and then `usableForVerdict` is false too.
   */
  preRegistered: boolean;
  /** Why this aggregate is exploratory, when it is. Null on the verdict path. */
  exploratoryReason: string | null;
  /** What the run attested about itself, or null when nothing was attested. */
  integrity: RunAttestation | null;
  /** False when the judge is position-biased, indecisive, or the design cannot decide. */
  usableForVerdict: boolean;
  /** The caveat in words, always present. */
  note: string;
  judged: PairOutcome[];
}

/**
 * THE EXPLORATORY PATH — the only way a gate value can be moved, and it costs
 * the verdict.
 *
 * Round 3's `judgeTraces` took `options.gate` on the ordinary path. Passing
 * `{alpha: 0.9, minDecisiveRate: 0.01, declaredEffect: 0.99}` over a rigged
 * 21-of-40 split (exact two-sided p = 0.8746) printed `usableForVerdict: true`.
 * The rule's own values travelled on `design`, so a reader who already knew the
 * canonical numbers could catch it — and nothing bound the artefact to them.
 *
 * Now there is no `gate` on the verdict path at all. A caller who wants to ask
 * "what would a looser rule have said?" says so out loud, and the answer is
 * stamped: every overridden value is listed in `design.overrides` beside the
 * pre-registered one, `preRegistered` is false, and `usableForVerdict` is false
 * WHATEVER the numbers are.
 */
export interface ExploratoryGate {
  /** Why this is being asked. Required: an unexplained override is not exploration. */
  reason: string;
  /** Fields to move. Anything omitted keeps its pre-registered value. */
  gate?: Partial<Omit<JudgeGateRule, 'justification'>>;
}

export interface AggregateOptions {
  /** z for the interval. Default 1.96 (95%). */
  z?: number;
  /** Which two arms the pairs contrast. Default A vs B. */
  arms?: [ArmId, ArmId];
  /**
   * What the run that produced these traces said about its own integrity.
   * REQUIRED for a verdict — see `RunAttestation`.
   */
  integrity?: RunAttestation;
  /** Ask a different question, and be told it is a different question. */
  exploratory?: ExploratoryGate;
}

export async function judgeTraces(
  pairs: readonly TracePair[],
  key: SealedTraceKey,
  judge: ITraceJudge,
  options: AggregateOptions = {},
): Promise<JudgeAggregate> {
  // ── PHASE 1 — every judgement, with the key untouched ──────────────────────
  interface Taken {
    pairId: string;
    leftId: string;
    rightId: string;
    forward: TraceJudgement;
    reversed: TraceJudgement;
  }
  const taken: Taken[] = [];
  for (const pair of pairs) {
    const forward = await judge.compare(pair);
    const reversed = await judge.compare({ pairId: `${pair.pairId}r`, left: pair.right, right: pair.left });
    taken.push({ pairId: pair.pairId, leftId: pair.left.traceId, rightId: pair.right.traceId, forward, reversed });
  }

  // ── PHASE 2 — now, and only now, look at which arm was which ───────────────
  const arms = options.arms ?? (['A', 'B'] as [ArmId, ArmId]);
  const armOf = new Map(key.unseal().map((k) => [k.traceId, k.arm]));
  const z = options.z ?? 1.96;
  // THE VERDICT PATH READS THE CONSTANT. There is no parameter that moves it;
  // `exploratory` builds a different rule and forfeits the verdict for it.
  const gate: JudgeGateRule = options.exploratory?.gate
    ? { ...JUDGE_GATE, ...options.exploratory.gate }
    : JUDGE_GATE;
  const alpha = gate.alpha;

  const wins = { A: 0, B: 0, ties: 0, inconsistent: 0 };
  const byCriterion = blankTallies();
  const position = { leftWins: 0, rightWins: 0, ties: 0 };
  const judged: PairOutcome[] = [];
  let confidence = 0;
  let consistentPairs = 0;
  let flippedPairs = 0;

  for (const row of taken) {
    const leftArm = armOf.get(row.leftId);
    const rightArm = armOf.get(row.rightId);
    if (!leftArm || !rightArm) continue;

    for (const judgement of [row.forward, row.reversed]) {
      confidence += judgement.confidence;
      if (judgement.preference === 'left') position.leftWins++;
      else if (judgement.preference === 'right') position.rightWins++;
      else position.ties++;
    }

    // The forward showing is (leftArm, rightArm); the reversed one is the
    // mirror, so a `left` there means the arm that was on the RIGHT forward.
    const forwardArm = sideToArm(row.forward.preference, leftArm, rightArm);
    const reversedArm = sideToArm(row.reversed.preference, rightArm, leftArm);
    const agreed = forwardArm === reversedArm;
    const preferred = agreed ? forwardArm : null;
    if (agreed) consistentPairs++;
    else flippedPairs++;

    if (preferred === arms[0]) wins.A++;
    else if (preferred === arms[1]) wins.B++;
    else if (agreed) wins.ties++;
    else wins.inconsistent++;

    for (const criterion of TRACE_CRITERIA) {
      const a = sideToArm(row.forward.byCriterion[criterion], leftArm, rightArm);
      const b = sideToArm(row.reversed.byCriterion[criterion], rightArm, leftArm);
      const tally = byCriterion[criterion];
      if (a !== b) tally.inconsistent++;
      else if (a === arms[0]) tally.A++;
      else if (a === arms[1]) tally.B++;
      else tally.ties++;
    }

    judged.push({
      pairId: row.pairId,
      forwardOrder: [leftArm, rightArm],
      forward: row.forward,
      reversed: row.reversed,
      preferred,
      consistent: agreed,
    });
  }

  const counted = judged.length;
  const showings = counted * 2;
  const decisivePairs = wins.A + wins.B;
  const decisivePositions = position.leftWins + position.rightWins;
  const leftRate = decisivePositions > 0 ? round(position.leftWins / decisivePositions) : 0;
  const positionWilson = wilsonInterval(position.leftWins, decisivePositions, z);
  const biased = decisivePositions > 0 && (positionWilson.low > 0.5 || positionWilson.high < 0.5);
  const design = judgeGateDesign(counted, decisivePairs, gate);
  const exactP = exactBinomialTwoSided(wins.A, decisivePairs);
  const consistencyRate = counted > 0 ? round(consistentPairs / counted) : 0;

  const exploratory = options.exploratory ?? null;
  const attestation = options.integrity ?? null;
  const reasons: string[] = [];
  if (counted === 0) reasons.push('no pairs were judged');
  // R2: an overridden rule can never be a verdict, whatever it prints.
  if (exploratory) {
    reasons.push(
      `this aggregate was computed on the EXPLORATORY path (${exploratory.reason}) — ` +
        (design.overrides.length > 0
          ? `${design.overrides.map((o) => `${o.field} ${o.preRegistered} → ${o.used}`).join(', ')}; `
          : 'no gate value was moved, but the path itself is exploratory; ') +
        'a rule chosen after the numbers are in is not a pre-registration',
    );
  }
  // R5: detection that changes nothing is not detection.
  if (!attestation) {
    reasons.push(
      'no run integrity was attested: an aggregate that has not been told whether the arms actually ran their own ' +
        'minds is not a verdict about the arms',
    );
  } else if (attestation.degraded) {
    reasons.push(
      `the run is DEGRADED, so these traces are not the arms' own behaviour — ${attestation.reasons.join('; ')}`,
    );
  }
  // R1: an under-powered block cannot return a verdict of any sign.
  if (counted > 0 && !design.adequatelyPowered) {
    reasons.push(
      `${counted} pairs reaches power ${design.power} under the pre-registered assumptions (effect ` +
        `${design.declaredEffect}, tie rate ${design.assumedTieRate}, position ${design.assumedPositionLeftRate}); ` +
        `the rule needs ${design.pairsForTargetPower ?? 'more than the search cap'} pairs for ${design.targetPower}. ` +
        'This block is EXPLORATORY: "not significant" here is an absence of measurement, not a null result',
    );
  }
  // The decisive fraction comes FIRST: an indecisive judge is a finding about
  // the judge, and quoting a win rate over four pairs out of thirty would be
  // reporting the tail of a distribution as its middle.
  if (counted > 0 && !design.enoughDecisive) {
    reasons.push(
      `only ${decisivePairs} of ${counted} pairs were decisive (${design.decisiveRate} < ${design.minDecisiveRate} required): ` +
        `${wins.inconsistent} pairs flipped with the order and ${wins.ties} were ties — a judge that cannot make up its ` +
        'mind is a finding about the judge, not a verdict about the arms',
    );
  } else if (design.underpowered) {
    reasons.push(
      `${decisivePairs} decisive pairs cannot reach p < ${alpha}: even a sweep of them is p = ${exactBinomialTwoSided(decisivePairs, decisivePairs)}`,
    );
  } else if (design.minimumWins !== null && wins.A < design.minimumWins && wins.B < design.minimumWins) {
    reasons.push(`neither arm reached the ${design.minimumWins} of ${decisivePairs} DECISIVE pairs this rule needs`);
  }
  if (biased) reasons.push(`the judge prefers one side: left rate ${leftRate}, interval [${positionWilson.low}, ${positionWilson.high}]`);
  if (decisivePositions === 0) reasons.push('every showing was a tie, so position bias is unmeasured rather than absent');

  return {
    judge: judge.id,
    arms,
    pairs: counted,
    showings,
    wins,
    decisivePairs,
    winRateA: decisivePairs > 0 ? round(wins.A / decisivePairs) : 0,
    wilson: wilsonInterval(wins.A, decisivePairs, z),
    exactP,
    bothOrdersConsistencyRate: consistencyRate,
    tieRate: counted > 0 ? round(wins.ties / counted) : 0,
    meanConfidence: showings > 0 ? round(confidence / showings) : 0,
    byCriterion: finish(byCriterion),
    position: {
      ...position,
      leftRate,
      wilson: positionWilson,
      exactP: exactBinomialTwoSided(position.leftWins, decisivePositions),
      consistentPairs,
      flippedPairs,
      consistencyRate,
      biased,
      undetermined: decisivePositions === 0,
    },
    design,
    preRegistered: exploratory === null && design.preRegistered,
    exploratoryReason: exploratory?.reason ?? null,
    integrity: attestation,
    usableForVerdict: reasons.length === 0,
    note:
      reasons.length === 0
        ? `${wins.A} of ${decisivePairs} decisive pairs (${counted} judged); exact two-sided p = ${exactP}; the rule needed ` +
          `${design.minimumWins}; orders agreed on ${consistencyRate}. Pre-registered rule ${design.ruleHash.slice(0, 12)}: ` +
          `power ${design.power} at a per-showing win rate of ${design.declaredEffect} under an assumed tie rate of ` +
          `${design.assumedTieRate}, and USABLE at ${design.typeIError} under a judge that cannot tell them apart.`
        : `NOT USABLE FOR A VERDICT — ${reasons.join('; ')}.`,
    judged,
  };
}

function sideToArm(side: Side, leftArm: ArmId, rightArm: ArmId): ArmId | null {
  if (side === 'left') return leftArm;
  if (side === 'right') return rightArm;
  return null;
}

/** Swap which arm every handle belongs to — the label-swap control. */
export function swapArmLabels(key: SealedTraceKey, arms: [ArmId, ArmId] = ['A', 'B']): SealedTraceKey {
  return key.relabelled((arm) => (arm === arms[0] ? arms[1] : arm === arms[1] ? arms[0] : arm));
}

function blankTallies(): Record<TraceCriterion, CriterionTally> {
  const blank = (): CriterionTally => ({ A: 0, B: 0, ties: 0, inconsistent: 0, winRate: 0 });
  return { pursues: blank(), consistent: blank(), reactive: blank(), social: blank(), ignorance: blank() };
}

function finish(tallies: Record<TraceCriterion, CriterionTally>): Record<TraceCriterion, CriterionTally> {
  for (const criterion of TRACE_CRITERIA) {
    const tally = tallies[criterion];
    const decisive = tally.A + tally.B;
    tally.winRate = decisive > 0 ? round(tally.A / decisive) : 0;
  }
  return tallies;
}

function round(v: number): number {
  return Math.round(v * 10000) / 10000;
}

export { wilsonInterval };
