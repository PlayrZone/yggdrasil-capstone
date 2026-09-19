import { describe, expect, it } from 'vitest';
import {
  JUDGE_GATE,
  blindTraces,
  exactBinomialTwoSided,
  foragerAdapter,
  judgeGatePower,
  judgeTraces,
  minimumDetectableEffect,
  minimumDetectableWins,
  multipleComparisonNote,
  pairTraces,
  pairedBootstrap,
  pairsForJudgePower,
  pairsForSweep,
  runAb,
  studentTQuantile,
  swapArmLabels,
  wilsonInterval,
} from '../src/index.js';
import type { ArmId, BlindTrace, RawBeingTrace, Side, TraceJudgement, TracePair } from '../src/index.js';

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
 * ROUND 2's GATE COULD NOT PASS ITS OWN ALTERNATIVE.
 *
 * `minimumDetectableWins(30)` = 21 is sized on ALL pairs; the verdict compared
 * `wins.A`, which counts only pairs whose two orders AGREED. At a true 0.70 per
 * showing a pair is decisive for A with probability 0.49, so E[wins.A] = 14.7
 * and P(wins.A ≥ 21) = 1.6% — while the sign test on the same data is
 * significant 82.7% of the time. The block would have printed NOT USABLE
 * almost whatever the traces showed.
 *
 * The rule is coherent now, and this is the test that would have caught it:
 * the gate is driven end to end by a judge with a KNOWN per-showing win rate,
 * and what comes out is compared against the power the design claims.
 */
const GATE_PAIRS = 30;

/** Deterministic, seeded, and not the engine's own PRNG — this is an independent check. */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function simulationPairs(count: number): { pairs: TracePair[]; key: ReturnType<typeof blindTraces>['key']; armOf: Map<string, ArmId> } {
  const moment = {
    t: 0, day: 1, night: false, season: 'spring',
    felt: [{ drive: 'hunger', pressure: 40 }],
    perceived: [{ kind: 'berryBush', count: 1 }],
    others: 0,
    carried: [{ kind: 'berry', count: 1 }],
    thought: 'the same words in every trace',
    did: ['Wait()'],
    said: [],
    happened: null,
  };
  const lives: RawBeingTrace[] = [];
  for (const arm of ['A', 'B'] as const) {
    for (let i = 0; i < count; i++) lives.push({ runId: `sim-${arm}`, arm, beingId: i + 1, moments: [{ ...moment }] });
  }
  const blinded = blindTraces(lives, foragerAdapter, { seed: 'gate-sim', secret: 'gate-sim-secret', minMoments: 1 });
  const armOf = new Map(blinded.key.unseal().map((k) => [k.traceId, k.arm]));
  const byArm = (arm: ArmId): BlindTrace[] => blinded.traces.filter((t) => armOf.get(t.traceId) === arm);
  const a = byArm('A');
  const b = byArm('B');
  const pairs = a.map((left, at) => ({ pairId: `sim-${at}`, left, right: b[at]! }));
  return { pairs, key: blinded.key, armOf };
}

/** A judge that prefers arm A on each SHOWING with probability `w`, and nothing else. */
function stochasticJudge(w: number, armOf: Map<string, ArmId>, rng: () => number): { id: string; compare: (p: TracePair) => Promise<TraceJudgement> } {
  return {
    id: `stochastic-${w}`,
    compare: (pair: TracePair): Promise<TraceJudgement> => {
      const leftIsA = armOf.get(pair.left.traceId) === 'A';
      const picksA = rng() < w;
      const preference: Side = picksA === leftIsA ? 'left' : 'right';
      return Promise.resolve({
        preference,
        confidence: 1,
        reasons: ['simulated'],
        byCriterion: { pursues: preference, consistent: preference, reactive: preference, social: preference, ignorance: preference },
      });
    },
  };
}

async function gateRate(w: number, reps: number, seed: number): Promise<number> {
  const { pairs, key, armOf } = simulationPairs(GATE_PAIRS);
  const rng = lcg(seed);
  let printed = 0;
  for (let rep = 0; rep < reps; rep++) {
    const aggregate = await judgeTraces(pairs, key, stochasticJudge(w, armOf, rng), { arms: ['A', 'B'] });
    if (aggregate.usableForVerdict) printed++;
  }
  return printed / reps;
}

describe('W1-E · the judge gate is coherent, and its power is printed rather than hoped for', () => {
  it('sizes the threshold on the DECISIVE pairs, which is the count the verdict uses', () => {
    // Round 2's number, kept visible: it is correct about 30 pairs and was
    // compared against a count over a different denominator.
    expect(minimumDetectableWins(30).minimumWins).toBe(21);
    const design = judgeGatePower(30);
    expect(design.expectedDecisiveRate).toBeCloseTo(0.58, 6);
    // eslint-disable-next-line no-console
    console.log(
      `gate design at ${design.declaredEffect} per showing: ${design.pairs} pairs → power ${design.power}, ` +
        `type I ${design.typeIError}, expected decisive rate ${design.expectedDecisiveRate}; ` +
        `${pairsForJudgePower(0.8)} pairs would be needed for 0.80 power`,
    );
    // The number round 2 could have printed for itself: 1.6%.
    expect(design.power).toBeGreaterThan(0.7);
    expect(design.typeIError).toBeLessThanOrEqual(JUDGE_GATE.alpha);
    expect(pairsForJudgePower(0.8)).toBeGreaterThan(30);
  });

  it('prints USABLE at the claimed power when the judge really prefers one arm 0.70 of the time', async () => {
    const claimed = judgeGatePower(GATE_PAIRS).power;
    const measured = await gateRate(0.7, 400, 20260919);
    // eslint-disable-next-line no-console
    console.log(`gate simulation at w = 0.70: claimed power ${claimed}, measured ${measured.toFixed(3)} over 400 runs`);
    expect(measured).toBeGreaterThan(0.6);
    expect(Math.abs(measured - claimed)).toBeLessThanOrEqual(0.07);
  }, 180_000);

  it('prints USABLE no more often than alpha when the judge cannot tell them apart', async () => {
    const claimed = judgeGatePower(GATE_PAIRS).typeIError;
    const measured = await gateRate(0.5, 400, 77777);
    // eslint-disable-next-line no-console
    console.log(`gate simulation at w = 0.50: claimed ${claimed}, measured ${measured.toFixed(3)} over 400 runs`);
    expect(measured).toBeLessThanOrEqual(JUDGE_GATE.alpha + 0.02);
  }, 180_000);

  it('refuses a verdict when the judge could not make up its mind, and says that is the finding', async () => {
    // 0.5 per showing means ~half the pairs flip with the order: the decisive
    // fraction, not the win rate, is what fails here.
    const { pairs, key, armOf } = simulationPairs(GATE_PAIRS);
    const aggregate = await judgeTraces(pairs, key, stochasticJudge(0.5, armOf, lcg(5)), { arms: ['A', 'B'] });
    expect(aggregate.design.decisiveRate).toBeLessThan(0.7);
    if (!aggregate.design.enoughDecisive) {
      expect(aggregate.usableForVerdict).toBe(false);
      expect(aggregate.note).toContain('cannot make up its mind');
    }
    // Whatever it decided, the threshold is over the decisive pairs.
    expect(aggregate.design.decisivePairs).toBe(aggregate.decisivePairs);
    expect(aggregate.design.minimumWins).toBe(minimumDetectableWins(aggregate.decisivePairs).minimumWins);
  }, 60_000);
});

// ─── The interval that actually covers ───────────────────────────────────────

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

  it('covers at about its nominal rate — measured, not claimed', () => {
    // Per-seed differences drawn from a known distribution with a known mean.
    // Round 2 quoted a raw percentile bootstrap, which at n = 5 covers ~0.80
    // against a nominal 0.95 and at n = 2 is literally [min, max] of two points.
    const trueMean = 0.3;
    const rng = lcg(424242);
    const normal = (): number => {
      // Box–Muller, from the same deterministic stream.
      const u = Math.max(1e-12, rng());
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
    };
    const rows: string[] = [];
    for (const n of [2, 5, 8]) {
      let t = 0;
      let bca = 0;
      const trials = 2000;
      for (let trial = 0; trial < trials; trial++) {
        const samples = Array.from({ length: n }, (_, i) => ({ seed: `s${i}`, a: trueMean + normal() * 0.2, b: 0 }));
        const result = pairedBootstrap('m', samples, { seed: `cover-${n}-${trial}`, resamples: 400 });
        if (result.ci && result.ci.low <= trueMean && result.ci.high >= trueMean) t++;
        if (result.bootstrapCi && result.bootstrapCi.low <= trueMean && result.bootstrapCi.high >= trueMean) bca++;
      }
      rows.push(`  n=${n}: student-t ${(t / trials).toFixed(3)} · BCa bootstrap ${(bca / trials).toFixed(3)} (nominal 0.950)`);
      // The one that is QUOTED has to cover. The BCa one is reported beside it
      // and is allowed to be worse, which is why it is not the headline.
      expect(t / trials).toBeGreaterThan(0.9);
    }
    // eslint-disable-next-line no-console
    console.log(['', 'paired-interval coverage over 2,000 samples per n:', ...rows].join('\n'));
  }, 120_000);
});

/** The shipped rule-based judge, reached without importing the class twice. */
async function featureJudge(pair: TracePair): Promise<TraceJudgement> {
  const { MockTraceJudge } = await import('../src/index.js');
  return new MockTraceJudge().compare(pair);
}

void foragerAdapter;
