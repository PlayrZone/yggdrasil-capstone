import { describe, expect, it } from 'vitest';
import { AgentMind, ReflexMind, foragerAdapter } from '../src/index.js';
import type { KnowledgeRule, ThinkInput } from '../src/index.js';
import { CTX, mem, resetIds } from './helpers.js';

describe('AgentMind', () => {
  it('turns repeated mushroom sickness into held knowledge, deterministically', () => {
    const run = () => {
      resetIds();
      const mind = new AgentMind(1, foragerAdapter, { consolidateInterval: 100 });
      for (let i = 0; i < 5; i++) {
        const tick = i * 1000;
        mind.observe(mem(tick, 'AteFood', { objectKind: 'mushroomRed', x: 5, y: 5, needDeltas: { hunger: -40 } }));
        mind.observe(mem(tick, 'BecameSick', { x: 5, y: 5, needDeltas: { safety: 15 } }));
      }
      mind.consolidate(5000);
      return mind.knowledge
        .held()
        .map((k) => `${k.ruleKey}@${k.confidence.toFixed(6)}x${k.evidenceCount}`)
        .sort();
    };
    const first = run();
    const second = run();
    expect(first).toEqual(second); // learning is deterministic
    expect(first.some((k) => k.includes('seq:AteFood:mushroomRed>BecameSick'))).toBe(true);
  });

  it('intakes share-knowledge utterances as trust-discounted testimony', () => {
    resetIds();
    const mind = new AgentMind(1, foragerAdapter);
    const rule: KnowledgeRule = {
      kind: 'context-association',
      event: 'GatherSucceeded',
      objectKind: 'berry',
      feature: 'nearWater',
      direction: 'positive',
    };
    mind.observe(
      mem(10, 'UtteranceSpoken', {
        subjects: [4],
        toldBy: 4,
        utterance: { targetId: 1, speechAct: 'share-knowledge', rule, ruleConfidence: 0.9 },
      }),
    );
    const all = mind.knowledge.all();
    expect(all).toHaveLength(1);
    expect(all[0]!.origin).toBe('testimony');
    expect(all[0]!.testimonyFrom).toBe(4);
    // Neutral trust (50) → 0.9 × (0.3 + 0.5 × 0.5) = 0.495.
    expect(all[0]!.confidence).toBeCloseTo(0.495, 3);
  });

  it('moves relationship scalars on first-hand events only', () => {
    resetIds();
    const mind = new AgentMind(1, foragerAdapter);
    mind.observe(mem(10, 'ReceivedItem', { subjects: [2], objectKind: 'berry' }));
    mind.observe(mem(20, 'AttackedAgent', { subjects: [3, 9], origin: 'observation' }));
    expect(mind.relationships.get(2)!.trust).toBeGreaterThan(50);
    expect(mind.relationships.get(3)).toBeUndefined();
  });
});

describe('ReflexMind consuming knowledge', () => {
  function baseInput(overrides: Partial<ThinkInput['snapshot']> = {}): ThinkInput {
    return {
      snapshot: {
        id: 1,
        name: 'Kara',
        ageTicks: 100,
        traits: { curiosity: 50, aggression: 10, compassion: 80, ambition: 40, loyalty: 60, riskTolerance: 30 },
        needs: { hunger: 70, rest: 10, safety: 5, socialConnection: 10 },
        health: 90,
        sick: false,
        x: 0,
        y: 0,
        inventory: {},
        context: CTX,
        ...overrides,
      },
      recalledMemories: [],
      knowledge: [],
      relationships: new Map(),
      worldView: { tick: 500, night: false, season: 'spring', agents: [], resources: [], structures: [] },
      goals: [],
      trigger: 'periodic',
    };
  }

  it('eats safe food from inventory when hungry', () => {
    const input = baseInput({ inventory: { berry: 2 } });
    const out = new ReflexMind().think(input);
    expect(out.plan[0]).toEqual({ kind: 'Eat', objectKind: 'berry' });
  });

  it('refuses food its knowledge says leads to sickness — discovery changes behavior', () => {
    const input = baseInput({ inventory: { mushroomRed: 2 } });
    input.knowledge = [
      {
        id: 1,
        ruleKey: 'seq:AteFood:mushroomRed>BecameSick:*',
        rule: {
          kind: 'succession',
          causeType: 'AteFood',
          causeObject: 'mushroomRed',
          effectType: 'BecameSick',
        },
        statement: 'Eating (mushroomRed) is followed by becoming sick',
        confidence: 0.83,
        evidenceCount: 5,
        contradictionCount: 1,
        sourceMemoryIds: [1, 2, 3],
        status: 'held',
        origin: 'experience',
        firstFormed: 100,
        lastReinforced: 400,
      },
    ];
    const out = new ReflexMind().think(input);
    expect(out.plan[0]?.kind).not.toBe('Eat');
    // Without that knowledge, the same situation ends in eating the mushroom.
    const naive = new ReflexMind().think(baseInput({ inventory: { mushroomRed: 2 } }));
    expect(naive.plan[0]).toEqual({ kind: 'Eat', objectKind: 'mushroomRed' });
  });
});
