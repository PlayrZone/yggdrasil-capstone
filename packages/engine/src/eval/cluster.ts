import { JUDGE_GATE, exactBinomialTwoSided, signFlipPermutation, signTest, wilsonInterval } from './stats.js';
import type { Interval, JudgeGateRule, PermutationTest, SignTest } from './stats.js';

/**
 * THE UNIT OF ANALYSIS IS THE RUN, NOT THE PAIR (S1).
 *
 * Round 4's judge gate bought **one seed** and analysed its 64 pairs as 64
 * independent Bernoulli draws. In `population` mode each arm is its own
 * `Experiment`, so arm A's beings share one world with each other and arm B's
 * share another: every pair of a seed carries the same run-level difference.
 * There was no cluster term anywhere in `stats.ts`, and the reviewer drove the
 * REAL gate 1,500×/cell under a run-exchangeable null — the judge's merit
 * preference given a per-run shift of ±ρ/2, mean 0 across runs:
 *
 *   | ρ    | 0      | 0.10   | 0.25   | 0.50   | 0.75   | 1.0    |
 *   |------|--------|--------|--------|--------|--------|--------|
 *   | P(VERDICT) | 0.0280 | 0.0713 | 0.3833 | 0.9340 | 0.9880 | 0.9980 |
 *
 * A shift of 0.05 — one judge quirk common to a run — already put type I at
 * 1.4× α; at ρ = 0.5 the gate returned a verdict 93% of the time under a null.
 * The item refuses exactly this pseudo-replication TWICE elsewhere ("One seed
 * is n = 1" for the metric table, "14 probes inside one being are correlated,
 * so n = 6" for the probe). The block being bought was the one where it was not
 * applied.
 *
 * SO: one seed × two arms is ONE cluster. A seed contributes its decisive-pair
 * WIN FRACTION; the test is over seeds; and because a fraction is a bounded
 * summary of however many pairs the seed had, a run-level shift moves ONE
 * number rather than sixty-four. The pilot spreads its budget over as many
 * independent seeds as fit — small cohorts, few pairs per seed — precisely so
 * the between-run correlation can be estimated instead of assumed.
 */

/** What one seed contributed. Two arms of one seed; never a pair from two seeds. */
export interface SeedCluster {
  seed: string;
  pairs: number;
  /** Pairs whose two orders named the same ARM. */
  decisivePairs: number;
  /** Of those, the ones that named the first arm. */
  winsA: number;
  /** Pairs where both orders named an arm and they DISAGREED. */
  contradictedPairs: number;
}

/**
 * THE PRE-REGISTERED ρ GRID. Declared here, before any simulation is run, so a
 * grid cannot be chosen after the type-I numbers are in. ρ is the size of the
 * judge-preference shift common to a run, in the units the reviewer used.
 *
 * `test/eval-cluster.test.ts` drives the REAL gate at every one of these and
 * requires type I ≤ α at all of them. A grid that stopped at 0.10 would be a
 * grid chosen to pass.
 */
export const CLUSTER_RHO_GRID: readonly number[] = Object.freeze([0, 0.1, 0.25, 0.5]);

export interface ClusterGate {
  /** Seeds that contributed at least one pair. */
  clusters: number;
  /** Seeds that contributed at least one DECISIVE pair — the n every test below uses. */
  decisiveClusters: number;
  minDecisiveClusters: number;
  enoughClusters: boolean;
  /** Per seed: its decisive-pair win fraction and the deviation from a half. */
  perCluster: { seed: string; pairs: number; decisivePairs: number; winsA: number; winFraction: number; delta: number }[];
  /** Mean of the per-seed deltas. The statistic both tests are over. */
  meanDelta: number;
  /** Interval on the mean win fraction across seeds, at the cluster n. */
  wilsonAcrossClusters: Interval;
  /** THE PRIMARY test: exact sign-flip permutation over SEEDS. */
  permutation: PermutationTest | null;
  /** THE ASSUMPTION-LIGHT check beside it, over the same seeds. */
  sign: SignTest | null;
  /** Both cleared alpha. A verdict needs both (S3/S5). */
  bothTestsPass: boolean;
  /** The pooled decided-agreement rate — decisive / (decisive + contradicted). */
  decidedAgreementRate: number | null;
  /** Why this cluster gate refuses, when it does. Empty means it does not. */
  reasons: string[];
  /** True when the seed-level evidence is sufficient on its own terms. */
  passes: boolean;
}

/**
 * Group pair outcomes into clusters. `preferred` is the arm both orders named,
 * or null; `contradicted` is a pair whose orders named DIFFERENT arms (a pair
 * where one order tied is neither).
 */
export function clustersOf(
  judged: readonly { cluster: string; preferred: string | null; contradicted: boolean }[],
  firstArm: string,
  secondArm: string,
): SeedCluster[] {
  const by = new Map<string, SeedCluster>();
  for (const row of judged) {
    const seed = row.cluster;
    const held = by.get(seed) ?? { seed, pairs: 0, decisivePairs: 0, winsA: 0, contradictedPairs: 0 };
    held.pairs++;
    if (row.preferred === firstArm) {
      held.decisivePairs++;
      held.winsA++;
    } else if (row.preferred === secondArm) {
      held.decisivePairs++;
    } else if (row.contradicted) {
      held.contradictedPairs++;
    }
    by.set(seed, held);
  }
  return [...by.values()].sort((a, b) => (a.seed < b.seed ? -1 : a.seed > b.seed ? 1 : 0));
}

/**
 * THE CLUSTER-LEVEL GATE.
 *
 * Each decisive seed contributes `winsA / decisivePairs − 0.5`. Under the null
 * "the judge is exchangeable between the arms", that deviation is as likely to
 * be positive as negative, INDEPENDENTLY ACROSS SEEDS — which is the assumption
 * a seed-paired A/B actually earns, and the one round 4 helped itself to at the
 * pair level where it is false.
 *
 * Two tests, both required:
 *
 *   the exact SIGN-FLIP PERMUTATION over the per-seed deltas (primary), and
 *   the exact SIGN TEST over their signs (assumption-light).
 *
 * The permutation test is exact under sign symmetry and loses its level on
 * right-skewed differences — 0.112 at n = 6, measured, 2.2× α. Requiring the
 * sign test too costs power and buys a level that does not depend on a shape
 * nothing has measured.
 */
export function clusterJudgeGate(clusters: readonly SeedCluster[], rule: JudgeGateRule = JUDGE_GATE): ClusterGate {
  const decisive = clusters.filter((c) => c.decisivePairs > 0);
  const perCluster = decisive.map((c) => {
    const winFraction = round(c.winsA / c.decisivePairs);
    return {
      seed: c.seed,
      pairs: c.pairs,
      decisivePairs: c.decisivePairs,
      winsA: c.winsA,
      winFraction,
      delta: round(winFraction - 0.5),
    };
  });
  const deltas = perCluster.map((c) => c.delta);
  const permutation = deltas.length > 0 ? signFlipPermutation(deltas, { alpha: rule.alpha, seed: 'cluster-gate' }) : null;
  const sign = deltas.length > 0 ? signTest(deltas, rule.alpha) : null;
  const bothTestsPass =
    permutation !== null && sign !== null && permutation.p <= rule.alpha && sign.p <= rule.alpha;

  const pooledDecisive = clusters.reduce((s, c) => s + c.decisivePairs, 0);
  const pooledContradicted = clusters.reduce((s, c) => s + c.contradictedPairs, 0);
  const decided = pooledDecisive + pooledContradicted;
  const decidedAgreementRate = decided > 0 ? round(pooledDecisive / decided) : null;

  const enoughClusters = decisive.length >= rule.minDecisiveClusters;
  const reasons: string[] = [];
  if (clusters.length === 0) reasons.push('no run contributed a pair');
  if (!enoughClusters) {
    reasons.push(
      `${decisive.length} of ${clusters.length} SEEDS contributed a decisive pair; the rule needs ` +
        `${rule.minDecisiveClusters}. One seed is n = 1 however many pairs it bought: both arms of a seed share a ` +
        'run-level difference, so 64 pairs from one run are one observation about that run',
    );
  }
  if (permutation !== null && permutation.p > rule.alpha) {
    reasons.push(`the sign-flip permutation test over ${permutation.n} seeds gives p = ${permutation.p}`);
  }
  if (sign !== null && sign.p > rule.alpha) {
    reasons.push(
      `the sign test over ${sign.n} non-tied seeds gives p = ${sign.p} — reported BESIDE the permutation test ` +
        'because the permutation test assumes sign symmetry and loses its level on skewed differences',
    );
  }
  if (permutation !== null && !permutation.couldReachAlpha) {
    reasons.push(`${permutation.n} seeds cannot reach p < ${rule.alpha} however clean the sweep: the floor is ${permutation.floorP}`);
  }
  if (decidedAgreementRate !== null && decidedAgreementRate <= rule.minDecidedAgreementRate) {
    reasons.push(
      `the judge contradicted itself as often as it agreed: ${pooledDecisive} decisive against ${pooledContradicted} ` +
        `order-flips (decided agreement ${decidedAgreementRate} <= ${rule.minDecidedAgreementRate}) — a finding about ` +
        'the judge, not a verdict about the arms',
    );
  }

  return {
    clusters: clusters.length,
    decisiveClusters: decisive.length,
    minDecisiveClusters: rule.minDecisiveClusters,
    enoughClusters,
    perCluster,
    meanDelta: deltas.length > 0 ? round(deltas.reduce((s, d) => s + d, 0) / deltas.length) : 0,
    wilsonAcrossClusters: wilsonInterval(perCluster.filter((c) => c.winFraction > 0.5).length, perCluster.length),
    permutation,
    sign,
    bothTestsPass,
    decidedAgreementRate,
    reasons,
    passes: reasons.length === 0,
  };
}

/**
 * THE BETWEEN-RUN CORRELATION, estimated rather than assumed — the nuisance
 * parameter the confirmatory design needs and no round has ever measured.
 *
 * A one-way random-effects ICC over the per-seed win fractions: how much of the
 * variance in "which arm this judge prefers" lives BETWEEN runs rather than
 * within them. ρ = 0 means pairs really were independent and round 4's
 * arithmetic was right; ρ = 0.25 means its type I was 0.38.
 *
 * It needs at least two seeds with at least two decisive pairs each. Below that
 * it returns null, which is the honest answer and the reason the estimation
 * pilot spends its budget on seeds rather than on pairs.
 */
export function betweenRunIcc(clusters: readonly SeedCluster[]): { rho: number; seeds: number; interval: Interval } | null {
  const usable = clusters.filter((c) => c.decisivePairs >= 2);
  if (usable.length < 2) return null;
  const k = usable.reduce((s, c) => s + c.decisivePairs, 0) / usable.length;
  if (k <= 1) return null;
  const grand = usable.reduce((s, c) => s + c.winsA, 0) / usable.reduce((s, c) => s + c.decisivePairs, 0);

  let between = 0;
  let within = 0;
  for (const c of usable) {
    const p = c.winsA / c.decisivePairs;
    between += c.decisivePairs * (p - grand) * (p - grand);
    // Binomial within-cluster variance of the individual 0/1 outcomes.
    within += c.decisivePairs * p * (1 - p);
  }
  const dfBetween = usable.length - 1;
  const dfWithin = usable.reduce((s, c) => s + c.decisivePairs, 0) - usable.length;
  if (dfBetween <= 0 || dfWithin <= 0) return null;
  const msBetween = between / dfBetween;
  const msWithin = within / dfWithin;
  const rho = msWithin > 0 || msBetween > 0 ? (msBetween - msWithin) / (msBetween + (k - 1) * msWithin) : 0;
  const clamped = Math.max(0, Math.min(1, rho));
  // A crude but honest interval: the Fisher-z style spread of an ICC at this
  // many clusters. Wide on purpose — the point of the pilot is that it IS wide.
  const spread = 1.96 / Math.sqrt(Math.max(1, usable.length - 2));
  return {
    rho: round(clamped),
    seeds: usable.length,
    interval: { low: round(Math.max(0, clamped - spread * (1 - clamped))), high: round(Math.min(1, clamped + spread * (1 - clamped))) },
  };
}

/**
 * The exact two-sided p of a clean sweep at this many seeds — what a reader
 * needs to see beside "8 of 8 seeds favoured A".
 */
export function sweepP(seeds: number): number {
  return exactBinomialTwoSided(seeds, seeds);
}

function round(v: number): number {
  return Math.round(v * 10000) / 10000;
}
