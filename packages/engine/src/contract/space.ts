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
 *  · **Weakly branded, not nominally.** `PlaceRef` declares one optional member
 *    nothing has, so an object with real fields is not assignable to it and a
 *    world has to say `as unknown as PlaceRef` once, in its own space module,
 *    where a reader can see the cast. The reverse needs a cast too, which is
 *    the asymmetry the whole step is about.
 *  · **Not `===` comparable in any meaningful way.** Two places that are the
 *    same place are usually two objects, so `equal` is the only answer, and it
 *    is the world's.
 */
export interface PlaceRef {
  readonly __place?: never;
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
