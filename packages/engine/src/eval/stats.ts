import { hashSeed, mulberry32 } from '../body/prng.js';

/**
 * THE STATISTICS, AND WHAT THEY ARE ALLOWED TO SAY.
 *
 * Round 1 shipped a table of ~30 numbers, called it "seed-paired", and had
 * neither. `pairMetrics(a, b)` subtracted two already-pooled scalars computed
 * from ONE seed; `PairedDiff` carried no n, no spread and no interval; the word
 * "variance" appears nowhere in the item; and the judge's n was double-counted
 * because each pair was shown twice and both showings were tallied as
 * independent decisions. At the pilot's five pairs, 5/5 is p = 0.0625 — not
 * significant — and the README reported [0.68, 1.00] from n = 8.
 *
 * So:
 *
 *   A PAIRED DIFFERENCE IS PER SEED. `pairedBootstrap` takes one difference per
 *   seed and returns n, the mean, the spread and a percentile interval from a
 *   seeded resample. With one seed it returns n = 1 and NO interval, which is
 *   the honest answer rather than a confident one.
 *   THE JUDGE'S UNIT IS THE PAIR. Two orders are one observation, and whether
 *   they agreed is its own reported number.
 *   THE DESIGN IS SIZED BEFORE IT IS RUN. `minimumDetectableEffect` says what
 *   this many seeds could ever have found; `minimumDetectableWins` says how many
 *   pairs a judge needs before a clean sweep means anything.
 *   EVERYTHING BUT THE PRE-REGISTERED METRIC IS EXPLORATORY, and says so.
 */

export interface Interval {
  low: number;
  high: number;
}

/**
 * Wilson score interval. Chosen over the normal approximation because the
 * interesting cases here are small n and rates near 0 or 1, which is exactly
 * where the normal interval runs off the end of the scale.
 */
export function wilsonInterval(wins: number, n: number, z = 1.96): Interval {
  if (n <= 0) return { low: 0, high: 1 };
  const p = wins / n;
  const z2 = z * z;
  const denominator = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denominator;
  const margin = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denominator;
  return { low: round(Math.max(0, centre - margin)), high: round(Math.min(1, centre + margin)) };
}

/**
 * The exact two-sided sign-test p-value against a fair coin. The judge's null
 * is "it cannot tell them apart", which is p = 0.5, and at these n the normal
 * approximation is not usable: 5 of 5 is p = 0.0625, and calling that
 * significant is the single easiest way to spend 2,000 calls on nothing.
 */
export function exactBinomialTwoSided(successes: number, n: number): number {
  if (n <= 0) return 1;
  const k = Math.min(successes, n - successes);
  let tail = 0;
  for (let i = 0; i <= k; i++) tail += binomialPmfHalf(i, n);
  return Math.min(1, round(2 * tail, 1e6));
}

function binomialPmfHalf(k: number, n: number): number {
  return Math.exp(logChoose(n, k) - n * Math.LN2);
}

function logChoose(n: number, k: number): number {
  return logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1);
}

/** Lanczos. Deterministic, and accurate far past anything this file needs. */
function logGamma(x: number): number {
  const g = [
    676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  const z = x - 1;
  let a = 0.99999999999980993;
  for (let i = 0; i < g.length; i++) a += g[i]! / (z + i + 1);
  const t = z + g.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

// ─── Paired differences, per seed ────────────────────────────────────────────

export interface PairedSample {
  /** The seed this difference came from. One entry per seed, never per being. */
  seed: string;
  a: number;
  b: number;
}

export interface PairedResult {
  metric: string;
  /** Number of SEEDS. This is the n every interval below is computed at. */
  n: number;
  /** Mean of the per-seed differences, a − b. */
  meanDelta: number;
  /** Sample standard deviation of the per-seed differences. 0 when n < 2. */
  sd: number;
  /**
   * The interval to QUOTE: paired Student-t on the per-seed differences, with
   * the small-sample t quantile rather than 1.96. Null when n < 2.
   *
   * *Round 2 quoted a percentile bootstrap, which under-covers badly at these
   * n: at n = 2 it is literally [min, max] of two points — a 0%-coverage
   * "interval" — and at n = 5 it covers about 0.80 against a nominal 0.95.
   * `test/eval-stats.test.ts` measures both by simulation and prints them.*
   */
  ci: Interval | null;
  /** How `ci` was computed, so a reader never has to guess. */
  ciMethod: 'student-t' | null;
  /**
   * The nonparametric one, beside it: a BCa bootstrap (bias-corrected and
   * accelerated), not the raw percentile. Null when n < 2 or the resamples are
   * degenerate. Reported, never the headline — at n ≤ 8 it still under-covers.
   */
  bootstrapCi: Interval | null;
  /** Per-seed differences, so a reader can see the spread rather than trust it. */
  deltas: { seed: string; delta: number }[];
  /** Standardised effect (mean/sd). Null when the spread is zero or n < 2. */
  effectSize: number | null;
  /** How this row may be read. Exactly one metric per question is primary. */
  role: 'primary' | 'exploratory';
  /** The pre-registered question this row answers, when it is the primary one. */
  question?: string;
}

export interface BootstrapOptions {
  seed?: string;
  resamples?: number;
  /** Two-sided coverage. Default 0.95. */
  level?: number;
}

/**
 * A paired difference per seed, with the interval that actually covers.
 *
 * ROUND 2's INTERVAL WAS ANTI-CONSERVATIVE. It was a raw percentile bootstrap:
 * at n = 2 it returns [min, max] of two points, which contains the true mean
 * essentially never; at n = 5 it covers about 0.80 against a nominal 0.95,
 * because the percentile method corrects neither the bias of the bootstrap
 * distribution nor its narrowness at small n. An interval that says 95% and
 * delivers 80% is worse than no interval, because it is quoted.
 *
 * So the headline is a PAIRED STUDENT-T interval with the small-sample
 * quantile (t₄ = 2.776 at 95%, not 1.96), and the nonparametric interval
 * beside it is BCa rather than the raw percentile. Both are reported; the
 * coverage of both is MEASURED by simulation in `test/eval-stats.test.ts` and
 * printed, rather than asserted in a comment.
 *
 * With n = 1 there is NO interval at all. That is not a limitation to be worked
 * around — one seed is one observation, and an interval drawn from it would be
 * a decoration on a single number.
 */
export function pairedBootstrap(
  metric: string,
  samples: readonly PairedSample[],
  options: BootstrapOptions = {},
): PairedResult {
  const deltas = samples.map((s) => ({ seed: s.seed, delta: round(s.a - s.b) }));
  const values = deltas.map((d) => d.delta);
  const n = values.length;
  const meanDelta = n > 0 ? round(mean(values)) : 0;
  const sd = n > 1 ? round(standardDeviation(values)) : 0;
  const base: PairedResult = {
    metric,
    n,
    meanDelta,
    sd,
    ci: null,
    ciMethod: null,
    bootstrapCi: null,
    deltas,
    effectSize: n > 1 && sd > 0 ? round(meanDelta / sd) : null,
    role: 'exploratory',
  };
  if (n < 2) return base;

  const level = options.level ?? 0.95;
  const t = studentTQuantile(1 - (1 - level) / 2, n - 1);
  const halfWidth = t * (standardDeviation(values) / Math.sqrt(n));
  return {
    ...base,
    ci: { low: round(mean(values) - halfWidth), high: round(mean(values) + halfWidth) },
    ciMethod: 'student-t',
    bootstrapCi: bcaInterval(values, level, `bootstrap:${options.seed ?? metric}:${n}`, options.resamples ?? 2000),
  };
}

/**
 * Bias-corrected and accelerated percentile bootstrap.
 *
 * `z0` corrects for the bootstrap distribution sitting off-centre from the
 * observed statistic; `a` corrects for its spread changing with the statistic,
 * estimated by jackknife. At n = 5 this is meaningfully better than the raw
 * percentile and still not enough on its own — which is why the t interval is
 * the one quoted and this one travels beside it.
 */
function bcaInterval(values: readonly number[], level: number, seed: string, resamples: number): Interval | null {
  const n = values.length;
  const observed = mean(values);
  const rng = mulberry32(hashSeed(seed));
  const means: number[] = [];
  for (let b = 0; b < resamples; b++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += values[Math.floor(rng() * n)]!;
    means.push(sum / n);
  }
  means.sort((x, y) => x - y);
  const below = means.filter((m) => m < observed).length;
  if (below === 0 || below === means.length) return null;
  const z0 = normalQuantile(below / means.length);

  // Jackknife acceleration: leave one seed out at a time.
  const jack = values.map((_, i) => mean(values.filter((__, j) => j !== i)));
  const jackMean = mean(jack);
  let numerator = 0;
  let denominator = 0;
  for (const j of jack) {
    const d = jackMean - j;
    numerator += d * d * d;
    denominator += d * d;
  }
  const a = denominator > 0 ? numerator / (6 * Math.pow(denominator, 1.5)) : 0;

  const alpha = (1 - level) / 2;
  const adjust = (p: number): number => {
    const z = normalQuantile(p);
    const shifted = z0 + (z0 + z) / (1 - a * (z0 + z));
    return normalCdf(shifted);
  };
  return { low: round(quantile(means, adjust(alpha))), high: round(quantile(means, adjust(1 - alpha))) };
}

// ─── Sizing the design BEFORE it is run ──────────────────────────────────────

export interface DesignPower {
  n: number;
  alpha: number;
  power: number;
  /**
   * The smallest true mean difference, IN UNITS OF THE PAIRED DIFFERENCE'S OWN
   * standard deviation, that this many PAIRED seeds could detect at this power:
   * `(z_{1−α/2} + z_power) / √n`. Below this, "no difference" and "a real
   * difference" look the same and the run decides nothing.
   */
  mdeInSdUnits: number;
  /**
   * The same question for an UNPAIRED design with `n` per arm:
   * `(z_{1−α/2} + z_power) · √(2/n)`. Reported beside it because quoting one
   * for the other is a factor-of-1.4 error in the only number that says whether
   * a run could have decided anything.
   *
   * THE TWO ARE IN DIFFERENT UNITS AND MAY NOT BE SUBTRACTED. `mdeInSdUnits` is
   * in σ_d, the SD of the paired DIFFERENCE; this one is in σ, the SD WITHIN an
   * arm. At n = 5 they read 1.25 and 1.77, and round 2's README turned that
   * into "pairing by seed is worth that much" — which is a units artifact: at
   * ρ = 0, σ_d = σ√2 and the two designs are identical. Pairing is worth
   * exactly as much as the correlation between the arms on a shared seed, and
   * nothing in this instrument has measured that yet.
   */
  mdeUnpairedPerArm: number;
}

export function minimumDetectableEffect(n: number, alpha = 0.05, power = 0.8): DesignPower {
  if (n < 2) {
    return { n, alpha, power, mdeInSdUnits: Number.POSITIVE_INFINITY, mdeUnpairedPerArm: Number.POSITIVE_INFINITY };
  }
  const z = normalQuantile(1 - alpha / 2) + normalQuantile(power);
  return {
    n,
    alpha,
    power,
    mdeInSdUnits: round(z / Math.sqrt(n)),
    mdeUnpairedPerArm: round(z * Math.sqrt(2 / n)),
  };
}

export interface JudgeDesignPower {
  pairs: number;
  alpha: number;
  /** The fewest A-wins out of `pairs` whose exact two-sided p is below alpha. */
  minimumWins: number | null;
  /** That many wins as a rate, or null when no result at this n could be significant. */
  minimumWinRate: number | null;
  /** True when even a clean sweep is not significant at this n. */
  underpowered: boolean;
}

/**
 * How many pairs a judge needs before a sweep is evidence. At 5 pairs the
 * answer is "no number is": 5/5 is p = 0.0625. This function is what turns that
 * into a line the pilot recipe has to answer to.
 */
export function minimumDetectableWins(pairs: number, alpha = 0.05): JudgeDesignPower {
  // p falls as k moves away from n/2, so the first k that clears alpha is the
  // smallest one that ever will.
  for (let wins = Math.ceil(pairs / 2); wins <= pairs; wins++) {
    if (exactBinomialTwoSided(wins, pairs) <= alpha) {
      return { pairs, alpha, minimumWins: wins, minimumWinRate: round(wins / pairs), underpowered: false };
    }
  }
  return { pairs, alpha, minimumWins: null, minimumWinRate: null, underpowered: true };
}

/** The fewest pairs at which a clean sweep clears alpha. */
export function pairsForSweep(alpha = 0.05): number {
  for (let n = 1; n <= 200; n++) if (exactBinomialTwoSided(n, n) <= alpha) return n;
  return 200;
}

// ─── The judge gate: one rule, pre-registered, with its power printed ────────

/**
 * THE GATE ROUND 2 COULD NOT PASS EVEN WHEN IT WAS RIGHT.
 *
 * It sized the threshold on ALL pairs — `minimumDetectableWins(30)` = 21 — and
 * then compared it against `wins.A`, which counts only pairs whose two orders
 * AGREED. At a true 0.70 per showing, a pair is decisive for A with probability
 * 0.70² = 0.49, so the expected `wins.A` over 30 pairs is 14.7 and
 * P(wins.A ≥ 21) is **1.6%** — while the sign test on the same data is
 * significant 82.7% of the time. The 840-call block would have printed
 * NOT USABLE almost whatever the traces showed.
 *
 * The rule below is coherent because the threshold and the count share a
 * denominator, and it is pre-registered because it is declared HERE, once, and
 * the runner reads it rather than choosing per run:
 *
 *   1. A pair is DECISIVE when both orders name the same arm; ties and
 *      order-flips are neither wins nor losses, and both are reported.
 *   2. At least `minDecisiveRate` of the judged pairs must be decisive. A judge
 *      that cannot make up its mind is a finding about the judge, not a verdict
 *      about the arms, and this is the line that says so out loud.
 *   3. The winner needs `minimumDetectableWins(decisivePairs, α)` wins OF THOSE
 *      DECISIVE PAIRS — the exact two-sided sign test at the declared α,
 *      conditioned on the number of non-ties, which is the standard sign test
 *      and not a threshold chosen after seeing the data.
 */
export interface JudgeGateRule {
  alpha: number;
  /** The least share of judged pairs whose two orders must agree on an arm. */
  minDecisiveRate: number;
  /** The per-showing win rate the design is powered for. Declared, not hoped for. */
  declaredEffect: number;
}

export const JUDGE_GATE: JudgeGateRule = { alpha: 0.05, minDecisiveRate: 0.5, declaredEffect: 0.7 };

export interface JudgeGatePower {
  pairs: number;
  alpha: number;
  declaredEffect: number;
  minDecisiveRate: number;
  /** P(a pair is decisive) at the declared effect: w² + (1−w)². */
  expectedDecisiveRate: number;
  /**
   * P(the gate prints USABLE **and** names the better arm) at the declared
   * effect. An UPPER BOUND on what a run will actually print: the position
   * check can void a verdict on its own, and this figure does not model it.
   * `test/eval-stats.test.ts` simulates the whole gate and prints both.
   */
  power: number;
  /** P(the gate prints USABLE for either arm) under a judge that cannot tell them apart. */
  typeIError: number;
}

/**
 * The power of the rule above, computed exactly rather than simulated.
 *
 * The model is the one the two showings impose: with a per-showing win rate w,
 * a pair is won by A when BOTH orders say A (w²), by B when both say B
 * ((1−w)²), and is inconsistent otherwise (2w(1−w)). That trinomial is summed
 * over every (a, b) the gate would pass.
 */
export function judgeGatePower(pairs: number, rule: JudgeGateRule = JUDGE_GATE): JudgeGatePower {
  const w = rule.declaredEffect;
  return {
    pairs,
    alpha: rule.alpha,
    declaredEffect: w,
    minDecisiveRate: rule.minDecisiveRate,
    expectedDecisiveRate: round(w * w + (1 - w) * (1 - w)),
    power: round(gateProbability(pairs, w, rule, 'winner'), 1e6),
    typeIError: round(gateProbability(pairs, 0.5, rule, 'either'), 1e6),
  };
}

function gateProbability(pairs: number, w: number, rule: JudgeGateRule, count: 'winner' | 'either'): number {
  if (pairs <= 0) return 0;
  const pA = w * w;
  const pB = (1 - w) * (1 - w);
  const pTie = 1 - pA - pB;
  const needDecisive = Math.ceil(rule.minDecisiveRate * pairs);
  // The threshold depends only on how many pairs were decisive, so it is
  // computed once per decisive count rather than once per outcome.
  const threshold = new Map<number, number | null>();
  const minimumFor = (decisive: number): number | null => {
    if (!threshold.has(decisive)) threshold.set(decisive, minimumDetectableWins(decisive, rule.alpha).minimumWins);
    return threshold.get(decisive) ?? null;
  };

  let total = 0;
  for (let a = 0; a <= pairs; a++) {
    for (let b = 0; a + b <= pairs; b++) {
      const decisive = a + b;
      if (decisive < needDecisive) continue;
      const minimum = minimumFor(decisive);
      if (minimum === null) continue;
      const passes = count === 'winner' ? a >= minimum : a >= minimum || b >= minimum;
      if (!passes) continue;
      total += Math.exp(
        logGamma(pairs + 1) - logGamma(a + 1) - logGamma(b + 1) - logGamma(pairs - decisive + 1) +
          a * Math.log(pA) + b * Math.log(pB) + (pairs - decisive) * (pTie > 0 ? Math.log(pTie) : -Infinity),
      );
    }
  }
  return Math.min(1, total);
}

/** The fewest pairs at which the gate reaches `power` at the declared effect. */
export function pairsForJudgePower(power = 0.8, rule: JudgeGateRule = JUDGE_GATE, cap = 400): number | null {
  for (let pairs = 2; pairs <= cap; pairs++) if (judgeGatePower(pairs, rule).power >= power) return pairs;
  return null;
}

/** What THIS run's gate decided on, and what the rule could ever have decided. */
export interface JudgeGateDesign {
  /** Pairs judged. Reported; never a denominator. */
  pairs: number;
  /** Pairs whose two orders agreed on an arm — the denominator the verdict uses. */
  decisivePairs: number;
  decisiveRate: number;
  minDecisiveRate: number;
  enoughDecisive: boolean;
  alpha: number;
  /** The fewest wins OF THE DECISIVE PAIRS whose exact two-sided p clears alpha. */
  minimumWins: number | null;
  minimumWinRate: number | null;
  /** True when even a sweep of the decisive pairs could not be significant. */
  underpowered: boolean;
  declaredEffect: number;
  /** Power of this rule at the declared effect, for the number of pairs JUDGED. */
  power: number;
  expectedDecisiveRate: number;
  typeIError: number;
}

export function judgeGateDesign(pairs: number, decisivePairs: number, rule: JudgeGateRule = JUDGE_GATE): JudgeGateDesign {
  const wins = minimumDetectableWins(decisivePairs, rule.alpha);
  const power = judgeGatePower(pairs, rule);
  const decisiveRate = pairs > 0 ? round(decisivePairs / pairs) : 0;
  return {
    pairs,
    decisivePairs,
    decisiveRate,
    minDecisiveRate: rule.minDecisiveRate,
    enoughDecisive: pairs > 0 && decisivePairs >= Math.ceil(rule.minDecisiveRate * pairs),
    alpha: rule.alpha,
    minimumWins: wins.minimumWins,
    minimumWinRate: wins.minimumWinRate,
    underpowered: wins.underpowered,
    declaredEffect: power.declaredEffect,
    power: power.power,
    expectedDecisiveRate: power.expectedDecisiveRate,
    typeIError: power.typeIError,
  };
}

// ─── Many comparisons ────────────────────────────────────────────────────────

export interface MultipleComparisonNote {
  comparisons: number;
  alpha: number;
  /** Bonferroni-adjusted threshold a single row would have to clear. */
  perRowAlpha: number;
  /** Expected number of rows at p < alpha under a true null. */
  expectedFalsePositives: number;
  text: string;
}

/**
 * The note that has to travel with an exploratory table. Round 1 printed ~30
 * comparisons with no correction and no warning, which at alpha 0.05 buys about
 * one and a half "findings" from pure noise every time it is run.
 */
export function multipleComparisonNote(comparisons: number, alpha = 0.05): MultipleComparisonNote {
  const perRow = comparisons > 0 ? alpha / comparisons : alpha;
  const expected = round(comparisons * alpha);
  return {
    comparisons,
    alpha,
    perRowAlpha: round(perRow, 1e6),
    expectedFalsePositives: expected,
    text:
      `${comparisons} exploratory comparisons at alpha ${alpha}: about ${expected} of them are expected to look ` +
      `interesting under a true null. A single row would need p < ${round(perRow, 1e6)} (Bonferroni) to stand on ` +
      `its own. Exploratory rows generate hypotheses for the next run; they do not decide this one.`,
  };
}

/** Holm–Bonferroni, for a reader who wants the adjusted values rather than a warning. */
export function holmAdjusted(pValues: readonly { label: string; p: number }[]): { label: string; p: number; adjusted: number }[] {
  const sorted = [...pValues].sort((a, b) => a.p - b.p);
  const m = sorted.length;
  let running = 0;
  return sorted.map((row, i) => {
    running = Math.max(running, Math.min(1, (m - i) * row.p));
    return { label: row.label, p: round(row.p, 1e6), adjusted: round(running, 1e6) };
  });
}

// ─── Small numeric helpers ───────────────────────────────────────────────────

function mean(values: readonly number[]): number {
  return values.length > 0 ? values.reduce((s, v) => s + v, 0) / values.length : 0;
}

function standardDeviation(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const ss = values.reduce((s, v) => s + (v - m) * (v - m), 0);
  return Math.sqrt(ss / (values.length - 1));
}

/** LINEARLY INTERPOLATED, not nearest-rank: at 2,000 resamples the rounding was worth a full percentile. */
function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0]!;
  const at = Math.min(sorted.length - 1, Math.max(0, q * (sorted.length - 1)));
  const low = Math.floor(at);
  const high = Math.min(sorted.length - 1, low + 1);
  return sorted[low]! + (sorted[high]! - sorted[low]!) * (at - low);
}

// ─── Student's t, because 1.96 is a lie at five seeds ────────────────────────

/**
 * The two-sided t quantile, by bisection on the exact CDF. No table, so any
 * coverage level works; no Cornish–Fisher expansion, because that series is
 * worst exactly where this instrument lives (t₁ at 95% is 12.706 and the
 * four-term expansion says 11.3).
 */
export function studentTQuantile(p: number, df: number): number {
  if (df <= 0) return Number.POSITIVE_INFINITY;
  if (p <= 0) return Number.NEGATIVE_INFINITY;
  if (p >= 1) return Number.POSITIVE_INFINITY;
  if (p === 0.5) return 0;
  if (p < 0.5) return -studentTQuantile(1 - p, df);
  let low = 0;
  let high = 1;
  while (studentTCdf(high, df) < p && high < 1e6) high *= 2;
  for (let i = 0; i < 200; i++) {
    const mid = (low + high) / 2;
    if (studentTCdf(mid, df) < p) low = mid;
    else high = mid;
  }
  return round((low + high) / 2, 1e6);
}

function studentTCdf(t: number, df: number): number {
  const x = df / (df + t * t);
  const tail = 0.5 * regularizedIncompleteBeta(x, df / 2, 0.5);
  return t > 0 ? 1 - tail : tail;
}

/** Regularized incomplete beta I_x(a,b), by the standard Lentz continued fraction. */
function regularizedIncompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  if (x < (a + 1) / (a + b + 2)) return (front * betaContinuedFraction(x, a, b)) / a;
  return 1 - (Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + b * Math.log(1 - x) + a * Math.log(x)) * betaContinuedFraction(1 - x, b, a)) / b;
}

function betaContinuedFraction(x: number, a: number, b: number): number {
  const tiny = 1e-30;
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < tiny) d = tiny;
  d = 1 / d;
  let result = d;
  for (let m = 1; m <= 300; m++) {
    const even = (m * (b - m) * x) / ((a + 2 * m - 1) * (a + 2 * m));
    d = 1 + even * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + even / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    result *= d * c;

    const odd = (-(a + m) * (a + b + m) * x) / ((a + 2 * m) * (a + 2 * m + 1));
    d = 1 + odd * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + odd / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const step = d * c;
    result *= step;
    if (Math.abs(1 - step) < 1e-12) break;
  }
  return result;
}

/** Abramowitz & Stegun 7.1.26 on erf. Enough for a BCa adjustment. */
function normalCdf(z: number): number {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

/** Acklam's inverse normal CDF. Plenty for sizing a design. */
export function normalQuantile(p: number): number {
  if (p <= 0) return Number.NEGATIVE_INFINITY;
  if (p >= 1) return Number.POSITIVE_INFINITY;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const low = 0.02425;
  if (p < low) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  if (p > 1 - low) return -normalQuantile(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return (((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q /
    (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
}

function round(v: number, scale = 10000): number {
  return Math.round(v * scale) / scale;
}
