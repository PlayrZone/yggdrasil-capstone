import { clamp01, mix, smoothstep01, valueNoise } from './noise.js';
import { slopeOf } from './geography.js';
import type { WorldGeography } from './geography.js';
import type { Region } from './regions.js';

/**
 * THE TRUE-SCALE CONTINENT — one world unit is one metre, and the numbers say
 * so out loud: a square of sea 8.192 km across with a rounded continent of
 * roughly 6.9 km inside it, coastal flats at 2–40 m, rolling hills at 60–200 m,
 * and one range whose crest passes 900 m with saddles low enough to walk over.
 *
 * WHAT IS SEEDED AND WHAT IS NOT. The LAND is fixed — this is one particular
 * continent, the way `world/regions.ts` is one particular continent — so the
 * relief probes, the founding valley and `scaleReport()` mean something without
 * a seed in hand. The run seed decides what is SCATTERED on it (every node,
 * every animal, every founder), exactly as it does in the classic world.
 *
 * EVERY FIELD IS A PURE FUNCTION OF (x, y). That is not a style preference: it
 * is what lets a tile of this world be left unsimulated for a thousand ticks
 * and rebuilt exactly, with no stored state, when a being walks back into it.
 *
 * SLOPE BUDGET. Each layer's gradient is bounded by construction (see
 * `noise.ts`): shore 0.20, undulation 0.06, hills 0.54, the range's belt 0.75
 * and its crest field 0.38, river carving 0.44. They cannot all align, and the
 * measured maximum over a 4 m grid is pinned by `test/continent-relief.test.ts`
 * against `CONTINENT_MAX_SLOPE`.
 */

export const CONTINENT_SPAN = 8192;
/** Side of an activity tile, in metres. 32 × 32 tiles cover the world. */
export const CONTINENT_TILE = 256;

const C = CONTINENT_SPAN / 2;
const TAU = Math.PI * 2;

// Fixed noise seeds — the identity of this continent.
const S_COAST = 0x1f35c;
const S_UND1 = 0x2b7d1;
const S_UND2 = 0x51a93;
const S_HILLMASK = 0x7c4e1;
const S_HILLTOP = 0x9d2af;
const S_CREST = 0xb61d3;
const S_FOREST = 0xd0937;

// ── Coast ────────────────────────────────────────────────────────────────────

const SEA_FLOOR = -48; // metres, well below anything wadeable
const SHORE_TOP = 14; // land height at full continental mask, before relief
const COAST_IN = 0.74; // warped distance at which the mask is fully land
const COAST_OUT = 0.96; // …and fully sea

/**
 * The shore is 900 m wide on purpose. EVERY relief layer is multiplied by this
 * mask, so a narrow shore would drop a 900 m mountain into the sea over a few
 * hundred metres and blow the slope budget — the first draft did exactly that
 * (measured 2.33 rise over run on the north-east coast).
 */

/**
 * 0 at the centre, ~1 at the world's edge. Chebyshev distance keeps the
 * continent broadly square (so there is a long coast, not a small island); the
 * euclidean term rounds the corners off; the noise term stops the coastline
 * being a drawn rectangle.
 */
function coastDistance(x: number, y: number): number {
  const dx = Math.abs(x - C) / C;
  const dy = Math.abs(y - C) / C;
  return Math.max(dx, dy) * 0.72 + Math.hypot(dx, dy) * 0.28 + (valueNoise(x, y, 1500, S_COAST) - 0.5) * 0.09;
}

/**
 * How much RELIEF the interior is allowed — a second, far wider mask than the
 * coastline's. Hills and mountains are multiplied by it, so the range dies out
 * a kilometre before the northern and southern shores instead of plunging into
 * them: with the coast mask alone the range met the sea in 900 m and measured
 * 1.28 rise over run there. It also gives the world what it should have —
 * coastal flats all the way round, relief inland.
 */
const RELIEF_IN = 0.4;
const RELIEF_OUT = 0.88;

// ── The range ────────────────────────────────────────────────────────────────

const RANGE_HALF = 1900; // metres from the crest line to where the belt dies

/** The crest line, wandering north–south so the range is not a stripe. */
function crestX(y: number): number {
  const v = y / CONTINENT_SPAN;
  return CONTINENT_SPAN * 0.66 + 300 * Math.sin(TAU * v * 1.15 + 0.6) + 140 * Math.sin(TAU * v * 2.4 + 2.1);
}

/** 1 on the crest line, 0 at the foot, with zero slope at both. */
function beltAt(x: number, y: number): number {
  const t = Math.abs(x - crestX(y)) / RANGE_HALF;
  if (t >= 1) return 0;
  return Math.cos((t * Math.PI) / 2) ** 2;
}

/**
 * Height the range adds. The crest FIELD does the work of making passes: where
 * it dips toward 260 m the range is a saddle a being can walk over, and where
 * it reaches 1,060 m it cannot.
 */
function rangeAt(belt: number, x: number, y: number): number {
  return belt <= 0 ? 0 : belt * (260 + 800 * valueNoise(x, y, 2800, S_CREST));
}

// ── Rivers ───────────────────────────────────────────────────────────────────

interface River {
  readonly x0: number;
  readonly x1: number;
  /** Bed height where the river leaves the hills, in metres. */
  readonly bedTop: number;
  centreY(x: number): number;
}

/** Three rivers, all draining the range westward into the sea. */
const RIVERS: readonly River[] = [
  {
    x0: 520,
    x1: 5400,
    bedTop: 150,
    centreY: (x) =>
      4200 + 560 * Math.sin((TAU * x) / CONTINENT_SPAN * 1.9 + 0.35) + 170 * Math.sin((TAU * x) / CONTINENT_SPAN * 4.3),
  },
  { x0: 1200, x1: 5050, bedTop: 190, centreY: (x) => 2330 + 420 * Math.sin((TAU * x) / CONTINENT_SPAN * 2.6 + 1.9) },
  { x0: 900, x1: 4850, bedTop: 170, centreY: (x) => 5900 + 380 * Math.sin((TAU * x) / CONTINENT_SPAN * 2.2 + 3.3) },
];

export const RIVER_COUNT = RIVERS.length;
/** Half-width of the wet channel. A river is 52 m across and fordable. */
const RIVER_HALF = 26;
/** Half-width of the flat floor the river has cut. */
const VALLEY_HALF = 420;

function riverBed(river: River, x: number): number {
  const u = clamp01((x - river.x0) / (river.x1 - river.x0));
  return 3 + u ** 1.5 * (river.bedTop - 3);
}

/** How strongly the valley floor claims this point: 1 on the line, 0 at the rim. */
function valleyWeight(river: River, x: number, y: number): number {
  if (x < river.x0 || x > river.x1) return 0;
  const across = smoothstep01((VALLEY_HALF - Math.abs(y - river.centreY(x))) / VALLEY_HALF);
  if (across <= 0) return 0;
  // Faded at both ends — an abruptly-ending trench would be a cliff, and the
  // upstream end has 400 m of mountain to give back, so it fades over 1.6 km.
  return across * smoothstep01((x - river.x0) / 280) * smoothstep01((river.x1 - x) / 1600);
}

/**
 * A river cuts at most this deep below the ground it crosses. Without the
 * bound, the upper reaches became a 250 m gorge whose walls measured 1.64 rise
 * over run; a valley 840 m wide can only hold so much relief.
 */
const MAX_CARVE = 85;

function carveRivers(x: number, y: number, height: number): number {
  let h = height;
  for (const river of RIVERS) {
    const w = valleyWeight(river, x, y);
    if (w <= 0) continue;
    const bed = Math.max(riverBed(river, x), h - MAX_CARVE);
    if (bed < h) h = mix(h, bed, w);
  }
  return h;
}

function inRiverChannel(x: number, y: number): boolean {
  for (const river of RIVERS) {
    if (x < river.x0 || x > river.x1) continue;
    if (Math.abs(y - river.centreY(x)) < RIVER_HALF) return true;
  }
  return false;
}

/** Points along a river's centre line, for placing drinkable water. */
export function riverCourse(index: number, stepM: number): { x: number; y: number }[] {
  const river = RIVERS[index]!;
  const out: { x: number; y: number }[] = [];
  for (let x = river.x0; x <= river.x1; x += stepM) out.push({ x, y: river.centreY(x) });
  return out;
}

// ── Lakes ────────────────────────────────────────────────────────────────────

/** [centre x, centre y, radius] — all in the western lowlands. */
export const CONTINENT_LAKES: readonly (readonly [number, number, number])[] = [
  [1520, 5380, 300],
  [3240, 2700, 230],
  [2600, 6460, 175],
];
const LAKE_RIM = 140;

function lakeBasin(x: number, y: number): number {
  let drop = 0;
  for (const [cx, cy, r] of CONTINENT_LAKES) {
    const d = Math.hypot(x - cx, y - cy);
    if (d >= r + LAKE_RIM) continue;
    drop += 16 * smoothstep01((r + LAKE_RIM - d) / LAKE_RIM);
  }
  return drop;
}

function lakeAt(x: number, y: number): 'in' | 'edge' | null {
  for (const [cx, cy, r] of CONTINENT_LAKES) {
    const d = Math.hypot(x - cx, y - cy);
    if (d < r) return 'in';
    if (d < r + LAKE_RIM) return 'edge';
  }
  return null;
}

// ── The field itself ─────────────────────────────────────────────────────────

export function continentHeightAt(x: number, y: number): number {
  const d = coastDistance(x, y);
  const land = smoothstep01((COAST_OUT - d) / (COAST_OUT - COAST_IN));
  let h = mix(SEA_FLOOR, SHORE_TOP, land);
  if (land > 0) {
    h += land * (14 * valueNoise(x, y, 1100, S_UND1) + 6 * valueNoise(x, y, 420, S_UND2));
    const relief = smoothstep01((RELIEF_OUT - d) / (RELIEF_OUT - RELIEF_IN));
    if (relief > 0) {
      const belt = beltAt(x, y);
      // Hills yield to the range they lead up to: foothills, then mountains,
      // never both at once — which keeps the two slope budgets from adding.
      const hills = smoothstep01((valueNoise(x, y, 2400, S_HILLMASK) - 0.48) / 0.38) * (1 - belt);
      h += relief * (hills * (46 + 120 * valueNoise(x, y, 1200, S_HILLTOP)) + rangeAt(belt, x, y));
    }
  }
  return carveRivers(x, y, h) - lakeBasin(x, y);
}

/** Metres. Above this the ground is the range; ore and gems live only here. */
export const HIGHLAND_M = 400;
/** Metres. Above this the ground is hills. */
export const UPLAND_M = 120;
/** Metres. Below this the ground is beach, shallows or open sea. */
const SHORE_M = 5;
/** Metres. Below this a walker cannot go: the sea proper. */
const DEEP_M = -1;

export function continentElevationBand(x: number, y: number): number {
  const h = continentHeightAt(x, y);
  return h >= HIGHLAND_M ? 2 : h >= UPLAND_M ? 1 : 0;
}

function inForest(x: number, y: number): boolean {
  return valueNoise(x, y, 1400, S_FOREST) > 0.6;
}

/** The region at a point whose height is already known — the hot path. */
function regionFrom(x: number, y: number, h: number, lake: 'in' | 'edge' | null): Region {
  if (lake === 'in') return 'lake';
  if (h < SHORE_M) return 'coast';
  if (lake === 'edge') return 'wetland';
  if (inRiverChannel(x, y)) return 'river';
  if (h >= HIGHLAND_M) return 'mountain';
  if (h >= UPLAND_M) return 'hills';
  // The lower reaches of a valley floor are marsh: flat, wet, reeds and clay.
  if (h < 16 && valleyWeight(RIVERS[0]!, x, y) > 0.3) return 'wetland';
  return inForest(x, y) ? 'forest' : 'plains';
}

export function continentRegionAt(x: number, y: number): Region {
  const lake = lakeAt(x, y);
  return regionFrom(x, y, lake === 'in' ? 0 : continentHeightAt(x, y), lake);
}

export function continentIsWater(x: number, y: number): boolean {
  const lake = lakeAt(x, y);
  if (lake === 'in') return true;
  if (inRiverChannel(x, y)) return true;
  return continentHeightAt(x, y) < 0;
}

export function continentIsDeepWater(x: number, y: number): boolean {
  if (lakeAt(x, y) === 'in') return true;
  if (inRiverChannel(x, y)) return false; // a river is always fordable
  return continentHeightAt(x, y) < DEEP_M;
}

// ── The founding valley ──────────────────────────────────────────────────────

/** Where the founders are put: a fertile stretch of the great river's floor. */
export const FOUNDING_VALLEY = Object.freeze({
  x: 1700,
  y: RIVERS[0]!.centreY(1700),
  /** Half the width AND half the length of the founding patch, in metres. */
  half: 420,
});

export function inFoundingValley(x: number, y: number): boolean {
  if (Math.abs(x - FOUNDING_VALLEY.x) > FOUNDING_VALLEY.half) return false;
  return Math.abs(y - RIVERS[0]!.centreY(x)) <= FOUNDING_VALLEY.half;
}

/** Metres over which nearness to fresh water stops making the ground fertile. */
const FERTILE_RANGE = 460;

/**
 * 1 on a bank, 0 more than `FERTILE_RANGE` from fresh water. THE habitat rule:
 * what grows on open ground is decided by how far the water is, which is why
 * the river valleys are worth living in and the far plains are not.
 */
export function freshWaterNearness(x: number, y: number): number {
  let best = Infinity;
  for (const river of RIVERS) {
    const cx = x < river.x0 ? river.x0 : x > river.x1 ? river.x1 : x;
    const d = Math.hypot(x - cx, y - river.centreY(cx));
    if (d < best) best = d;
  }
  for (const [cx, cy, r] of CONTINENT_LAKES) {
    const d = Math.abs(Math.hypot(x - cx, y - cy) - r);
    if (d < best) best = d;
  }
  return smoothstep01((FERTILE_RANGE - best) / FERTILE_RANGE);
}

// ── The geography object ─────────────────────────────────────────────────────

const EDGE = 18;

export const continentGeography: WorldGeography = Object.freeze({
  id: 'forager-continent',
  span: CONTINENT_SPAN,
  edge: EDGE,
  origin: Object.freeze({ x: FOUNDING_VALLEY.x, y: FOUNDING_VALLEY.y }),
  heightAt: continentHeightAt,
  slopeAt: (x: number, y: number) => slopeOf(continentHeightAt, x, y),
  elevationBand: continentElevationBand,
  regionAt: continentRegionAt,
  isWater: continentIsWater,
  isDeepWater: continentIsDeepWater,
  clamp: (p: { x: number; y: number }): void => {
    p.x = Math.min(CONTINENT_SPAN - EDGE, Math.max(EDGE, p.x));
    p.y = Math.min(CONTINENT_SPAN - EDGE, Math.max(EDGE, p.y));
  },
});
