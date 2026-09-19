import { createPlaneSpace } from '../plane.js';
import type { Point } from '../plane.js';

/**
 * THE FORAGER CONTINENT IS A PLANE, AND SAYS SO HERE (W1-B4).
 *
 * The plane itself — the handle class, the arithmetic, the compass, the codec —
 * is `worlds/plane.ts`, because W1-C's town is a plane too and the whole point
 * of the factory is that its places and THIS world's places are different
 * things at runtime. What is forager here is the single call: this continent
 * has one plane, minted once, and every place in every forager run comes from
 * it.
 *
 * WHAT LEAVES THIS MODULE, and to whom:
 *  · `foragerSpace` — the mind's half, on the adapter. Guarded, so another
 *    world's place reaches a `ForeignPlaceError` and not the arithmetic.
 *  · `at` / `pointOf` / `xOf` / `yOf` — this world's OWN reach into its own
 *    geometry, for its body, its reflex policy and the instrument. None of them
 *    is on the adapter and none of them is reachable from a mind: no mind file
 *    may import `worlds/**` at all, which `test/mind-type-graph.test.ts` proves
 *    by compiling the whole mind against a repository with no `worlds/` in it.
 *  · `foragerCodec` — the edges' half, and the reason this is a module-level
 *    const rather than a lookup: `worlds/forager/adapter.ts` puts it in this
 *    world's `WorldEdges` and the host wiring hands THAT to the parser, the
 *    recorder, the body edge, the gate and the lab bridge. Round 3 exported a
 *    `codecFor(space)` from `contract/`, which every mind file could import and
 *    one cast could widen; there is nothing of the sort now (see
 *    `contract/edges.ts`).
 */

const plane = createPlaneSpace();

/** This world's space, as a mind is handed it. */
export const foragerSpace = plane.space;

/** This world's space, as its EDGES are handed it. Never on the adapter. */
export const foragerCodec = plane.codec;

/** A place on this continent, from a pair of its coordinates. */
export const at = plane.at;

/** …and back, for this world's own body, policy and instrument. */
export const pointOf = plane.pointOf;

/** One coordinate, allocating nothing — the hot-loop reader. */
export const xOf = plane.xOf;
export const yOf = plane.yOf;

export type { Point };
