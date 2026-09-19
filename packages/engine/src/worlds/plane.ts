import { defineSpace } from '../contract/space.js';
import type { DirectionId, PlaceRef, SpaceCodec, SpaceOps } from '../contract/space.js';

/**
 * A EUCLIDEAN PLANE, AS A WORLD'S SPACE — and the opaque handle that goes with
 * it (W1-B4, round 3).
 *
 * The forager continent is a plane. W1-C's town will be a plane too, which is
 * exactly why this is a FACTORY and not a module-level singleton: each call
 * mints its own place class, so two planar worlds in one process recognise only
 * their own places and refuse each other's with `ForeignPlaceError`. The old
 * gate asked "does this value carry an `x`", and a town grid's `{x:3,y:9}`
 * answered yes — `distance` 1080.41, `direction` "southeast", `equal` true
 * (W1-B4 verifier, round 2, FAIL 2).
 *
 * THE HANDLE IS A CLASS WITH NOTHING ON IT. Its whole state is two ECMAScript
 * `#private` fields, which are not properties: `Object.keys/values/entries`,
 * spread, `for…in`, `Object.assign`, `structuredClone`, `JSON.stringify`,
 * `Reflect.ownKeys`, `getOwnPropertyNames/Symbols/Descriptors` and `p?.[K]` all
 * come back with nothing, and the prototype is emptied — `constructor` deleted,
 * `[[Prototype]]` set to null, frozen — so not even the class that made it is
 * reachable from an instance. Instances are frozen. `#x in v` is then an exact
 * brand test no other object can satisfy and no Proxy can trap, which is both
 * the ownership check and the reason the gate cannot be made to throw.
 *
 * IT IS ALSO THE FAST REPRESENTATION, which is the other half of round 3. The
 * old handle was a plain `{x, y}` behind two casts, and every op paid for
 * `asPoint`/`fieldsOf` and every `placeOf` allocated a fresh pair (round 2,
 * FAIL 3: −14.4% ticks/s at 1,000 beings). A private field is a monomorphic
 * slot read, and `xOf`/`yOf` let this world's own body, policy and instrument
 * read one coordinate without building an object to hold both.
 *
 * Every expression below is transcribed, not designed: `Math.hypot(…)` from
 * `prompt.ts`, `dx * dx + dy * dy > radius * radius` from `SuccessionMiner`, the
 * four-unit compass from `prompt.ts`, operation for operation and in the same
 * order — a rounding boundary that moves moves a think cadence and the whole run
 * diverges.
 */

/** This world's own datum, behind the handle. Nothing outside a plane sees it. */
export interface Point {
  x: number;
  y: number;
}

/**
 * The nine directions a plane names. Eight compass words plus the one a being
 * uses when the pull is too close to have a direction at all — which is a word,
 * not a nothing, and `compass` has always returned it.
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

/** One planar world's space: what a mind may ask, what an edge may do, and the
 *  three readers this world's own body, policy and instrument use. */
export interface PlaneSpace {
  /** Published on the adapter. Guarded: refuses a place this plane did not mint. */
  readonly space: SpaceOps;
  /** Reached only through `codecFor(space)` — never from the adapter. */
  readonly codec: SpaceCodec;
  /** A place of THIS plane, from a pair of its coordinates. */
  at(x: number, y: number): PlaceRef;
  /** …and back, for this world's own body, policy and instrument. */
  pointOf(place: PlaceRef): Point;
  /**
   * One coordinate, with nothing allocated to carry it. `pointOf` builds a pair
   * per call, which is fine once and expensive inside a loop over everything a
   * being can see — which is where this world's reflex policy spends its time.
   */
  xOf(place: PlaceRef): number;
  yOf(place: PlaceRef): number;
}

/**
 * ONE PLANE, WITH ITS OWN PLACE CLASS. Call it once per world.
 *
 * A HALF-WRITTEN PLACE IS REACHABLE, not a mistake to design out: a model may
 * write `{"kind":"MoveTo","x":5}` with no `y`, and before this step that
 * half-written act reached the body, which answered for it with a refusal the
 * being remembers. The place carries exactly what was written, so both fields
 * are `number | undefined`.
 */
export function createPlaneSpace(): PlaneSpace {
  /**
   * THE ONE PLACE THIS WORLD'S GEOMETRY LIVES. Nothing outside this class body
   * can read `#x`/`#y` — not another world, not a cast, not reflection.
   */
  class Place {
    readonly #x: number | undefined;
    readonly #y: number | undefined;

    constructor(x: number | undefined, y: number | undefined) {
      this.#x = x;
      this.#y = y;
      Object.freeze(this);
    }

    /** The ownership test: unforgeable, untrappable, and exact to this class. */
    static owns(value: unknown): boolean {
      return typeof value === 'object' && value !== null && #x in value;
    }

    static readX(place: PlaceRef): number | undefined {
      return (place as unknown as Place).#x;
    }

    static readY(place: PlaceRef): number | undefined {
      return (place as unknown as Place).#y;
    }
  }

  // The prototype is emptied rather than merely left bare: `p.constructor`
  // would otherwise hand a mind the class itself, and with it `new` — which is
  // minting, the route that made round 2's triangulation work. With no
  // `Object.prototype` behind it there is no `toString` to splice into a prompt
  // either; a template of a place throws instead of rendering one.
  Reflect.deleteProperty(Place.prototype, 'constructor');
  Object.setPrototypeOf(Place.prototype, null);
  Object.freeze(Place.prototype);

  /** THE ONE CAST THAT MAKES A PLACE OF THIS PLANE. Half of one is legal here
   *  and nowhere else: only `decode` builds one, from what a model wrote. */
  const mint = (x: number | undefined, y: number | undefined): PlaceRef => new Place(x, y) as unknown as PlaceRef;
  const at = (x: number, y: number): PlaceRef => mint(x, y);
  const readX = Place.readX;
  const readY = Place.readY;

  const ops: SpaceOps = {
    directions: DIRECTIONS,
    /** The origin — what `AgentMind` wrote for a story retold with no site. */
    unplaced: at(0, 0),

    distance(a, b) {
      return Math.hypot((readX(b) as number) - (readX(a) as number), (readY(b) as number) - (readY(a) as number));
    },

    direction(from, to) {
      return compass((readX(to) as number) - (readX(from) as number), (readY(to) as number) - (readY(from) as number));
    },

    /**
     * Squares, never a root — `SuccessionMiner`'s own comparison, so the boolean
     * is the same boolean for every pair of places it has ever been asked about.
     */
    within(a, b, radius) {
      const dx = (readX(a) as number) - (readX(b) as number);
      const dy = (readY(a) as number) - (readY(b) as number);
      return !(dx * dx + dy * dy > radius * radius);
    },

    equal(a, b) {
      return readX(a) === readX(b) && readY(a) === readY(b);
    },

    /** What `prompt.ts` has always written in the parentheses. */
    label(place) {
      return `${Math.round(readX(place) as number)},${Math.round(readY(place) as number)}`;
    },
  };

  const codec: SpaceCodec = {
    /** The two numbers this world's acts have always been written with — and
     *  `number`, so `x: 1e999` is still `bad-number` about `x`. */
    fields: [
      { id: 'x', type: 'number' },
      { id: 'y', type: 'number' },
    ],

    encode(place) {
      const x = readX(place);
      const y = readY(place);
      const out: Record<string, unknown> = {};
      if (x !== undefined) out['x'] = x;
      if (y !== undefined) out['y'] = y;
      return out;
    },

    decode(fields) {
      const x = fields['x'];
      const y = fields['y'];
      const hasX = typeof x === 'number';
      const hasY = typeof y === 'number';
      if (!hasX && !hasY) return undefined;
      return mint(hasX ? x : undefined, hasY ? y : undefined);
    },

    isPlace(value) {
      if (value === null || typeof value !== 'object') return false;
      // A place THIS world minted answers from its own fields; anything else is
      // untrusted JSON and is read as untrusted JSON.
      const x = Place.owns(value) ? readX(value as unknown as PlaceRef) : (value as { x?: unknown }).x;
      const y = Place.owns(value) ? readY(value as unknown as PlaceRef) : (value as { y?: unknown }).y;
      // Each coordinate is the number the parser would have carried through, and
      // at least one of them is there — which is the half-written act above.
      const usable = (v: unknown): boolean => v === undefined || (typeof v === 'number' && Number.isFinite(v));
      return usable(x) && usable(y) && !(x === undefined && y === undefined);
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

    owns: Place.owns,
  };

  return {
    space: defineSpace({ ops, codec }),
    codec,
    at,
    pointOf: (place) => ({ x: readX(place) as number, y: readY(place) as number }),
    xOf: (place) => readX(place) as number,
    yOf: (place) => readY(place) as number,
  };
}
