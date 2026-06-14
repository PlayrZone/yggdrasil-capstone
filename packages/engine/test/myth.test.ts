import { describe, expect, it } from 'vitest';
import { analyzeMyth, mutateNarrative } from '../src/index.js';

describe('myth formation', () => {
  it('a retelling can faithfully keep, lose a detail, or climb the legend ladder', () => {
    const text = 'Karendo raised a home in the forest';
    const outcomes = new Set<string>();
    for (let h = 0; h < 100; h++) outcomes.add(mutateNarrative(text, h));
    expect(outcomes.has('Karendo raised a home in the forest')).toBe(true); // faithful
    expect(outcomes.has('Karendo raised a home')).toBe(true); // detail lost (place)
    expect([...outcomes].some((o) => o.includes('great hall'))).toBe(true); // one rung grander
  });

  it('escalates a humble event into legend over many retellings', () => {
    // Repeatedly retell with an "escalate" seed (h%100 in [87,100)) → it climbs.
    let text = 'Karendo raised a home in the forest';
    for (let i = 0; i < 30; i++) text = mutateNarrative(text, 90); // 90 → ladder step
    expect(text).toContain('chosen by the spirits'); // home → great hall → settlement → our people → chosen
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
