import { describe, expect, it } from 'vitest';
import { analyzeCulture } from '../src/index.js';
import type { KnowledgeRule } from '../src/index.js';

// A true belief and a false one (a superstition).
const trueRule: KnowledgeRule = { kind: 'context-association', event: 'GatherSucceeded', objectKind: 'berry', feature: 'nearWater', direction: 'positive' };
const falseRule: KnowledgeRule = { kind: 'context-association', event: 'GatherSucceeded', objectKind: 'berry', feature: 'highland', direction: 'positive' };

function belief(key: string, statement: string, rule: KnowledgeRule) {
  return { key, statement, rule };
}

describe('culture analysis (what tribes believe)', () => {
  it('measures cultural divergence + the superstition test', () => {
    // Tribe A (1,2,3) all believe a TRUE thing; tribe B (4,5,6) all believe a FALSE thing.
    const beliefs = new Map<number, ReturnType<typeof belief>[]>();
    for (const id of [1, 2, 3]) beliefs.set(id, [belief('t', 'food is near water', trueRule)]);
    for (const id of [4, 5, 6]) beliefs.set(id, [belief('f', 'food is in the highlands', falseRule)]);
    const c = analyzeCulture(
      [
        { members: [1, 2, 3], size: 3 },
        { members: [4, 5, 6], size: 3 },
      ],
      beliefs,
    );
    // The two tribes share no beliefs → maximal divergence.
    expect(c.divergence).toBe(1);
    expect(c.mostDivergent?.aOnly[0]).toBeDefined();
    expect(c.mostDivergent?.bOnly[0]).toBeDefined();
    // Tribe B holds a superstition (false belief); tribe A does not.
    const falseCounts = c.tribes.map((t) => t.falseCount).sort();
    expect(falseCounts).toEqual([0, 1]);
    expect(c.labels.some((l) => l.includes('superstition') || l.includes('divergence'))).toBe(true);
  });

  it('detects shared stories (narrative identity)', () => {
    const beliefs = new Map([[1, [belief('t', 's', trueRule)]], [2, [belief('t', 's', trueRule)]], [3, [belief('t', 's', trueRule)]]]);
    const narratives = new Map([
      [1, [{ id: 'slew:9:1', text: 'Ka slew a bear' }]],
      [2, [{ id: 'slew:9:1', text: 'Ka slew a bear' }]],
      [3, [{ id: 'slew:9:1', text: 'Ka slew a bear' }]],
    ]);
    const c = analyzeCulture([{ members: [1, 2, 3], size: 3 }], beliefs, narratives);
    expect(c.topStory?.text).toBe('Ka slew a bear');
    expect(c.topStory?.holders).toBe(3);
    expect(c.tribeStories[0]?.stories).toContain('Ka slew a bear');
  });
});
