import { describe, expect, it } from 'vitest';
import { World } from '../src/core/World.js';
import {
  SEASON_DAYS,
  TICKS_PER_SEASON,
  TICKS_PER_YEAR,
  coldPressure,
  growthFactor,
  hungerRateMultiplier,
  seasonAt,
  weatherAt,
} from '../src/body/Climate.js';
import { ResourceNodeSystem, createResourceNode } from '../src/body/ResourceNodeSystem.js';
import { TICKS_PER_DAY } from '../src/body/WorldRegularities.js';
import { foragerAdapter } from '../src/worlds/forager/adapter.js';

describe('Climate — seasons', () => {
  it('cycles spring→summer→autumn→winter and wraps', () => {
    expect(seasonAt(0)).toBe('spring');
    expect(seasonAt(TICKS_PER_SEASON)).toBe('summer');
    expect(seasonAt(TICKS_PER_SEASON * 2)).toBe('autumn');
    expect(seasonAt(TICKS_PER_SEASON * 3)).toBe('winter');
    expect(seasonAt(TICKS_PER_YEAR)).toBe('spring'); // wrapped
    expect(TICKS_PER_SEASON).toBe(SEASON_DAYS * TICKS_PER_DAY);
  });

  /**
   * The forager world writes its clock out rather than importing the body's
   * derived constants — `Climate`, `WorldRegularities` and `ResourceNodeSystem`
   * form an import cycle, so `TICKS_PER_SEASON` and `TICKS_PER_YEAR` initialise
   * to NaN when the graph is entered at `PerceptionSystem` instead of at
   * `body/index.ts`, and a world's clock must not depend on that. This file
   * reaches the body in the order that works, so it is where the two are tied
   * together. (The cycle itself is a pre-existing engine bug, reported, unfixed.)
   */
  it('is the same clock the forager world declares', () => {
    expect(foragerAdapter.time.ticksPerDay).toBe(TICKS_PER_DAY);
    expect(foragerAdapter.time.ticksPerSeason).toBe(TICKS_PER_SEASON);
    expect(foragerAdapter.time.ticksPerYear).toBe(TICKS_PER_YEAR);
    expect(foragerAdapter.time.adultAge).toBe(TICKS_PER_SEASON); // Scenario's ADULT_AGE
    expect(foragerAdapter.time.seasonAt).toBe(seasonAt);
  });

  it('winter halts growth and presses hardest; summer is easy', () => {
    const winter = TICKS_PER_SEASON * 3;
    const summer = TICKS_PER_SEASON;
    expect(growthFactor(winter)).toBe(0);
    expect(growthFactor(summer)).toBe(1);
    expect(growthFactor(TICKS_PER_SEASON * 2)).toBe(0.5); // autumn
    expect(coldPressure(winter)).toBe(1);
    expect(coldPressure(summer)).toBe(0);
    expect(hungerRateMultiplier(winter)).toBeGreaterThan(hungerRateMultiplier(summer));
  });

  it('weather is deterministic per day and winter-biased to cold', () => {
    expect(weatherAt(123)).toBe(weatherAt(123));
    const winterDay = TICKS_PER_SEASON * 3 + 10;
    // Sample a winter's worth of days — cold snaps should be common.
    let cold = 0;
    for (let d = 0; d < SEASON_DAYS; d++) {
      if (weatherAt(winterDay + d * TICKS_PER_DAY) === 'coldsnap') cold++;
    }
    expect(cold).toBeGreaterThan(0);
  });
});

describe('ResourceNodeSystem — seasonal regrowth', () => {
  it('plant nodes regrow in spring but not in winter', () => {
    const sys = new ResourceNodeSystem();
    // Spring: a regrow tick increments stock.
    {
      const w = new World();
      const e = w.createEntity({ ResourceNode: createResourceNode('berryBush', 8) });
      const node = e.components['ResourceNode'] as { stock: number; regrowEvery: number };
      node.stock = 4;
      const springRegrowTick = node.regrowEvery; // spring (tick well within season 0)
      sys.step(w, springRegrowTick);
      expect(node.stock).toBe(5);
    }
    // Winter: same depletion, a regrow tick does NOT increment.
    {
      const w = new World();
      const e = w.createEntity({ ResourceNode: createResourceNode('berryBush', 8) });
      const node = e.components['ResourceNode'] as { stock: number; regrowEvery: number };
      node.stock = 4;
      const winterBase = TICKS_PER_SEASON * 3;
      const winterRegrowTick = winterBase + node.regrowEvery - (winterBase % node.regrowEvery);
      sys.step(w, winterRegrowTick);
      expect(node.stock).toBe(4); // winter halts regrowth
    }
  });

  it('mineral nodes (ore) never regrow', () => {
    const w = new World();
    const e = w.createEntity({ ResourceNode: createResourceNode('copperVein', 6) });
    const node = e.components['ResourceNode'] as { stock: number; regrowEvery: number };
    node.stock = 1;
    const sys = new ResourceNodeSystem();
    for (let t = 1; t < 2000; t++) sys.step(w, t);
    expect(node.stock).toBe(1);
  });
});
