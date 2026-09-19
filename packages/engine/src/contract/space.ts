import type { ParamSchema } from './actions.js';

/**
 * WHERE THINGS ARE, WITHOUT THE MIND KNOWING WHERE (W1-B4).
 *
 * A modern town's space is a street graph, a voxel sandbox is three
 * dimensions, the forager continent is a plane. A mind that can live in any of
 * them may not hold a coordinate, may not subtract one from another and may not
 * decide that the answer is "north": it holds an opaque `PlaceRef` and asks the
 * world the two questions it genuinely has — how far, and which way.
 *
 * `SpaceOps` is DATA + PURE FUNCTIONS, like `TimeOps` beside it. Nothing here
 * is a callback the mind asks for a decision: `distance` is a projection of two
 * places, not a choice, and `direction` names a direction this world declares
 * rather than describing one. Nothing here may be shown to a mind as a fact.
 *
 * ─── WHY THIS FILE IS SHAPED THE WAY IT IS (W1-B4 verifier, round 2) ─────────
 *
 * Round 2 wrote 22 routes out of the handle that all COMPILED, including a full
 * Euclidean distance made of `Object.values`, and two that needed no reflection
 * at all: `space.encode(p)` and `space.decode({x, y})` — the codec's own doors,
 * standing open on the object the mind is handed. A nominal TYPE cannot close
 * them. `const o: object = p` is legal for any object, and no checker rule will
 * ever enumerate every widening.
 *
 * So the defence is two RUNTIME facts and one narrowed static guard:
 *
 *  1. **The handle is opaque at runtime.** A world mints places as instances of
 *     its own class whose whole state is ECMAScript `#private` fields. There is
 *     nothing for `Object.keys/values/entries`, spread, `for…in`,
 *     `Object.assign`, `structuredClone`, `JSON.stringify`, `Reflect.ownKeys`,
 *     `getOwnPropertyNames/Symbols/Descriptors` or `p?.[K]` to find, and the
 *     prototype is emptied so not even `constructor` is reachable.
 *  2. **Ownership is per WORLD INSTANCE.** `#x in v` is an exact, unforgeable
 *     brand check that only the minting class can perform, so two PLANAR worlds
 *     — and W1-C's town is planar — refuse each other's places. The old gate
 *     asked "does it carry any of my field names", which made `{x:3,y:9}` a
 *     forager place and answered `distance 1080.41` about it.
 *  3. **What the mind may ask is a different OBJECT from what the edges may
 *     do.** `SpaceOps` below is the whole of a mind's reach. `SpaceCodec` is the
 *     edges' — and it is reachable only through `codecFor`, a module-level
 *     lookup, never as a property of the `WorldAdapter` a mind is handed. Routes
 *     20–22 are gone by construction rather than by lint.
 *
 * WHAT IS STILL OPEN, named here so it is not rediscovered as a hole:
 *  · `label(place)` renders this world's own writing of a place, which on a
 *    plane is `"900,120"` — text a mind could parse. It stays until B5 gives
 *    places WORDS, because the prompt's bytes must not move in this step. The
 *    static guard narrows it: in a mind directory a `label` result may only
 *    flow into string concatenation or a template.
 *  · `SimEvent` still carries this world's `x`/`y` (`contract/types.ts`), which
 *    a mind file holding a `SimEvent` can read. That is B6's, with the rest of
 *    the per-world instrument.
 */

/**
 * A PLACE, AS A MIND HOLDS ONE — opaque, and comparable only through the world
 * that minted it.
 *
 * It is a TYPE WITH NO MEMBER and NO RUNTIME OF ITS OWN. The brand below is a
 * property keyed by a `unique symbol` this module does not export, so
 * `const p: PlaceRef = {}` is a compile error (TS2739) and the only way to
 * produce a place is the cast a world makes in its own space module. The
 * contract deliberately gains no class: WHAT a place is made of is the world's,
 * and a base class here would be one more thing every world shares and every
 * mind could reach.
 *
 * The nominal brand is the first line and NOT the defence — round 2 proved a
 * name is a thing a mind need never say. The defence is that the runtime value
 * a world hands over has nothing on it (see the block above).
 *
 * **Not `===` comparable in any meaningful way.** Two places that are the same
 * place are usually two objects, so `equal` is the only answer, and it is the
 * world's.
 */
declare const placeBrand: unique symbol;

export interface PlaceRef {
  readonly [placeBrand]: 'place';
}

/**
 * One direction this world names. The forager continent's are its compass
 * words; a town's might be `upstreet`/`downstreet`, and a graph world's might
 * be the name of the next junction. B5 turns an id into the WORD a being reads;
 * until then the forager world's ids are its words, which is what keeps this
 * step byte-identical.
 */
export type DirectionId = string;

/**
 * WHAT A MIND MAY ASK ABOUT PLACE, and the whole of it.
 *
 * This is the object on `WorldAdapter.space`. Every member is a question with a
 * scalar or a word for an answer; not one of them hands back anything a place
 * is MADE of, and there is deliberately no way to get from here to the codec.
 */
export interface SpaceOps {
  /**
   * Every direction this world can name, in declared order. A closed set, so
   * a lexicon can be checked against it — and so the mind can be shown that
   * "north" is not a fact about space but a word this world happens to have.
   */
  readonly directions: readonly DirectionId[];
  /**
   * WHERE THIS WORLD FILES SOMETHING THAT HAPPENED NOWHERE IT CAN NAME — a
   * tale retold with no site attached to it. The mind has no way to invent one
   * and used to write `0, 0` (`AgentMind.observe`), which is the same move
   * `emptyContext` took away from `injectIdea`. Declared, not neutral: on the
   * forager plane it is the origin, which is a REAL place a being can walk to,
   * and keeping it that is what makes this step behaviour-neutral. That it is
   * real is a finding for W1-D, not a thing to quietly fix here.
   *
   * It is a place this world genuinely MINTED, so it passes its own ownership
   * check like any other.
   */
  readonly unplaced: PlaceRef;

  /** How far apart, in this world's own units. */
  distance(a: PlaceRef, b: PlaceRef): number;
  /** Which way `to` lies from `from`. */
  direction(from: PlaceRef, to: PlaceRef): DirectionId;
  /**
   * Is `b` no further than `radius` from `a`? Asked rather than derived from
   * `distance`, because the answer is a BOOLEAN a world may reach by its own
   * arithmetic — the forager continent compares squares and never takes a root,
   * and rebuilding it out of `distance` would move a comparison boundary.
   */
  within(a: PlaceRef, b: PlaceRef, radius: number): boolean;
  /** The same place? The only comparison a mind is allowed to make. */
  equal(a: PlaceRef, b: PlaceRef): boolean;
  /**
   * How this world writes a place down for a reader. GEOMETRY → WORDS is the
   * world's, like `direction`: the forager continent writes a rounded pair of
   * coordinates because that is what its prompt has always said. The SENTENCE
   * around it is still `prompt.ts`'s and moves to the lexicon at B5, which is
   * also when this stops being parseable text (see the header).
   */
  label(place: PlaceRef): string;
}

/**
 * WHAT THE EDGES MAY DO WITH A PLACE — and nothing in the mind can reach it.
 *
 * A parser reading a model's JSON, a body being handed a plan, a recorder
 * writing a row, an IPC gate deciding whether untrusted JSON could be a place,
 * an instrument plotting where a story is anchored: each of these genuinely has
 * to open or build one. None of them is the mind, and the way they ask is
 * `codecFor(world.space)` — a module-level lookup, not a property of anything a
 * mind is handed.
 */
export interface SpaceCodec {
  /**
   * The WIRE fields one place is written as, in the order they are written,
   * each TYPED as an argument in its own right. World data: the forager plane
   * writes two numbers `x`,`y`; a world with no plane writes one named spot.
   *
   * Typed rather than merely named, because the parser has to hold each of them
   * to something — `{"kind":"MoveTo","x":1e999}` is `bad-number` about `x`, and
   * a spot outside the world's list is `bad-arg` about the spot — and which of
   * the two it is is a fact about the world's space, not about parsing.
   */
  readonly fields: readonly ParamSchema[];

  /** The wire fields this place is written as, ready to be spliced into a row. */
  encode(place: PlaceRef): Record<string, unknown>;
  /**
   * …and back. Reads only `fields`, and returns a place carrying exactly those
   * that were there: a model may write half of one, and half of one is what
   * reached the body before this step existed. Undefined when none were.
   */
  decode(fields: Record<string, unknown>): PlaceRef | undefined;
  /** Could this value be a place here? The edge's question, not the body's. */
  isPlace(value: unknown): boolean;
  /**
   * The place of something this world knows — an event, a snapshot, a thing
   * seen. The world reads its own geometry off its own carrier and hands back
   * a handle; this is the one bridge from a world's data into a mind's, and it
   * goes one way. Undefined when the thing is nowhere in particular.
   */
  placeOf(carrier: unknown): PlaceRef | undefined;
  /**
   * DID THIS WORLD MINT THIS VALUE? The ownership check, and the one question
   * only the minting module can answer: on a class with `#private` state it is
   * `#x in value`, which nothing can forge, nothing can trap and no other
   * world's places satisfy — including another world built on the same plane.
   *
   * It is NOT `isPlace`. `isPlace` is the EDGE's question about untrusted JSON
   * and answers strictly: `{x: NaN}` is nonsense a model wrote. But a world
   * MINTS non-finite and half-written places of its own — an event authored
   * with a NaN coordinate becomes a memory whose site renders into a prompt —
   * so a gate built on `isPlace` would throw inside runs that have always
   * worked. Ownership and usability are different questions.
   */
  owns(value: unknown): boolean;
}

/** The names of the wire fields a place is written as, in the order written. */
export function placeFieldNames(codec: SpaceCodec): string[] {
  return codec.fields.map((field) => field.id);
}

/**
 * A PLACE FROM SOMEWHERE ELSE, REFUSED OUT LOUD (W1-B4 verifier, backlog 4 and
 * round 2 FAIL 2).
 *
 * A place carries no world tag, and until this existed nothing noticed when one
 * world was handed another's: `equal` returned TRUE for two places that are not
 * the same place and were never in the same world, `distance` answered `0` or
 * `NaN`, and `label` — which `prompt.ts` splices into a prompt a model is paid
 * to read — produced `"NaN,NaN"` or `undefined`. Silent garbage, in the one
 * comparison a mind is allowed to make.
 *
 * THE CHOICE, stated so it is not rediscovered: every `SpaceOps` entry point
 * that takes a place THROWS. It does not substitute `unplaced` and it does not
 * count and carry on, because both of those answer a question that was never
 * asked — a mind that reached the wrong world has a bug, and a bug that returns
 * a plausible number is the expensive kind. W1-C puts two worlds in one process;
 * this is what it will hit instead of a wrong answer.
 */
export class ForeignPlaceError extends Error {
  override readonly name = 'ForeignPlaceError';

  constructor(
    /** The entry point that was asked. */
    readonly op: string,
    /** Which argument it was, by position, counted from 1. */
    readonly argument: number,
  ) {
    super(`space.${op}: argument ${argument} is not a place of this world`);
  }
}

/** A world's whole space: the mind's half and the edges' half, built together. */
export interface SpaceDefinition {
  readonly ops: SpaceOps;
  readonly codec: SpaceCodec;
}

/**
 * THE CODEC IS NOT ON THE ADAPTER, AND THIS IS WHERE IT LIVES INSTEAD.
 *
 * A `WeakMap` keyed by the guarded `SpaceOps` a world publishes. An edge that
 * holds a world asks `codecFor(world.space)`; a mind holds the same world and
 * has no expression of the codec's type and no import of this function — which
 * is what `test/mind-no-geometry.test.ts` enforces, by file and function, with
 * the allow-listed names asserted to occur exactly once in their file so the
 * list cannot be widened by adding a second function with the same name (round
 * 2 did exactly that to `record/serialize.ts:asPlace`).
 */
const CODECS = new WeakMap<SpaceOps, SpaceCodec>();

/**
 * ONE WORLD'S SPACE, WITH THE DOOR SHUT. A world builds its ops and its codec
 * and hands both here; what comes back is the `SpaceOps` it publishes, wrapped
 * so every entry point taking a place refuses one this world did not mint.
 *
 * It wraps rather than being written into each world because the check is not a
 * fact about any world: a world says WHAT its places are (`codec.owns`), and
 * this says that nothing else may be passed off as one.
 *
 * UNTHROWABLE BY CONSTRUCTION. `owns` is a private-brand test, which reads no
 * property, invokes no getter and is not a Proxy trap — so a place whose `x` is
 * a throwing getter, a revoked Proxy and a `Proxy` that lies about its own keys
 * are all simply NOT OWNED, and come back as `ForeignPlaceError` rather than as
 * whatever the trap felt like throwing (round 2 FAIL 2, last paragraph).
 */
export function defineSpace(definition: SpaceDefinition): SpaceOps {
  const { ops, codec } = definition;
  const check = (op: string, argument: number, value: PlaceRef): void => {
    if (!codec.owns(value)) throw new ForeignPlaceError(op, argument);
  };
  const guarded: SpaceOps = {
    directions: ops.directions,
    unplaced: ops.unplaced,
    distance(a, b) {
      check('distance', 1, a);
      check('distance', 2, b);
      return ops.distance(a, b);
    },
    direction(from, to) {
      check('direction', 1, from);
      check('direction', 2, to);
      return ops.direction(from, to);
    },
    within(a, b, radius) {
      check('within', 1, a);
      check('within', 2, b);
      return ops.within(a, b, radius);
    },
    equal(a, b) {
      check('equal', 1, a);
      check('equal', 2, b);
      return ops.equal(a, b);
    },
    label(place) {
      check('label', 1, place);
      return ops.label(place);
    },
  };
  Object.freeze(guarded);
  CODECS.set(guarded, codec);
  return guarded;
}

/**
 * THE EDGE'S WAY IN. Throws rather than returning undefined: a space that was
 * not built by `defineSpace` has no ownership check either, so a caller handed
 * one would be writing rows with no idea whose places they are.
 */
export function codecFor(space: SpaceOps): SpaceCodec {
  const codec = CODECS.get(space);
  if (!codec) {
    throw new Error('space: this SpaceOps was not built by defineSpace, so it has no codec and no owner');
  }
  return codec;
}
