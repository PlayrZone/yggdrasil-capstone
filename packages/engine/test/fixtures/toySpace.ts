import { guardPlaces } from '../../src/contract/space.js';
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
 */

const WAYS: Readonly<Record<string, readonly string[]>> = {
  hollow: ['ridge', 'burrow'],
  ridge: ['hollow', 'well'],
  well: ['ridge'],
  burrow: ['hollow'],
};

export const TOY_SPOTS: readonly string[] = ['hollow', 'ridge', 'well', 'burrow'];

/** Somewhere you can be. The whole runtime value of a place in this world. */
interface Spot {
  spot: string;
}

const asPlace = (spot: Spot): PlaceRef => spot as unknown as PlaceRef;
const asSpot = (place: PlaceRef): Spot => place as unknown as Spot;

/** A place in this world, by name. */
export function spot(name: string): PlaceRef {
  return asPlace({ spot: name });
}

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
  /** One field, and it is a word — not two, and not numbers. */
  fields: [{ id: 'spot', type: 'enum', values: TOY_SPOTS, hint: 'names one of the spots there are' }],
  unplaced: spot('hollow'),

  distance: (a, b) => hops(asSpot(a).spot, asSpot(b).spot),
  direction: (from, to) => stepToward(asSpot(from).spot, asSpot(to).spot),
  within: (a, b, radius) => hops(asSpot(a).spot, asSpot(b).spot) <= radius,
  equal: (a, b) => asSpot(a).spot === asSpot(b).spot,

  placeOf(carrier) {
    if (carrier === null || typeof carrier !== 'object') return undefined;
    const named = (carrier as { spot?: unknown }).spot;
    return typeof named === 'string' && named in WAYS ? spot(named) : undefined;
  },

  label: (place) => asSpot(place).spot,
  encode: (place) => ({ spot: asSpot(place).spot }),
  decode(fields) {
    const named = fields['spot'];
    return typeof named === 'string' && named in WAYS ? spot(named) : undefined;
  },
  isPlace(value) {
    if (value === null || typeof value !== 'object') return false;
    const named = (value as { spot?: unknown }).spot;
    return typeof named === 'string' && named in WAYS;
  },
};

/**
 * Guarded exactly as the forager plane is, and for the same reason: hand this
 * world a place from the continent and it must say so rather than answer
 * `Infinity` hops to `undefined`.
 */
export const toySpace: SpaceOps = guardPlaces(wayfaring);
