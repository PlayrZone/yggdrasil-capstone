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
  /** Percentile bootstrap interval on the mean difference. Null when n < 2. */
  ci: Interval | null;
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
 * A paired bootstrap over per-seed differences.
 *
 * Bootstrap rather than a t-interval because these differences are counts,
 * rates and bounded scores over a handful of seeds, and nothing about them is
 * normal. Seeded, so a result is reproducible; the seed is part of the manifest.
 *
 * With n = 1 there is NO interval. That is not a limitation to be worked
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
    deltas,
    effectSize: n > 1 && sd > 0 ? round(meanDelta / sd) : null,
    role: 'exploratory',
  };
  if (n < 2) return base;

  const resamples = options.resamples ?? 2000;
  const level = options.level ?? 0.95;
  const rng = mulberry32(hashSeed(`bootstrap:${options.seed ?? metric}:${n}`));
  const means: number[] = [];
  for (let b = 0; b < resamples; b++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += values[Math.floor(rng() * n)]!;
    means.push(sum / n);
  }
  means.sort((x, y) => x - y);
  const alpha = (1 - level) / 2;
  return { ...base, ci: { low: round(quantile(means, alpha)), high: round(quantile(means, 1 - alpha)) } };
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
   * `(z_{1−α/2} + z_power) · √(2/n)`. Reported beside it because the two differ
   * by √2 and quoting one for the other is a factor-of-1.4 error in the only
   * number that says whether a run could have decided anything. At n = 5 the
   * paired figure is 1.25 SD and the unpaired one is 1.77 SD — pairing by seed
   * is worth that much, and it is worth it only if the pairing is REAL.
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

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const at = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[at] ?? 0;
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
