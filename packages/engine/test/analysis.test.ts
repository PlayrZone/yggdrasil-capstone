import { describe, expect, it } from 'vitest';
import {
  analyzeBeliefAccuracy,
  analyzeDiffusion,
  classifyArchetype,
  classifyRuleTruth,
} from '../src/index.js';
import type { AgentKnowledge, KnowledgeRecord, KnowledgeRule, MemoryRecord } from '../src/index.js';
import { ruleKey } from '../src/index.js';
import { renderStatement } from '../src/index.js';
import { CTX, mem, resetIds } from './helpers.js';

function held(rule: KnowledgeRule, overrides: Partial<KnowledgeRecord> = {}): KnowledgeRecord {
  return {
    id: 1,
    ruleKey: ruleKey(rule),
    rule,
    statement: renderStatement(rule),
    confidence: 0.8,
    evidenceCount: 6,
    contradictionCount: 0,
    sourceMemoryIds: [1, 2],
    status: 'held',
    origin: 'experience',
    firstFormed: 100,
    lastReinforced: 200,
    ...overrides,
  };
}

const FOOD_NEAR_WATER: KnowledgeRule = {
  kind: 'context-association',
  event: 'GatherSucceeded',
  objectKind: 'berry',
  feature: 'nearWater',
  direction: 'positive',
};
const MUSHROOM_SICK: KnowledgeRule = {
  kind: 'succession',
  causeType: 'AteFood',
  causeObject: 'mushroomRed',
  effectType: 'BecameSick',
};
const RAIN_DEATH: KnowledgeRule = {
  kind: 'succession',
  causeType: 'DrankWater',
  effectType: 'WitnessedDeath',
};

describe('ground truth', () => {
  it('confirms real regularities, rejects superstitions, abstains on social', () => {
    expect(classifyRuleTruth(FOOD_NEAR_WATER)).toBe('true');
    expect(classifyRuleTruth(MUSHROOM_SICK)).toBe('true');
    // Eating either poison is truly sickening…
    expect(
      classifyRuleTruth({ kind: 'succession', causeType: 'AteFood', causeObject: 'nightshade', effectType: 'BecameSick' }),
    ).toBe('true');
    // …but GATHERING the poison → sick is a confounded correlation (false).
    expect(
      classifyRuleTruth({ kind: 'succession', causeType: 'GatherSucceeded', causeObject: 'nightshade', effectType: 'BecameSick' }),
    ).toBe('false');
    expect(classifyRuleTruth(RAIN_DEATH)).toBe('false'); // death is never learnably caused
    expect(
      classifyRuleTruth({
        kind: 'succession',
        causeType: 'DrankWater',
        effectType: 'BecameSick',
      }),
    ).toBe('false'); // only the red mushroom sickens
    expect(
      classifyRuleTruth({ kind: 'social-contingency', partnerId: 5, pattern: 'reciprocates' }),
    ).toBe('unverified');
    expect(
      classifyRuleTruth({ kind: 'outcome-association', actionType: 'AteFood', feature: null, need: 'hunger', direction: 'relieves' }),
    ).toBe('true');
  });
});

describe('diffusion', () => {
  it('clusters a belief across holders and counts transmission paths', () => {
    const agents: AgentKnowledge[] = [
      { agentId: 1, alive: true, knowledge: [held(FOOD_NEAR_WATER, { origin: 'experience', firstFormed: 50 })] },
      { agentId: 2, alive: true, knowledge: [held(FOOD_NEAR_WATER, { origin: 'testimony', testimonyFrom: 1, firstFormed: 200 })] },
      { agentId: 3, alive: true, knowledge: [held(FOOD_NEAR_WATER, { origin: 'testimony', testimonyFrom: 2, firstFormed: 300 })] },
    ];
    const [cluster] = analyzeDiffusion(agents);
    expect(cluster!.holderCount).toBe(3);
    expect(cluster!.byExperience).toBe(1);
    expect(cluster!.byTestimony).toBe(2);
    expect(cluster!.originatorId).toBe(1); // earliest first-hand
    expect(cluster!.truth).toBe('true');
    expect(cluster!.outlivedOriginator).toBe(false); // originator still alive
  });

  it('flags a belief that outlived its discoverer (culture)', () => {
    const agents: AgentKnowledge[] = [
      { agentId: 1, alive: false, knowledge: [held(FOOD_NEAR_WATER, { origin: 'experience', firstFormed: 50 })] },
      { agentId: 2, alive: true, knowledge: [held(FOOD_NEAR_WATER, { origin: 'testimony', testimonyFrom: 1, firstFormed: 200 })] },
    ];
    const [cluster] = analyzeDiffusion(agents);
    expect(cluster!.originatorId).toBe(1);
    expect(cluster!.originatorAlive).toBe(false);
    expect(cluster!.outlivedOriginator).toBe(true);
  });

  it('ignores non-held knowledge', () => {
    const agents: AgentKnowledge[] = [
      { agentId: 1, alive: true, knowledge: [held(FOOD_NEAR_WATER, { status: 'hypothesis' })] },
    ];
    expect(analyzeDiffusion(agents)).toHaveLength(0);
  });
});

describe('belief accuracy', () => {
  it('separates true regularities from superstitions held by the population', () => {
    const agents: AgentKnowledge[] = [
      { agentId: 1, alive: true, knowledge: [held(FOOD_NEAR_WATER), held(MUSHROOM_SICK)] },
      { agentId: 2, alive: true, knowledge: [held(FOOD_NEAR_WATER), held(RAIN_DEATH)] },
      { agentId: 3, alive: true, knowledge: [held(RAIN_DEATH)] },
    ];
    const acc = analyzeBeliefAccuracy(analyzeDiffusion(agents));
    expect(acc.trueCount).toBe(3); // 2× food-near-water + 1× mushroom
    expect(acc.falseCount).toBe(2); // 2× rain-death superstition
    expect(acc.accuracy).toBeCloseTo(3 / 5, 5);
    expect(acc.falseBeliefs).toHaveLength(1);
    expect(acc.falseBeliefs[0]!.rule.kind).toBe('succession');
  });
});

describe('archetype (post-hoc, analysis-side)', () => {
  it('labels a food-gathering life a forager', () => {
    resetIds();
    const memories: MemoryRecord[] = [];
    for (let i = 0; i < 8; i++) memories.push(mem(i * 10, 'GatherSucceeded', { objectKind: 'berry' }));
    for (let i = 0; i < 2; i++) memories.push(mem(100 + i * 10, 'GatherSucceeded', { objectKind: 'wood' }));
    const r = classifyArchetype(memories);
    expect(r.archetype).toBe('forager');
    expect(r.dominance).toBeGreaterThan(0.5);
  });

  it('falls back to wanderer without enough signal', () => {
    resetIds();
    expect(classifyArchetype([mem(0, 'SawAgent')]).archetype).toBe('wanderer');
  });
});
