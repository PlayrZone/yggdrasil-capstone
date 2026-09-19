import { codecFor } from '../../src/contract/space.js';
import type { PlaceRef, SpaceCodec, SpaceOps } from '../../src/contract/space.js';

/**
 * THE THREE ROUTES THAT ARE NOT ABOUT OPENING A HANDLE — the negative controls
 * for the rules W1-B4 round 3 added, and, like `place-leaks.ts`, this file
 * COMPILES CLEANLY. That is the point: the type system has no objection to any
 * of them, so the guard has to.
 *
 * Plant this file in a mind directory and `mind-no-geometry.test.ts` turns red
 * with one finding per function below.
 */

/** Holding the codec at all — the verifier's routes 20 and 21, by import. */
export function holdsTheCodec(space: SpaceOps): SpaceCodec {
  return codecFor(space);
}

/** …under an alias, which is why the rule is asked of the TYPE, not the name. */
export function writesOneDown(space: SpaceOps, place: PlaceRef): Record<string, unknown> {
  const doorway = codecFor(space);
  return doorway.encode(place);
}

/** …and MINTING one, which is what made round 2's triangulation work. */
export function mintsOne(space: SpaceOps, x: number, y: number): PlaceRef | undefined {
  return codecFor(space).decode({ x, y });
}

/** A string no static rule can see inside. */
export function readsBySource(place: PlaceRef): unknown {
  // eslint-disable-next-line no-new-func
  return new Function('p', 'return p.x')(place);
}

export function evaluatesIt(place: PlaceRef): unknown {
  const p = place;
  // eslint-disable-next-line no-eval
  return eval('p');
}

/** Route 19: the world hands the mind its coordinates as text, by design. */
export function parsesTheLabel(space: SpaceOps, place: PlaceRef): number[] {
  return space.label(place).split(',').map(Number);
}

export function keepsTheLabel(space: SpaceOps, place: PlaceRef): string {
  return space.label(place);
}
