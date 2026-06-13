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

describe('Climate — seasons', () => {
  it('cycles spring→summer→autumn→winter and wraps', () => {
    expect(seasonAt(0)).toBe('spring');
    expect(seasonAt(TICKS_PER_SEASON)).toBe('summer');
    expect(seasonAt(TICKS_PER_SEASON * 2)).toBe('autumn');
    expect(seasonAt(TICKS_PER_SEASON * 3)).toBe('winter');
    expect(seasonAt(TICKS_PER_YEAR)).toBe('spring'); // wrapped
    expect(TICKS_PER_SEASON).toBe(SEASON_DAYS * TICKS_PER_DAY);
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
