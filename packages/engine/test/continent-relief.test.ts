import { describe, expect, it } from 'vitest';
import {
  CONTINENT_LAKES,
  CONTINENT_SPAN,
  FOUNDING_VALLEY,
  HIGHLAND_M,
  RIVER_COUNT,
  UPLAND_M,
  continentElevationBand,
  continentGeography,
  continentHeightAt,
  continentIsDeepWater,
  continentRegionAt,
  inFoundingValley,
} from '../src/world/continent.js';
import { classicGeography } from '../src/world/geography.js';
import { scaleReport } from '../src/worlds/forager/scale.js';

/**
 * WHAT THE GROUND ACTUALLY IS, in metres. `world/continent.ts` promises relief
 * a human would recognise and a slope a mesher can cope with; this is where
 * those promises are measured rather than asserted in a comment. A terrain
 * change that moves any of them fails here — including the ones `scaleReport`
 * publishes, so that function cannot drift into being a lie.
 */

/**
 * The declared bound on |∇height|: no ground steeper than 50°. Mountain faces
 * genuinely reach that; anything beyond it is a cliff the field cannot mesh.
 * Every relief layer is budgeted against it in `continent.ts`.
 */
const MAX_SLOPE = 1.2;

function grid(step: number, visit: (x: number, y: number) => void): void {
  for (let y = 0; y < CONTINENT_SPAN; y += step) {
    for (let x = 0; x < CONTINENT_SPAN; x += step) visit(x, y);
  }
}

describe('the continent has relief a human would recognise', () => {
  it('reaches 800 m and no higher than the report says', () => {
    let peak = -Infinity;
    grid(16, (x, y) => {
      const h = continentHeightAt(x, y);
      if (h > peak) peak = h;
    });
    expect(peak).toBeGreaterThanOrEqual(800);
    // Pinned to the figure `scaleReport` publishes, within the resolution of
    // this probe — the report is a constant and this is what keeps it honest.
    expect(peak).toBeCloseTo(scaleReport('forager-continent').maxPeakM, 0);
  }, 120_000);

  it('has passes through the range: the crest is not a wall', () => {
    // Along the crest line the ground must fall below the highland threshold
    // somewhere, or the range cannot be crossed on foot.
    let crossable = 0;
    for (let y = 1800; y < 6400; y += 32) {
      let lowest = Infinity;
      for (let x = 3000; x < 7400; x += 32) {
        const h = continentHeightAt(x, y);
        if (h < lowest) lowest = h;
      }
      if (lowest < HIGHLAND_M) crossable++;
    }
    expect(crossable).toBeGreaterThan(0);
  }, 120_000);

  it('keeps every slope below the declared bound', () => {
    let worst = 0;
    let at: [number, number] = [0, 0];
    grid(8, (x, y) => {
      const s = continentGeography.slopeAt(x, y);
      if (s > worst) {
        worst = s;
        at = [x, y];
      }
    });
    expect(worst, `steepest ground at ${at}`).toBeLessThan(MAX_SLOPE);
  }, 300_000);

  it('rings the land with deep water, so the wall is unreachable', () => {
    const e = continentGeography.edge;
    for (let t = e; t < CONTINENT_SPAN - e; t += 8) {
      for (const [x, y] of [
        [t, e],
        [t, CONTINENT_SPAN - e],
        [e, t],
        [CONTINENT_SPAN - e, t],
      ] as const) {
        expect(continentIsDeepWater(x, y), `${x},${y} should be open sea`).toBe(true);
      }
    }
    // …and a good way in from the edge, too: this is a sea, not a puddle.
    for (let t = 300; t < CONTINENT_SPAN - 300; t += 16) {
      expect(continentIsDeepWater(t, 300)).toBe(true);
      expect(continentIsDeepWater(300, t)).toBe(true);
    }
  }, 120_000);

  it('puts the elevation bands at metre thresholds that keep their meaning', () => {
    // 0 lowland · 1 upland · 2 highland, as in the classic world — but read off
    // 120 m and 400 m rather than 4 m and 8 m, so `highland` still means the
    // range where the ore is.
    expect(UPLAND_M).toBe(120);
    expect(HIGHLAND_M).toBe(400);
    const sample: number[] = [0, 0, 0];
    grid(32, (x, y) => {
      sample[continentElevationBand(x, y)]!++;
    });
    expect(sample[0]).toBeGreaterThan(0);
    expect(sample[1]).toBeGreaterThan(0);
    expect(sample[2]).toBeGreaterThan(0);
    // Every highland point is in the range — the only exception being the
    // mountain streams that run down it, which are `river` all the way up.
    grid(64, (x, y) => {
      if (continentElevationBand(x, y) !== 2) return;
      expect(['mountain', 'river']).toContain(continentRegionAt(x, y));
    });
  }, 120_000);

  it('has a valley floor a being can live on', () => {
    let lowest = Infinity;
    let highest = -Infinity;
    let deep = 0;
    let n = 0;
    for (let y = FOUNDING_VALLEY.y - 500; y < FOUNDING_VALLEY.y + 500; y += 8) {
      for (let x = FOUNDING_VALLEY.x - 500; x < FOUNDING_VALLEY.x + 500; x += 8) {
        if (!inFoundingValley(x, y)) continue;
        n++;
        const h = continentHeightAt(x, y);
        if (h < lowest) lowest = h;
        if (h > highest) highest = h;
        if (continentIsDeepWater(x, y)) deep++;
      }
    }
    expect(n).toBeGreaterThan(1000);
    expect(highest).toBeLessThan(40);
    expect(lowest).toBeGreaterThan(0);
    expect(deep).toBe(0);
    expect(FOUNDING_VALLEY.half * 2).toBeGreaterThanOrEqual(600);
    expect(FOUNDING_VALLEY.half * 2).toBeLessThanOrEqual(900);
  });

  it('puts the ore in the range and the salt on the coast, kilometres away', () => {
    let toHighland = Infinity;
    let toCoast = Infinity;
    grid(32, (x, y) => {
      const d = Math.hypot(x - FOUNDING_VALLEY.x, y - FOUNDING_VALLEY.y);
      if (continentHeightAt(x, y) >= HIGHLAND_M && d < toHighland) toHighland = d;
      if (continentRegionAt(x, y) === 'coast' && !continentIsDeepWater(x, y) && d < toCoast) toCoast = d;
    });
    expect(toHighland).toBeGreaterThan(2000);
    expect(toCoast).toBeGreaterThan(900);
  }, 120_000);
});

describe('scaleReport', () => {
  it('describes the continent in metres, and agrees with the terrain', () => {
    const r = scaleReport('forager-continent');
    expect(r.metresPerUnit).toBe(1);
    expect(r.secondsPerTick).toBe(1);
    expect(r.ticksPerDay).toBe(2400);
    expect(r.adultHeightM).toBe(1.7);
    expect(r.worldSpanM).toBe(CONTINENT_SPAN);
    expect(r.riverCount).toBe(RIVER_COUNT);
    expect(r.lakeCount).toBe(CONTINENT_LAKES.length);
    expect(r.valley).toEqual({
      x: FOUNDING_VALLEY.x,
      y: FOUNDING_VALLEY.y,
      widthM: FOUNDING_VALLEY.half * 2,
      floorM: 20.5,
    });
    expect(continentHeightAt(FOUNDING_VALLEY.x, FOUNDING_VALLEY.y)).toBeCloseTo(r.valley!.floorM, 1);
    // The land's own span, measured as the extent of ground a walker can stand on.
    let minX = CONTINENT_SPAN;
    let maxX = 0;
    grid(8, (x, y) => {
      if (continentIsDeepWater(x, y)) return;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
    });
    expect(maxX - minX).toBeCloseTo(r.landSpanM, -2);
  }, 300_000);

  it('describes the classic world without pretending it is to scale', () => {
    const r = scaleReport('forager-classic');
    expect(r.worldSpanM).toBe(2000);
    expect(r.valley).toBeNull();
    expect(r.maxPeakM).toBeLessThan(25); // its "mountains" are 20 m hills
    expect(r.walkSpeedMPerTick).toBe(0.5);
    expect(classicGeography.span).toBe(r.worldSpanM);
  });
});
