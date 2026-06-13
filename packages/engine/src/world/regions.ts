/**
 * The first world's geography — a small, deliberately UNEQUAL continent
 * (yggdrasil_world_design.md, Slice 1). One source of truth for both the
 * 3D terrain (height) and the sim (resource placement + elevation the
 * PerceptionSystem reads), so visuals and physics agree.
 *
 * Layout on a 0..WORLD square:
 *   - west edge      → coast (salt, fiber, sea water), near sea level
 *   - sinuous middle → river valley (food-rich: berries, tubers, clay banks)
 *   - east edge      → mountains (ore/coal/stone/gems, food-poor, highland)
 *   - before mtns    → hills (stone, clay, midland)
 *   - scattered      → forest patches (wood-rich, some food, nightshade danger)
 *   - the rest       → plains (sparse forage + fiber)
 */
export const WORLD = 400;

export type Region = 'coast' | 'river' | 'forest' | 'mountain' | 'hills' | 'plains';

const FOREST_CENTERS: [number, number][] = [
  [120, 110],
  [150, 300],
  [240, 90],
];
const FOREST_R2 = 58 * 58;

/** River centre-line y for a given x — a gentle sinuous valley. */
export function riverY(x: number): number {
  return 200 + Math.sin(x * 0.018) * 34 + Math.sin(x * 0.05) * 10;
}

export function inRiver(x: number, y: number): boolean {
  return x >= 30 && x <= 360 && Math.abs(y - riverY(x)) < 17;
}

export function regionAt(x: number, y: number): Region {
  if (x < 36) return 'coast';
  if (inRiver(x, y)) return 'river';
  if (x > 304) return 'mountain';
  for (const [cx, cy] of FOREST_CENTERS) {
    const dx = x - cx;
    const dy = y - cy;
    if (dx * dx + dy * dy < FOREST_R2) return 'forest';
  }
  if (x > 250) return 'hills';
  return 'plains';
}

/** Surface height in world-z (drives both the voxel terrain and where feet sit). */
export function heightAt(x: number, y: number): number {
  if (x < 36) return 0.4 + Math.max(0, (x - 10) / 26) * 1.4; // coastal rise from the sea
  const ripple = Math.sin(x * 0.05) * 0.5 + Math.cos(y * 0.06) * 0.4;
  if (x > 304) {
    // Mountains: steep ramp east + jagged ridge.
    const m = (x - 304) / 96; // 0..1
    return 3 + m * 11 + Math.sin(x * 0.13) * Math.cos(y * 0.11) * 2.5 + ripple;
  }
  if (x > 250) return 2 + ((x - 250) / 54) * 3 + ripple; // hills
  if (inRiver(x, y)) return 1.1 + ripple * 0.3; // valley floor
  return 2 + ripple; // plains / forest
}

export function elevationBand(x: number, y: number): number {
  const h = heightAt(x, y);
  if (h >= 8) return 2; // highland (mountains)
  if (h >= 4) return 1; // midland (hills / upper slopes)
  return 0; // lowland
}
