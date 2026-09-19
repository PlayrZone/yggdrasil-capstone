import { guardPlaces } from '../../contract/space.js';
import type { DirectionId, PlaceRef, SpaceOps } from '../../contract/space.js';

/**
 * THE FORAGER CONTINENT IS A PLANE, AND SAYS SO HERE (W1-B4).
 *
 * Transcribed, not designed. Every expression below stood somewhere in the
 * mind the moment before — `Math.hypot(place.x - x, place.y - y)` in
 * `prompt.ts`, `dx * dx + dy * dy > radius * radius` in `SuccessionMiner`, the
 * four-unit compass in `prompt.ts` — and is reproduced here operation for
 * operation, in the same order, because a rounding boundary that moves moves a
 * think cadence and the whole run diverges.
 *
 * The numbers are the world's again, which is the point: a town measures in
 * streets and a graph world in hops, and neither of them has a `hypot`.
 */

/** This world's own datum, behind the handle. Nothing outside this file sees it. */
export interface Point {
  x: number;
  y: number;
}

/**
 * A partial point is REACHABLE, not a mistake to design out: a model may write
 * `{"kind":"MoveTo","x":5}` with no `y`, and before this step that half-written
 * act reached the body, which answered for it with a refusal the being
 * remembers. The place carries exactly what was written.
 */
type PartialPoint = Partial<Point>;

/**
 * THE TWO CASTS THIS WORLD MAKES — not, as this comment once claimed, the two
 * in the repository (W1-B4 verifier, backlog 5). Every world's space module
 * makes its own pair: `test/fixtures/toySpace.ts` has the same two lines, and
 * `contract/wire.ts` makes one more where it narrows an `Intent`'s own `place`
 * field before handing it to `space.encode` — the single reviewed serialisation
 * seam, allow-listed by name in `test/mind-no-geometry.test.ts`. What IS true of
 * the repository is the direction: a `PlaceRef` is branded, so a cast is the
 * only way to make one, and every cast that makes one lives in `worlds/**` or
 * at that one seam.
 *
 * A `PlaceRef` has no readable member by design, so the world that mints one has
 * to say, once and visibly, what its own places are made of. Everything else in
 * this file goes through these two.
 */
const asPlace = (point: PartialPoint): PlaceRef => point as unknown as PlaceRef;
const asPoint = (place: PlaceRef): PartialPoint => place as unknown as PartialPoint;

/** A place in this world, from a pair of its coordinates. */
export function at(x: number, y: number): PlaceRef {
  return asPlace({ x, y });
}

/** …and back, for this world's own body, policy and instrument. */
export function pointOf(place: PlaceRef): Point {
  const point = asPoint(place);
  return { x: point.x as number, y: point.y as number };
}

/**
 * The nine directions this plane names. Eight compass words plus the one a
 * being uses when the pull is too close to have a direction at all — which is
 * a word, not a nothing, and `compass` has always returned it.
 */
const DIRECTIONS: readonly DirectionId[] = [
  'north',
  'northeast',
  'northwest',
  'south',
  'southeast',
  'southwest',
  'east',
  'west',
  'near here',
];

/** `prompt.ts`'s own compass, moved verbatim: four world units of dead zone. */
function compass(dx: number, dy: number): DirectionId {
  const ns = dy < -4 ? 'north' : dy > 4 ? 'south' : '';
  const ew = dx > 4 ? 'east' : dx < -4 ? 'west' : '';
  return `${ns}${ew}` || 'near here';
}

function fieldsOf(place: PlaceRef): PartialPoint {
  return asPoint(place);
}

const planeSpace: SpaceOps = {
  directions: DIRECTIONS,
  /** The two numbers this world's acts have always been written with — and
   *  `number`, so `x: 1e999` is still `bad-number` about `x`. */
  fields: [
    { id: 'x', type: 'number' },
    { id: 'y', type: 'number' },
  ],
  /** The origin — what `AgentMind` wrote for a story retold with no site. */
  unplaced: at(0, 0),

  distance(a, b) {
    const from = fieldsOf(a);
    const to = fieldsOf(b);
    return Math.hypot((to.x as number) - (from.x as number), (to.y as number) - (from.y as number));
  },

  direction(from, to) {
    const here = fieldsOf(from);
    const there = fieldsOf(to);
    return compass((there.x as number) - (here.x as number), (there.y as number) - (here.y as number));
  },

  /**
   * Squares, never a root — `SuccessionMiner`'s own comparison, so the boolean
   * is the same boolean for every pair of places it has ever been asked about.
   */
  within(a, b, radius) {
    const p = fieldsOf(a);
    const q = fieldsOf(b);
    const dx = (p.x as number) - (q.x as number);
    const dy = (p.y as number) - (q.y as number);
    return !(dx * dx + dy * dy > radius * radius);
  },

  equal(a, b) {
    const p = fieldsOf(a);
    const q = fieldsOf(b);
    return p.x === q.x && p.y === q.y;
  },

  /**
   * Anything this world puts in the plane: a `SimEvent`, a body's transform, a
   * thing seen. It reads its own two fields off its own carrier — which is
   * exactly the reach a mind no longer has.
   */
  placeOf(carrier) {
    if (carrier === null || typeof carrier !== 'object') return undefined;
    const held = carrier as { x?: unknown; y?: unknown };
    return typeof held.x === 'number' && typeof held.y === 'number' ? at(held.x, held.y) : undefined;
  },

  /** What `prompt.ts` has always written in the parentheses. */
  label(place) {
    const point = fieldsOf(place);
    return `${Math.round(point.x as number)},${Math.round(point.y as number)}`;
  },

  encode(place) {
    const point = fieldsOf(place);
    const out: Record<string, unknown> = {};
    if (point.x !== undefined) out['x'] = point.x;
    if (point.y !== undefined) out['y'] = point.y;
    return out;
  },

  decode(fields) {
    const x = fields['x'];
    const y = fields['y'];
    const point: PartialPoint = {};
    if (typeof x === 'number') point.x = x;
    if (typeof y === 'number') point.y = y;
    return point.x === undefined && point.y === undefined ? undefined : asPlace(point);
  },

  isPlace(value) {
    if (value === null || typeof value !== 'object') return false;
    const held = value as { x?: unknown; y?: unknown };
    const x = held.x;
    const y = held.y;
    // Each coordinate is the number the parser would have carried through, and
    // at least one of them is there — which is the half-written act above.
    const usable = (v: unknown): boolean => v === undefined || (typeof v === 'number' && Number.isFinite(v));
    return usable(x) && usable(y) && !(x === undefined && y === undefined);
  },
};

/**
 * …and the same plane with its door shut: a place another world minted reaches
 * none of the arithmetic above, it reaches a `ForeignPlaceError` (W1-B4
 * verifier, backlog 4). The raw object stays module-private so there is exactly
 * one `foragerSpace` and no way to hold the unguarded one by accident.
 */
export const foragerSpace: SpaceOps = guardPlaces(planeSpace);
