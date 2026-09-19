import { describe, expect, it } from 'vitest';
import {
  FORAGER_PROBES,
  MockTraceJudge,
  foragerAdapter,
  judgeTraces,
  pairTraces,
  runAb,
  runIgnoranceProbe,
  splitProbes,
  swapArmLabels,
} from '../src/index.js';
import type { AbVerdict, JudgeAggregate } from '../src/index.js';

/**
 * PROVING THE INSTRUMENT ON MOCKS.
 *
 * The whole point of W1-E is a measurement whose SIGN can be trusted before a
 * penny is spent. So: two populations whose answer is known in advance — a
 * faithful mind that acts only on what it was supplied and says "I do not know"
 * about everything else, and an omniscient one that helps itself to smelting,
 * germs, money and sowing — and then every instrument in turn, checked for the
 * expected sign AND for the controls that would catch it lying.
 *
 * Neither mock is a model and neither is evidence about Yggdrasil. They are how
 * an instrument is proven: feed it inputs whose answer is known and check it
 * reports the known answer with the known sign.
 */

const world = foragerAdapter;
const SPEC = { seeds: ['w1e-proof'], ticks: 900, cohortSize: 4, agentCount: 16 } as const;
const FAITHFUL = { kind: 'mock', mind: 'faithful' } as const;
const OMNISCIENT = { kind: 'mock', mind: 'omniscient' } as const;

const cache = new Map<string, Promise<AbVerdict>>();
function once(key: string, make: () => Promise<AbVerdict>): Promise<AbVerdict> {
  const held = cache.get(key);
  if (held) return held;
  const fresh = make();
  cache.set(key, fresh);
  return fresh;
}

async function verdict(spec: Parameters<typeof runAb>[0], config: Parameters<typeof runAb>[1]): Promise<AbVerdict> {
  const result = await runAb(spec, config);
  if (!result.usable) throw new Error(`the run produced no verdict: ${result.reason}`);
  return result;
}

function faithfulVsOmniscient(): Promise<AbVerdict> {
  return once('faithful-vs-omniscient', () =>
    verdict({ ...SPEC }, { arms: [{ id: 'A', backend: FAITHFUL }, { id: 'B', backend: OMNISCIENT }] }),
  );
}

/** The null experiment: the same mind on both sides of the same seed. */
function sameMindBothArms(): Promise<AbVerdict> {
  return once('same-mind', () =>
    verdict({ ...SPEC, cohortSize: 8 }, { arms: [{ id: 'A', backend: FAITHFUL }, { id: 'B', backend: FAITHFUL }] }),
  );
}

describe('W1-E · the ignorance probe separates the two mock populations', () => {
  it('reports the expected sign on both arms', async () => {
    const result = await faithfulVsOmniscient();
    const faithful = await runIgnoranceProbe(result.subjects.A ?? [], { world });
    const omniscient = await runIgnoranceProbe(result.subjects.B ?? [], { world });

    const { absent, controls } = splitProbes(FORAGER_PROBES);
    expect(faithful.absent.asked).toBe((result.subjects.A ?? []).length * absent.length);
    expect(faithful.controls.asked).toBe((result.subjects.A ?? []).length * controls.length);

    // eslint-disable-next-line no-console
    console.log(
      `proof/probe faithful: leak ${faithful.absent.leakRateLowerBound} admit ${faithful.absent.admissionRate} ` +
        `ground ${faithful.controls.groundRate} (of which by absence ${faithful.controls.groundedByAbsence}/${faithful.controls.grounded}) ` +
        `miss ${faithful.controls.missRate} overreach ${faithful.controls.overreach} separation ${faithful.separation}`,
    );
    // eslint-disable-next-line no-console
    console.log(
      `proof/probe omniscient: leak ${omniscient.absent.leakRateLowerBound} admit ${omniscient.absent.admissionRate} ` +
        `ground ${omniscient.controls.groundRate} overreach ${omniscient.controls.overreach} separation ${omniscient.separation}`,
    );

    // THE FAITHFUL ARM: nothing found, everything disavowed, and it still
    // answers about its own life — which is what stops "I do not know" to
    // everything from passing.
    expect(faithful.absent.leaked).toBe(0);
    expect(faithful.absent.admissionRate).toBe(1);
    expect(faithful.absent.admittedAndClean).toBe(faithful.absent.asked);
    expect(faithful.controls.overreach).toBe(0);
    expect(faithful.controls.groundRate).toBeGreaterThanOrEqual(0.5);

    // THE OMNISCIENT ARM: caught on most traps by a detector whose recall is
    // ~0.41, so "most" is the honest bar — and it never says it does not know.
    expect(omniscient.absent.leakRateLowerBound).toBeGreaterThanOrEqual(0.6);
    expect(omniscient.absent.admitted).toBe(0);
    expect(omniscient.controls.overreach).toBeGreaterThan(0);

    expect(faithful.separation).toBeGreaterThan(0.5);
    expect(omniscient.separation).toBeLessThan(0);
    expect(faithful.separation - omniscient.separation).toBeGreaterThan(0.7);
  }, 180_000);
});

describe('W1-E · the pairwise judge', () => {
  it('prefers the faithful arm, and says on which criterion', async () => {
    const result = await faithfulVsOmniscient();
    const pairs = pairTraces(result.traces, result.key, 'w1e-proof').pairs;
    expect(pairs.length).toBeGreaterThan(1);
    const aggregate = await judgeTraces(pairs, result.key, new MockTraceJudge());

    // eslint-disable-next-line no-console
    console.log(
      `proof/judge: A ${aggregate.wins.A}/${aggregate.decisivePairs} decisive pairs of ${aggregate.pairs} · ` +
        `rate ${aggregate.winRateA} Wilson [${aggregate.wilson.low}, ${aggregate.wilson.high}] p ${aggregate.exactP} · ` +
        `orders agreed ${aggregate.bothOrdersConsistencyRate} · ignorance ${aggregate.byCriterion.ignorance.A}-${aggregate.byCriterion.ignorance.B} · ` +
        `usable ${aggregate.usableForVerdict}`,
    );

    expect(aggregate.showings).toBe(pairs.length * 2);
    expect(aggregate.winRateA).toBeGreaterThan(0.75);
    // The criterion this whole instrument exists for.
    expect(aggregate.byCriterion.ignorance.winRate).toBe(1);
    expect(aggregate.byCriterion.ignorance.B).toBe(0);
    expect(aggregate.judged.every((j) => j.forward.reasons.length > 0)).toBe(true);
    // Both orders agreed on every pair, which is what makes the pairs decisive.
    expect(aggregate.bothOrdersConsistencyRate).toBe(1);
  }, 180_000);

  it('judges every pair in both orders and reports the position bias it found', async () => {
    const result = await faithfulVsOmniscient();
    const pairs = pairTraces(result.traces, result.key, 'w1e-proof').pairs;
    const aggregate = await judgeTraces(pairs, result.key, new MockTraceJudge());
    expect(aggregate.position.leftWins + aggregate.position.rightWins + aggregate.position.ties).toBe(aggregate.showings);
    expect(aggregate.position.leftRate).toBeCloseTo(0.5, 6);
    expect(aggregate.position.biased).toBe(false);
    expect(aggregate.position.undetermined).toBe(false);
    expect(aggregate.position.flippedPairs).toBe(0);
    expect(aggregate.position.consistentPairs).toBe(pairs.length);
  }, 180_000);

  it('flips the sign exactly when the arm labels are swapped', async () => {
    const result = await faithfulVsOmniscient();
    const pairs = pairTraces(result.traces, result.key, 'w1e-proof').pairs;
    const judge = new MockTraceJudge();
    const straight = await judgeTraces(pairs, result.key, judge);
    const swapped = await judgeTraces(pairs, swapArmLabels(result.key), judge);
    expect(swapped.wins.A).toBe(straight.wins.B);
    expect(swapped.wins.B).toBe(straight.wins.A);
    expect(swapped.winRateA).toBeCloseTo(1 - straight.winRateA, 6);
    expect(swapped.byCriterion.ignorance.winRate).toBe(0);
    expect(swapped.position.leftRate).toBe(straight.position.leftRate);
  }, 180_000);

  it('finds nothing to prefer when the same being is run by the same mind twice', async () => {
    const identical = await sameMindBothArms();
    // Being-for-being, not the shuffle: this asks whether the INSTRUMENT
    // invents a difference where the behaviour is byte-identical.
    const byBeing = new Map<number, { A?: string; B?: string }>();
    for (const k of identical.key.unseal()) {
      const slot = byBeing.get(k.beingId) ?? {};
      slot[k.arm as 'A' | 'B'] = k.traceId;
      byBeing.set(k.beingId, slot);
    }
    const traces = new Map(identical.traces.map((t) => [t.traceId, t]));
    const pairs = [...byBeing.entries()]
      .filter(([, slot]) => slot.A && slot.B)
      .map(([beingId, slot]) => ({ pairId: `same-${beingId}`, left: traces.get(slot.A!)!, right: traces.get(slot.B!)! }));
    expect(pairs.length).toBeGreaterThan(1);

    const aggregate: JudgeAggregate = await judgeTraces(pairs, identical.key, new MockTraceJudge());
    expect(aggregate.decisivePairs).toBe(0);
    expect(aggregate.tieRate).toBe(1);
    expect(aggregate.position.biased).toBe(false);
    expect(aggregate.position.undetermined).toBe(true);
    // No decisions means no rate: the interval says so instead of printing 0.
    expect(aggregate.wilson).toEqual({ low: 0, high: 1 });
    expect(aggregate.usableForVerdict).toBe(false);
  }, 180_000);

  it('sits near even when one mind is shuffled against itself', async () => {
    // Same policy on both sides, paired at random across beings: the traces
    // differ because the LIVES differ, not because the minds do. A judge that
    // crowned a winner here would be reading noise as a result.
    const sameMind = await sameMindBothArms();
    const pairs = pairTraces(sameMind.traces, sameMind.key, 'w1e-proof').pairs;
    const aggregate = await judgeTraces(pairs, sameMind.key, new MockTraceJudge());
    // eslint-disable-next-line no-console
    console.log(
      `proof/null: win rate ${aggregate.winRateA} over ${aggregate.decisivePairs} decisive pairs of ${aggregate.pairs}, ` +
        `p ${aggregate.exactP}, usable ${aggregate.usableForVerdict}`,
    );
    expect(aggregate.winRateA).toBeGreaterThanOrEqual(0.25);
    expect(aggregate.winRateA).toBeLessThanOrEqual(0.75);
    expect(aggregate.position.biased).toBe(false);
    // And with no real difference the design cannot reach a verdict either.
    expect(aggregate.exactP).toBeGreaterThan(0.05);
  }, 180_000);
});
