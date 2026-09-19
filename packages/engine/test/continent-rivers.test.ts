import { describe, expect, it } from 'vitest';
import {
  RIVER_COUNT,
  continentHeightAt,
  continentIsDeepWater,
  continentIsWater,
  riverBedHeight,
  riverCourse,
  riverExtent,
} from '../src/world/continent.js';
import { scenarioFor } from '../src/runner/Scenario.js';

/**
 * A RIVER HAS TO GET TO THE SEA.
 *
 * The first draft's rivers 1 and 2 stopped on dry ground, 27.3 m and 18.5 m
 * above sea level and hundreds of metres short of the water, because their
 * mouths were hand-set coordinates rather than something the land decided.
 * They are now built by following the ground west until it goes under, with a
 * bed that is the running minimum of the ground crossed — so both properties
 * below hold by construction, and this is where that is checked rather than
 * asserted in a comment.
 *
 * ON SEEDS. The continent's LAND is one particular continent: `continentHeightAt`
 * takes no seed, and the noise fields that shape it are fixed constants. A run
 * seed decides only what is scattered on it. The ten-seed loop below is there
 * to make that a checked claim instead of a remembered one — if anything ever
 * makes the ground depend on the seed, the rivers are the first thing to break.
 */

const SEEDS = ['s0', 's1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9'];

describe('every river reaches the sea', () => {
  it('ends under water, with open sea just beyond the last fresh water', () => {
    for (let i = 0; i < RIVER_COUNT; i++) {
      const { shore, mouth, source } = riverExtent(i);
      expect(mouth, `river ${i} carve stops upstream of its own mouth`).toBeLessThanOrEqual(shore);
      expect(source - shore, `river ${i} is a trickle`).toBeGreaterThan(1500);
      const course = riverCourse(i, 20);
      const at = course[0]!;
      expect(at.x).toBeCloseTo(shore, 6);
      // The last point of fresh water is at or below sea level…
      expect(continentHeightAt(at.x, at.y), `river ${i} ends ${continentHeightAt(at.x, at.y)} m up`).toBeLessThan(0);
      expect(continentIsWater(at.x, at.y)).toBe(true);
      // …and 30 m further down the course is sea a walker cannot enter.
      const beyond = { x: at.x - 30, y: at.y };
      expect(continentIsDeepWater(beyond.x, beyond.y), `river ${i} does not meet the sea`).toBe(true);
    }
  });

  it('never runs uphill: the bed falls from source to mouth', () => {
    for (let i = 0; i < RIVER_COUNT; i++) {
      const { mouth, source } = riverExtent(i);
      let previous = Number.POSITIVE_INFINITY;
      let lowestSeen = Number.POSITIVE_INFINITY;
      for (let x = source; x >= mouth; x -= 4) {
        const bed = riverBedHeight(i, x);
        expect(bed, `river ${i} bed rises at x=${x}`).toBeLessThanOrEqual(previous);
        previous = bed;
        lowestSeen = Math.min(lowestSeen, bed);
      }
      // It falls a long way, rather than being flat and trivially monotone.
      expect(riverBedHeight(i, source) - lowestSeen, `river ${i} has no fall`).toBeGreaterThan(300);
      expect(lowestSeen, `river ${i} bed never gets under water`).toBeLessThan(0);
    }
  });

  it('carries fresh water the whole way, on every seed', () => {
    for (const seed of SEEDS) {
      const geography = scenarioFor({ seed, scenario: 'forager-continent', agentCount: 1 }).geography;
      for (let i = 0; i < RIVER_COUNT; i++) {
        for (const p of riverCourse(i, 120)) {
          expect(geography.isWater(p.x, p.y), `${seed}: river ${i} is dry at ${p.x},${p.y}`).toBe(true);
          // Fordable everywhere it is a river; a lake it runs through is not.
          const inLake = geography.regionAt(p.x, p.y) === 'lake';
          expect(geography.isDeepWater(p.x, p.y), `${seed}: river ${i} at ${p.x},${p.y}`).toBe(inLake);
        }
      }
    }
  }, 120_000);
});
