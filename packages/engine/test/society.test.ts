import { describe, expect, it } from 'vitest';
import { analyzeSociety, type SocietySignals } from '../src/index.js';

const base: SocietySignals = {
  alive: [1, 2, 3, 4, 5, 6].map((id) => ({ id, name: `A${id}` })),
  teaching: [],
  origination: [],
  bonds: [],
  kin: [],
  caches: [],
  specialists: [],
  trust: [],
};

describe('society analysis (the influence layer)', () => {
  it('detects a possible mentor from repeated teaching', () => {
    const s = analyzeSociety({
      ...base,
      teaching: [
        { teacher: 1, student: 2 },
        { teacher: 1, student: 2 },
        { teacher: 1, student: 3 },
        { teacher: 1, student: 4 },
      ],
    });
    expect(s.mentors[0]?.id).toBe(1);
    expect(s.mentors[0]?.lessons).toBe(4);
    expect(s.mentors[0]?.students).toBe(3);
    expect(s.labels.some((l) => l.includes('Possible mentor'))).toBe(true);
  });

  it('detects a possible innovator whose discoveries spread', () => {
    const s = analyzeSociety({
      ...base,
      origination: [
        { originator: 5, reach: 20 },
        { originator: 5, reach: 15 },
        { originator: 2, reach: 1 },
      ],
    });
    expect(s.innovators[0]?.id).toBe(5);
    expect(s.innovators[0]?.reach).toBe(35);
  });

  it('detects a possible family from kinship', () => {
    const s = analyzeSociety({
      ...base,
      kin: [
        { parent: 1, child: 3 },
        { parent: 2, child: 3 },
        { parent: 1, child: 4 },
      ],
    });
    expect(s.families[0]?.size).toBe(4); // 1,2,3,4 connected
  });

  it('detects a possible tribe from a social cluster', () => {
    const s = analyzeSociety({
      ...base,
      bonds: [
        { a: 1, b: 2 },
        { a: 2, b: 3 },
        { a: 3, b: 1 },
        { a: 5, b: 6 }, // only a pair — not a tribe
      ],
    });
    expect(s.tribes).toHaveLength(1);
    expect(s.tribes[0]?.size).toBe(3);
  });

  it('detects trusted sources + knowledge lineages', () => {
    const s = analyzeSociety({
      ...base,
      trust: [
        { holder: 2, toward: 1 },
        { holder: 3, toward: 1 },
        { holder: 4, toward: 1 },
      ],
      kin: [{ parent: 1, child: 2 }],
      teaching: [{ teacher: 1, student: 2 }], // a parent teaching a child = lineage
    });
    expect(s.trustedSources[0]?.id).toBe(1);
    expect(s.trustedSources[0]?.trusters).toBe(3);
    expect(s.knowledgeLineages).toBe(1);
  });

  it('never invents institutions when there is no signal', () => {
    const s = analyzeSociety(base);
    expect(s.mentors).toHaveLength(0);
    expect(s.innovators).toHaveLength(0);
    expect(s.families).toHaveLength(0);
    expect(s.tribes).toHaveLength(0);
    expect(s.trustedSources).toHaveLength(0);
    expect(s.knowledgeLineages).toBe(0);
    expect(s.labels).toHaveLength(0);
  });
});
