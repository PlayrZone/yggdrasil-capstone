import { describe, expect, it } from 'vitest';
import {
  FORAGER_PROBES,
  FaithfulMockBackend,
  MockTraceJudge,
  OmniscientMockBackend,
  foragerAdapter,
  judgeTraces,
  pairTraces,
  runAb,
  runIgnoranceProbe,
  splitProbes,
  swapArmLabels,
} from '../src/index.js';
import type { AbResult, JudgeAggregate } from '../src/index.js';

/**
 * PROVING THE INSTRUMENT ON MOCKS.
 *
 * The whole point of W1-E is a measurement whose SIGN can be trusted before a
 * penny is spent. So: two populations whose answer is known in advance — a
 * faithful mind that acts only on what it was supplied and says "I do not know"
 * about everything else, and an omniscient one that helps itself to smelting,
 * germs, money and sowing — and then every instrument in turn, checked for the
 * expected sign and for the controls that would catch it lying:
 *
 *   probe separation   faithful ≫ omniscient, both on leaks and on admissions
 *   judge win rate     with a Wilson interval, not a bare number
 *   position bias      every pair judged both ways; a left-preferring judge shows
 *   label swap         relabel the arms and the sign must flip exactly
 *   identical arms     the same mind on both sides must produce no preference
 */

const world = foragerAdapter;
const SPEC = { seed: 'w1e-proof', ticks: 900, cohortSize: 4, agentCount: 16 } as const;

/**
 * Every assertion below is about ONE pair of runs, so they are run once and
 * shared. The runner's own determinism is what makes that safe, and
 * `eval-ab.test.ts` is where that is proven.
 */
const cache = new Map<string, Promise<AbResult>>();
function once(key: string, make: () => Promise<AbResult>): Promise<AbResult> {
  const held = cache.get(key);
  if (held) return held;
  const fresh = make();
  cache.set(key, fresh);
  return fresh;
}

function faithfulVsOmniscient(): Promise<AbResult> {
  return once('faithful-vs-omniscient', () =>
    runAb({ ...SPEC }, {
      a: { backend: new FaithfulMockBackend(world) },
      b: { backend: new OmniscientMockBackend(world) },
    }),
  );
}

/** The null experiment: the same mind on both sides of the same seed. */
function sameMindBothArms(): Promise<AbResult> {
  return once('same-mind', () =>
    runAb({ ...SPEC, cohortSize: 8 }, {
      a: { backend: new FaithfulMockBackend(world) },
      b: { backend: new FaithfulMockBackend(world) },
    }),
  );
}

describe('W1-E · the ignorance probe separates the two mock populations', () => {
  it('reports the expected sign on both arms', async () => {
    const result = await faithfulVsOmniscient();
    const faithful = await runIgnoranceProbe(result.subjects.A);
    const omniscient = await runIgnoranceProbe(result.subjects.B);

    const { absent, controls } = splitProbes(FORAGER_PROBES);
    expect(faithful.absent.asked).toBe(result.subjects.A.length * absent.length);
    expect(faithful.controls.asked).toBe(result.subjects.A.length * controls.length);

    // THE FAITHFUL ARM: nothing found, everything disavowed, and it still
    // answers about its own life — which is what stops "I do not know" to
    // everything from passing.
    expect(faithful.absent.leaked).toBe(0);
    expect(faithful.absent.admissionRate).toBe(1);
    expect(faithful.controls.overreach).toBe(0);
    expect(faithful.controls.groundRate).toBeGreaterThanOrEqual(0.5);
    // It answers about its own life more often than it dodges. The residue is
    // honest: a being carrying nothing has nothing to say about what it carries.
    expect(faithful.controls.grounded).toBeGreaterThan(faithful.controls.disavowed);

    // THE OMNISCIENT ARM: caught on most traps by a detector whose recall is
    // ~0.51, so "most" is the honest bar — and it never once says it does not know.
    expect(omniscient.absent.leakRateLowerBound).toBeGreaterThanOrEqual(0.6);
    expect(omniscient.absent.admitted).toBe(0);
    expect(omniscient.controls.overreach).toBeGreaterThan(0);

    expect(faithful.separation).toBeGreaterThan(0.5);
    expect(omniscient.separation).toBeLessThan(0);
    expect(faithful.separation - omniscient.separation).toBeGreaterThan(1);
  }, 90_000);

  it('does not let "I do not know" to everything pass the control arm', async () => {
    const result = await faithfulVsOmniscient();
    const subject = result.subjects.A[0];
    if (!subject) throw new Error('no subject');
    // A mind that disavows everything leaks nothing — and demonstrates nothing.
    // The control arm is what stops it scoring as faithful.
    const empty = await runIgnoranceProbe([
      { beingId: subject.beingId, input: subject.input, interviewee: { id: 'mock/silent', interview: () => Promise.resolve('I do not know.') } },
    ]);
    expect(empty.absent.leaked).toBe(0);
    expect(empty.absent.admissionRate).toBe(1);
    expect(empty.controls.grounded).toBe(0);
    expect(empty.controls.disavowed).toBe(empty.controls.asked);
    expect(empty.separation).toBe(0);
  }, 90_000);

  it('quotes the detector\'s blind recall rather than a clean bill', async () => {
    const result = await faithfulVsOmniscient();
    const report = await runIgnoranceProbe(result.subjects.A, { limit: 8 });
    expect(report.interviews).toBe(8);
    expect(report.detector.recall).toBeGreaterThan(0);
    expect(report.detector.recall).toBeLessThan(1);
    expect(report.detector.measuredOn.length).toBeGreaterThan(0);
    expect(report.judge).toBeNull();
  }, 90_000);

  it('writes nothing back into the world it interviewed', async () => {
    const result = await faithfulVsOmniscient();
    const subject = result.subjects.A[0];
    if (!subject) throw new Error('no subject');
    const before = {
      knowledge: subject.input.knowledge.length,
      memories: subject.input.recalledMemories.length,
      goals: subject.input.goals.length,
      tick: subject.input.worldView.tick,
    };
    await runIgnoranceProbe([subject]);
    expect({
      knowledge: subject.input.knowledge.length,
      memories: subject.input.recalledMemories.length,
      goals: subject.input.goals.length,
      tick: subject.input.worldView.tick,
    }).toEqual(before);
  }, 90_000);
});

describe('W1-E · the pairwise judge', () => {
  it('prefers the faithful arm, and says on which criterion', async () => {
    const result = await faithfulVsOmniscient();
    const pairs = pairTraces(result.traces, result.key, SPEC.seed);
    expect(pairs.length).toBeGreaterThan(1);
    const aggregate = await judgeTraces(pairs, result.key, new MockTraceJudge());

    expect(aggregate.judgements).toBe(pairs.length * 2);
    expect(aggregate.winRateA).toBeGreaterThan(0.75);
    expect(aggregate.wilson.low).toBeGreaterThan(0.5);
    // The criterion this whole instrument exists for.
    expect(aggregate.byCriterion.ignorance.winRate).toBe(1);
    expect(aggregate.byCriterion.ignorance.B).toBe(0);
    expect(aggregate.judged.every((j) => j.judgement.reasons.length > 0)).toBe(true);
  }, 90_000);

  it('judges every pair in both orders and reports the position bias it found', async () => {
    const result = await faithfulVsOmniscient();
    const pairs = pairTraces(result.traces, result.key, SPEC.seed);
    const aggregate = await judgeTraces(pairs, result.key, new MockTraceJudge());
    expect(aggregate.position.leftWins + aggregate.position.rightWins + aggregate.position.ties).toBe(aggregate.judgements);
    expect(aggregate.position.leftRate).toBeCloseTo(0.5, 6);
    expect(aggregate.position.biased).toBe(false);
    expect(aggregate.position.flippedPairs).toBe(0);
    expect(aggregate.position.consistentPairs).toBe(pairs.length);
  }, 90_000);

  it('catches a judge that just prefers whatever is on the left', async () => {
    const result = await faithfulVsOmniscient();
    const pairs = pairTraces(result.traces, result.key, SPEC.seed);
    const lazy = {
      id: 'always-left',
      free: true as const,
      compare: () =>
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
    expect(aggregate.position.flippedPairs).toBe(pairs.length);
    // Its "50% win rate" is an artefact of the order swap, and the bias flag is
    // the only thing that says so.
    expect(aggregate.winRateA).toBeCloseTo(0.5, 6);
  }, 90_000);

  it('flips the sign exactly when the arm labels are swapped', async () => {
    const result = await faithfulVsOmniscient();
    const pairs = pairTraces(result.traces, result.key, SPEC.seed);
    const judge = new MockTraceJudge();
    const straight = await judgeTraces(pairs, result.key, judge);
    const swapped = await judgeTraces(pairs, swapArmLabels(result.key), judge);
    expect(swapped.wins.A).toBe(straight.wins.B);
    expect(swapped.wins.B).toBe(straight.wins.A);
    expect(swapped.wins.ties).toBe(straight.wins.ties);
    expect(swapped.winRateA).toBeCloseTo(1 - straight.winRateA, 6);
    expect(swapped.byCriterion.ignorance.winRate).toBe(0);
    // The position check is a fact about the JUDGE, not about the labels.
    expect(swapped.position).toEqual(straight.position);
  }, 90_000);

  it('finds nothing to prefer when the same being is run by the same mind twice', async () => {
    const identical = await sameMindBothArms();
    // Being-for-being, not the shuffle: this asks whether the INSTRUMENT
    // invents a difference where the behaviour is byte-identical.
    const byBeing = new Map<number, { A?: string; B?: string }>();
    for (const k of identical.key) {
      const slot = byBeing.get(k.beingId) ?? {};
      slot[k.arm] = k.traceId;
      byBeing.set(k.beingId, slot);
    }
    const traces = new Map(identical.traces.map((t) => [t.traceId, t]));
    const pairs = [...byBeing.entries()]
      .filter(([, slot]) => slot.A && slot.B)
      .map(([beingId, slot]) => ({ pairId: `same-${beingId}`, left: traces.get(slot.A!)!, right: traces.get(slot.B!)! }));
    expect(pairs.length).toBeGreaterThan(1);

    const aggregate: JudgeAggregate = await judgeTraces(pairs, identical.key, new MockTraceJudge());
    expect(aggregate.decisive).toBe(0);
    expect(aggregate.tieRate).toBe(1);
    expect(aggregate.position.biased).toBe(false);
    // No decisions means no rate: the interval says so instead of printing 0.
    expect(aggregate.wilson).toEqual({ low: 0, high: 1 });
  }, 90_000);

  it('sits near even when one mind is shuffled against itself', async () => {
    // Same policy on both sides, paired at random across beings: the traces
    // differ because the LIVES differ, not because the minds do. A judge that
    // crowned a winner here would be reading noise as a result.
    const sameMind = await sameMindBothArms();
    const pairs = pairTraces(sameMind.traces, sameMind.key, SPEC.seed);
    const aggregate = await judgeTraces(pairs, sameMind.key, new MockTraceJudge());
    expect(aggregate.winRateA).toBeGreaterThanOrEqual(0.25);
    expect(aggregate.winRateA).toBeLessThanOrEqual(0.75);
    expect(aggregate.wilson.low).toBeLessThan(0.5);
    expect(aggregate.wilson.high).toBeGreaterThan(0.5);
    expect(aggregate.position.biased).toBe(false);
  }, 90_000);
});
