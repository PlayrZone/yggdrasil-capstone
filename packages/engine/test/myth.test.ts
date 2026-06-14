import { describe, expect, it } from 'vitest';
import { analyzeMyth, mutateNarrative } from '../src/index.js';

describe('myth formation', () => {
  it('a retelling can faithfully keep, lose a detail, or embellish — deterministically', () => {
    const text = 'Karendo slew a bear in the forest';
    // Sweep many seeds; we should see the original, a detail-lost version, and an embellished one.
    const outcomes = new Set<string>();
    for (let h = 0; h < 100; h++) outcomes.add(mutateNarrative(text, h));
    expect(outcomes.has('Karendo slew a bear in the forest')).toBe(true); // faithful
    expect(outcomes.has('Karendo slew a bear')).toBe(true); // detail lost
    expect([...outcomes].some((o) => o.includes('great bear') || o.includes('single-handedly'))).toBe(true); // embellished
  });

  it('detects drift, a hero, a villain, and divergent tribe versions', () => {
    // Same event id 'slew:9:1' is held in TWO versions across two tribes; an attacker is a villain.
    const narratives = new Map<number, { id: string; text: string }[]>([
      [1, [{ id: 'slew:9:1', text: 'Nine slew a bear' }, { id: 'attack:5:2', text: 'Five attacked Two' }]],
      [2, [{ id: 'slew:9:1', text: 'Nine slew a bear' }]],
      [3, [{ id: 'slew:9:1', text: 'Nine slew a great bear' }, { id: 'attack:5:2', text: 'Five attacked Two' }]],
      [4, [{ id: 'slew:9:1', text: 'Nine slew a great bear' }, { id: 'attack:5:2', text: 'Five attacked Two' }]],
      [5, [{ id: 'attack:5:2', text: 'Five attacked Two' }]],
    ]);
    const tribes = [
      { members: [1, 2], size: 2 },
      { members: [3, 4], size: 2 },
    ];
    const names = new Map([[9, 'Nine'], [5, 'Five']]);
    const m = analyzeMyth(narratives, tribes, names);
    expect(m.driftedStories).toBe(1); // slew:9:1 has 2 versions
    expect(m.heroes[0]?.name).toBe('Nine');
    expect(m.villains[0]?.name).toBe('Five');
    expect(m.tribeVersions?.versions.length).toBe(2); // each tribe its own version
  });
});
