import { describe, expect, it } from 'vitest';
import { NarrativeStore } from '../src/narrative/NarrativeStore.js';

describe('NarrativeStore origins', () => {
  it('a retelling never makes a tale younger, and an older teller corrects it', () => {
    const store = new NarrativeStore();
    store.remember('slew:9:0', 'Nine slew a bear', 10, 20, 500, true);
    store.remember('slew:9:0', 'Nine slew a great bear', 10, 20, 900, false);
    expect(store.get('slew:9:0')!.firstTick).toBe(500);
    store.remember('slew:9:0', 'Nine slew a great bear', 10, 20, 120, false);
    expect(store.get('slew:9:0')!.firstTick).toBe(120);
    expect(store.get('slew:9:0')!.timesHeard).toBe(3);
  });

  it('seeding an already-carried tale never moves its origin forward', () => {
    const store = new NarrativeStore();
    store.remember('seed:myth', 'The makers raised a home', 5, 5, 40, true);
    store.seed('seed:myth', 'The makers raised a great hall', 5, 5, 9000, 6);
    const story = store.get('seed:myth')!;
    expect(story.firstTick).toBe(40); // the tale is as old as it ever was
    expect(story.text).toBe('The makers raised a great hall');
    expect(story.timesHeard).toBe(6);
    // …and seeding one nobody carries still dates it from the seeding tick.
    store.seed('seed:other', 'A second tale', 1, 1, 9000, 2);
    expect(store.get('seed:other')!.firstTick).toBe(9000);
  });

  it('seeding backwards is allowed — it is the origin, not the telling', () => {
    const store = new NarrativeStore();
    store.seed('seed:myth', 'A tale', 0, 0, 800, 3);
    store.seed('seed:myth', 'A tale', 0, 0, 100, 3);
    expect(store.get('seed:myth')!.firstTick).toBe(100);
  });

  it('refuses a tale whose claimed origin is not a real tick', () => {
    const store = new NarrativeStore();
    store.remember('a', 'from nowhere', 0, 0, Number.NaN, false);
    store.remember('b', 'from before time', 0, 0, -5000, false);
    store.remember('c', 'from forever', 0, 0, Number.NEGATIVE_INFINITY, false);
    store.remember('d', 'from the end of time', 0, 0, Number.POSITIVE_INFINITY, false);
    expect(store.size).toBe(0);
  });

  it('a bad origin cannot rewrite the age of a tale already carried', () => {
    const store = new NarrativeStore();
    store.remember('slew:9:0', 'Nine slew a bear', 0, 0, 700, true);
    store.remember('slew:9:0', 'Nine slew a bear', 0, 0, -1, false);
    store.remember('slew:9:0', 'Nine slew a bear', 0, 0, Number.NaN, false);
    const story = store.get('slew:9:0')!;
    expect(story.firstTick).toBe(700);
    expect(story.timesHeard).toBe(1); // the corrupt retellings were not taken in
  });
});
