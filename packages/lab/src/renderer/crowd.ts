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
  /**
   * The being's drawn MARK — its ground ring or its pin — as a disc on screen.
   *
   * A figure is not the only thing drawn for a being, and out where the body is
   * a few pixels it is not the thing a reader sees at all. `mr` is 0 for a
   * being whose mark this frame is suppressed (inside a hut's chip), and
   * `hasBody` is false for one drawn too small to be a figure — which is
   * exactly when the mark is all there is to point at.
   */
  mx: number;
  my: number;
  mr: number;
  hasBody: boolean;
}

/**
 * How much of a being's own figure another one has to cover before the picture
 * stops being about it: a fraction of ITS box, not of the pair.
 *
 * Just under a half, and that is where it belongs. Past a half the nearer body
 * necessarily holds this one's own reported point and the first rule has
 * already fired; this is the sliver below that, where a figure is nearly gone
 * and the pixel a driver would aim at is a fraction of one away from the body
 * drawn over it. Two figures merely clipping each other's shoulders are a
 * crowd, and both of them are there to be pointed at.
 */
export const COVER_OVERLAP = 0.48;

/**
 * Who is drawn where each being is — the front-most one for every stack on
 * screen, and `null` for whoever that front-most one is.
 *
 * Bodies are opaque and painted in depth order, so out of any pile of figures
 * sharing a patch of screen exactly ONE is in the picture. Round two's probe
 * asked a narrower question — is the point this being is reported at inside
 * somebody else's box, and is that somebody at least half a metre nearer — and
 * a reviewer duly found four beings sharing one pixel, all four reporting
 * `coveredBy: null` and all four offered by `visibleIds()` while the picker
 * correctly returned one of them. The depth slack was the bug: in a real crowd
 * the people standing on each other's line of sight are a pace apart, not a
 * metre.
 *
 * So the order is the PICKER's order — nearest to the eye, `id` breaking an
 * exact tie, exactly what `orderCandidates` does inside one layer — and the
 * rule is greedy against what is already known to be drawn: a being is covered
 * by the first being in front of it that either holds the point the view
 * reports it at or covers `minOverlap` of its figure. Nothing is ever covered
 * by a being that is itself covered, so a stack of ten resolves to one visible
 * being and nine that name it.
 *
 * Round three of the rule adds the other half of what is DRAWN. A being whose
 * body is too small to be a figure is carried by its mark alone, and the picker
 * offers it on the mark layer — where a nearer being's mark over the same pixel
 * wins on depth. So a mark-only being standing under somebody else's ring is
 * covered by it, and a being with a figure of its own never is: its own body is
 * drawn at its own point, which is what the picker's body layer says.
 */
export function coveringBodies(boxes: readonly BodyBox[], minOverlap = COVER_OVERLAP): Map<number, number> {
  const out = new Map<number, number>();
  const order = boxes.slice().sort((a, b) => a.depth - b.depth || a.id - b.id);
  const front: BodyBox[] = [];
  for (const b of order) {
    let by: BodyBox | null = null;
    for (const f of front) {
      if (coversBox(f, b, minOverlap)) { by = f; break; }
    }
    if (by === null) front.push(b);
    else out.set(b.id, by.id);
  }
  return out;
}

/** Whether `front` is what is drawn where `back` is. */
function coversBox(front: BodyBox, back: BodyBox, minOverlap: number): boolean {
  // The point the view REPORTS this being at — where a driver aims — inside the
  // other one's figure. This fires for a small being behind a large one whose
  // boxes share little area, and it is the case round one of this rule caught.
  if (front.hasBody && back.x >= front.x0 && back.x <= front.x1 && back.y >= front.y0 && back.y <= front.y1) return true;
  // The same question about the other thing a being is drawn as. Only for a
  // being with no figure of its own: with one, its own body is what is drawn at
  // its own point, and the picker says so.
  if (!back.hasBody && front.mr > 0) {
    const dx = back.x - front.mx;
    const dy = back.y - front.my;
    if (dx * dx + dy * dy <= front.mr * front.mr) return true;
  }
  if (!front.hasBody || !back.hasBody) return false;
  const w = Math.min(front.x1, back.x1) - Math.max(front.x0, back.x0);
  if (w <= 0) return false;
  const h = Math.min(front.y1, back.y1) - Math.max(front.y0, back.y0);
  if (h <= 0) return false;
  const area = Math.max(1e-6, (back.x1 - back.x0) * (back.y1 - back.y0));
  return (w * h) / area >= minOverlap;
}

/**
 * Who is standing in front of this ONE being, or `null` when the picture at
 * that patch of screen is its own. The whole frame's answer, read off once —
 * `coveringBodies` is what a caller asking about every being should use.
 */
export function coveringBody(boxes: readonly BodyBox[], id: number, minOverlap = COVER_OVERLAP): number | null {
  return coveringBodies(boxes, minOverlap).get(id) ?? null;
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
