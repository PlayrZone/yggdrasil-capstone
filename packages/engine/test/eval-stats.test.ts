import { describe, expect, it } from 'vitest';
import {
  MIN_PAIRED_SEEDS,
  exactBinomialTwoSided,
  foragerAdapter,
  judgeTraces,
  minimumDetectableEffect,
  minimumDetectableWins,
  minimumPairedSeeds,
  multipleComparisonNote,
  pairTraces,
  pairedBootstrap,
  pairsForSweep,
  runAb,
  signFlipPermutation,
  studentTQuantile,
  swapArmLabels,
  wilsonInterval,
} from '../src/index.js';
import type { TraceJudgement, TracePair } from '../src/index.js';

/**
 * THE STATISTICS — and the four things round 1 claimed without them.
 *
 *   "SEED-PAIRED" WAS NOT PAIRED. `pairMetrics(a, b)` subtracted two already
 *   pooled scalars from ONE seed; `AbSpec.seed` was a single string;
 *   `PairedDiff` carried no n, no spread and no interval; and `variance`,
 *   `bootstrap`, `permutation` and `effectSize` appeared nowhere in the item.
 *
 *   THE JUDGE'S n WAS DOUBLE-COUNTED. Every pair was shown twice and both
 *   showings were tallied as independent decisions, so five pairs read as ten
 *   and a 5-of-5 sweep was quoted with an 8-of-8 interval. The honest n is the
 *   number of PAIRS: 5/5 is exact two-sided p = 0.0625, which is not
 *   significant at any n this pilot can afford.
 *
 *   ~30 COMPARISONS, NO CORRECTION. About one and a half of them look
 *   interesting under a true null, every time it is run.
 *
 *   POSITION BIAS WAS A BARE BOOLEAN that changed nothing when it tripped, and
 *   an all-ties judge read as UNBIASED rather than as unmeasured.
 */

const SPEC = { seeds: ['stats-1', 'stats-2', 'stats-3'], ticks: 600, cohortSize: 3, agentCount: 12 } as const;
const ARMS = [
  { id: 'A' as const, backend: { kind: 'mock', mind: 'faithful' } as const },
  { id: 'B' as const, backend: { kind: 'mock', mind: 'omniscient' } as const },
];

describe('W1-E · a paired difference is one difference per seed', () => {
  it('reports n, spread and a bootstrap interval — and refuses an interval at n = 1', () => {
    const one = pairedBootstrap('planSuccessRate', [{ seed: 's1', a: 0.8, b: 0.5 }], { seed: 'fixed' });
    expect(one.n).toBe(1);
    expect(one.meanDelta).toBeCloseTo(0.3, 6);
    expect(one.sd).toBe(0);
    // ONE SEED IS ONE OBSERVATION. Round 1 printed a delta and nothing else,
    // which reads as a finding; this reads as what it is.
    expect(one.ci).toBeNull();
    expect(one.effectSize).toBeNull();

    const many = pairedBootstrap(
      'planSuccessRate',
      [
        { seed: 's1', a: 0.8, b: 0.5 },
        { seed: 's2', a: 0.7, b: 0.55 },
        { seed: 's3', a: 0.9, b: 0.4 },
        { seed: 's4', a: 0.75, b: 0.6 },
        { seed: 's5', a: 0.85, b: 0.45 },
      ],
      { seed: 'fixed' },
    );
    expect(many.n).toBe(5);
    expect(many.deltas.map((d) => d.seed)).toEqual(['s1', 's2', 's3', 's4', 's5']);
    expect(many.sd).toBeGreaterThan(0);
    expect(many.ci).not.toBeNull();
    expect(many.ci!.low).toBeLessThan(many.meanDelta);
    expect(many.ci!.high).toBeGreaterThan(many.meanDelta);
    expect(many.effectSize).toBeGreaterThan(1);
  });

  it('draws an interval that straddles zero when the seeds disagree', () => {
    const noisy = pairedBootstrap(
      'dispersalMean',
      [
        { seed: 's1', a: 10, b: 4 },
        { seed: 's2', a: 3, b: 9 },
        { seed: 's3', a: 7, b: 6 },
        { seed: 's4', a: 2, b: 8 },
        { seed: 's5', a: 9, b: 3 },
      ],
      { seed: 'fixed' },
    );
    expect(noisy.ci!.low).toBeLessThan(0);
    expect(noisy.ci!.high).toBeGreaterThan(0);
  });

  it('is reproducible from its seed', () => {
    const samples = [
      { seed: 's1', a: 1, b: 0 },
      { seed: 's2', a: 3, b: 1 },
      { seed: 's3', a: 2, b: 2 },
      { seed: 's4', a: 5, b: 1 },
    ];
    expect(pairedBootstrap('m', samples, { seed: 'x' }).ci).toEqual(pairedBootstrap('m', samples, { seed: 'x' }).ci);
  });
});

describe('W1-E · the design is sized before it is run', () => {
  it('says what this many paired seeds could ever have detected', () => {
    expect(minimumDetectableEffect(1).mdeInSdUnits).toBe(Number.POSITIVE_INFINITY);
    const two = minimumDetectableEffect(2);
    const ten = minimumDetectableEffect(10);
    expect(two.mdeInSdUnits).toBeGreaterThan(ten.mdeInSdUnits);
    // Both figures, because they differ by √2 and quoting one for the other is
    // a 1.4× error in the only number that says whether a run could decide.
    // The reviewer's ≈1.77 SD is the UNPAIRED design at 5 per arm; pairing by
    // seed buys 1.25 SD — and only if the pairing is real, which is the whole
    // reason `AbSpec.seeds` is a list now.
    expect(minimumDetectableEffect(5).mdeInSdUnits).toBeCloseTo(1.25, 2);
    expect(minimumDetectableEffect(5).mdeUnpairedPerArm).toBeCloseTo(1.77, 2);
  });

  it('says how many judged PAIRS a sweep needs before it means anything', () => {
    // The pilot's five pairs: 5/5 is p = 0.0625. Not significant, at any answer.
    expect(exactBinomialTwoSided(5, 5)).toBeCloseTo(0.0625, 6);
    expect(minimumDetectableWins(5).underpowered).toBe(true);
    expect(minimumDetectableWins(5).minimumWins).toBeNull();
    // Six is the first n at which a clean sweep clears 0.05.
    expect(pairsForSweep()).toBe(6);
    expect(exactBinomialTwoSided(6, 6)).toBeCloseTo(0.03125, 6);
    const thirty = minimumDetectableWins(30);
    expect(thirty.underpowered).toBe(false);
    expect(thirty.minimumWins).toBe(21);
    expect(thirty.minimumWinRate).toBeCloseTo(0.7, 2);
  });

  it('says what 184 held-out items can and cannot certify about the leak judge', () => {
    // P5. The calibration card's rule was "recall ≥ 0.80 at precision ≥ 0.95 →
    // tier 3 is calibrated", read off POINT ESTIMATES over ~100 positives. A
    // true recall of 0.80 passes that about half the time and a true 0.85 fails
    // it about one time in fifteen, so the rule was a coin flip at its own
    // boundary. Restated as a LOWER BOUND, the sample says what it can support.
    const positives = 100;
    const observed = wilsonInterval(80, positives);
    expect(observed.low).toBeCloseTo(0.711, 2);
    expect(observed.high).toBeCloseTo(0.867, 2);

    let recallBar = positives;
    for (let k = 0; k <= positives; k++) {
      if (wilsonInterval(k, positives).low >= 0.8) {
        recallBar = k;
        break;
      }
    }
    let flagsForPrecision = 0;
    for (let f = 1; f <= 400; f++) {
      if (wilsonInterval(f, f).low >= 0.95) {
        flagsForPrecision = f;
        break;
      }
    }
    // eslint-disable-next-line no-console
    console.log(
      `calibration at ${positives} positives: an observed recall of 0.80 is [${observed.low}, ${observed.high}] — ` +
        `certifying ≥ 0.80 needs ${recallBar}/${positives} observed; precision ≥ 0.95 as a lower bound needs ` +
        `${flagsForPrecision} flags with no false positive.`,
    );
    expect(recallBar).toBeGreaterThanOrEqual(87);
    expect(flagsForPrecision).toBeGreaterThanOrEqual(70);
  });

  it('carries a multiple-comparison note wherever it prints many rows', () => {
    const note = multipleComparisonNote(30);
    expect(note.expectedFalsePositives).toBeCloseTo(1.5, 6);
    expect(note.perRowAlpha).toBeCloseTo(0.05 / 30, 6);
    expect(note.text).toContain('exploratory');
  });
});

describe('W1-E · the judge is counted by the PAIR', () => {
  it('counts one observation per pair, not one per showing, and reports the agreement rate', async () => {
    const result = await runAb({ ...SPEC }, { arms: ARMS });
    if (!result.usable) throw new Error(result.reason);
    const pairs = pairTraces(result.traces, result.key, 'judge-n').pairs;
    const aggregate = await judgeTraces(pairs, result.key, { id: 'mock-feature-judge', compare: featureJudge });

    // Round 1: `judgements` WAS the n, so this many pairs read as twice as many.
    expect(aggregate.pairs).toBe(pairs.length);
    expect(aggregate.showings).toBe(pairs.length * 2);
    expect(aggregate.wins.A + aggregate.wins.B + aggregate.wins.ties + aggregate.wins.inconsistent).toBe(pairs.length);
    expect(aggregate.wilson).toEqual(wilsonInterval(aggregate.wins.A, aggregate.decisivePairs));
    expect(aggregate.exactP).toBe(exactBinomialTwoSided(aggregate.wins.A, aggregate.decisivePairs));
    // Round 1's `flippedPairs` was 0 by construction, because the two showings
    // of one pair were tallied independently and never compared.
    expect(aggregate.bothOrdersConsistencyRate).toBeGreaterThan(0);
    expect(aggregate.design.pairs).toBe(pairs.length);
    // eslint-disable-next-line no-console
    console.log(
      `judge: ${aggregate.wins.A}/${aggregate.decisivePairs} decisive pairs of ${aggregate.pairs}, ` +
        `p = ${aggregate.exactP}, Wilson [${aggregate.wilson.low}, ${aggregate.wilson.high}], ` +
        `orders agreed ${aggregate.bothOrdersConsistencyRate}, usable ${aggregate.usableForVerdict}`,
    );
  }, 180_000);

  it('refuses a verdict when the design could not have reached one', async () => {
    const result = await runAb({ ...SPEC, seeds: ['under'], cohortSize: 2 }, { arms: ARMS });
    if (!result.usable) throw new Error(result.reason);
    const pairs = pairTraces(result.traces, result.key, 'underpowered').pairs;
    expect(pairs.length).toBeLessThan(6);
    const aggregate = await judgeTraces(pairs, result.key, { id: 'mock-feature-judge', compare: featureJudge });
    // Even a clean sweep at this n is p > 0.05, and the aggregate says so
    // instead of printing a win rate somebody would quote.
    expect(aggregate.design.underpowered).toBe(true);
    expect(aggregate.usableForVerdict).toBe(false);
    expect(aggregate.note).toContain('NOT USABLE FOR A VERDICT');
  }, 180_000);

  it('catches a judge that just prefers whatever is on the left, and voids the verdict', async () => {
    const result = await runAb({ ...SPEC }, { arms: ARMS });
    if (!result.usable) throw new Error(result.reason);
    const pairs = pairTraces(result.traces, result.key, 'left-bias').pairs;
    const lazy = {
      id: 'always-left',
      compare: (): Promise<TraceJudgement> =>
        Promise.resolve({
          preference: 'left' as const,
          confidence: 1,
          reasons: ['left'],
          byCriterion: { pursues: 'left', consistent: 'left', reactive: 'left', social: 'left', ignorance: 'left' } as const,
        }),
    };
    const aggregate = await judgeTraces(pairs, result.key, lazy);
    expect(aggregate.position.leftRate).toBe(1);
    expect(aggregate.position.biased).toBe(true);
    // Every pair's two showings disagree about the ARM, so no pair is decided —
    // round 1 reported a tidy 0.50 win rate from exactly this.
    expect(aggregate.decisivePairs).toBe(0);
    expect(aggregate.wins.inconsistent).toBe(pairs.length);
    expect(aggregate.bothOrdersConsistencyRate).toBe(0);
    // And the bias now CHANGES something.
    expect(aggregate.usableForVerdict).toBe(false);
  }, 180_000);

  it('reports an all-ties judge as unmeasured rather than unbiased', async () => {
    const result = await runAb({ ...SPEC, seeds: ['ties'] }, { arms: ARMS });
    if (!result.usable) throw new Error(result.reason);
    const pairs = pairTraces(result.traces, result.key, 'ties').pairs;
    const undecided = {
      id: 'all-ties',
      compare: (): Promise<TraceJudgement> =>
        Promise.resolve({
          preference: 'tie' as const,
          confidence: 0,
          reasons: [],
          byCriterion: { pursues: 'tie', consistent: 'tie', reactive: 'tie', social: 'tie', ignorance: 'tie' } as const,
        }),
    };
    const aggregate = await judgeTraces(pairs, result.key, undecided);
    expect(aggregate.position.undetermined).toBe(true);
    expect(aggregate.position.biased).toBe(false);
    expect(aggregate.usableForVerdict).toBe(false);
    expect(aggregate.note).toContain('unmeasured');
  }, 180_000);

  it('flips the sign exactly when the arm labels are swapped', async () => {
    const result = await runAb({ ...SPEC }, { arms: ARMS });
    if (!result.usable) throw new Error(result.reason);
    const pairs = pairTraces(result.traces, result.key, 'swap').pairs;
    const judge = { id: 'mock-feature-judge', compare: featureJudge };
    const straight = await judgeTraces(pairs, result.key, judge);
    const swapped = await judgeTraces(pairs, swapArmLabels(result.key), judge);
    expect(swapped.wins.A).toBe(straight.wins.B);
    expect(swapped.wins.B).toBe(straight.wins.A);
    expect(swapped.wins.ties).toBe(straight.wins.ties);
    // The position check is a fact about the JUDGE, not about the labels.
    expect(swapped.position.leftRate).toBe(straight.position.leftRate);
    expect(swapped.bothOrdersConsistencyRate).toBe(straight.bothOrdersConsistencyRate);
  }, 180_000);
});

// ─── The gate, and whether it can ever print USABLE ──────────────────────────

/**
 * THE GATE MOVED OUT. Round 3's block lived here and was sized on a model with
 * no tie mass and no position check, which is the whole of R1. The gate, its
 * power model, the 2,000-run simulation that pins the two together at four tie
 * rates and two position rates, and the pre-registration control (R2) are now
 * `test/eval-gate.test.ts`.
 */

/** Deterministic, seeded, and not the engine's own PRNG — this is an independent check. */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

// ─── P6 · the test that decides, and the interval that is quoted ─────────────

/**
 * ROUND 3 QUOTED A t INTERVAL AND MEASURED ITS COVERAGE ON NORMAL DIFFERENCES.
 *
 * The reviewer measured it on right-skewed ones — which `dietBreadth`,
 * `deaths:*` and `distinctPlanShapes` are — and got **0.893 / 0.827 / 0.831** at
 * n = 2 / 5 / 8 against a nominal 0.95, while the coverage table in the README
 * named no distribution at all. An interval that says 95% and delivers 83% is
 * worse than no interval, because it is quoted.
 *
 * So the PRIMARY test is an exact sign-flip permutation test, which assumes
 * only that the paired differences are exchangeable in sign under the null —
 * the one thing a seed-paired A/B actually guarantees. The t interval stays as
 * the quoted CI, with its coverage MEASURED on four distributions and printed,
 * and the minimum n at which any verdict may be printed is a constant.
 */
describe('W1-E · P6 · the primary paired test is an exact permutation test', () => {
  it('enumerates all 2^n sign flips at these n, and is exact', () => {
    // Three positive differences: the observed mean is the most extreme of the
    // 8 arrangements, and its mirror is equally extreme — so p = 2/8.
    const three = signFlipPermutation([0.1, 0.2, 0.3], { seed: 'p6' })!;
    expect(three.method).toBe('exact-enumeration');
    expect(three.draws).toBe(8);
    expect(three.p).toBeCloseTo(0.25, 6);
    expect(three.floorP).toBeCloseTo(0.25, 6);
    expect(three.couldReachAlpha).toBe(false);

    const six = signFlipPermutation([1, 2, 3, 4, 5, 6], { seed: 'p6' })!;
    expect(six.draws).toBe(64);
    expect(six.p).toBeCloseTo(2 / 64, 6);
    expect(six.couldReachAlpha).toBe(true);

    // A sweep with one dissenter is not the extreme arrangement any more.
    const mixed = signFlipPermutation([1, 2, 3, 4, 5, -6], { seed: 'p6' })!;
    expect(mixed.p).toBeGreaterThan(six.p);
  });

  it('states the minimum n at which any verdict may be printed, and marks rows below it', () => {
    // 2/2^5 = 0.0625 > 0.05: five seeds cannot produce a significant result
    // however clean the sweep, exactly as five judged pairs cannot.
    expect(minimumPairedSeeds(0.05)).toBe(6);
    expect(MIN_PAIRED_SEEDS).toBe(6);
    expect(minimumPairedSeeds(0.01)).toBe(8);
    const five = pairedBootstrap(
      'planSuccessRate',
      [0.3, 0.25, 0.4, 0.2, 0.35].map((delta, i) => ({ seed: `s${i}`, a: delta, b: 0 })),
      { seed: 'fixed' },
    );
    expect(five.n).toBe(5);
    expect(five.verdictEligible).toBe(false);
    expect(five.permutation!.p).toBeCloseTo(2 / 32, 6);
    expect(five.permutation!.couldReachAlpha).toBe(false);

    const six = pairedBootstrap(
      'planSuccessRate',
      [0.3, 0.25, 0.4, 0.2, 0.35, 0.28].map((delta, i) => ({ seed: `s${i}`, a: delta, b: 0 })),
      { seed: 'fixed' },
    );
    expect(six.verdictEligible).toBe(true);
    expect(six.permutation!.p).toBeLessThanOrEqual(0.05);
  });

  it('samples above n = 20 rather than enumerating, and says which it did', () => {
    const many = Array.from({ length: 24 }, (_, i) => 0.2 + i * 0.01);
    const test = signFlipPermutation(many, { seed: 'mc', draws: 4000 })!;
    expect(test.method).toBe('monte-carlo');
    expect(test.draws).toBe(4000);
    expect(test.p).toBeLessThan(0.01);
    // Seeded: the same call twice is the same answer.
    expect(signFlipPermutation(many, { seed: 'mc', draws: 4000 })!.p).toBe(test.p);
  });

  it('holds its level on SKEWED differences, where the quoted t interval does not', () => {
    // The permutation test is exact under exchangeability whatever the shape,
    // so its type I rate is at or below alpha on every distribution below. The
    // t interval's coverage is the table in the next test.
    const rng = lcg(31337);
    const draws = { normal: normalDraw(rng), lognormal: lognormalDraw(rng), heavy: heavyDraw(rng) } as const;
    const rows: string[] = [];
    for (const [name, draw] of Object.entries(draws)) {
      for (const n of [6, 8, 12]) {
        let rejected = 0;
        const trials = 1500;
        for (let trial = 0; trial < trials; trial++) {
          // TRUE NULL: differences with median 0 under sign symmetry.
          const values = Array.from({ length: n }, () => (rng() < 0.5 ? draw() : -draw()));
          const test = signFlipPermutation(values, { seed: `null-${name}-${n}-${trial}` })!;
          if (test.p <= 0.05) rejected++;
        }
        const rate = rejected / trials;
        rows.push(`  ${name.padEnd(9)} n=${n}: type I ${rate.toFixed(4)}`);
        expect(rate, `${name} n=${n}`).toBeLessThanOrEqual(0.06);
      }
    }
    // eslint-disable-next-line no-console
    console.log(['', 'sign-flip permutation, 1,500 null samples, alpha 0.05:', ...rows].join('\n'));
  }, 300_000);
});

// ─── The interval that actually covers, on four distributions ────────────────


describe('W1-E · the paired interval is not anti-conservative', () => {
  it('uses the small-sample t quantile rather than 1.96', () => {
    expect(studentTQuantile(0.975, 1)).toBeCloseTo(12.706, 2);
    expect(studentTQuantile(0.975, 4)).toBeCloseTo(2.776, 3);
    expect(studentTQuantile(0.975, 9)).toBeCloseTo(2.262, 3);
    const five = pairedBootstrap(
      'planSuccessRate',
      [
        { seed: 's1', a: 0.8, b: 0.5 },
        { seed: 's2', a: 0.7, b: 0.55 },
        { seed: 's3', a: 0.9, b: 0.4 },
        { seed: 's4', a: 0.75, b: 0.6 },
        { seed: 's5', a: 0.85, b: 0.45 },
      ],
      { seed: 'fixed' },
    );
    expect(five.ciMethod).toBe('student-t');
    const halfWidth = (five.ci!.high - five.ci!.low) / 2;
    // The t interval at n = 5 is 2.776/1.96 = 1.42× the normal one, and round
    // 2's percentile bootstrap was NARROWER than the normal one.
    expect(halfWidth).toBeCloseTo((studentTQuantile(0.975, 4) * five.sd) / Math.sqrt(5), 3);
    expect(five.bootstrapCi).not.toBeNull();
    expect(five.bootstrapCi!.high - five.bootstrapCi!.low).toBeLessThan(five.ci!.high - five.ci!.low);
  });

  /**
   * THE COVERAGE TABLE, ON FOUR DISTRIBUTIONS AND FOUR n — the README's version
   * of it named no distribution, and the one it was measured on was the only
   * one it covers.
   *
   * `dietBreadth`, `deaths:*` and `distinctPlanShapes` are right-skewed counts,
   * and the reviewer measured the quoted t interval at **0.893 / 0.827 / 0.831**
   * on lognormal differences at n = 2 / 5 / 8. That row is reproduced here and
   * printed, and the README quotes THIS table rather than the normal row alone.
   */
  it('prints its coverage by DISTRIBUTION and by n, because only one of them was ever measured', () => {
    const trueMean = 0.3;
    const rng = lcg(424242);
    const shapes: Record<string, () => number> = {
      normal: normalDraw(rng),
      'skewed (lognormal)': lognormalDraw(rng),
      'heavy-tailed (t3)': heavyDraw(rng),
      'contaminated 90/10': mixtureDraw(rng),
    };
    const rows: string[] = [];
    const worstQuoted: Record<string, number> = {};
    for (const [name, draw] of Object.entries(shapes)) {
      const cells: string[] = [];
      for (const n of [2, 5, 8, 12]) {
        let t = 0;
        let bca = 0;
        const trials = 2000;
        for (let trial = 0; trial < trials; trial++) {
          const samples = Array.from({ length: n }, (_, i) => ({ seed: `s${i}`, a: trueMean + draw() * 0.2, b: 0 }));
          const result = pairedBootstrap('m', samples, { seed: `cover-${name}-${n}-${trial}`, resamples: 300 });
          if (result.ci && result.ci.low <= trueMean && result.ci.high >= trueMean) t++;
          if (result.bootstrapCi && result.bootstrapCi.low <= trueMean && result.bootstrapCi.high >= trueMean) bca++;
        }
        cells.push(`n=${n} t ${(t / trials).toFixed(3)} / BCa ${(bca / trials).toFixed(3)}`);
        worstQuoted[name] = Math.min(worstQuoted[name] ?? 1, t / trials);
      }
      rows.push(`  ${name.padEnd(20)} ${cells.join('  ·  ')}`);
    }
    // eslint-disable-next-line no-console
    console.log(
      ['', 'quoted t interval and reported BCa, coverage over 2,000 samples per cell (nominal 0.950):', ...rows].join('\n'),
    );
    // The normal row is the only one that meets its nominal rate, and the
    // skewed one is the reason the permutation test above is the primary.
    expect(worstQuoted['normal']!).toBeGreaterThan(0.93);
    expect(worstQuoted['skewed (lognormal)']!).toBeLessThan(0.93);
  }, 300_000);
});

// ─── Shapes a per-seed difference actually takes ─────────────────────────────

/** Box–Muller from a supplied stream: mean 0, SD 1. */
function normalDraw(rng: () => number): () => number {
  return () => {
    const u = Math.max(1e-12, rng());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
  };
}

/** Right-skewed and centred: `dietBreadth`, `deaths:*` and plan-shape counts are this shape. */
function lognormalDraw(rng: () => number): () => number {
  const normal = normalDraw(rng);
  const mean = Math.exp(0.5);
  return () => (Math.exp(normal()) - mean) / 2;
}

/** Student-t with 3 degrees of freedom: the same centre, much fatter tails. */
function heavyDraw(rng: () => number): () => number {
  const normal = normalDraw(rng);
  return () => {
    let chi = 0;
    for (let i = 0; i < 3; i++) {
      const z = normal();
      chi += z * z;
    }
    return normal() / Math.sqrt(Math.max(1e-9, chi / 3));
  };
}

/** Ninety per cent tight, ten per cent wide — one seed behaving very differently. */
function mixtureDraw(rng: () => number): () => number {
  const normal = normalDraw(rng);
  return () => (rng() < 0.9 ? normal() : normal() * 5);
}

/** The shipped rule-based judge, reached without importing the class twice. */
async function featureJudge(pair: TracePair): Promise<TraceJudgement> {
  const { MockTraceJudge } = await import('../src/index.js');
  return new MockTraceJudge().compare(pair);
}

void foragerAdapter;
