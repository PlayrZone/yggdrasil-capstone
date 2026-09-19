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

/**
 * WHAT was drawn at that pixel, best first — the only question a pick is
 * allowed to answer.
 *
 * Round six's picking asked a different question and got a different answer:
 * any body the ray struck outranked every mark, whatever the cursor was
 * actually on, and a body the ray MISSED — through the gap between a figure's
 * arm and its trunk, or because the being was lying down — fell all the way
 * back to "whose pin is nearest", which in a crowd is the neighbour's. Pointing
 * the real mouse at a being's own reported position gave a card for somebody
 * else seven times in ten.
 *
 * So the layers are the drawing order. An exact hit on a body beats the same
 * body's silhouette, which beats a ground mark, and anything only visible
 * THROUGH the land — an x-ray outline over a hill — comes after everything
 * drawn in the open.
 */
export const PICK_BODY = 0;
/** Inside the drawn figure's own footprint, where the ray slipped through it. */
export const PICK_FIGURE = 1;
/** Inside the ground mark: the pin, the ring, or the dot out at FAR. */
export const PICK_MARK = 2;
/** How far a being the land is hiding is pushed down the list. */
export const PICK_HIDDEN = 3;

export interface PickCandidate {
  id: number;
  /** True when the ray struck this being's BODY — an exact hit, not a near miss. */
  onBody: boolean;
  /**
   * Which layer of the drawing the cursor found it in. Absent means the caller
   * only knows body-or-not, and it is read as `PICK_BODY` / `PICK_MARK`.
   */
  layer?: number;
  /** Distance from the cursor to the being's screen point, in CSS pixels. */
  distPx: number;
  /** Distance from the eye, in metres. */
  depth: number;
}

export function pickLayerOf(c: PickCandidate): number {
  return c.layer ?? (c.onBody ? PICK_BODY : PICK_MARK);
}

/**
 * The order a disambiguation list offers beings in.
 *
 * By what is drawn on top: the layer first, then nearest to the eye — the being
 * in front is the one drawn over the one behind it, and is the one you meant —
 * then nearest to the cursor. `id` breaks the last tie, so the list does not
 * reshuffle between two frames of a paused world and the arrow keys walk a
 * stable sequence.
 */
export function orderCandidates(cands: readonly PickCandidate[]): PickCandidate[] {
  return cands.slice().sort((a, b) => {
    const la = pickLayerOf(a);
    const lb = pickLayerOf(b);
    if (la !== lb) return la - lb;
    if (a.depth !== b.depth) return a.depth - b.depth;
    if (a.distPx !== b.distPx) return a.distPx - b.distPx;
    return a.id - b.id;
  });
}

/**
 * One being's patch of screen: the box its drawn figure covers, the point the
 * view reports it at, and how far away it is.
 */
export interface BodyBox {
  id: number;
  /** The point `screenPositionOf` reports — where a driver aims. */
  x: number;
  y: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Metres from the eye. */
  depth: number;
}

/**
 * Who is standing in front of this being, at the exact point the view reports
 * it at — or `null` when that pixel is its own.
 *
 * Bodies are drawn opaque and in depth order, so a being behind another being
 * is not in the picture at that point, however large and well drawn it is. Six
 * rounds of probes never said so: `visibleIds()` offered beings whose reported
 * position belonged to somebody standing in front of them, a reviewer pointed a
 * real mouse at each one, and the card that opened was — correctly — about the
 * being that WAS drawn there. The identification score went to 3/10 and the
 * picking was not the thing that was wrong.
 *
 * `slack` keeps two beings at the same depth from covering each other: a metre
 * apart on the same line of sight is a crowd, not an occlusion.
 */
export function coveringBody(boxes: readonly BodyBox[], id: number, slack = 0.5): number | null {
  let self: BodyBox | undefined;
  for (const b of boxes) if (b.id === id) { self = b; break; }
  if (!self) return null;
  let front: BodyBox | null = null;
  for (const b of boxes) {
    if (b.id === id || b.depth > self.depth - slack) continue;
    if (self.x < b.x0 || self.x > b.x1 || self.y < b.y0 || self.y > b.y1) continue;
    if (front === null || b.depth < front.depth) front = b;
  }
  return front === null ? null : front.id;
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
