import { defineSpace } from '../../src/contract/edges.js';
import type { SpaceCodec } from '../../src/contract/edges.js';
import { ForeignPlaceError } from '../../src/contract/space.js';
import type { DirectionId, PlaceRef, SpaceOps } from '../../src/contract/space.js';

/**
 * A SPACE WITH NO COORDINATES IN IT AT ALL (W1-B4).
 *
 * Four named spots and the ways between them. There is no plane, no pair of
 * numbers, no `hypot` and no compass: distance is HOPS along the ways, and a
 * direction is the name of the next spot you would head for. If anything in the
 * mind still believed space was a plane, nothing here would work — and the
 * point of keeping a world like this beside the forager continent is that the
 * same unchanged mind has to live in both.
 *
 *     hollow ── ridge ── well
 *        │
 *      burrow
 *
 * Its handle is built the same way the plane's is (round 3): a class whose one
 * field is `#private`, a prototype with nothing on it, frozen instances. A toy
 * world is the place a shortcut would be most tempting and least noticed, so it
 * takes the same medicine — which is also what makes "the continent refuses a
 * toy place" a test of ownership rather than of two different field names.
 *
 * And the same medicine for ownership too (round 5): the ops live IN the class
 * and read `#spot` directly, so a place this world did not mint throws
 * natively and only the `catch` names it. A toy world written the old way —
 * ops beside the class, a wrapper around them — would still pass every test
 * here and would quietly be the shape the perf round deleted; `defineSpace`
 * now refuses to publish one that does not refuse a stranger itself.
 */

const WAYS: Readonly<Record<string, readonly string[]>> = {
  hollow: ['ridge', 'burrow'],
  ridge: ['hollow', 'well'],
  well: ['ridge'],
  burrow: ['hollow'],
};

export const TOY_SPOTS: readonly string[] = ['hollow', 'ridge', 'well', 'burrow'];

/** Somewhere you can be. The whole runtime state of a place in this world. */
class Somewhere {
  readonly #spot: string;

  constructor(name: string) {
    this.#spot = name;
    Object.freeze(this);
  }

  static owns(value: unknown): boolean {
    return typeof value === 'object' && value !== null && #spot in value;
  }

  static read(place: PlaceRef): string {
    return (place as unknown as Somewhere).#spot;
  }

  /** The slow path only: which argument was not ours, or the original error. */
  static #refuse(op: string, error: unknown, args: readonly unknown[]): unknown {
    for (let i = 0; i < args.length; i++) {
      if (!Somewhere.owns(args[i])) return new ForeignPlaceError(op, i + 1);
    }
    return error;
  }

  static distance(a: PlaceRef, b: PlaceRef): number {
    try {
      return hops((a as unknown as Somewhere).#spot, (b as unknown as Somewhere).#spot);
    } catch (error) {
      throw Somewhere.#refuse('distance', error, [a, b]);
    }
  }

  static direction(from: PlaceRef, to: PlaceRef): DirectionId {
    try {
      return stepToward((from as unknown as Somewhere).#spot, (to as unknown as Somewhere).#spot);
    } catch (error) {
      throw Somewhere.#refuse('direction', error, [from, to]);
    }
  }

  static within(a: PlaceRef, b: PlaceRef, radius: number): boolean {
    try {
      return hops((a as unknown as Somewhere).#spot, (b as unknown as Somewhere).#spot) <= radius;
    } catch (error) {
      throw Somewhere.#refuse('within', error, [a, b]);
    }
  }

  static equal(a: PlaceRef, b: PlaceRef): boolean {
    try {
      return (a as unknown as Somewhere).#spot === (b as unknown as Somewhere).#spot;
    } catch (error) {
      throw Somewhere.#refuse('equal', error, [a, b]);
    }
  }

  static label(place: PlaceRef): string {
    try {
      return (place as unknown as Somewhere).#spot;
    } catch (error) {
      throw Somewhere.#refuse('label', error, [place]);
    }
  }

  static encode(place: PlaceRef): Record<string, unknown> {
    try {
      return { spot: (place as unknown as Somewhere).#spot };
    } catch (error) {
      throw Somewhere.#refuse('encode', error, [place]);
    }
  }
}

Reflect.deleteProperty(Somewhere.prototype, 'constructor');
Object.setPrototypeOf(Somewhere.prototype, null);
Object.freeze(Somewhere.prototype);

/** A place in this world, by name. */
export function spot(name: string): PlaceRef {
  return new Somewhere(name) as unknown as PlaceRef;
}

const nameOf = Somewhere.read;

/** Hops from one spot to another along the ways, or Infinity if unreachable. */
function hops(from: string, to: string): number {
  if (from === to) return 0;
  const seen = new Set<string>([from]);
  let edge = [from];
  let depth = 0;
  while (edge.length > 0) {
    depth++;
    const next: string[] = [];
    for (const here of edge) {
      for (const there of WAYS[here] ?? []) {
        if (seen.has(there)) continue;
        if (there === to) return depth;
        seen.add(there);
        next.push(there);
      }
    }
    edge = next;
  }
  return Number.POSITIVE_INFINITY;
}

/** The first step of the shortest way — this world's whole notion of "which way". */
function stepToward(from: string, to: string): DirectionId {
  if (from === to) return 'here';
  let best: DirectionId = 'here';
  let bestHops = Number.POSITIVE_INFINITY;
  for (const there of WAYS[from] ?? []) {
    const d = hops(there, to);
    if (d < bestHops) {
      bestHops = d;
      best = there;
    }
  }
  return best;
}

const wayfaring: SpaceOps = {
  /** You head FOR a place here; the directions are the spots themselves. */
  directions: [...TOY_SPOTS, 'here'],
  unplaced: spot('hollow'),

  distance: Somewhere.distance,
  direction: Somewhere.direction,
  within: Somewhere.within,
  equal: Somewhere.equal,
  label: Somewhere.label,
};

const wayfaringCodec: SpaceCodec = {
  /** One field, and it is a word — not two, and not numbers. */
  fields: [{ id: 'spot', type: 'enum', values: TOY_SPOTS, hint: 'names one of the spots there are' }],

  placeOf(carrier) {
    if (carrier === null || typeof carrier !== 'object') return undefined;
    const named = (carrier as { spot?: unknown }).spot;
    return typeof named === 'string' && named in WAYS ? spot(named) : undefined;
  },

  encode: Somewhere.encode,
  decode(fields) {
    const named = fields['spot'];
    return typeof named === 'string' && named in WAYS ? spot(named) : undefined;
  },
  isPlace(value) {
    if (value === null || typeof value !== 'object') return false;
    const named = Somewhere.owns(value) ? nameOf(value as unknown as PlaceRef) : (value as { spot?: unknown }).spot;
    return typeof named === 'string' && named in WAYS;
  },
  owns: Somewhere.owns,
};

/**
 * Checked exactly as the forager plane is, and for the same reason: hand this
 * world a place from the continent and it must say so rather than answer
 * `Infinity` hops to `undefined`.
 */
const guarded = defineSpace({ ops: wayfaring, codec: wayfaringCodec });

export const toySpace: SpaceOps = guarded.space;

/** This world's edges' half — handed over, never looked up (round 4). */
export const toyCodec: SpaceCodec = guarded.codec;

/** The fields this world writes a place as, for its own `place` param. */
export const TOY_PLACE_FIELDS = wayfaringCodec.fields;
