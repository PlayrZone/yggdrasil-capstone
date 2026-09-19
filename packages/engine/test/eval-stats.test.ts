import { describe, expect, it } from 'vitest';
import {
  exactBinomialTwoSided,
  foragerAdapter,
  judgeTraces,
  minimumDetectableEffect,
  minimumDetectableWins,
  multipleComparisonNote,
  pairTraces,
  pairedBootstrap,
  pairsForSweep,
  runAb,
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

/** The shipped rule-based judge, reached without importing the class twice. */
async function featureJudge(pair: TracePair): Promise<TraceJudgement> {
  const { MockTraceJudge } = await import('../src/index.js');
  return new MockTraceJudge().compare(pair);
}

void foragerAdapter;
