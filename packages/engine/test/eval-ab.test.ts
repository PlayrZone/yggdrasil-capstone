import { describe, expect, it } from 'vitest';
import {
  EPISTEMIC_INSTRUCTION_LINES,
  EPISTEMIC_INSTRUCTION_TEXT,
  buildThinkPrompt,
  carriesEpistemicInstruction,
  contrastsFor,
  foragerAdapter,
  runAb,
  stripEpistemicInstruction,
} from '../src/index.js';
import type { AbSpec, ArmSpec, PreRegisteredQuestion, ThinkPrompt } from '../src/index.js';

/**
 * THE A/B RUNNER, AND THE CONFOUND ROUND 1 SHIPPED.
 *
 * Arm A's prompt says "You reason ONLY from what you perceive and what you
 * KNOW… You have no knowledge of the world beyond this. Do not invent facts."
 * Arm B's said nothing of the kind, on the stated grounds that telling the
 * baseline not to use its pretraining would be testing the instruction rather
 * than the architecture. That reasoning is right about what B must not be, and
 * wrong about what the experiment then measures: with the sentence present in
 * exactly one arm and NEVER ABLATED, a difference is one sentence OR an
 * architecture and no number in the table can tell you which. A 2,000-call
 * pilot on a confounded contrast decides nothing.
 *
 * Four arms fix it. A vs A− and B+ vs B isolate the sentence; A− vs B and
 * A vs B+ isolate the architecture at a fixed level of the sentence.
 */

const world = foragerAdapter;
const faithful = { kind: 'mock', mind: 'faithful' } as const;
const omniscient = { kind: 'mock', mind: 'omniscient' } as const;
const SPEC: AbSpec = { seeds: ['w1e-ab'], ticks: 480, cohortSize: 4, agentCount: 16 };
const AB: ArmSpec[] = [
  { id: 'A', backend: faithful },
  { id: 'B', backend: omniscient },
];

describe('W1-E · the epistemic instruction is a factor, not a property of an arm', () => {
  it('finds the exact lines in the mind\'s own prompt, and fails loudly if they move', () => {
    const prompt = buildThinkPrompt(situation(), world);
    expect(carriesEpistemicInstruction(prompt)).toBe(true);
    for (const line of EPISTEMIC_INSTRUCTION_LINES) expect(prompt.system).toContain(line);

    const ablated = stripEpistemicInstruction(prompt);
    expect(carriesEpistemicInstruction(ablated)).toBe(false);
    expect(ablated.system).not.toContain('You have no knowledge of the world beyond this');
    expect(ablated.system).not.toContain('Do not invent facts');
    // Everything else about the prompt survives, or the ablation is a rewrite
    // and the arm varies two things at once.
    expect(ablated.user).toBe(prompt.user);
    expect(ablated.system).toContain('You do not control movement step by step');
    expect(ablated.system).toContain('Respond ONLY with JSON of this exact shape:');
    expect(ablated.system).toContain('Keep the plan short (1-4 intents).');
    // The JSON-shape rows keep their leading spaces: they are part of what the
    // model is shown, and a tidy-up that reflowed them would be a second change.
    expect(ablated.system).toContain('\n "plan":[{"kind":INTENT,...args}],');
    expect(ablated.system.length).toBeLessThan(prompt.system.length);

    // The ablation is not silently a no-op when the prompt is reworded.
    const reworded: ThinkPrompt = { system: 'nothing of the kind here', user: '' };
    expect(() => stripEpistemicInstruction(reworded)).toThrow(/cannot find the line it removes/);
  });

  it('names every contrast the arms present can support', () => {
    expect(contrastsFor(['A', 'B']).map((c) => c.label)).toEqual(['A vs B']);
    const all = contrastsFor(['A', 'A-', 'B', 'B+']);
    expect(all.map((c) => c.label)).toEqual(['A vs B', 'A vs A-', 'B+ vs B', 'A- vs B', 'A vs B+']);
    expect(all.find((c) => c.label === 'A vs B')!.isolates).toContain('confounded');
    expect(all.find((c) => c.label === 'A- vs B')!.isolates).toContain('architecture');
    expect(all.find((c) => c.label === 'A vs A-')!.isolates).toContain('instruction');
  });

  it('runs all four arms and produces the decomposing contrasts', async () => {
    const result = await runAb(
      { ...SPEC, ticks: 400, cohortSize: 3 },
      {
        arms: [
          { id: 'A', backend: faithful },
          { id: 'A-', backend: faithful },
          { id: 'B', backend: omniscient },
          { id: 'B+', backend: omniscient },
        ],
      },
    );
    if (!result.usable) throw new Error(result.reason);
    expect(result.arms).toEqual(['A', 'A-', 'B', 'B+']);
    expect(Object.keys(result.perSeed[0]!.metrics).sort()).toEqual(['A', 'A-', 'B', 'B+']);
    expect(result.contrasts.map((c) => c.label)).toEqual(['A vs B', 'A vs A-', 'B+ vs B', 'A- vs B', 'A vs B+']);

    // The manifest says, per arm, which mind and whether the sentence is there.
    const manifest = new Map(result.manifest.arms.map((a) => [a.id, a]));
    expect(manifest.get('A')).toMatchObject({ family: 'yggdrasil', epistemicInstruction: true, paid: false });
    expect(manifest.get('A-')).toMatchObject({ family: 'yggdrasil', epistemicInstruction: false });
    expect(manifest.get('B')).toMatchObject({ family: 'baseline', epistemicInstruction: false });
    expect(manifest.get('B+')).toMatchObject({ family: 'baseline', epistemicInstruction: true });
  }, 180_000);

  it('gives B+ the instruction and B none of it', async () => {
    const result = await runAb(
      { ...SPEC, ticks: 300, cohortSize: 2 },
      { arms: [{ id: 'B', backend: faithful }, { id: 'B+', backend: faithful }] },
    );
    if (!result.usable) throw new Error(result.reason);
    const plain = result.sentPrompts['B'] ?? [];
    const plus = result.sentPrompts['B+'] ?? [];
    expect(plain.length).toBeGreaterThan(0);
    expect(plus.length).toBeGreaterThan(0);
    const first = EPISTEMIC_INSTRUCTION_TEXT.split('\n')[0]!;
    expect(plus[0]!.prompt.system).toContain(first);
    expect(plain[0]!.prompt.system).not.toContain(first);
  }, 180_000);
});

describe('W1-E · seeds, pairing and pre-registration', () => {
  it('is deterministic given the backends', async () => {
    const one = await runAb({ ...SPEC }, { arms: AB });
    const two = await runAb({ ...SPEC }, { arms: AB });
    if (!one.usable || !two.usable) throw new Error('no verdict');
    expect(two.perSeed).toEqual(one.perSeed);
    expect(two.contrasts).toEqual(one.contrasts);
    expect(two.traces.map((t) => t.text)).toEqual(one.traces.map((t) => t.text));
    expect(two.traces.map((t) => t.traceId)).toEqual(one.traces.map((t) => t.traceId));
  }, 180_000);

  it('computes one difference PER SEED and carries an interval only when it has one', async () => {
    const single = await runAb({ ...SPEC, seeds: ['s1'] }, { arms: AB });
    const three = await runAb({ ...SPEC, seeds: ['s1', 's2', 's3'] }, { arms: AB });
    if (!single.usable || !three.usable) throw new Error('no verdict');

    expect(single.perSeed).toHaveLength(1);
    expect(three.perSeed).toHaveLength(3);
    const oneSeed = single.contrasts[0]!.exploratory[0]!;
    const threeSeeds = three.contrasts[0]!.exploratory[0]!;
    // Round 1 called a one-seed subtraction "seed-paired" and shipped no n.
    expect(oneSeed.n).toBe(1);
    expect(oneSeed.ci).toBeNull();
    expect(threeSeeds.n).toBe(3);
    expect(threeSeeds.deltas).toHaveLength(3);
    expect(threeSeeds.ci).not.toBeNull();
    expect(single.contrasts[0]!.design.mdeInSdUnits).toBe(Number.POSITIVE_INFINITY);
    expect(three.contrasts[0]!.design.mdeInSdUnits).toBeGreaterThan(0);
  }, 240_000);

  it('echoes the pre-registered question and marks exactly one row primary', async () => {
    const preRegistered: PreRegisteredQuestion[] = [
      {
        question: 'Is the Yggdrasil arm objectively better off in the world?',
        primaryMetric: 'planSuccessRate',
        contrast: ['A', 'B'],
        direction: 'higher',
      },
    ];
    const result = await runAb({ ...SPEC, preRegistered }, { arms: AB });
    if (!result.usable) throw new Error(result.reason);
    expect(result.manifest.preRegistered).toEqual(preRegistered);
    const headline = result.contrasts.find((c) => c.label === 'A vs B')!;
    expect(headline.primary?.metric).toBe('planSuccessRate');
    expect(headline.primary?.role).toBe('primary');
    expect(headline.primary?.question).toBe(preRegistered[0]!.question);
    // Everything else is exploratory, and says how many of it there is.
    expect(headline.exploratory.every((r) => r.role === 'exploratory')).toBe(true);
    expect(headline.exploratory.some((r) => r.metric === 'planSuccessRate')).toBe(false);
    expect(headline.multipleComparisons.comparisons).toBe(headline.exploratory.length);
    expect(headline.multipleComparisons.text).toContain('do not decide this one');
  }, 180_000);

  it('never pairs knowledge, and says whose mind could read it', async () => {
    const result = await runAb({ ...SPEC }, { arms: AB });
    if (!result.usable) throw new Error(result.reason);
    const metrics = result.perSeed[0]!.metrics;
    expect(metrics.A!.knowledge.reachesMind).toBe(true);
    expect(metrics.B!.knowledge.reachesMind).toBe(false);
    const rows = result.contrasts[0]!.exploratory.map((r) => r.metric);
    expect(rows).not.toContain('knowledgeFormed');
  }, 180_000);

  it('keeps the arms\' interview subjects apart even though the being ids match', async () => {
    const result = await runAb({ ...SPEC }, { arms: AB });
    if (!result.usable) throw new Error(result.reason);
    expect(result.subjects.A!.map((s) => s.beingId)).toEqual(result.subjects.B!.map((s) => s.beingId));
    expect(result.subjects.A![0]!.interviewee.id).not.toBe(result.subjects.B![0]!.interviewee.id);
  }, 180_000);

  it('reports its own integrity rather than leaving a fallback to look like behaviour', async () => {
    const result = await runAb({ ...SPEC }, { arms: AB });
    if (!result.usable) throw new Error(result.reason);
    expect(result.integrity.backendErrors).toHaveLength(0);
    expect(Object.keys(result.integrity.fallbackRateByArm).sort()).toEqual(['A', 'B']);
    expect(typeof result.integrity.degraded).toBe('boolean');
    expect(result.integrity.note.length).toBeGreaterThan(0);
  }, 180_000);

  it('puts two minds in one world in mixed mode', async () => {
    const result = await runAb({ ...SPEC, cohortSize: 6 }, { arms: AB }, 'mixed');
    if (!result.usable) throw new Error(result.reason);
    expect(result.mode).toBe('mixed');
    const metrics = result.perSeed[0]!.metrics;
    expect(metrics.A!.cohortSize).toBe(3);
    expect(metrics.B!.cohortSize).toBe(3);
    expect(metrics.A!.population).toEqual(metrics.B!.population);
    const ids = new Set([...result.subjects.A!, ...result.subjects.B!].map((s) => s.beingId));
    expect(ids.size).toBe(result.subjects.A!.length + result.subjects.B!.length);
  }, 180_000);

  it('refuses a run that cannot be an A/B at all', async () => {
    await expect(runAb({ ...SPEC, seeds: [] }, { arms: AB })).rejects.toThrow(/at least one seed/);
    await expect(runAb({ ...SPEC }, { arms: [AB[0]!] })).rejects.toThrow(/at least two arms/);
    await expect(
      runAb({ ...SPEC }, { arms: [...AB, { id: 'B+', backend: omniscient }] }, 'mixed'),
    ).rejects.toThrow(/exactly two arms/);
  });
});

function situation(): Parameters<typeof buildThinkPrompt>[0] {
  return {
    snapshot: {
      id: 3,
      name: 'Ilka',
      ageTicks: 5000,
      traits: { curiosity: 60, aggression: 10, compassion: 50, ambition: 40, loyalty: 55, riskTolerance: 30 },
      needs: { hunger: 61, rest: 20, safety: 5, socialConnection: 30 },
      health: 88,
      sick: false,
      place: {},
      inventory: { berry: 2 },
      context: { nearWater: true, night: false, inShelter: false, elevationBand: 0 },
    },
    recalledMemories: [],
    knowledge: [],
    relationships: new Map(),
    worldView: { tick: 900, night: false, season: 'spring', agents: [], resources: [], structures: [] },
    goals: [],
    trigger: 'periodic',
  } as unknown as Parameters<typeof buildThinkPrompt>[0];
}
