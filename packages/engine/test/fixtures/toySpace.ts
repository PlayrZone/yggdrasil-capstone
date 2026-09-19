import { defineSpace } from '../../src/contract/space.js';
import type { DirectionId, PlaceRef, SpaceCodec, SpaceOps } from '../../src/contract/space.js';

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

  distance: (a, b) => hops(nameOf(a), nameOf(b)),
  direction: (from, to) => stepToward(nameOf(from), nameOf(to)),
  within: (a, b, radius) => hops(nameOf(a), nameOf(b)) <= radius,
  equal: (a, b) => nameOf(a) === nameOf(b),
  label: (place) => nameOf(place),
};

const wayfaringCodec: SpaceCodec = {
  /** One field, and it is a word — not two, and not numbers. */
  fields: [{ id: 'spot', type: 'enum', values: TOY_SPOTS, hint: 'names one of the spots there are' }],

  placeOf(carrier) {
    if (carrier === null || typeof carrier !== 'object') return undefined;
    const named = (carrier as { spot?: unknown }).spot;
    return typeof named === 'string' && named in WAYS ? spot(named) : undefined;
  },

  encode: (place) => ({ spot: nameOf(place) }),
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
 * Guarded exactly as the forager plane is, and for the same reason: hand this
 * world a place from the continent and it must say so rather than answer
 * `Infinity` hops to `undefined`.
 */
export const toySpace: SpaceOps = defineSpace({ ops: wayfaring, codec: wayfaringCodec });
