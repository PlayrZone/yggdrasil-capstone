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

// ── 2b. What the view OFFERS ─────────────────────────────────────────────────

/**
 * What one being's own point answers when the real picker is asked at it.
 *
 * `first` is whoever the picker puts at the head of its list there — the being
 * a click would choose — or `null` when the picker finds nothing at all.
 */
export interface OfferAnswer {
  id: number;
  first: number | null;
}

export interface OfferAudit {
  /** The beings a reader can point at: the picker returns them at their own point. */
  offered: number[];
  /** For everyone else, who the picker returns there instead — `null` for nobody. */
  coveredBy: Map<number, number | null>;
}

/**
 * Who this frame OFFERS, DEFINED by the picker.
 *
 * This is deliberately not a rule. Three rounds ran a second geometry beside
 * the picker — boxes, depth order, an overlap fraction — and asked it "is
 * anybody standing in front of this being". It was wrong about four beings
 * sharing one pixel in round six, two in a hundred in round seven, and four in
 * a hundred and forty-eight in round eight; every time it was tightened it
 * agreed more often and still disagreed, because two implementations of one
 * question is a bug with a maintenance schedule.
 *
 * So "offered" now MEANS: ask the picker at the point the view would send the
 * mouse to, and see whether it hands back this being. A mispick is not unlikely
 * any more, it is not expressible: the test a reviewer runs is the definition
 * the view is using.
 */
export function offerAudit(answers: readonly OfferAnswer[]): OfferAudit {
  const offered: number[] = [];
  const coveredBy = new Map<number, number | null>();
  for (const a of answers) {
    if (a.first === a.id) offered.push(a.id);
    else coveredBy.set(a.id, a.first);
  }
  return { offered, coveredBy };
}

/**
 * How far either side of a being's own point the picker must still name it
 * before the view will OFFER that being, in CSS pixels.
 *
 * A press is not a point, it is a small neighbourhood: a hand moves a pixel or
 * two between reading a card and pressing the button, and in a shelter packed
 * with bodies the depth order at one pixel is decided by fractions of a metre.
 * An offer that only holds at one exact pixel is not an offer a reader can take.
 */
export const OFFER_MARGIN_PX = 2;

/**
 * The winner a point offers — only if every sample around it agrees.
 *
 * Any disagreement means this being is not offered at all rather than offered
 * unreliably: the view would rather say "too tightly packed to point at" than
 * hand a reader somebody else's card.
 */
export function steadyWinner(samples: readonly (number | null)[]): number | null {
  const first = samples[0] ?? null;
  if (first === null) return null;
  for (const s of samples) if (s !== first) return null;
  return first;
}

/**
 * Whether a being is offered under the POINTER at all, or only through the chip
 * that is already speaking for it.
 *
 * The occupants of a shelter have had their rings, badges, arrows and names
 * taken off them so the hut is not a scribble, and one number on the roof
 * stands for all of them. A view that then also hands them back individually
 * under the mouse is running two contradictory promises at once: two of round
 * five's 389 offers were hut occupants, 13–28 px from the being the picker
 * actually returned. They are reachable, and the route is the chip — its card
 * lists every occupant by name and a click on a name selects that being.
 */
export function offeredUnderPointer(carriedBy: number | null): boolean {
  return carriedBy === null;
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
