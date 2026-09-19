import type { PlaceRef, SpaceOps } from '../../src/contract/space.js';

/**
 * EVERYTHING A MIND IS ALLOWED TO DO WITH A PLACE — the positive controls for
 * `placeLeaksIn`. A guard that reports nothing is indistinguishable from a guard
 * that works, and so is a guard that reports EVERYTHING: if any of these ever
 * starts failing, the guard has stopped being usable and a reader will start
 * casting places to get around it.
 *
 * The rule they all obey: a place is PASSED, never opened. It goes to the world
 * that minted it, into a field, into a list, and it is compared for existence.
 * Nothing here asks what is inside one.
 */

/** The two questions a mind genuinely has, and the world answers both. */
export function howFar(space: SpaceOps, a: PlaceRef, b: PlaceRef): number {
  return space.distance(a, b);
}

export function whichWay(space: SpaceOps, a: PlaceRef, b: PlaceRef): string {
  return space.direction(a, b);
}

export function close(space: SpaceOps, a: PlaceRef, b: PlaceRef): boolean {
  return space.within(a, b, 8);
}

/** The only comparison of two places there is. */
export function samePlace(space: SpaceOps, a: PlaceRef, b: PlaceRef): boolean {
  return space.equal(a, b);
}

/** Written down — through the world, which is the one reviewed seam. */
export function written(space: SpaceOps, place: PlaceRef): Record<string, unknown> {
  return space.encode(place);
}

export function named(space: SpaceOps, place: PlaceRef): string {
  return space.label(place);
}

/** Is there one at all? The one comparison that is not about places. */
export function anywhere(place: PlaceRef | undefined): boolean {
  return place !== undefined && place !== null;
}

/** Somewhere to be when nothing is known — the world's own answer. */
export function nowhere(space: SpaceOps): PlaceRef {
  return space.unplaced;
}

/** Stored, read back off a record, and carried in a list. */
export function keep(store: { place?: PlaceRef }, place: PlaceRef): void {
  store.place = place;
}

export function readOffARecord(memory: { place?: PlaceRef }): PlaceRef | undefined {
  return memory.place;
}

export function collect(places: PlaceRef[], place: PlaceRef): PlaceRef[] {
  return [...places, place];
}

export function copyTheList(places: readonly PlaceRef[]): PlaceRef[] {
  return [...places];
}

/** A RECORD that happens to carry a place is not a place — spreading and
 *  serialising one is ordinary bookkeeping, and both must stay legal. */
export function copyTheRecord(memory: { id: number; place?: PlaceRef }): object {
  return { ...memory };
}

export function storeTheRecord(memory: { id: number; place?: PlaceRef }): string {
  return JSON.stringify(memory);
}

/** Arithmetic on what the world ANSWERED is arithmetic on a number. */
export function rounded(space: SpaceOps, a: PlaceRef, b: PlaceRef): number {
  return Math.round(space.distance(a, b));
}
