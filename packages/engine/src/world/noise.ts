/**
 * DETERMINISTIC TERRAIN NOISE — the only source of randomness a continuous
 * world field is allowed. Pure functions of (x, y, seed): no state, no
 * `Math.random`, no wall clock, so `heightAt` can be asked about any point in
 * any order and always answers the same thing. That is what lets a tile be
 * skipped for a thousand ticks and rebuilt exactly when a being walks into it.
 *
 * Value noise, not gradient noise, and interpolated with the cubic smoothstep
 * on purpose: |d/dt (3t² − 2t³)| ≤ 1.5, so a term `A · valueNoise(cell)` has a
 * per-axis gradient of at most `1.5 · A / cell`. Every layer of the continent's
 * relief is budgeted with that inequality, which is how the terrain can promise
 * a bounded slope instead of hoping for one.
 */

/** FNV-1a over a coordinate pair and a seed → a well-mixed unit float. */
export function hashCell(ix: number, iy: number, seed: number): number {
  let h = 0x811c9dc5 ^ (seed | 0);
  h = Math.imul(h ^ (ix | 0), 0x01000193);
  h = Math.imul(h ^ (iy | 0), 0x01000193);
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

export function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** The cubic smoothstep on a normalised, clamped input. */
export function smoothstep01(t: number): number {
  const u = clamp01(t);
  return u * u * (3 - 2 * u);
}

/** Linear blend, for readability at the call sites below. */
export function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Smooth value noise in [0, 1] on a lattice of `cell` metres.
 *
 * `Math.floor` (not `| 0`) so negative coordinates fall in the cell below the
 * origin rather than reflecting around it — a world whose sea starts at x < 0
 * would otherwise be a mirror of the one at x > 0.
 */
export function valueNoise(x: number, y: number, cell: number, seed: number): number {
  const fx = x / cell;
  const fy = y / cell;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const tx = smoothstep01(fx - ix);
  const ty = smoothstep01(fy - iy);
  const n00 = hashCell(ix, iy, seed);
  const n10 = hashCell(ix + 1, iy, seed);
  const n01 = hashCell(ix, iy + 1, seed);
  const n11 = hashCell(ix + 1, iy + 1, seed);
  return mix(mix(n00, n10, tx), mix(n01, n11, tx), ty);
}
