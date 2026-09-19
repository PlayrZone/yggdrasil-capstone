import { describe, expect, it } from 'vitest';
import {
  ContextMiner,
  OutcomeMiner,
  SocialMiner,
  SuccessionMiner,
  foragerAdapter,
  renderStatement,
  ruleKey,
} from '../src/index.js';
import { CTX, mem, resetIds } from './helpers.js';

describe('ContextMiner', () => {
  it('discovers "food is found near water" from lived correlation', () => {
    resetIds();
    const miner = new ContextMiner(foragerAdapter);
    // 8 of 10 berry gathers happened near water…
    for (let i = 0; i < 10; i++) {
      miner.observe(
        mem(i * 10, 'GatherSucceeded', {
          objectKind: 'berry',
          context: { ...CTX, nearWater: i < 8 },
        }),
      );
    }
    // …while the background rate of being near water is low.
    for (let i = 0; i < 20; i++) {
      miner.observe(mem(200 + i * 10, 'DrankWater', { context: { ...CTX, nearWater: i < 4 } }));
    }

    const reports = miner.consolidate();
    const rule = reports.find(
      (r) =>
        r.rule.kind === 'context-association' &&
        r.rule.event === 'GatherSucceeded' &&
        r.rule.feature === 'nearWater' &&
        r.rule.direction === 'positive',
    );
    expect(rule).toBeDefined();
    expect(rule!.evidenceCount).toBe(8);
    // Laplace: (8+1)/(10+2)
    expect(rule!.confidence).toBeCloseTo(0.75, 5);
    expect(rule!.sourceMemoryIds.length).toBeGreaterThan(0);
  });

  it('stays silent when the correlation is just the base rate', () => {
    resetIds();
    const miner = new ContextMiner(foragerAdapter);
    // Near water half the time, gathering near water half the time: lift ≈ 1.
    for (let i = 0; i < 12; i++) {
      miner.observe(
        mem(i * 10, 'GatherSucceeded', { objectKind: 'berry', context: { ...CTX, nearWater: i % 2 === 0 } }),
      );
    }
    for (let i = 0; i < 12; i++) {
      miner.observe(mem(200 + i * 10, 'DrankWater', { context: { ...CTX, nearWater: i % 2 === 0 } }));
    }
    const rules = miner.consolidate().filter((r) => r.rule.kind === 'context-association');
    expect(
      rules.find((r) => r.rule.kind === 'context-association' && r.rule.feature === 'nearWater'),
    ).toBeUndefined();
  });
});

describe('SuccessionMiner', () => {
  it('discovers seed → plant from repeated succession at the same spot', () => {
    resetIds();
    const miner = new SuccessionMiner(foragerAdapter);
    for (let i = 0; i < 3; i++) {
      const base = i * 2000;
      miner.observe(mem(base, 'SeedDeposited', { objectKind: 'seed', x: 10, y: 10 }));
      miner.observe(mem(base + 400, 'PlantSprouted', { x: 11, y: 10 }));
    }
    const rule = miner
      .consolidate()
      .find(
        (r) =>
          r.rule.kind === 'succession' &&
          r.rule.causeType === 'SeedDeposited' &&
          r.rule.effectType === 'PlantSprouted',
      );
    expect(rule).toBeDefined();
    expect(rule!.evidenceCount).toBe(3);
    expect(rule!.confidence).toBeCloseTo(4 / 5, 5);
    expect(renderStatement(rule!.rule)).toContain('seed');
  });

  it('ignores successions outside the time window or far away', () => {
    resetIds();
    const miner = new SuccessionMiner(foragerAdapter, { windowTicks: 100, radius: 5 });
    miner.observe(mem(0, 'SeedDeposited', { x: 0, y: 0 }));
    miner.observe(mem(500, 'PlantSprouted', { x: 0, y: 0 })); // too late
    miner.observe(mem(600, 'SeedDeposited', { x: 0, y: 0 }));
    miner.observe(mem(650, 'PlantSprouted', { x: 50, y: 50 })); // too far
    expect(
      miner
        .consolidate()
        .find((r) => r.rule.kind === 'succession' && r.rule.causeType === 'SeedDeposited'),
    ).toBeUndefined();
  });

  it('permits false knowledge: a coincidence can become a belief', () => {
    resetIds();
    const miner = new SuccessionMiner(foragerAdapter);
    // Pure coincidence, twice: drinking water then witnessing a death.
    for (let i = 0; i < 2; i++) {
      miner.observe(mem(i * 3000, 'DrankWater', { x: 0, y: 0 }));
      miner.observe(mem(i * 3000 + 100, 'WitnessedDeath', { x: 1, y: 1 }));
    }
    const superstition = miner
      .consolidate()
      .find(
        (r) =>
          r.rule.kind === 'succession' &&
          r.rule.causeType === 'DrankWater' &&
          r.rule.effectType === 'WitnessedDeath',
      );
    // No truth oracle: the pattern is reported. The knowledge lifecycle
    // (not the miner) decides how seriously to take it.
    expect(superstition).toBeDefined();
    expect(superstition!.evidenceCount).toBe(2);
  });
});

describe('SocialMiner', () => {
  it('discovers reciprocation per partner', () => {
    resetIds();
    const miner = new SocialMiner(foragerAdapter);
    for (let i = 0; i < 4; i++) {
      miner.observe(mem(i * 100, 'GaveItem', { subjects: [7] }));
      if (i < 3) miner.observe(mem(i * 100 + 50, 'ReceivedItem', { subjects: [7] }));
    }
    const rule = miner
      .consolidate()
      .find((r) => r.rule.kind === 'social-contingency' && r.rule.pattern === 'reciprocates');
    expect(rule).toBeDefined();
    expect(rule!.rule.kind === 'social-contingency' && rule!.rule.partnerId).toBe(7);
    expect(rule!.evidenceCount).toBe(3);
    expect(rule!.confidence).toBeCloseTo(4 / 6, 5);
  });

  it('marks repeat attackers dangerous', () => {
    resetIds();
    const miner = new SocialMiner(foragerAdapter);
    miner.observe(mem(0, 'WasAttacked', { subjects: [9] }));
    miner.observe(mem(500, 'WasAttacked', { subjects: [9] }));
    const rule = miner
      .consolidate()
      .find((r) => r.rule.kind === 'social-contingency' && r.rule.pattern === 'dangerous');
    expect(rule).toBeDefined();
    expect(rule!.confidence).toBeCloseTo(2 / 3, 5);
  });
});

describe('OutcomeMiner', () => {
  it('discovers that sheltered sleep eases rest', () => {
    resetIds();
    const miner = new OutcomeMiner(foragerAdapter);
    for (let i = 0; i < 4; i++) {
      miner.observe(
        mem(i * 100, 'SleptSafely', {
          context: { ...CTX, inShelter: true },
          needDeltas: { rest: -35 },
        }),
      );
    }
    const rule = miner
      .consolidate()
      .find(
        (r) =>
          r.rule.kind === 'outcome-association' &&
          r.rule.actionType === 'SleptSafely' &&
          r.rule.feature === 'inShelter' &&
          r.rule.need === 'rest',
      );
    expect(rule).toBeDefined();
    expect(rule!.rule.kind === 'outcome-association' && rule!.rule.direction).toBe('relieves');
    expect(rule!.confidence).toBeCloseTo(5 / 6, 5);
  });

  it('learns from observation (demonstration) too, but discounted vs first-hand', () => {
    resetIds();
    const miner = new OutcomeMiner(foragerAdapter);
    // A few glimpses of an elder eating are not enough to cross the threshold
    // (observation is weighted 0.4, so 4 watches ≈ 1.6 evidence < 3).
    for (let i = 0; i < 4; i++) {
      miner.observe(mem(i * 100, 'AteFood', { origin: 'observation', needDeltas: { hunger: -40 } }));
    }
    expect(miner.consolidate()).toHaveLength(0);
    // But repeatedly WATCHING the demonstration does teach — vertical/community
    // knowledge transfer (12 watches ≈ 4.8 evidence ≥ 3).
    for (let i = 0; i < 8; i++) {
      miner.observe(mem(1000 + i * 100, 'AteFood', { origin: 'observation', needDeltas: { hunger: -40 } }));
    }
    const learned = miner
      .consolidate()
      .find((r) => r.rule.kind === 'outcome-association' && r.rule.actionType === 'AteFood' && r.rule.need === 'hunger');
    expect(learned).toBeDefined();
    expect(learned!.rule.kind === 'outcome-association' && learned!.rule.direction).toBe('relieves');
  });
});

describe('rule identity', () => {
  it('equal rules produce equal keys (diffusion comparability)', () => {
    const a = ruleKey({
      kind: 'context-association',
      event: 'GatherSucceeded',
      objectKind: 'berry',
      feature: 'nearWater',
      direction: 'positive',
    });
    const b = ruleKey({
      kind: 'context-association',
      event: 'GatherSucceeded',
      objectKind: 'berry',
      feature: 'nearWater',
      direction: 'positive',
    });
    expect(a).toBe(b);
  });
});
