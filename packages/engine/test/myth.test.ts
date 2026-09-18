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
    const slew = { id: 'slew:9:1', firstTick: 300 };
    const attack = { id: 'attack:5:2', firstTick: 600 };
    const narratives = new Map<number, { id: string; text: string; firstTick: number }[]>([
      [1, [{ ...slew, text: 'Nine slew a bear' }, { ...attack, text: 'Five attacked Two' }]],
      [2, [{ ...slew, text: 'Nine slew a bear' }]],
      [3, [{ ...slew, text: 'Nine slew a great bear' }, { ...attack, text: 'Five attacked Two' }]],
      [4, [{ ...slew, text: 'Nine slew a great bear' }, { ...attack, text: 'Five attacked Two' }]],
      [5, [{ ...attack, text: 'Five attacked Two' }]],
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

  it('names the story that fractured most', () => {
    const narratives = new Map<number, { id: string; text: string; firstTick: number }[]>([
      [1, [{ id: 'slew:9:1', text: 'Nine slew a bear', firstTick: 300 }, { id: 'home:3:2', text: 'Three raised a home', firstTick: 600 }]],
      [2, [{ id: 'slew:9:1', text: 'Nine slew a great bear', firstTick: 800 }, { id: 'home:3:2', text: 'Three raised a home', firstTick: 600 }]],
      [3, [{ id: 'slew:9:1', text: 'Nine slew the dread beast of the wild', firstTick: 900 }]],
    ]);
    const m = analyzeMyth(narratives, [], new Map(), 3000);
    expect(m.mostVaried?.id).toBe('slew:9:1');
    expect(m.mostVaried?.variants).toBe(3);
  });

  it('ages a story from when it entered the world, seeded or witnessed alike', () => {
    // A myth seeded at 2000 is younger than a slaying remembered from 300.
    const carried = [
      { id: 'seed:myth', text: 'The makers were here before us', firstTick: 2000 },
      { id: 'slew:9:1', text: 'Nine slew a bear', firstTick: 300 },
    ];
    const m = analyzeMyth(new Map([[1, carried], [2, carried], [3, carried]]), [], new Map(), 9000);
    expect(m.oldestSurviving?.text).toBe('Nine slew a bear');
    expect(m.oldestSurviving?.ageTicks).toBe(8700);
  });

  it('gives a seeded myth its true age when it is the oldest thing carried', () => {
    const carried = [{ id: 'seed:myth', text: 'The makers were here before us', firstTick: 0 }];
    const m = analyzeMyth(new Map([[1, carried], [2, carried], [3, carried]]), [], new Map(), 50000);
    expect(m.oldestSurviving?.ageTicks).toBe(50000); // not null, not 0
    expect(m.grandest?.ageTicks).toBe(50000);
  });
});
