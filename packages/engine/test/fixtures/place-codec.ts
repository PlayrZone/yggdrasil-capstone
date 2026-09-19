import type { SpaceCodec } from '../../src/contract/edges.js';
import type { PlaceRef } from '../../src/contract/space.js';

/**
 * THE ROUTES THAT ARE NOT ABOUT OPENING A HANDLE — the negative controls for the
 * expression-level rules, and, like `place-leaks.ts`, this file COMPILES
 * CLEANLY. That is the point: the type system has no objection to any of them,
 * so a guard has to.
 *
 * ROUND 4 CHANGED WHAT IT TAKES TO WRITE THIS FILE, which is the finding. Round
 * 3's version opened with `import { codecFor } from '../../src/contract/space'`
 * and asked for a codec in three lines; a mind file could make the same import,
 * and one cast past the type rule reopened twenty-two routes. There is no such
 * import to make now — nothing in `contract/space.ts` or anywhere else in a
 * mind's reach produces a codec — so each function below has to be HANDED one,
 * and a mind directory has nowhere to be handed one from. The structural proof
 * is `mind-type-graph.test.ts`; these rules are what still bites if a
 * codec-typed value ever does arrive.
 *
 * Plant this file in a mind directory and `mind-no-geometry.test.ts` turns red
 * with one finding per function below.
 */

/** Holding the codec at all — the verifier's routes 20 and 21. */
export function holdsTheCodec(codec: SpaceCodec): SpaceCodec {
  return codec;
}

/** …under an alias, which is why the rule is asked of the TYPE, not the name. */
export function writesOneDown(codec: SpaceCodec, place: PlaceRef): Record<string, unknown> {
  const doorway = codec;
  return doorway.encode(place);
}

/** …and MINTING one, which is what made round 2's triangulation work. */
export function mintsOne(codec: SpaceCodec, x: number, y: number): PlaceRef | undefined {
  return codec.decode({ x, y });
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
