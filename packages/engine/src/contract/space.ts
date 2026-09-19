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
 */

/**
 * A PLACE, AS A MIND HOLDS ONE — opaque, serialisable, and comparable only
 * through the world that minted it.
 *
 * It is a TYPE with no readable member rather than a number, a pair or a
 * string, and every part of that is load bearing:
 *
 *  · **No member.** `place.x` is a compile error in every mind directory, which
 *    is what `test/world-tables-out.test.ts` then only has to double-check
 *    rather than be the sole line of defence for.
 *  · **Its RUNTIME value is the world's own datum**, so a world can round-trip
 *    a place exactly: the forager continent mints `{x, y}` and gets back the
 *    same two floats, bit for bit, which is why a corpus row recorded before
 *    this step and after it are the same bytes. A handle into a side table
 *    would not survive a JSON round trip, and a stringified form would not
 *    survive a float.
 *  · **Nominally branded, and REQUIRED.** The brand below is a property keyed by
 *    a `unique symbol` this module does not export, so no other file can write
 *    one — `const p: PlaceRef = {}` and every other object literal is a compile
 *    error (TS2739: the brand is missing), and the only way to produce a place
 *    is the cast a world makes in its own space module, in `worlds/**`, where a
 *    reader can see it. It was OPTIONAL until the W1-B4 verifier pointed out
 *    that an optional brand is no brand at all: `{}` satisfied it, so any mind
 *    could MINT a place with no cast and hand it to `SpaceOps` (verifier, the
 *    second fail). The runtime value is unchanged — the brand is declared, never
 *    assigned — so JSON, corpus bytes and every float are what they were.
 *  · **Not `===` comparable in any meaningful way.** Two places that are the
 *    same place are usually two objects, so `equal` is the only answer, and it
 *    is the world's.
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

/** How this world answers a mind's questions about place. */
export interface SpaceOps {
  /**
   * Every direction this world can name, in declared order. A closed set, so
   * a lexicon can be checked against it — and so the mind can be shown that
   * "north" is not a fact about space but a word this world happens to have.
   */
  readonly directions: readonly DirectionId[];
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
  /**
   * WHERE THIS WORLD FILES SOMETHING THAT HAPPENED NOWHERE IT CAN NAME — a
   * tale retold with no site attached to it. The mind has no way to invent one
   * and used to write `0, 0` (`AgentMind.observe`), which is the same move
   * `emptyContext` took away from `injectIdea`. Declared, not neutral: on the
   * forager plane it is the origin, which is a REAL place a being can walk to,
   * and keeping it that is what makes this step behaviour-neutral. That it is
   * real is a finding for W1-D, not a thing to quietly fix here.
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
   * The place of something this world knows — an event, a snapshot, a thing
   * seen. The world reads its own geometry off its own carrier and hands back
   * a handle; this is the one bridge from a world's data into a mind's, and it
   * goes one way. Undefined when the thing is nowhere in particular.
   */
  placeOf(carrier: unknown): PlaceRef | undefined;
  /**
   * How this world writes a place down for a reader. GEOMETRY → WORDS is the
   * world's, like `direction`: the forager continent writes a rounded pair of
   * coordinates because that is what its prompt has always said. The SENTENCE
   * around it is still `prompt.ts`'s and moves to the lexicon at B5.
   */
  label(place: PlaceRef): string;

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
}

/** The names of the wire fields a place is written as, in the order written. */
export function placeFieldNames(space: SpaceOps): string[] {
  return space.fields.map((field) => field.id);
}

/**
 * A PLACE FROM SOMEWHERE ELSE, REFUSED OUT LOUD (W1-B4 verifier, backlog 4).
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

/**
 * ONE WORLD'S SPACE, WITH THE DOOR SHUT. Wraps a world's own `SpaceOps` so that
 * every entry point taking a place refuses one this world did not mint.
 *
 * It wraps rather than being written into each world because the check is not a
 * fact about any world: a world says WHAT its places are, and this says that
 * nothing else may be passed off as one. `placeOf`, `decode` and `isPlace` take
 * `unknown` by contract and are passed straight through.
 *
 * THE QUESTION IS OWNERSHIP, NOT USABILITY, and the difference is load-bearing.
 * `isPlace` is the EDGE's question — could this untrusted JSON be a place here —
 * and the forager plane answers it strictly, refusing `{x: NaN}` because a model
 * that writes one has written nonsense. But a world MINTS non-finite places of
 * its own: an event authored with a NaN coordinate becomes a memory whose place
 * is `at(NaN, …)`, that memory's site renders into a prompt, and a row carrying
 * it replays to the bytes that were sent (`test/record.test.ts`, "a non-finite
 * number replays to the bytes that were sent"). Gating on `isPlace` alone throws
 * there — a place this world made, refused by this world. So the gate asks the
 * weaker, correct question: does this value carry any of the fields this world
 * WRITES a place with (`SpaceOps.fields`, the world's own data)? A continent
 * place has `x` or `y`; a toy world's has `spot`; `{}` has neither, and neither
 * does the other world's. Nothing that reaches the arithmetic today is refused,
 * and nothing from another world reaches it at all.
 */
export function guardPlaces(space: SpaceOps): SpaceOps {
  const own = Object.prototype.hasOwnProperty;
  const fields = space.fields.map((field) => field.id);
  const minted = (value: PlaceRef): boolean => {
    if (value === null || typeof value !== 'object') return false;
    if (space.isPlace(value)) return true;
    return fields.some((id) => own.call(value, id));
  };
  const check = (op: string, argument: number, value: PlaceRef): void => {
    if (!minted(value)) throw new ForeignPlaceError(op, argument);
  };
  return {
    directions: space.directions,
    fields: space.fields,
    unplaced: space.unplaced,
    distance(a, b) {
      check('distance', 1, a);
      check('distance', 2, b);
      return space.distance(a, b);
    },
    direction(from, to) {
      check('direction', 1, from);
      check('direction', 2, to);
      return space.direction(from, to);
    },
    within(a, b, radius) {
      check('within', 1, a);
      check('within', 2, b);
      return space.within(a, b, radius);
    },
    equal(a, b) {
      check('equal', 1, a);
      check('equal', 2, b);
      return space.equal(a, b);
    },
    label(place) {
      check('label', 1, place);
      return space.label(place);
    },
    encode(place) {
      check('encode', 1, place);
      return space.encode(place);
    },
    placeOf: (carrier) => space.placeOf(carrier),
    decode: (fields) => space.decode(fields),
    isPlace: (value) => space.isPlace(value),
  };
}
