import { TRACE_CRITERIA } from './judge.js';
import type { ITraceJudge, Side, TraceCriterion, TraceJudgement } from './judge.js';
import type { TracePair } from './pairing.js';
import { exactBinomialTwoSided, minimumDetectableWins, wilsonInterval } from './stats.js';
import type { Interval, JudgeDesignPower } from './stats.js';
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
  /** What this many pairs could ever have decided. Computed, not hoped for. */
  design: JudgeDesignPower;
  /** False when the judge is position-biased or the design cannot decide. */
  usableForVerdict: boolean;
  /** The caveat in words, always present. */
  note: string;
  judged: PairOutcome[];
}

export interface AggregateOptions {
  /** z for the interval. Default 1.96 (95%). */
  z?: number;
  alpha?: number;
  /** Which two arms the pairs contrast. Default A vs B. */
  arms?: [ArmId, ArmId];
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
  const alpha = options.alpha ?? 0.05;

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
  const design = minimumDetectableWins(counted, alpha);
  const exactP = exactBinomialTwoSided(wins.A, decisivePairs);
  const consistencyRate = counted > 0 ? round(consistentPairs / counted) : 0;

  const reasons: string[] = [];
  if (counted === 0) reasons.push('no pairs were judged');
  if (design.underpowered) {
    reasons.push(
      `${counted} pairs cannot reach p < ${alpha}: even a clean sweep is p = ${exactBinomialTwoSided(counted, counted)}`,
    );
  } else if (design.minimumWins !== null && wins.A < design.minimumWins && wins.B < design.minimumWins) {
    reasons.push(`neither arm reached the ${design.minimumWins} of ${counted} pairs this design needs`);
  }
  if (biased) reasons.push(`the judge prefers one side: left rate ${leftRate}, interval [${positionWilson.low}, ${positionWilson.high}]`);
  if (decisivePositions === 0) reasons.push('every showing was a tie, so position bias is unmeasured rather than absent');
  if (counted > 0 && consistencyRate < 0.5) reasons.push(`the two orders agreed on only ${consistencyRate} of pairs`);

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
    usableForVerdict: reasons.length === 0,
    note:
      reasons.length === 0
        ? `${decisivePairs} decisive pairs of ${counted}; exact two-sided p = ${exactP}; orders agreed on ${consistencyRate}.`
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
