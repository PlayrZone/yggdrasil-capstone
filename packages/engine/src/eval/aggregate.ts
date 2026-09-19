import { TRACE_CRITERIA } from './judge.js';
import type { ITraceJudge, Side, TraceCriterion, TraceJudgement, TracePair } from './judge.js';
import type { ArmId, TraceKey } from './types.js';

/**
 * AGGREGATION, WITH THE CAVEATS ATTACHED.
 *
 * Every pair is judged TWICE — once as (left, right) and once as (right, left).
 * That doubles the cost and buys two things nothing else can: a measured
 * position bias, and a per-pair consistency check (did the judge change its mind
 * when the order changed?). A win rate quoted without those two numbers is not
 * a result, so they are fields of the same object.
 */

export interface JudgedPair {
  pairId: string;
  /** Which arm sat on each side, in the order the judge saw them. */
  order: [ArmId, ArmId];
  judgement: TraceJudgement;
  /** The arm the judge preferred, or null for a tie. */
  preferred: ArmId | null;
}

export interface CriterionTally {
  A: number;
  B: number;
  ties: number;
  /** A-wins over decisive judgements. 0 when nothing was decisive. */
  winRate: number;
}

export interface PositionCheck {
  leftWins: number;
  rightWins: number;
  ties: number;
  /** left-wins over decisive judgements. 0.5 is unbiased. */
  leftRate: number;
  /** Pairs whose preferred ARM survived the order swap. */
  consistentPairs: number;
  /** Pairs where it did not — the judge followed the position, not the trace. */
  flippedPairs: number;
  /** True when the left rate is far enough from 0.5 to distrust the win rate. */
  biased: boolean;
}

export interface JudgeAggregate {
  judge: string;
  pairs: number;
  /** Two per pair, by construction. */
  judgements: number;
  wins: { A: number; B: number; ties: number };
  decisive: number;
  /** Arm A's share of decisive judgements. */
  winRateA: number;
  wilson: { low: number; high: number };
  tieRate: number;
  meanConfidence: number;
  byCriterion: Record<TraceCriterion, CriterionTally>;
  position: PositionCheck;
  judged: JudgedPair[];
}

export interface AggregateOptions {
  /** z for the interval. Default 1.96 (95%). */
  z?: number;
  /** |leftRate − 0.5| above which the judge is flagged biased. Default 0.2. */
  biasTolerance?: number;
}

export async function judgeTraces(
  pairs: readonly TracePair[],
  key: readonly TraceKey[],
  judge: ITraceJudge,
  options: AggregateOptions = {},
): Promise<JudgeAggregate> {
  const armOf = new Map(key.map((k) => [k.traceId, k.arm]));
  const wins = { A: 0, B: 0, ties: 0 };
  const byCriterion = blankTallies();
  const position = { leftWins: 0, rightWins: 0, ties: 0 };
  const judged: JudgedPair[] = [];
  let confidence = 0;
  let consistentPairs = 0;
  let flippedPairs = 0;

  for (const pair of pairs) {
    const forward = await judge.compare(pair);
    const reversed = await judge.compare({ pairId: `${pair.pairId}r`, left: pair.right, right: pair.left });
    const orders: [TracePair, TraceJudgement][] = [
      [pair, forward],
      [{ pairId: `${pair.pairId}r`, left: pair.right, right: pair.left }, reversed],
    ];
    const preferences: (ArmId | null)[] = [];
    for (const [shown, judgement] of orders) {
      const leftArm = armOf.get(shown.left.traceId);
      const rightArm = armOf.get(shown.right.traceId);
      if (!leftArm || !rightArm) continue;
      const preferred = sideToArm(judgement.preference, leftArm, rightArm);
      preferences.push(preferred);
      if (preferred === 'A') wins.A++;
      else if (preferred === 'B') wins.B++;
      else wins.ties++;
      if (judgement.preference === 'left') position.leftWins++;
      else if (judgement.preference === 'right') position.rightWins++;
      else position.ties++;
      confidence += judgement.confidence;
      for (const criterion of TRACE_CRITERIA) {
        const armSide = sideToArm(judgement.byCriterion[criterion], leftArm, rightArm);
        const tally = byCriterion[criterion];
        if (armSide === 'A') tally.A++;
        else if (armSide === 'B') tally.B++;
        else tally.ties++;
      }
      judged.push({ pairId: shown.pairId, order: [leftArm, rightArm], judgement, preferred });
    }
    if (preferences.length === 2) {
      const [first, second] = preferences;
      // Two ties agree; a tie beside a preference does not, and neither does a
      // preference that moved with the position.
      if (first === second) consistentPairs++;
      else flippedPairs++;
    }
  }

  const decisive = wins.A + wins.B;
  const judgements = judged.length;
  const decisivePositions = position.leftWins + position.rightWins;
  const leftRate = decisivePositions > 0 ? round(position.leftWins / decisivePositions) : 0;
  const tolerance = options.biasTolerance ?? 0.2;

  return {
    judge: judge.id,
    pairs: pairs.length,
    judgements,
    wins,
    decisive,
    winRateA: decisive > 0 ? round(wins.A / decisive) : 0,
    wilson: wilsonInterval(wins.A, decisive, options.z),
    tieRate: judgements > 0 ? round(wins.ties / judgements) : 0,
    meanConfidence: judgements > 0 ? round(confidence / judgements) : 0,
    byCriterion: finish(byCriterion),
    position: {
      ...position,
      leftRate,
      consistentPairs,
      flippedPairs,
      biased: decisivePositions > 0 && Math.abs(leftRate - 0.5) > tolerance,
    },
    judged,
  };
}

function sideToArm(side: Side, leftArm: ArmId, rightArm: ArmId): ArmId | null {
  if (side === 'left') return leftArm;
  if (side === 'right') return rightArm;
  return null;
}

/** Swap which arm every handle belongs to — the label-swap control. */
export function swapArmLabels(key: readonly TraceKey[]): TraceKey[] {
  return key.map((k) => ({ ...k, arm: k.arm === 'A' ? ('B' as const) : ('A' as const) }));
}

/**
 * Wilson score interval. Chosen over the normal approximation because the
 * interesting cases here are small n and rates near 0 or 1, which is exactly
 * where the normal interval runs off the end of the scale and claims a bound
 * below 0 or above 1.
 */
export function wilsonInterval(wins: number, n: number, z = 1.96): { low: number; high: number } {
  if (n <= 0) return { low: 0, high: 1 };
  const p = wins / n;
  const z2 = z * z;
  const denominator = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denominator;
  const margin = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denominator;
  return { low: round(Math.max(0, centre - margin)), high: round(Math.min(1, centre + margin)) };
}

function blankTallies(): Record<TraceCriterion, CriterionTally> {
  return {
    pursues: { A: 0, B: 0, ties: 0, winRate: 0 },
    consistent: { A: 0, B: 0, ties: 0, winRate: 0 },
    reactive: { A: 0, B: 0, ties: 0, winRate: 0 },
    social: { A: 0, B: 0, ties: 0, winRate: 0 },
    ignorance: { A: 0, B: 0, ties: 0, winRate: 0 },
  };
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
