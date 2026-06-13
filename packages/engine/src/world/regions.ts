/**
 * The first world's geography — a medium-large, deliberately UNEQUAL continent
 * (yggdrasil_world_design.md). Not a game map: a young Earth with the physical
 * ingredients of civilization and none of civilization itself. Layout is
 * expressed as fractions of WORLD, so the continent scales with the map size.
 *
 * West→east: coast/sea → coastal wetlands → great river valley + lakes →
 * central plains & forests → foothills → eastern mountains. A hard boundary
 * (the world wall) rings the map at the edges; nobody leaves.
 */
export const WORLD = 2000;
/** Hard boundary inset — agents are kept inside [EDGE, WORLD-EDGE] (the wall). */
export const EDGE = 18;

export type Region = 'coast' | 'river' | 'lake' | 'wetland' | 'forest' | 'mountain' | 'hills' | 'plains';

const COAST_X = WORLD * 0.055; // west of this: shore / sea
const HILLS_X = WORLD * 0.7; // foothills band
const MTN_X = WORLD * 0.82; // east of this: mountains
const K = (2 * Math.PI) / WORLD;

/** Great river centre-line — a sinuous valley draining the mountains to the sea. */
export function riverY(x: number): number {
  return WORLD * 0.46 + Math.sin(x * K * 4) * WORLD * 0.1 + Math.sin(x * K * 11) * WORLD * 0.025;
}
/** A northern tributary joining from the highlands. */
export function tributaryY(x: number): number {
  return WORLD * 0.22 + Math.sin(x * K * 8) * WORLD * 0.05;
}

/** Lakes: [centreX, centreY, radius]. Fed by the river system; fertile shores. */
export const LAKE_CENTERS: readonly [number, number, number][] = [
  [WORLD * 0.32, WORLD * 0.68, WORLD * 0.085],
  [WORLD * 0.6, WORLD * 0.27, WORLD * 0.06],
  [WORLD * 0.5, WORLD * 0.52, WORLD * 0.05],
];

const FOREST_CENTERS: readonly [number, number, number][] = [
  [WORLD * 0.22, WORLD * 0.17, WORLD * 0.11],
  [WORLD * 0.18, WORLD * 0.8, WORLD * 0.1],
  [WORLD * 0.5, WORLD * 0.63, WORLD * 0.095],
  [WORLD * 0.66, WORLD * 0.74, WORLD * 0.088],
  [WORLD * 0.37, WORLD * 0.33, WORLD * 0.078],
];

const RIVER_HALF = WORLD * 0.016;

export function inRiver(x: number, y: number): boolean {
  return (
    (x >= COAST_X && x <= MTN_X + WORLD * 0.04 && Math.abs(y - riverY(x)) < RIVER_HALF) ||
    (x >= WORLD * 0.36 && x <= MTN_X && Math.abs(y - tributaryY(x)) < RIVER_HALF * 0.7)
  );
}

function lakeAt(x: number, y: number): 'in' | 'edge' | null {
  for (const [cx, cy, r] of LAKE_CENTERS) {
    const d = Math.hypot(x - cx, y - cy);
    if (d < r) return 'in';
    if (d < r + WORLD * 0.022) return 'edge';
  }
  return null;
}

function inForest(x: number, y: number): boolean {
  for (const [cx, cy, r] of FOREST_CENTERS) {
    const dx = x - cx;
    const dy = y - cy;
    if (dx * dx + dy * dy < r * r) return true;
  }
  return false;
}

// Marshy strip behind the coast (broken up so it isn't a solid wall).
function coastalWetland(x: number, y: number): boolean {
  return x >= COAST_X && x < COAST_X + WORLD * 0.06 && Math.sin(y * K * 9) > 0.35;
}

export function regionAt(x: number, y: number): Region {
  if (x < COAST_X) return 'coast';
  const lk = lakeAt(x, y);
  if (lk === 'in') return 'lake';
  if (lk === 'edge') return 'wetland';
  if (inRiver(x, y)) return 'river';
  if (coastalWetland(x, y)) return 'wetland';
  if (x > MTN_X) return 'mountain';
  if (x > HILLS_X) return 'hills';
  if (inForest(x, y)) return 'forest';
  return 'plains';
}

/** Surface height in world-z (drives the 3D terrain and where feet sit). */
export function heightAt(x: number, y: number): number {
  const ripple = Math.sin(x * 0.02) * 0.5 + Math.cos(y * 0.024) * 0.4;
  if (x < COAST_X) return 0.25 + Math.max(0, (x - COAST_X * 0.25) / (COAST_X * 0.75)) * 1.7 + ripple * 0.2; // sea -> shore
  const lk = lakeAt(x, y);
  if (lk === 'in') return 0.5; // below sea level -> fills with water
  if (lk === 'edge') return 1.0 + ripple * 0.2;
  if (inRiver(x, y)) return 1.1 + ripple * 0.3; // fertile valley floor
  if (coastalWetland(x, y)) return 1.0 + ripple * 0.2;
  if (x > MTN_X) {
    // A ridged range with peaks and passes, not a wall ramping to the edge.
    const m = (x - MTN_X) / (WORLD - MTN_X); // 0..1 inland
    const ridge = Math.abs(Math.sin(x * 0.022) * Math.cos(y * 0.02));
    const ridge2 = Math.abs(Math.sin(x * 0.05 + y * 0.04));
    return 5 + m * 6 + ridge * 7 + ridge2 * 3 + ripple * 0.5;
  }
  if (x > HILLS_X) return 2.5 + ((x - HILLS_X) / (MTN_X - HILLS_X)) * 3.5 + ripple; // foothills
  return 2.4 + ripple; // plains / forest
}

export function elevationBand(x: number, y: number): number {
  const h = heightAt(x, y);
  if (h >= 8) return 2; // highland (mountains)
  if (h >= 4) return 1; // midland (hills / upper slopes)
  return 0; // lowland
}

/** Keep a point inside the world wall. */
export function clampToWorld(p: { x: number; y: number }): void {
  p.x = Math.min(WORLD - EDGE, Math.max(EDGE, p.x));
  p.y = Math.min(WORLD - EDGE, Math.max(EDGE, p.y));
}

/** Sea level in world-height units — terrain below this is underwater. */
export const SEA_HEIGHT = 0.85;

/** Any water: the sea, lakes, and the river (fish/crocodile habitat). */
export function isWater(x: number, y: number): boolean {
  const r = regionAt(x, y);
  return r === 'lake' || r === 'river' || (r === 'coast' && heightAt(x, y) < SEA_HEIGHT);
}

/** DEEP water a walker can't enter (sea + lakes). Rivers stay fordable. */
export function isDeepWater(x: number, y: number): boolean {
  const r = regionAt(x, y);
  return r === 'lake' || (r === 'coast' && heightAt(x, y) < SEA_HEIGHT);
}
