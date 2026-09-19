import type { PlaceRef } from '../../src/contract/space.js';

/**
 * THE ROUTES THE TYPE SYSTEM ITSELF REFUSES — the compile proof.
 *
 * `place-leaks.ts` is what compiles; this is what does not, and the difference
 * is the first ruling of the W1-B4 fix. `PlaceRef` carries a REQUIRED brand
 * keyed by a `unique symbol` that `contract/space.ts` does not export, so:
 *
 *  · nothing can READ a member off one,
 *  · nothing can INDEX one, by literal or by const key,
 *  · nothing can DESTRUCTURE a named key out of one,
 *  · nothing can do arithmetic on one (ORDERING one, `a < b`, does compile —
 *    that route lives in `place-leaks.ts`, where the guard is the whole defence),
 *  · and — the mint the verifier found — `const p: PlaceRef = {}` no longer
 *    compiles either. An OPTIONAL brand (`readonly __place?: never`) is no brand
 *    at all: `{}` satisfied it, so any mind could make a place from nothing with
 *    no cast for a reader to notice.
 *
 * `mind-no-geometry.test.ts` compiles this file and asserts that EVERY function
 * below produces a diagnostic. If one of them ever starts compiling, the brand
 * has been weakened and the test says which route reopened.
 */

export function memberAccess(place: PlaceRef): unknown {
  // @ts-expect-error a place has no readable member
  return place.x;
}

export function elementAccess(place: PlaceRef): unknown {
  // @ts-expect-error …and no index signature either
  return place['x'];
}

export function constKeyAccess(place: PlaceRef): unknown {
  const key = 'x';
  // @ts-expect-error the key being a constant changes nothing
  return place[key];
}

export function namedDestructure(place: PlaceRef): unknown {
  // @ts-expect-error there is no `x` to take out
  const { x } = place;
  return x;
}

export function mintFromNothing(): PlaceRef {
  // @ts-expect-error the brand is required, so `{}` is not a place
  const place: PlaceRef = {};
  return place;
}

export function mintFromAPair(): PlaceRef {
  // @ts-expect-error nor is an object with real fields
  const place: PlaceRef = { x: 1, y: 2 };
  return place;
}

export function subtractThem(a: PlaceRef, b: PlaceRef): number {
  // @ts-expect-error two places are not two numbers
  return a - b;
}
