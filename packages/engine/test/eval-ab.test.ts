import { describe, expect, it } from 'vitest';
import { FaithfulMockBackend, OmniscientMockBackend, foragerAdapter, runAb, wilsonInterval } from '../src/index.js';
import type { AbBackends, AbResult } from '../src/index.js';

/**
 * THE A/B RUNNER. Four properties, and nothing else is claimed here: it is
 * deterministic given the backends, it pairs by seed, it reports knowledge
 * honestly (only one arm's mind can read it), and the mixed-cohort mode really
 * does put two minds in one world.
 */

const world = foragerAdapter;
const arms = (): AbBackends => ({
  a: { backend: new FaithfulMockBackend(world) },
  b: { backend: new OmniscientMockBackend(world) },
});

const SPEC = { seed: 'w1e-ab', ticks: 420, cohortSize: 4, agentCount: 16 } as const;

describe('W1-E · the A/B runner', () => {
  it('is deterministic given the backends', async () => {
    const one = await runAb({ ...SPEC }, arms());
    const two = await runAb({ ...SPEC }, arms());
    expect(two.metrics).toEqual(one.metrics);
    expect(two.paired).toEqual(one.paired);
    expect(two.traces.map((t) => t.text)).toEqual(one.traces.map((t) => t.text));
    expect(two.traces.map((t) => t.features)).toEqual(one.traces.map((t) => t.features));
  }, 60_000);

  it('runs both arms on the same seed and reports the difference as a pair', async () => {
    const result = await runAb({ ...SPEC }, arms());
    expect(result.metrics.A.cohortSize).toBe(SPEC.cohortSize);
    expect(result.metrics.B.cohortSize).toBe(SPEC.cohortSize);
    expect(result.metrics.A.thinks).toBeGreaterThan(0);
    expect(result.metrics.B.thinks).toBeGreaterThan(0);
    const bySeed = new Map(result.paired.map((row) => [row.metric, row]));
    for (const row of result.paired) expect(row.delta).toBeCloseTo(row.a - row.b, 6);
    // The omniscient arm plans acts the world cannot grant it, so its plan
    // success is the lower of the two. That is the sign this fixture exists for.
    expect(bySeed.get('planSuccessRate')?.delta ?? 0).toBeGreaterThan(0);
    expect(bySeed.get('planStepsRejected')?.delta ?? 0).toBeLessThan(0);
    expect(result.paired.some((row) => row.metric.startsWith('deaths:') || row.metric === 'deaths')).toBe(true);
  }, 60_000);

  it('never pairs knowledge, and says whose mind could read it', async () => {
    const result = await runAb({ ...SPEC }, arms());
    expect(result.metrics.A.knowledge.reachesMind).toBe(true);
    expect(result.metrics.B.knowledge.reachesMind).toBe(false);
    expect(result.metrics.A.knowledge.formed).toBeGreaterThanOrEqual(0);
    expect(result.metrics.B.knowledge.formed).toBeGreaterThanOrEqual(0);
    // Both arms' bodies still mine beliefs — only arm A's MIND is shown them —
    // so a head-to-head knowledge number would be measuring the body twice.
    expect(result.paired.map((row) => row.metric)).not.toContain('knowledgeFormed');
  }, 60_000);

  it('keeps the two arms\' interview subjects apart even though the ids match', async () => {
    const result = await runAb({ ...SPEC }, arms());
    expect(result.subjects.A.length).toBeGreaterThan(0);
    expect(result.subjects.B.length).toBeGreaterThan(0);
    // Same seed, same founders: the ids are the same in both arms, which is
    // exactly why the subjects are split rather than pooled.
    expect(result.subjects.A.map((s) => s.beingId)).toEqual(result.subjects.B.map((s) => s.beingId));
    expect(result.subjects.A[0]?.interviewee.id).not.toBe(result.subjects.B[0]?.interviewee.id);
  }, 60_000);

  it('records what arm B actually sent, which the cognition row cannot hold', async () => {
    const result = await runAb({ ...SPEC }, arms());
    expect(result.baselineSent.length).toBeGreaterThan(0);
    const sent = result.baselineSent[0];
    expect(sent?.prompt.user).toContain('RECENT OBSERVATIONS');
    expect(sent?.prompt.user).not.toContain('WHAT YOU KNOW');
    // …and it is arm-private: nothing of it reaches a blinded trace.
    for (const trace of result.traces) expect(trace.text).not.toContain('RECENT OBSERVATIONS');
  }, 60_000);

  it('puts two minds in one world in mixed mode', async () => {
    const result = await runAb({ ...SPEC, cohortSize: 6 }, arms(), 'mixed');
    expect(result.mode).toBe('mixed');
    expect(result.metrics.A.cohortSize).toBe(3);
    expect(result.metrics.B.cohortSize).toBe(3);
    // One run, so the two arms share a population — which is the point.
    expect(result.metrics.A.population).toEqual(result.metrics.B.population);
    expect(result.metrics.A.seed).toBe(result.metrics.B.seed);
    const ids = new Set([...result.subjects.A, ...result.subjects.B].map((s) => s.beingId));
    expect(ids.size).toBe(result.subjects.A.length + result.subjects.B.length);
    expect(result.key.some((k) => k.arm === 'A')).toBe(true);
    expect(result.key.some((k) => k.arm === 'B')).toBe(true);
  }, 60_000);

  it('builds one trace per being that thought, and drops the too-short ones', async () => {
    const result: AbResult = await runAb({ ...SPEC, minTraceMoments: 99 }, arms());
    expect(result.traces).toHaveLength(0);
    expect(result.key).toHaveLength(0);
  }, 60_000);
});

describe('W1-E · the interval that ships with every rate', () => {
  it('is Wilson, so it never runs off the end of the scale', () => {
    expect(wilsonInterval(0, 0)).toEqual({ low: 0, high: 1 });
    const perfectSmall = wilsonInterval(4, 4);
    expect(perfectSmall.high).toBe(1);
    expect(perfectSmall.low).toBeGreaterThan(0.4);
    expect(perfectSmall.low).toBeLessThan(0.6);
    const perfectLarge = wilsonInterval(400, 400);
    expect(perfectLarge.low).toBeGreaterThan(perfectSmall.low);
    const none = wilsonInterval(0, 10);
    expect(none.low).toBe(0);
    expect(none.high).toBeLessThan(0.35);
  });
});
