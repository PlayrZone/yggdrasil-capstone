/* eslint-disable @typescript-eslint/no-explicit-any */
import type { PlaceRef } from '../../src/contract/space.js';

/**
 * EVERY WAY OUT OF AN OPAQUE PLACE THAT THE COMPILER ALLOWS.
 *
 * This is the verifier's second fail, written out. `PlaceRef` has no readable
 * member, so `p.x` does not compile — and the W1-B4 guard, which matched the
 * NAME `x`, caught every spelling of it. The hole was everything below: not one
 * of these functions contains a coordinate name, a compass word or a `hypot`,
 * every one of them TYPE-CHECKS CLEANLY, and two `Object.values` calls plus a
 * `Math.sqrt` are a full Euclidean distance.
 *
 * `mind-no-geometry.test.ts` asserts two things about this file: that it has
 * ZERO type errors — so the compiler really is no defence here and the guard is
 * the whole of it — and that `placeLeaksIn` reports every function in it. Plant
 * any of these in a mind directory and the guard goes red.
 *
 * One route per exported function, and the function's name is the route.
 */

export function objectValues(place: PlaceRef): unknown[] {
  return Object.values(place);
}

export function objectKeys(place: PlaceRef): string[] {
  return Object.keys(place);
}

export function objectEntries(place: PlaceRef): [string, unknown][] {
  return Object.entries(place);
}

export function objectAssign(place: PlaceRef): object {
  return Object.assign({}, place);
}

export function ownPropertyNames(place: PlaceRef): string[] {
  return Object.getOwnPropertyNames(place);
}

export function ownPropertyDescriptors(place: PlaceRef): object {
  return Object.getOwnPropertyDescriptors(place);
}

export function prototypeOf(place: PlaceRef): unknown {
  return Object.getPrototypeOf(place);
}

export function reflectOwnKeys(place: PlaceRef): (string | symbol)[] {
  return Reflect.ownKeys(place);
}

export function spreadIntoAnObject(place: PlaceRef): object {
  return { ...place };
}

export function restDestructure(place: PlaceRef): object {
  const { ...rest } = place;
  return rest;
}

export function structuredCloneIt(place: PlaceRef): PlaceRef {
  return structuredClone(place);
}

/** The round trip: a place's runtime value IS the world's datum, so this is a
 *  coordinate pair in a string, and `JSON.parse` of it is the pair back. */
export function jsonStringify(place: PlaceRef): string {
  return JSON.stringify(place);
}

export function stringify(place: PlaceRef): string {
  return String(place);
}

export function templateInterpolation(place: PlaceRef): string {
  return `${place}`;
}

export function forInLoop(place: PlaceRef): string[] {
  const keys: string[] = [];
  for (const key in place) keys.push(key);
  return keys;
}

export function inOperator(place: PlaceRef): boolean {
  return 'x' in place;
}

export function castToUnknown(place: PlaceRef): unknown {
  return place as unknown;
}

export function castToAny(place: PlaceRef): any {
  return place as any;
}

/** A mind MINTING one: a place the world never gave it, and no world would
 *  recognise. `{}` needs no cast at all until the brand is required. */
export function mintFromAPair(): PlaceRef {
  return { x: 1, y: 2 } as unknown as PlaceRef;
}

/** …and the comparisons the world is supposed to make. `a === b` is two
 *  objects, not two places; `a < b` is arithmetic TypeScript happily allows
 *  between two values of one type, and `space.equal` is the only real answer. */
export function compareByIdentity(a: PlaceRef, b: PlaceRef): boolean {
  return a === b;
}

export function orderThem(a: PlaceRef, b: PlaceRef): boolean {
  return a < b;
}
