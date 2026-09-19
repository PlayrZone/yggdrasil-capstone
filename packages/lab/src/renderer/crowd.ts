/**
 * What a crowd is allowed to claim, and who the pointer is actually on.
 *
 * Three rules, all of them pure, all of them the direct answer to a measured
 * failure of the five earlier rounds:
 *
 *  1. `suppressOverlaps` — if two beings' marks touch on screen, NEITHER draws
 *     a pictogram or a heading arrow. Round five's stranger test read activity
 *     at 38% and nearly every miss was a mark attributed to the wrong body. A
 *     mark that might belong to the neighbour is worse than no mark: it is a
 *     confident wrong answer, and the reader has no way to tell.
 *  2. `orderCandidates` — when several beings lie under the cursor, they are
 *     offered in a fixed, explicable order rather than "whichever the raycast
 *     happened to hit". Picking is by instance id; ordering is what makes the
 *     disambiguation list stable enough to arrow through.
 *  3. `conditionMix` / `groupByActivity` — a count chip says *how many*; these
 *     say *of what*, so a crowd stops being an opaque number.
 */

import { CONDITION_WORDS } from './filters.js';
import { conditionWord, HUE_DANGER, HUE_SICK, HUE_STARVING, HUE_WELL, hex } from './beings.js';

// ── 1. Marks that would be attributed to the wrong body ──────────────────────

export interface MarkPoint {
  /** Canvas x, in CSS pixels. */
  x: number;
  y: number;
  /** Radius of the whole mark this being draws, in CSS pixels. */
  r: number;
}

/**
 * Which beings may draw a per-being mark.
 *
 * Two marks "collide" when the distance between their centres is less than the
 * sum of their radii — i.e. when they touch at all. Both sides of a collision
 * are suppressed, deliberately: suppressing only the smaller one leaves a
 * pictogram sitting on a boundary a reader has no way to resolve, which is the
 * exact failure being fixed.
 *
 * O(n) in practice: a uniform grid sized to the largest mark, so a settlement
 * of forty inside a hundred pixels costs forty lookups rather than sixteen
 * hundred comparisons.
 */
export function suppressOverlaps(points: readonly MarkPoint[]): boolean[] {
  const n = points.length;
  const out = new Array<boolean>(n).fill(true);
  if (n < 2) return out;
  let maxR = 0;
  for (const p of points) if (p.r > maxR) maxR = p.r;
  const cell = Math.max(1, maxR * 2);
  const grid = new Map<number, number[]>();
  const key = (cx: number, cy: number): number => cx * 73856093 ^ cy * 19349663;
  for (let i = 0; i < n; i++) {
    const p = points[i]!;
    const cx = Math.floor(p.x / cell);
    const cy = Math.floor(p.y / cell);
    const k = key(cx, cy);
    const bucket = grid.get(k);
    if (bucket) bucket.push(i);
    else grid.set(k, [i]);
  }
  for (let i = 0; i < n; i++) {
    const p = points[i]!;
    const cx = Math.floor(p.x / cell);
    const cy = Math.floor(p.y / cell);
    for (let dx = -1; dx <= 1 && out[i]; dx++) {
      for (let dy = -1; dy <= 1 && out[i]; dy++) {
        const bucket = grid.get(key(cx + dx, cy + dy));
        if (!bucket) continue;
        for (const j of bucket) {
          if (j === i) continue;
          const q = points[j]!;
          const ddx = p.x - q.x;
          const ddy = p.y - q.y;
          const reach = p.r + q.r;
          if (ddx * ddx + ddy * ddy < reach * reach) {
            out[i] = false;
            out[j] = false;
            break;
          }
        }
      }
    }
  }
  return out;
}

// ── 2. Who is under the cursor ───────────────────────────────────────────────

export interface PickCandidate {
  id: number;
  /** True when the ray struck this being's BODY — an exact hit, not a near miss. */
  onBody: boolean;
  /** Distance from the cursor to the being's screen point, in CSS pixels. */
  distPx: number;
  /** Distance from the eye, in metres. */
  depth: number;
}

/**
 * The order a disambiguation list offers beings in.
 *
 * Bodies the ray actually struck come first, nearest to the eye first — you
 * pointed at a person, and the one in front is the one you meant. Everything
 * else follows by how far the cursor is from its mark. `id` breaks the last
 * tie, so the list does not reshuffle between two frames of a paused world and
 * the arrow keys walk a stable sequence.
 */
export function orderCandidates(cands: readonly PickCandidate[]): PickCandidate[] {
  return cands.slice().sort((a, b) => {
    if (a.onBody !== b.onBody) return a.onBody ? -1 : 1;
    if (a.onBody && b.onBody) {
      if (a.depth !== b.depth) return a.depth - b.depth;
      return a.id - b.id;
    }
    if (a.distPx !== b.distPx) return a.distPx - b.distPx;
    if (a.depth !== b.depth) return a.depth - b.depth;
    return a.id - b.id;
  });
}

/** Step through a disambiguation list, wrapping — the arrow keys' whole behaviour. */
export function cycleCandidate(count: number, at: number, delta: number): number {
  if (count <= 0) return 0;
  return ((at + delta) % count + count) % count;
}

// ── 3. What a crowd is made of ───────────────────────────────────────────────

export interface MixSegment {
  word: string;
  count: number;
  color: string;
}

const CONDITION_HEX: Record<string, string> = {
  well: hex(HUE_WELL),
  starving: hex(HUE_STARVING),
  sick: hex(HUE_SICK),
  'in danger': hex(HUE_DANGER),
};

/**
 * The stacked bar under a count chip: how the crowd's condition breaks down.
 *
 * Segments are always in the legend's own order — well, starving, sick, in
 * danger — and empty ones are dropped, so two chips side by side can be
 * compared by eye without reading either of them. The colours are the condition
 * palette already chosen on LIGHTNESS for colour-blind safety, so the bar is
 * readable as light-to-dark even where the hues are not separable.
 */
export function conditionMix(members: readonly { cond: number; act: number }[]): MixSegment[] {
  const counts = new Map<string, number>();
  for (const m of members) {
    const word = conditionWord(m.cond, m.act);
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  const out: MixSegment[] = [];
  for (const word of CONDITION_WORDS) {
    const count = counts.get(word) ?? 0;
    if (count > 0) out.push({ word, count, color: CONDITION_HEX[word] ?? hex(HUE_WELL) });
  }
  return out;
}

/**
 * What a crowd is DOING, biggest group first — the list a chip's hover shows.
 *
 * Ties are broken alphabetically so the order is a property of the data rather
 * than of the iteration, which matters when a driver diffs two chips.
 */
export function groupByActivity(members: readonly { actWord: string }[]): { word: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const m of members) counts.set(m.actWord, (counts.get(m.actWord) ?? 0) + 1);
  return [...counts.entries()]
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word));
}
