/**
 * The first world's geography — a medium, deliberately UNEQUAL continent
 * (yggdrasil_world_design.md). Not a game map: a young Earth with the physical
 * ingredients of civilization and none of civilization itself. One source of
 * truth for both the 3D terrain (height) and the sim (resource placement +
 * the elevation the PerceptionSystem reads), so visuals and physics agree.
 *
 * West→east on a 0..WORLD square:
 *   coast/sea → coastal wetlands → great river valley + lakes → central
 *   plains & forests → foothills → eastern mountains. Big enough that distant
 *   groups form independently and knowledge spreads slowly.
 */
export const WORLD = 900;

export type Region = 'coast' | 'river' | 'lake' | 'wetland' | 'forest' | 'mountain' | 'hills' | 'plains';

const COAST_X = 70; // west of this: shore / sea
const HILLS_X = 620; // 620..MTN: foothills
const MTN_X = 740; // east of this: mountains

/** Great river centre-line — a sinuous valley draining the mountains to the sea. */
export function riverY(x: number): number {
  return 400 + Math.sin(x * 0.011) * 86 + Math.sin(x * 0.031) * 22;
}
/** A northern tributary joining from the highlands. */
export function tributaryY(x: number): number {
  return 190 + Math.sin(x * 0.02) * 44;
}

/** Lakes: [centreX, centreY, radius]. Fed by the river system; fertile shores. */
export const LAKE_CENTERS: readonly [number, number, number][] = [
  [300, 610, 80],
  [560, 250, 58],
  [470, 470, 46],
];

const FOREST_CENTERS: readonly [number, number, number][] = [
  [205, 150, 96],
  [170, 720, 90],
  [450, 560, 85],
  [600, 660, 78],
  [330, 300, 70],
];

const RIVER_HALF = 16;

export function inRiver(x: number, y: number): boolean {
  return (
    (x >= COAST_X && x <= MTN_X + 40 && Math.abs(y - riverY(x)) < RIVER_HALF) ||
    (x >= 330 && x <= MTN_X && Math.abs(y - tributaryY(x)) < 12)
  );
}

function lakeAt(x: number, y: number): 'in' | 'edge' | null {
  for (const [cx, cy, r] of LAKE_CENTERS) {
    const d = Math.hypot(x - cx, y - cy);
    if (d < r) return 'in';
    if (d < r + 22) return 'edge';
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
  return x >= COAST_X && x < COAST_X + 64 && Math.sin(y * 0.021) > 0.35;
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
  const ripple = Math.sin(x * 0.05) * 0.5 + Math.cos(y * 0.06) * 0.4;
  if (x < COAST_X) return 0.25 + Math.max(0, (x - 18) / (COAST_X - 18)) * 1.7 + ripple * 0.2; // sea -> shore
  const lk = lakeAt(x, y);
  if (lk === 'in') return 0.5; // below sea level -> fills with water
  if (lk === 'edge') return 1.0 + ripple * 0.2;
  if (inRiver(x, y)) return 1.1 + ripple * 0.3; // fertile valley floor
  if (coastalWetland(x, y)) return 1.0 + ripple * 0.2;
  if (x > MTN_X) {
    const m = (x - MTN_X) / (WORLD - MTN_X); // 0..1
    return 3 + m * 15 + Math.sin(x * 0.09) * Math.cos(y * 0.08) * 3 + ripple;
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
