import { hashSeed, mulberry32 } from '../body/prng.js';
import { sha256Hex } from './commit.js';

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
  const p = Math.min(1, 2 * tail);
  // A PUBLISHED p OF ZERO IS WRONG (S8). `round(…, 1e6)` turned 60 of 64 — a
  // real p of about 1.2e-13 — into exactly 0, and the gate's own `note` printed
  // "exact two-sided p = 0". Values the sixth decimal can carry are still
  // rounded there, so every pinned number in the item is unchanged; anything
  // smaller keeps its magnitude and is RENDERED by `formatP` as "< 1e-6".
  return p >= 1e-6 ? round(p, 1e6) : p;
}

/** How a p-value is printed. Never "0": a two-sided exact p is never zero. */
export function formatP(p: number): string {
  if (p >= 1e-6) return String(round(p, 1e6));
  return p > 0 ? '< 1e-6' : '< 1e-12';
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
  /**
   * THE PRIMARY TEST — an exact sign-flip permutation test, not the t.
   *
   * *Round 3 quoted a paired Student-t interval and measured its coverage on
   * NORMAL differences only. The reviewer measured it on right-skewed ones —
   * which `dietBreadth`, `deaths:*` and `distinctPlanShapes` are — and it
   * covers **0.827** at n = 5 against a nominal 0.95. The t interval stays,
   * because a reader wants an interval and this one is the least-bad on offer,
   * but the number that decides anything is this one: it assumes only that the
   * paired differences are exchangeable in sign under the null, which is what a
   * seed-paired A/B actually guarantees.*
   */
  permutation: PermutationTest | null;
  /**
   * THE ASSUMPTION-LIGHT CHECK, beside it. The permutation test assumes sign
   * symmetry and loses its level on right-skewed differences (0.112 at n = 6);
   * the sign test assumes only that a difference is as likely to be positive as
   * negative. A VERDICT NEEDS BOTH — `bothTestsPass`.
   */
  sign: SignTest | null;
  /** Both the permutation test and the sign test cleared alpha, uncorrected. */
  bothTestsPass: boolean;
  /**
   * The larger of the two p-values, Holm-corrected across the declared contrast
   * family by `holmAcrossContrasts`. Null until that correction has been
   * applied — a row that has not been corrected must not read as if it had.
   */
  familyAdjustedP: number | null;
  /**
   * False when this many seeds could not clear alpha however extreme the data,
   * CORRECTED ACROSS THE DECLARED FAMILY: `MIN_PAIRED_SEEDS` = 8, not 6.
   */
  verdictEligible: boolean;
  /** How this row may be read. Exactly one metric per question is primary. */
  role: 'primary' | 'exploratory';
  /** The pre-registered question this row answers, when it is the primary one. */
  question?: string;
}

/**
 * AN EXACT SIGN-FLIP PERMUTATION TEST ON PAIRED DIFFERENCES.
 *
 * Under the null "the two arms are exchangeable on a shared seed", flipping the
 * sign of any subset of the per-seed differences is equally likely, so the
 * reference distribution of the mean is its 2^n sign-flips. For n ≤ 20 that is
 * enumerated — 1,048,576 arrangements at the top end, which is a few hundred
 * milliseconds and worth it for an exact p. Above that it is sampled from a
 * seeded stream, and `method` says which happened.
 */
export interface PermutationTest {
  n: number;
  /** |mean of the observed differences| — the statistic being permuted. */
  statistic: number;
  /** Two-sided p: the share of sign-flips at least as extreme. */
  p: number;
  method: 'exact-enumeration' | 'monte-carlo';
  /** 2^n, or the number of draws taken. */
  draws: number;
  seed: string;
  /** The smallest p this n could ever produce: 2 / 2^n. */
  floorP: number;
  /** False when even the most extreme arrangement could not clear alpha. */
  couldReachAlpha: boolean;
  alpha: number;
}

/**
 * THE DECLARED CONTRAST FAMILY. Four pre-registered questions ship in
 * `mcp/evalTools.ts#PRE_REGISTERED`, each with its own primary metric, and
 * round 4 corrected NONE of them: `holmAdjusted` existed and `contrastsOf`
 * never called it, while `multipleComparisonNote` counted only one contrast's
 * exploratory rows. Four primary tests at α = 0.05 is a family, and the family
 * size is what `MIN_PAIRED_SEEDS` has to be derived from.
 */
export const DECLARED_CONTRAST_FAMILY = 4;

/**
 * The fewest paired SEEDS at which any verdict may be printed — HOLM-CORRECTED
 * ACROSS THE DECLARED FAMILY (S8).
 *
 * The smallest attainable two-sided p at n seeds is 2/2ⁿ, for the sign-flip
 * permutation test and for the sign test alike. Holm multiplies the smallest
 * p in a family of `family` by `family`, so the question is the smallest n with
 * `family · 2/2ⁿ ≤ alpha`: **6** for a family of one, and **8** for the four
 * contrasts actually declared (4·2/2⁸ = 0.03125 ≤ 0.05, while 4·2/2⁷ = 0.0625
 * is not). Round 4 shipped 6, which is right only for a family of one.
 */
export function minimumPairedSeeds(alpha = 0.05, family = 1): number {
  for (let n = 1; n <= 64; n++) if ((family * 2) / Math.pow(2, n) <= alpha) return n;
  return 64;
}

export const MIN_PAIRED_SEEDS: number = minimumPairedSeeds(0.05, DECLARED_CONTRAST_FAMILY);

/**
 * THE SIGN TEST, the assumption-light check that travels beside the permutation
 * test (S3/S5).
 *
 * The sign-flip permutation test is exact under SIGN SYMMETRY, not under
 * exchangeability of arms in general, and the reviewer measured its level on
 * genuinely right-skewed differences — the shape `dietBreadth`, `deaths:*` and
 * `distinctPlanShapes` take — at **0.112 at n = 6, 2.2× α**. Round 4's
 * "holds its level on skewed differences" test symmetrised by construction
 * (`rng() < 0.5 ? draw() : -draw()`), on which the test is exact tautologically.
 *
 * The sign test assumes only that each difference is equally likely to be
 * positive or negative under the null, which survives any amount of skew. It is
 * less powerful, and it is reported beside the permutation test rather than
 * instead of it: a VERDICT needs BOTH.
 */
export interface SignTest {
  n: number;
  positives: number;
  negatives: number;
  /** Zeroes are dropped, as the sign test requires, and reported. */
  ties: number;
  p: number;
  floorP: number;
  couldReachAlpha: boolean;
  alpha: number;
}

export function signTest(values: readonly number[], alpha = 0.05): SignTest | null {
  if (values.length < 1) return null;
  const positives = values.filter((v) => v > 0).length;
  const negatives = values.filter((v) => v < 0).length;
  const ties = values.length - positives - negatives;
  const n = positives + negatives;
  const floorP = n > 0 ? Math.min(1, 2 / Math.pow(2, n)) : 1;
  return {
    n,
    positives,
    negatives,
    ties,
    p: n > 0 ? exactBinomialTwoSided(positives, n) : 1,
    floorP: round(floorP, 1e6),
    couldReachAlpha: n > 0 && floorP <= alpha,
    alpha,
  };
}

export function signFlipPermutation(
  values: readonly number[],
  options: { alpha?: number; seed?: string; draws?: number } = {},
): PermutationTest | null {
  const n = values.length;
  if (n < 1) return null;
  const alpha = options.alpha ?? 0.05;
  const seed = options.seed ?? 'permutation';
  const total = values.reduce((s, v) => s + v, 0);
  const statistic = Math.abs(total) / n;
  const floorP = Math.min(1, 2 / Math.pow(2, n));
  const tolerance = 1e-12;

  if (n <= 20) {
    const arrangements = 1 << n;
    let atLeast = 0;
    for (let mask = 0; mask < arrangements; mask++) {
      let sum = 0;
      for (let i = 0; i < n; i++) sum += (mask & (1 << i)) === 0 ? values[i]! : -values[i]!;
      if (Math.abs(sum) / n >= statistic - tolerance) atLeast++;
    }
    return {
      n,
      statistic: round(statistic, 1e6),
      p: round(atLeast / arrangements, 1e6),
      method: 'exact-enumeration',
      draws: arrangements,
      seed,
      floorP: round(floorP, 1e6),
      couldReachAlpha: floorP <= alpha,
      alpha,
    };
  }

  const draws = options.draws ?? 20000;
  const rng = mulberry32(hashSeed(`sign-flip:${seed}:${n}`));
  let atLeast = 1; // the observed arrangement is one of the draws
  for (let draw = 1; draw < draws; draw++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += rng() < 0.5 ? values[i]! : -values[i]!;
    if (Math.abs(sum) / n >= statistic - tolerance) atLeast++;
  }
  return {
    n,
    statistic: round(statistic, 1e6),
    p: round(atLeast / draws, 1e6),
    method: 'monte-carlo',
    draws,
    seed,
    floorP: round(floorP, 1e6),
    couldReachAlpha: floorP <= alpha,
    alpha,
  };
}

export interface BootstrapOptions {
  seed?: string;
  resamples?: number;
  /** Two-sided coverage. Default 0.95. */
  level?: number;
  /** The permutation test's threshold, and the one `verdictEligible` is read at. Default 0.05. */
  alpha?: number;
  /** How many primary tests this row belongs to. Default `DECLARED_CONTRAST_FAMILY`. */
  family?: number;
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
  const alpha = options.alpha ?? 0.05;
  const permutation = signFlipPermutation(values, { alpha, seed: options.seed ?? metric });
  const sign = signTest(values, alpha);
  const family = options.family ?? DECLARED_CONTRAST_FAMILY;
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
    permutation,
    sign,
    bothTestsPass: permutation !== null && sign !== null && permutation.p <= alpha && sign.p <= alpha,
    familyAdjustedP: null,
    verdictEligible: n >= minimumPairedSeeds(alpha, family),
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
  const key = `${pairs}:${alpha}`;
  const cached = winsCache.get(key);
  if (cached) return cached;
  // p falls as k moves away from n/2, so the first k that clears alpha is the
  // smallest one that ever will.
  let answer: JudgeDesignPower = { pairs, alpha, minimumWins: null, minimumWinRate: null, underpowered: true };
  for (let wins = Math.ceil(pairs / 2); wins <= pairs; wins++) {
    if (exactBinomialTwoSided(wins, pairs) <= alpha) {
      answer = { pairs, alpha, minimumWins: wins, minimumWinRate: round(wins / pairs), underpowered: false };
      break;
    }
  }
  winsCache.set(key, answer);
  return answer;
}

const winsCache = new Map<string, JudgeDesignPower>();

/** The fewest pairs at which a clean sweep clears alpha. */
export function pairsForSweep(alpha = 0.05): number {
  for (let n = 1; n <= 200; n++) if (exactBinomialTwoSided(n, n) <= alpha) return n;
  return 200;
}

// ─── The judge gate: one rule, pre-registered, with its power printed ────────

/**
 * THE GATE THAT COULD NOT RETURN A VERDICT, AND WHY THE POWER MODEL DID NOT SAY SO.
 *
 * Round 2 sized the threshold on ALL pairs — `minimumDetectableWins(30)` = 21 —
 * and compared it against `wins.A`, a count over DECISIVE pairs. Round 3 fixed
 * the denominator and left the deeper fault: THE GATE AND ITS POWER MODEL WERE
 * TWO DIFFERENT THINGS.
 *
 *   `judgeTraces` demanded that `minDecisiveRate` (0.5) of **all judged pairs**
 *   be decisive, and a pair is decisive only when both of its showings name the
 *   same arm — so every tie and every order-flip counts against that
 *   denominator. `judgeGatePower` modelled P(A) = w², P(B) = (1−w)² and the rest
 *   "inconsistent", WITH NO TIE MASS AT ALL, and never modelled the position
 *   check at all. With a per-showing tie rate q the true expected decisive rate
 *   is (1−q)²(w² + (1−w)²) — 0.58 at q = 0, **0.284 at q = 0.30** — against a
 *   fixed floor of 0.5. Break-even is q ≈ 0.072: a **7%** tie rate put the
 *   1,120-call block at the knife edge, and the reviewer measured P(USABLE) =
 *   **0.0015** at q = 0.30, w = 0.70, 40 pairs. The block bought no verdict and
 *   nothing said so, because the number printed beside it came from a model in
 *   which ties do not exist.
 *
 * So the gate and the model are ONE THING now. `judgeGatePower` enumerates the
 * SAME rule `judgeTraces` applies — the decisive floor, the exact sign test over
 * the decisive pairs, AND the position check that can void a verdict on its own
 * — under a per-showing tie rate and a per-showing position preference, both of
 * which are PRE-REGISTERED in `JUDGE_GATE` with the reasoning for their values.
 * `test/eval-stats.test.ts` pins the enumeration against ≥ 2,000 runs through
 * the real `judgeTraces` at four tie rates and two position rates.
 *
 * THE RULE, in the order `judgeTraces` applies it:
 *
 *   1. A pair is DECISIVE when both orders name the same arm; ties and
 *      order-flips are neither wins nor losses, and both are reported.
 *   2. At least `minDecisiveRate` of the judged pairs must be decisive — a floor
 *      set at HALF the decisive rate the pre-registration assumes, so a judge
 *      twice as indecisive as pre-registered is reported as a finding about the
 *      judge rather than as a verdict about the arms.
 *   3. The winner needs `minimumDetectableWins(decisivePairs, α)` wins OF THOSE
 *      DECISIVE PAIRS — the exact two-sided sign test conditioned on the
 *      non-ties.
 *   4. The position check must not exclude a half, and must not be unmeasured.
 *   5. The run must have judged at least `pairsForJudgePower(targetPower)` pairs.
 *      Below that the block is EXPLORATORY and may not print a verdict at all:
 *      an under-powered block that returns "not significant" is not a null
 *      result, it is an absence of measurement, and round 3 shipped one at 40.
 */
export interface JudgeGateRule {
  alpha: number;
  /** The least share of judged pairs whose two orders must agree on an arm. */
  minDecisiveRate: number;
  /** The per-showing win rate the design is powered for. Declared, not hoped for. */
  declaredEffect: number;
  /**
   * PRE-REGISTERED: the share of showings on which the judge is expected to
   * answer "tie". Sizing a design at q = 0 is what produced a 1,120-call block
   * with 0.0015 power, so the assumption is declared and sized under.
   */
  assumedTieRate: number;
  /**
   * PRE-REGISTERED: the share of DECISIVE showings on which the judge is
   * expected to name the LEFT trace. 0.5 is "no side preference".
   */
  assumedPositionLeftRate: number;
  /** The power the design must reach under those assumptions before a verdict is allowed. */
  targetPower: number;
  /**
   * PRE-REGISTERED (S2): among pairs where BOTH orders named an arm, the share
   * that named the SAME arm must EXCEED this. 0.50 is a coin: a judge that
   * contradicts itself on the same two traces at least as often as it agrees
   * has measured nothing, whatever its win rate says. The declared effect
   * implies w² + (1−w)² = **0.58**; a judge that cannot tell the arms apart
   * implies exactly 0.50, and the reviewer's `usable=true` run sat below it.
   */
  minDecidedAgreementRate: number;
  /**
   * PRE-REGISTERED (S1): the fewest independent SEEDS that must contribute at
   * least one decisive pair before any verdict. The pair is not the unit of
   * analysis; the run is. `MIN_PAIRED_SEEDS` = 8, Holm-corrected across the
   * four declared contrasts.
   */
  minDecisiveClusters: number;
  /**
   * FALSE UNTIL A PILOT MEASURES THEM (S2). `assumedTieRate` and
   * `minDecisiveRate` are ASSUMPTIONS — the justification calls 0.30
   * "deliberately pessimistic" and 0.15 is half of the decisive rate it
   * implies, so the floor is derived from a number nothing has measured. Every
   * design stamps `assumptionStatus` from this flag, and the estimation pilot
   * exists to replace it.
   */
  assumptionsMeasured: boolean;
  /** Why those numbers, in words, so a reader is not left to guess. */
  justification: string;
}

/**
 * THE PRE-REGISTRATION. Deep-frozen: `Object.isFrozen(JUDGE_GATE)` was FALSE in
 * round 3 and `judgeTraces` accepted `options.gate`, so a rigged 21-of-40 split
 * at exact two-sided p = 0.8746 printed `usableForVerdict: true` under
 * `{alpha: 0.9, minDecisiveRate: 0.01, declaredEffect: 0.99}`, and mutating
 * `JUDGE_GATE.alpha` in place made the DEFAULT path print it. A rule that can be
 * edited after the numbers are in is not a pre-registration; it is a naming
 * convention.
 */
export const JUDGE_GATE: JudgeGateRule = deepFreeze({
  alpha: 0.05,
  // Half of 0.284 — the decisive rate the assumptions below imply at w = 0.70.
  minDecisiveRate: 0.15,
  declaredEffect: 0.7,
  assumedTieRate: 0.3,
  assumedPositionLeftRate: 0.5,
  targetPower: 0.8,
  minDecidedAgreementRate: 0.5,
  minDecisiveClusters: MIN_PAIRED_SEEDS,
  assumptionsMeasured: false,
  justification:
    'THE UNIT IS THE RUN, NOT THE PAIR. 64 pairs bought from ONE seed are one cluster: in population mode each arm ' +
    'is its own Experiment, so every pair of a seed carries that seed\'s run-level difference and the pairs are not ' +
    'independent Bernoulli draws. Driven through the real gate under a run-exchangeable null, a per-run judge shift ' +
    'of only 0.05 put type I at 1.4x alpha and a shift of 0.5 returned a VERDICT 93% of the time. So a seed ' +
    'contributes its decisive-pair win fraction, the test is over SEEDS, and at least ' + String(MIN_PAIRED_SEEDS) +
    ' seeds must be decisive. ' +
    'DECIDED-AGREEMENT 0.50: among pairs where both orders committed to an arm, the declared effect implies they ' +
    'agree 0.58 of the time and a judge that cannot tell them apart implies 0.50. Requiring MORE agreement than ' +
    'contradiction costs some power, which is measured and printed rather than assumed away. ' +
    'TIE RATE 0.30 per showing: the traces are 8 moments of a being a third of a sim day old, the judge is asked ' +
    'which of two such records reads as more ALIVE, and "neither, really" is the honest answer to a large share of ' +
    'them. The reviewer measured break-even for the old 0.5 decisive floor at q = 0.072 and observed that an LLM ' +
    'judge on 8-moment traces will tie more than that; 0.30 is deliberately pessimistic, because a design sized ' +
    'under an optimistic tie rate is the exact failure this number exists to prevent. A measured tie rate BELOW ' +
    '0.30 leaves the block over-powered, which costs nothing. ' +
    'POSITION LEFT RATE 0.50: a systematic side preference is a VETO, not a design parameter. It cannot be powered ' +
    'against — measured on this same model, a judge that names the left trace 0.55 of the time plateaus at 0.70 ' +
    'power and then FALLS as pairs are added, because the position interval narrows onto the bias — so the design ' +
    'is sized for an unbiased judge and the position check voids the verdict if the judge turns out not to be one. ' +
    'What a biased judge would do is printed rather than assumed away: at 64 pairs a 0.60 left rate reaches 0.345 ' +
    'power at w = 0.70, and type I stays at or below alpha at every tie rate and every position rate.',
});

/**
 * A stable digest of the rule, so an artefact can be bound to the text of it.
 *
 * VERSION 2: the cluster floor, the decided-agreement floor and the
 * "have the assumptions been measured" flag are part of the rule, so they are
 * part of its identity. A v1 hash on a v2 artefact is a mismatch, which is the
 * point — round 4's `ruleHash` bound the RULE and nothing else, and an artefact
 * post-processed to `usableForVerdict: true` still carried a valid one (S8).
 * `judgeTraces` now binds the NUMBERS too, through the run attestation.
 */
export function hashJudgeGate(rule: JudgeGateRule): string {
  return sha256Hex(
    `yggdrasil/judge-gate/v2:${rule.alpha}|${rule.minDecisiveRate}|${rule.declaredEffect}|` +
      `${rule.assumedTieRate}|${rule.assumedPositionLeftRate}|${rule.targetPower}|` +
      `${rule.minDecidedAgreementRate}|${rule.minDecisiveClusters}|${rule.assumptionsMeasured}`,
  );
}

export const JUDGE_GATE_HASH: string = hashJudgeGate(JUDGE_GATE);

/** Every numeric field of a rule that differs from the pre-registration, with both values. */
export function judgeGateOverrides(rule: JudgeGateRule): { field: string; preRegistered: number; used: number }[] {
  const fields: readonly (keyof JudgeGateRule)[] = [
    'alpha',
    'minDecisiveRate',
    'declaredEffect',
    'assumedTieRate',
    'assumedPositionLeftRate',
    'targetPower',
    'minDecidedAgreementRate',
    'minDecisiveClusters',
  ];
  const out: { field: string; preRegistered: number; used: number }[] = [];
  for (const field of fields) {
    const used = rule[field];
    const declared = JUDGE_GATE[field];
    if (typeof used === 'number' && typeof declared === 'number' && used !== declared) {
      out.push({ field, preRegistered: declared, used });
    }
  }
  return out;
}

/** The conditions a power figure is computed AT. Defaults: the pre-registration's own. */
export interface JudgeGateConditions {
  /** Per-showing win rate for the first arm, among showings decided on merit. */
  effect?: number;
  /** Per-showing tie rate. */
  tieRate?: number;
  /** Share of decisive showings on which the judge names the LEFT trace. */
  positionLeftRate?: number;
}

export interface JudgeGatePower {
  pairs: number;
  alpha: number;
  declaredEffect: number;
  minDecisiveRate: number;
  /** The conditions this figure was computed at. */
  tieRate: number;
  positionLeftRate: number;
  /** P(a pair is decisive) at these conditions — ties and position bias included. */
  expectedDecisiveRate: number;
  /**
   * P(the gate prints USABLE **and** names the better arm) at these conditions.
   * NOT an upper bound any more: the position check is enumerated with the rest,
   * which is what round 3's figure was missing.
   */
  power: number;
  /** P(the gate prints USABLE for either arm) under a judge that cannot tell them apart. */
  typeIError: number;
  /** P(the position check alone voids the verdict) at these conditions. */
  positionVoidRate: number;
}

/**
 * The power of the rule above, computed exactly rather than simulated.
 *
 * THE MODEL, stated so it can be checked. Every pair is shown twice: once with
 * the first arm on the LEFT and once with it on the right. A showing is a tie
 * with probability q; otherwise the judge answers by POSITION with probability
 * β = 2|p − ½| (naming the favoured side whatever sits on it) and by MERIT
 * otherwise (naming the first arm with probability w). That gives nine outcomes
 * per pair, exactly two of which are decisive, and the left/right tallies follow
 * from the same nine — so the arm verdict and the position check are enumerated
 * from ONE distribution rather than modelled apart.
 *
 * At q = 0 and p = ½ it collapses to the trinomial round 3 used, minus the
 * position check that model never had: 0.800 at 40 pairs where round 3 printed
 * 0.827, and 0.800 is what the real gate does.
 */
export function judgeGatePower(
  pairs: number,
  rule: JudgeGateRule = JUDGE_GATE,
  at: JudgeGateConditions = {},
): JudgeGatePower {
  const w = at.effect ?? rule.declaredEffect;
  const q = at.tieRate ?? rule.assumedTieRate;
  const p = at.positionLeftRate ?? rule.assumedPositionLeftRate;
  const key = `${pairs}|${rule.alpha}|${rule.minDecisiveRate}|${w}|${q}|${p}`;
  const cached = powerCache.get(key);
  if (cached) return cached;

  const alternative = pairCategories(w, q, p);
  const answer: JudgeGatePower = {
    pairs,
    alpha: rule.alpha,
    declaredEffect: w,
    minDecisiveRate: rule.minDecisiveRate,
    tieRate: q,
    positionLeftRate: p,
    expectedDecisiveRate: round(alternative.pA + alternative.pB),
    power: round(gateProbability(pairs, w, q, p, rule, 'winner', true), 1e6),
    typeIError: round(gateProbability(pairs, 0.5, q, p, rule, 'either', true), 1e6),
    positionVoidRate: round(1 - positionPassRate(pairs, w, q, p), 1e6),
  };
  if (powerCache.size > 4096) powerCache.clear();
  powerCache.set(key, answer);
  return answer;
}

const powerCache = new Map<string, JudgeGatePower>();

/** The nine outcomes of one pair, as probabilities and left/right contributions. */
interface PairCategories {
  /** Both showings named the first arm. */
  pA: number;
  /** Both named the second. */
  pB: number;
  /** Everything else, with what it contributes to the left and right tallies. */
  nonDecisive: { p: number; left: number; right: number }[];
}

function pairCategories(w: number, q: number, p: number): PairCategories {
  const beta = Math.min(1, 2 * Math.abs(p - 0.5));
  const favoursLeft = p >= 0.5;
  const decided = 1 - q;
  // X is the showing with the first arm on the LEFT; Y is the mirror. Every
  // pair supplies exactly one of each, whichever order was called "forward".
  const xA = decided * (favoursLeft ? beta + (1 - beta) * w : (1 - beta) * w);
  const xB = decided * (favoursLeft ? (1 - beta) * (1 - w) : beta + (1 - beta) * (1 - w));
  const yA = decided * (favoursLeft ? (1 - beta) * w : beta + (1 - beta) * w);
  const yB = decided * (favoursLeft ? beta + (1 - beta) * (1 - w) : (1 - beta) * (1 - w));
  return {
    pA: xA * yA,
    pB: xB * yB,
    nonDecisive: [
      { p: xA * yB, left: 2, right: 0 },
      { p: xA * q, left: 1, right: 0 },
      { p: xB * yA, left: 0, right: 2 },
      { p: xB * q, left: 0, right: 1 },
      { p: q * yA, left: 0, right: 1 },
      { p: q * yB, left: 1, right: 0 },
      { p: q * q, left: 0, right: 0 },
    ].filter((row) => row.p > 0),
  };
}

/**
 * P(the position check passes) for every possible number of decisive pairs, in
 * one pass.
 *
 * A DECISIVE pair always contributes exactly one left and one right — both
 * orders named the same arm, and that arm sat on each side once — so the only
 * random part of the position tally comes from the non-decisive pairs, and the
 * check factorises out of the arm count given how many pairs were decisive.
 * That is what makes an exact enumeration affordable at these n.
 */
function positionPassByDecisive(pairs: number, w: number, q: number, p: number): Float64Array {
  const { pA, pB, nonDecisive } = pairCategories(w, q, p);
  const spare = Math.max(0, 1 - pA - pB);
  const conditional = nonDecisive.map((row) => ({ ...row, p: spare > 0 ? row.p / spare : 0 }));
  const stride = 2 * pairs + 2;
  let distribution = new Float64Array(stride * stride);
  distribution[0] = 1;
  const pass = new Float64Array(pairs + 1);
  for (let spareCount = 0; spareCount <= pairs; spareCount++) {
    if (spareCount > 0) {
      const next = new Float64Array(stride * stride);
      const reach = 2 * (spareCount - 1);
      for (let left = 0; left <= reach; left++) {
        for (let right = 0; left + right <= reach; right++) {
          const mass = distribution[left * stride + right] ?? 0;
          if (mass === 0) continue;
          for (const row of conditional) {
            const at = (left + row.left) * stride + (right + row.right);
            next[at] = (next[at] ?? 0) + mass * row.p;
          }
        }
      }
      distribution = next;
    }
    const decisive = pairs - spareCount;
    const reach = 2 * spareCount;
    let ok = 0;
    for (let left = 0; left <= reach; left++) {
      for (let right = 0; left + right <= reach; right++) {
        const mass = distribution[left * stride + right] ?? 0;
        if (mass === 0) continue;
        const l = decisive + left;
        const r = decisive + right;
        // The two reasons `judgeTraces` voids a verdict on position, verbatim:
        // an interval that excludes a half, and nothing decisive to measure.
        if (l + r === 0) continue;
        const interval = wilsonInterval(l, l + r, 1.96);
        if (interval.low > 0.5 || interval.high < 0.5) continue;
        ok += mass;
      }
    }
    pass[decisive] = ok;
  }
  return pass;
}

function positionPassRate(pairs: number, w: number, q: number, p: number): number {
  if (pairs <= 0) return 0;
  const { pA, pB } = pairCategories(w, q, p);
  const spare = Math.max(0, 1 - pA - pB);
  const pass = positionPassByDecisive(pairs, w, q, p);
  let total = 0;
  for (let a = 0; a <= pairs; a++) {
    for (let b = 0; a + b <= pairs; b++) {
      const mass = trinomial(pairs, a, b, pA, pB, spare);
      if (mass > 0) total += mass * (pass[a + b] ?? 0);
    }
  }
  return Math.min(1, total);
}

function gateProbability(
  pairs: number,
  w: number,
  q: number,
  p: number,
  rule: JudgeGateRule,
  count: 'winner' | 'either',
  includePosition: boolean,
): number {
  if (pairs <= 0) return 0;
  const { pA, pB } = pairCategories(w, q, p);
  const spare = Math.max(0, 1 - pA - pB);
  const needDecisive = Math.ceil(rule.minDecisiveRate * pairs);
  const pass = includePosition ? positionPassByDecisive(pairs, w, q, p) : null;

  let total = 0;
  for (let a = 0; a <= pairs; a++) {
    for (let b = 0; a + b <= pairs; b++) {
      const decisive = a + b;
      if (decisive < needDecisive) continue;
      const minimum = minimumDetectableWins(decisive, rule.alpha).minimumWins;
      if (minimum === null) continue;
      const passes = count === 'winner' ? a >= minimum : a >= minimum || b >= minimum;
      if (!passes) continue;
      const mass = trinomial(pairs, a, b, pA, pB, spare);
      if (mass <= 0) continue;
      total += pass ? mass * (pass[decisive] ?? 0) : mass;
    }
  }
  return Math.min(1, total);
}

function trinomial(n: number, a: number, b: number, pA: number, pB: number, pRest: number): number {
  const rest = n - a - b;
  if ((a > 0 && pA <= 0) || (b > 0 && pB <= 0) || (rest > 0 && pRest <= 0)) return 0;
  const logP =
    logGamma(n + 1) -
    logGamma(a + 1) -
    logGamma(b + 1) -
    logGamma(rest + 1) +
    (a > 0 ? a * Math.log(pA) : 0) +
    (b > 0 ? b * Math.log(pB) : 0) +
    (rest > 0 ? rest * Math.log(pRest) : 0);
  return Math.exp(logP);
}

/**
 * The fewest pairs at which the gate reaches `power` under the PRE-REGISTERED
 * conditions — the number the pilot recipe has to buy.
 *
 * Two phases, because the exact model is cubic in the number of pairs: the
 * position-free probability is an upper bound on the full one, so the cheap
 * model gives a lower bound on the answer and the expensive one runs only from
 * there. Null when no n up to `cap` reaches it, which is the honest answer for
 * a judge with a real side preference — adding pairs narrows the position
 * interval onto the bias, so the verdict is voided MORE often, not less.
 */
export function pairsForJudgePower(
  power: number = JUDGE_GATE.targetPower,
  rule: JudgeGateRule = JUDGE_GATE,
  cap = 200,
  at: JudgeGateConditions = {},
): number | null {
  const w = at.effect ?? rule.declaredEffect;
  const q = at.tieRate ?? rule.assumedTieRate;
  const p = at.positionLeftRate ?? rule.assumedPositionLeftRate;
  const key = `${power}|${rule.alpha}|${rule.minDecisiveRate}|${w}|${q}|${p}|${cap}`;
  const cached = pairsCache.get(key);
  if (cached !== undefined) return cached;

  let from = 2;
  for (let pairs = 2; pairs <= cap; pairs++) {
    from = pairs;
    if (gateProbability(pairs, w, q, p, rule, 'winner', false) >= power) break;
  }
  let answer: number | null = null;
  for (let pairs = from; pairs <= cap; pairs++) {
    if (judgeGatePower(pairs, rule, { effect: w, tieRate: q, positionLeftRate: p }).power >= power) {
      answer = pairs;
      break;
    }
  }
  pairsCache.set(key, answer);
  return answer;
}

const pairsCache = new Map<string, number | null>();

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
  /** The pre-registered assumptions this design was sized under. */
  assumedTieRate: number;
  assumedPositionLeftRate: number;
  /** Power of this rule at the declared effect, for the number of pairs JUDGED. */
  power: number;
  targetPower: number;
  /** Pairs this rule needs to reach `targetPower` under those assumptions. */
  pairsForTargetPower: number | null;
  /** False when fewer pairs were judged than that. An exploratory block. */
  adequatelyPowered: boolean;
  /**
   * THE POWER OF THE BLOCK THAT ACTUALLY RAN (S2), recomputed at the OBSERVED
   * tie rate rather than at the pre-registered one. Round 4 printed
   * `power: 0.802408` — a number false of the block in front of it — beside a
   * verdict drawn from 13 decisive pairs at a realised tie rate of 0.5, whose
   * true power was 0.2618. Null only when nothing was observed.
   */
  poweredAsRun: number | null;
  /** `poweredAsRun >= targetPower`. The condition a CONFIRMATORY block must meet. */
  adequatelyPoweredAsRun: boolean;
  /** The tie rate the run had, as opposed to the one it was sized under. */
  observedTieRate: number | null;
  /** Among pairs where both orders named an arm, the share that named the same one. */
  observedDecidedAgreementRate: number | null;
  minDecidedAgreementRate: number;
  /** Seeds contributing at least one decisive pair — the real n (S1). */
  decisiveClusters: number | null;
  minDecisiveClusters: number;
  /**
   * Whether the numbers this design was sized under have ever been measured.
   * `ASSUMED` until an estimation pilot replaces them; `judgeGateDesign` copies
   * it onto every artefact so a reader is never left to infer it.
   */
  assumptionStatus: 'ASSUMED' | 'MEASURED';
  /** What a block of this size may be called. A verdict needs `confirmatory`. */
  role: 'confirmatory' | 'exploratory' | 'underpowered-as-run';
  expectedDecisiveRate: number;
  typeIError: number;
  positionVoidRate: number;
  /** Was the rule the pre-registered one, value for value? */
  preRegistered: boolean;
  ruleHash: string;
  /** Every value that differs from `JUDGE_GATE`, with both numbers. */
  overrides: { field: string; preRegistered: number; used: number }[];
  /** The pre-registration's own words for why the assumptions are what they are. */
  justification: string;
}

/**
 * WHAT THE RUN ACTUALLY DID — handed to `judgeGateDesign` so the printed power
 * is the power of the block in front of the reader (S2).
 */
export interface JudgeGateObserved {
  /** Share of SHOWINGS the judge called a tie. Not the share of pairs. */
  tieRate: number;
  /** Decisive pairs / (decisive + contradicted) pairs. Null when nothing was decided. */
  decidedAgreementRate: number | null;
  /** Seeds that contributed at least one decisive pair. */
  decisiveClusters: number;
}

export function judgeGateDesign(
  pairs: number,
  decisivePairs: number,
  rule: JudgeGateRule = JUDGE_GATE,
  observed?: JudgeGateObserved,
): JudgeGateDesign {
  const wins = minimumDetectableWins(decisivePairs, rule.alpha);
  const power = judgeGatePower(pairs, rule);
  const decisiveRate = pairs > 0 ? round(decisivePairs / pairs) : 0;
  const overrides = judgeGateOverrides(rule);
  const needed = pairsForJudgePower(rule.targetPower, rule);
  const adequatelyPowered = needed !== null && pairs >= needed;
  // THE POWER OF THIS BLOCK, at the tie rate this block had.
  const asRun =
    observed && pairs > 0 ? judgeGatePower(pairs, rule, { tieRate: observed.tieRate }).power : null;
  const adequatelyPoweredAsRun = asRun !== null && asRun >= rule.targetPower;
  const enoughClusters = observed !== undefined && observed.decisiveClusters >= rule.minDecisiveClusters;
  const agrees =
    observed !== undefined &&
    observed.decidedAgreementRate !== null &&
    observed.decidedAgreementRate > rule.minDecidedAgreementRate;
  const confirmatory =
    adequatelyPowered && overrides.length === 0 && observed !== undefined && adequatelyPoweredAsRun && enoughClusters && agrees;
  const role: JudgeGateDesign['role'] = confirmatory
    ? 'confirmatory'
    : observed !== undefined && adequatelyPowered && overrides.length === 0
      ? // IT RAN, IT WAS SIZED RIGHT, AND IT STILL CANNOT DECIDE. This is not
        // "no difference" and it is not ordinary exploration: it is a block
        // whose realised conditions took its power away, and it says so.
        'underpowered-as-run'
      : 'exploratory';
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
    assumedTieRate: rule.assumedTieRate,
    assumedPositionLeftRate: rule.assumedPositionLeftRate,
    power: power.power,
    targetPower: rule.targetPower,
    pairsForTargetPower: needed,
    adequatelyPowered,
    poweredAsRun: asRun,
    adequatelyPoweredAsRun,
    observedTieRate: observed?.tieRate ?? null,
    observedDecidedAgreementRate: observed?.decidedAgreementRate ?? null,
    minDecidedAgreementRate: rule.minDecidedAgreementRate,
    decisiveClusters: observed?.decisiveClusters ?? null,
    minDecisiveClusters: rule.minDecisiveClusters,
    assumptionStatus: rule.assumptionsMeasured ? 'MEASURED' : 'ASSUMED',
    role,
    expectedDecisiveRate: power.expectedDecisiveRate,
    typeIError: power.typeIError,
    positionVoidRate: power.positionVoidRate,
    preRegistered: overrides.length === 0,
    ruleHash: hashJudgeGate(rule),
    overrides,
    justification: rule.justification,
  };
}

/** Freeze an object and everything reachable from it. `Object.freeze` is one level deep. */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  for (const key of Object.getOwnPropertyNames(value)) deepFreeze((value as Record<string, unknown>)[key]);
  return Object.freeze(value);
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
