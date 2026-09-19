import { defineSpace } from '../contract/edges.js';
import type { SpaceCodec } from '../contract/edges.js';
import { ForeignPlaceError } from '../contract/space.js';
import type { DirectionId, PlaceRef, SpaceOps } from '../contract/space.js';
import type { ParamSchema } from '../contract/actions.js';

/**
 * A EUCLIDEAN PLANE, AS A WORLD'S SPACE — and the opaque handle that goes with
 * it (W1-B4, rounds 3-4).
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
 * reachable from an instance. `#x in v` is then an exact brand test no other
 * object can satisfy and no Proxy can trap, which is both the ownership check
 * and the reason the gate cannot be made to throw.
 *
 * NOTHING HERE IS EXPORTED AS A CODEC. `createPlaneSpace` RETURNS one, to the
 * world that called it; the world puts it in its `WorldEdges` and the host
 * wiring hands that to the edges. There is no lookup to import (see
 * `contract/edges.ts` for what one cast did to the lookup this replaced).
 *
 * THE OWNERSHIP CHECK IS THE FIELD READ ITSELF (round 5, the perf round). Round
 * 4 published these ops through a wrapper in `defineSpace` that asked
 * `codec.owns(a)` before forwarding, and that wrapper WAS the step's tick-rate
 * regression: −3.2% at 256 beings and −7.2% at 1,000, with a CPU profile that
 * showed parity, because the cost is an extra frame and a second shape per call
 * rather than work a sampler can see. Bypassing it measured +0.12%.
 *
 * So the ops moved in here, where `a.#x` is BOTH the read and the check: on an
 * object this class did not construct the read throws a `TypeError` natively,
 * at no cost whatsoever on the path where it does not. Each op is one
 * `try`/`catch`, and the catch — reached only when something foreign arrived —
 * asks `#x in` of each argument in turn to say WHICH one, and re-throws the
 * original error untouched when every argument was in fact ours (a place may
 * hold a `Symbol`, and `Math.round` of one throws a `TypeError` that has
 * nothing to do with ownership). `defineSpace` no longer wraps: it VERIFIES, at
 * world construction, that each entry point refuses a foreign place — so a
 * world author who writes an op that reads a coordinate off any old object
 * fails loudly where the mistake is, not silently in W1-C.
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
 * THE TWO FIELDS A PLANE WRITES A PLACE AS, declared once and read by both
 * halves: the codec below writes and reads them, and a planar world's `place`
 * PARAM carries the same list so the parser and the prompt's argument paragraph
 * can say `x,y` without holding a codec (`PlaceParam.fields`). One constant, so
 * the two cannot drift; `test/world-space.test.ts` pins them against each other
 * anyway, because a drift here is a silently different wire.
 */
export const PLANE_FIELDS: readonly ParamSchema[] = Object.freeze([
  Object.freeze({ id: 'x', type: 'number' }) as ParamSchema,
  Object.freeze({ id: 'y', type: 'number' }) as ParamSchema,
]);

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

/** One planar world's space: what a mind may ask, and what its edges may do. */
export interface PlaneSpace {
  /** Published on the adapter. Guarded: refuses a place this plane did not mint. */
  readonly space: SpaceOps;
  /** HANDED to this world's `WorldEdges` — never looked up, never on the adapter. */
  readonly codec: SpaceCodec;
  /** A place of THIS plane, from a pair of its coordinates. */
  at(x: number, y: number): PlaceRef;
  /** …and back, for this world's own body, policy and instrument. */
  pointOf(place: PlaceRef): Point;
  /**
   * One coordinate, with nothing allocated to carry it. `pointOf` builds a pair
   * per call, which is fine once and expensive inside a loop over everything a
   * being can see — which is where this world's reflex policy spends its time.
   *
   * UNGUARDED, deliberately, and the only two things here that are. They are
   * this plane's own private readers, called from this world's own body and
   * policy with places this world minted a few lines earlier, and they sit in
   * the innermost loop of every tick. `pointOf` — the same read, cold — IS
   * guarded, and so is every door an edge or another world can reach.
   *
   * "Unguarded" now means only that a foreign place reaches them as the raw
   * `TypeError` the field read throws rather than as a `ForeignPlaceError`.
   * They are still class statics reading `#x` directly, so nothing gets a
   * coordinate out of them that did not already have one.
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
 * being remembers.
 *
 * SO IS A PLACE WHOSE COORDINATE IS NOT A NUMBER. A host may author an event
 * carrying `x: "5"` or `y: null`, and until round 4 a witness of one formed NO
 * MEMORY AT ALL, where `c727af7` formed one and stored exactly what was written
 * (W1-B4 verifier, round 1 item 8). That is why the fields below are `unknown`
 * rather than `number | undefined`: the handle carries what the world put in it,
 * and every expression that reads one coerces exactly as the code it replaced
 * did (`Math.round("5")` is 5, `"5" - 3` is 2). `test/world-space.test.ts` pins
 * the four shapes against a fixture captured in the base checkout.
 */
export function createPlaneSpace(): PlaneSpace {
  /**
   * THE ONE PLACE THIS WORLD'S GEOMETRY LIVES. Nothing outside this class body
   * can read `#x`/`#y` — not another world, not a cast, not reflection.
   */
  class Place {
    readonly #x: unknown;
    readonly #y: unknown;

    constructor(x: unknown, y: unknown) {
      this.#x = x;
      this.#y = y;
      // SEALED, NOT FROZEN, and the difference is 2.4 points of tick rate
      // (round 4). An instance has no own property to freeze AGAINST reading —
      // the state is `#private` and the prototype is null — so what either call
      // buys is the same one thing: `p.x = 900.5` may not ADD a property, so
      // writing to a place and reading it back yields nothing and
      // `Object.keys(p)` stays empty (`world-space.test.ts`, route 30). That is
      // `preventExtensions`' whole job; `Object.freeze` also walks and reseals
      // every own property, of which there are none, and it cost 2.4% of ticks
      // per second at a thousand beings because a place is minted for every
      // entity a being perceives. Measured both ways: freeze −7.5%,
      // preventExtensions −5.1%, neither −5.0%.
      Object.preventExtensions(this);
    }

    /** The ownership test: unforgeable, untrappable, and exact to this class. */
    static owns(value: unknown): boolean {
      return typeof value === 'object' && value !== null && #x in value;
    }

    /**
     * THE SLOW PATH, AND ONLY THE SLOW PATH. Something below threw; say which
     * argument was not ours, or hand back the original error untouched.
     *
     * The second half matters as much as the first. A place of this world may
     * hold anything the world put in it — `"5"`, `null`, a `Symbol` a host cast
     * its way — and `Math.round` of a `Symbol` throws a `TypeError` that is not
     * about ownership at all. Base threw exactly that error; so does this.
     */
    static #refuse(op: string, error: unknown, args: readonly unknown[]): unknown {
      for (let i = 0; i < args.length; i++) {
        if (!Place.owns(args[i])) return new ForeignPlaceError(op, i + 1);
      }
      return error;
    }

    /**
     * ── THE FIVE A MIND MAY ASK ──────────────────────────────────────────────
     *
     * Every expression is the one `prompt.ts` and `SuccessionMiner` wrote,
     * operation for operation and in the same order, down to which operand is
     * read first: a rounding boundary that moves moves a think cadence and the
     * whole run diverges.
     *
     * Which read THREW is not which argument is refused. `distance` reads `b`
     * first, so a foreign `a` surfaces second; `#refuse` asks ownership in
     * ARGUMENT order and names argument 1 anyway.
     */
    static distance(a: PlaceRef, b: PlaceRef): number {
      const from = a as unknown as Place;
      const to = b as unknown as Place;
      try {
        return Math.hypot((to.#x as number) - (from.#x as number), (to.#y as number) - (from.#y as number));
      } catch (error) {
        throw Place.#refuse('distance', error, [a, b]);
      }
    }

    static direction(a: PlaceRef, b: PlaceRef): DirectionId {
      const from = a as unknown as Place;
      const to = b as unknown as Place;
      try {
        return compass((to.#x as number) - (from.#x as number), (to.#y as number) - (from.#y as number));
      } catch (error) {
        throw Place.#refuse('direction', error, [a, b]);
      }
    }

    /**
     * Squares, never a root — `SuccessionMiner`'s own comparison, so the boolean
     * is the same boolean for every pair of places it has ever been asked about.
     * This is the hottest guarded op in the engine: it runs once per live
     * pending cause per memory observed.
     */
    static within(a: PlaceRef, b: PlaceRef, radius: number): boolean {
      const here = a as unknown as Place;
      const there = b as unknown as Place;
      try {
        const dx = (here.#x as number) - (there.#x as number);
        const dy = (here.#y as number) - (there.#y as number);
        return !(dx * dx + dy * dy > radius * radius);
      } catch (error) {
        throw Place.#refuse('within', error, [a, b]);
      }
    }

    static equal(a: PlaceRef, b: PlaceRef): boolean {
      const one = a as unknown as Place;
      const two = b as unknown as Place;
      try {
        return one.#x === two.#x && one.#y === two.#y;
      } catch (error) {
        throw Place.#refuse('equal', error, [a, b]);
      }
    }

    /** What `prompt.ts` has always written in the parentheses. */
    static label(place: PlaceRef): string {
      const p = place as unknown as Place;
      try {
        return `${Math.round(p.#x as number)},${Math.round(p.#y as number)}`;
      } catch (error) {
        throw Place.#refuse('label', error, [place]);
      }
    }

    /** ── THE TWO AN EDGE MAY ASK, guarded the same way ────────────────────── */
    static encode(place: PlaceRef): Record<string, unknown> {
      const p = place as unknown as Place;
      try {
        const x = p.#x;
        const y = p.#y;
        const out: Record<string, unknown> = {};
        if (x !== undefined) out['x'] = x;
        if (y !== undefined) out['y'] = y;
        return out;
      } catch (error) {
        throw Place.#refuse('encode', error, [place]);
      }
    }

    static point(place: PlaceRef): Point {
      const p = place as unknown as Place;
      try {
        return { x: p.#x as number, y: p.#y as number };
      } catch (error) {
        throw Place.#refuse('pointOf', error, [place]);
      }
    }

    /** ── THIS WORLD'S OWN READERS. Unguarded; see `PlaneSpace.xOf`. ───────── */
    static readX(place: PlaceRef): unknown {
      return (place as unknown as Place).#x;
    }

    static readY(place: PlaceRef): unknown {
      return (place as unknown as Place).#y;
    }

    static xOf(place: PlaceRef): number {
      return (place as unknown as Place).#x as number;
    }

    static yOf(place: PlaceRef): number {
      return (place as unknown as Place).#y as number;
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
   *  and nowhere else: only `decode` and `placeOf` build those. */
  const mint = (x: unknown, y: unknown): PlaceRef => new Place(x, y) as unknown as PlaceRef;
  const at = (x: number, y: number): PlaceRef => mint(x, y);
  const owns = Place.owns;
  const readX = Place.readX;
  const readY = Place.readY;

  /**
   * THE OPS ARE THE CLASS'S OWN FUNCTIONS, put on an object — not wrapped in
   * one. `space.within(a, b, r)` is one call into one frame that reads two
   * private fields; there is no `owns` call, no forwarding closure and no
   * second object shape between the mind and the arithmetic.
   *
   * None of them reads `this`, so detaching them here is sound —
   * `test/world-space.test.ts` pins the identity, which is what keeps a wrapper
   * from growing back.
   */
  const ops: SpaceOps = {
    directions: DIRECTIONS,
    /** The origin — what `AgentMind` wrote for a story retold with no site. */
    unplaced: at(0, 0),

    distance: Place.distance,
    direction: Place.direction,
    within: Place.within,
    equal: Place.equal,
    label: Place.label,
  };

  const codec: SpaceCodec = {
    /** The two numbers this world's acts have always been written with — and
     *  `number`, so `x: 1e999` is still `bad-number` about `x`. */
    fields: PLANE_FIELDS,

    encode: Place.encode,

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
      const mine = owns(value);
      const x = mine ? readX(value as unknown as PlaceRef) : (value as { x?: unknown }).x;
      const y = mine ? readY(value as unknown as PlaceRef) : (value as { y?: unknown }).y;
      // Each coordinate is the number the parser would have carried through, and
      // at least one of them is there — which is the half-written act above.
      const usable = (v: unknown): boolean => v === undefined || (typeof v === 'number' && Number.isFinite(v));
      return usable(x) && usable(y) && !(x === undefined && y === undefined);
    },

    /**
     * Anything this world puts in the plane: a `SimEvent`, a body's transform, a
     * thing seen. It reads its own two fields off its own carrier — which is
     * exactly the reach a mind no longer has.
     *
     * A CARRIER THAT HAS EITHER FIELD IS SOMEWHERE, whatever is written there.
     *
     * Round 3 asked for two `number`s, which is what a body always writes — and
     * which silently deleted the memory a witness of a HOST-AUTHORED event used
     * to form when the host wrote `{x:5}`, `{y:6}`, `{x:"5",y:6}` or
     * `{x:5,y:null}` (verifier round 1, item 8). `c727af7` did not ask: it
     * copied `event.x` and `event.y` onto the memory unconditionally, so a
     * witness always remembered WHERE, even when where was `undefined`. This is
     * that, and nothing more: the place carries exactly what the carrier had.
     *
     * Downstream nothing moves, which is why it is safe to restore. `encode`
     * writes only the fields that are not `undefined`, so a place of nothing
     * stores as `{}` — which is what `{x: undefined, y: undefined}` has always
     * become on the way to disk. `SuccessionMiner`'s proximity test compares
     * `NaN` and therefore constrains nothing, which is what base's "both
     * coordinates must be defined" guard also did. `test/world-space.test.ts`
     * pins the shapes against a fixture captured at `c727af7`.
     *
     * ONE DELIBERATE DIVERGENCE, named: a carrier with NEITHER field is nowhere
     * here and was a place-of-nothing at base. `SimEvent` declares both fields
     * required, so no host can author one — but a FOREIGN HANDLE is an object
     * with no own `x` or `y`, and minting a place out of one would mean this
     * world claiming to know where another world's place is. "A stranger is
     * nowhere" is the better answer and it is the one the edge already gives
     * (`isPlace`, `owns`).
     */
    placeOf(carrier) {
      if (carrier === null || typeof carrier !== 'object') return undefined;
      const held = carrier as { x?: unknown; y?: unknown };
      if (!('x' in held) && !('y' in held)) return undefined;
      return mint(held.x, held.y);
    },

    owns,
  };

  // Not a wrapper any more: `defineSpace` CHECKS that each entry point above
  // refuses a place this plane did not mint, and hands back what it was given.
  const verified = defineSpace({ ops, codec });
  return {
    space: verified.space,
    codec: verified.codec,
    at,
    pointOf: Place.point,
    xOf: Place.xOf,
    yOf: Place.yOf,
  };
}
