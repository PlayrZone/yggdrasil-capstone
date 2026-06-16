import { describe, expect, it } from 'vitest';
import { CraftObservationMiner } from '../src/learning/CraftObservationMiner.js';
import { renderStatement, ruleKey } from '../src/index.js';
import type { KnowledgeRule } from '../src/contract/types.js';
import { mem, resetIds } from './helpers.js';

const spearRule: KnowledgeRule = { kind: 'craft-recipe', output: 'spear', inputs: { wood: 1, stone: 1 } };

describe('craft-recipe knowledge rule', () => {
  it('keys by output only, so demonstrations of the same tool reinforce one belief', () => {
    expect(ruleKey(spearRule)).toBe('craft:spear');
    // Same output, inputs remembered differently — still the same recipe.
    expect(ruleKey({ kind: 'craft-recipe', output: 'spear', inputs: {} })).toBe('craft:spear');
  });

  it('renders a readable statement naming the materials', () => {
    expect(renderStatement(spearRule)).toBe('A spear can be made by working wood and stone together');
  });
});

describe('CraftObservationMiner — learning a skill by watching', () => {
  it('does not form the recipe from too few demonstrations', () => {
    resetIds();
    const miner = new CraftObservationMiner();
    // Watching twice is not yet apprenticeship.
    for (let i = 0; i < 2; i++) {
      miner.observe(mem(i * 10, 'Crafted', { objectKind: 'spear', craftInputs: { wood: 1, stone: 1 }, origin: 'observation' }));
    }
    expect(miner.consolidate()).toHaveLength(0);
  });

  it('forms the recipe after watching a master make it enough times', () => {
    resetIds();
    const miner = new CraftObservationMiner();
    // Eight observed demonstrations (discounted ×0.5 → evidence 4) clears the bar.
    for (let i = 0; i < 8; i++) {
      miner.observe(mem(i * 10, 'Crafted', { objectKind: 'spear', craftInputs: { wood: 1, stone: 1 }, origin: 'observation' }));
    }
    const report = miner.consolidate().find((r) => r.rule.kind === 'craft-recipe');
    expect(report).toBeDefined();
    expect(report!.rule).toMatchObject({ kind: 'craft-recipe', output: 'spear', inputs: { wood: 1, stone: 1 } });
    expect(report!.evidenceCount).toBe(4); // 8 × 0.5
    expect(report!.contradictionCount).toBe(0);
  });

  it('learns faster from doing it yourself than from watching', () => {
    resetIds();
    const watcher = new CraftObservationMiner();
    const doer = new CraftObservationMiner();
    for (let i = 0; i < 4; i++) {
      watcher.observe(mem(i * 10, 'Crafted', { objectKind: 'spear', craftInputs: { wood: 1, stone: 1 }, origin: 'observation' }));
      doer.observe(mem(i * 10, 'Crafted', { objectKind: 'spear', craftInputs: { wood: 1, stone: 1 }, origin: 'experience' }));
    }
    // Four first-hand crafts (×1 = evidence 4) reach the recipe; four watched (×0.5 = 2) do not.
    expect(doer.consolidate().find((r) => r.rule.kind === 'craft-recipe')).toBeDefined();
    expect(watcher.consolidate().find((r) => r.rule.kind === 'craft-recipe')).toBeUndefined();
  });

  it('ignores testimony — a craft is learned by watching, not by being told', () => {
    resetIds();
    const miner = new CraftObservationMiner();
    for (let i = 0; i < 10; i++) {
      miner.observe(mem(i * 10, 'Crafted', { objectKind: 'spear', craftInputs: { wood: 1, stone: 1 }, origin: 'testimony' }));
    }
    expect(miner.consolidate()).toHaveLength(0);
  });
});
