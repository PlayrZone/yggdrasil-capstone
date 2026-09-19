import type { ParamSchema } from './actions.js';
import type { WorldAdapter } from './adapter.js';
import { ForeignPlaceError } from './space.js';
import type { PlaceRef, SpaceOps } from './space.js';

/**
 * THE EDGES' HALF OF A WORLD'S SPACE — A CAPABILITY, NOT A LOOKUP (W1-B4 round
 * 4).
 *
 * ─── WHY THIS FILE EXISTS AT ALL ─────────────────────────────────────────────
 *
 * Round 3 shipped an opaque place handle that held up against seventeen
 * reflection routes, and beside it left `codecFor(space)` — a module-level
 * `WeakMap` lookup exported from `contract/space.ts`, which every mind file
 * imports from constantly. The guard against a mind using it was a type rule:
 * "no expression in a mind directory may have type `SpaceCodec`". One cast
 * widened the FUNCTION instead of the result —
 *
 *     const opener = codecFor as unknown as (s: SpaceOps) => { encode(p: PlaceRef): Record<string, unknown> };
 *
 * — and no expression in the chain had that type any more. Twenty-two routes
 * compiled with the project's own `tsc` and all three guards green: the full
 * coordinate pair, a bit-exact Euclidean distance, the field names, MINTING via
 * `placeOf`/`decode`, and triangulation of a real place from three `distance`
 * calls. A relay in `contract/` needed no cast whatsoever, because what it
 * exported was already narrower than `SpaceCodec`.
 *
 * The lesson is not "write a better type rule". It is that a DOOR ANY FILE CAN
 * IMPORT is a door, and the only way to be sure a mind cannot open one is for
 * there to be nothing to open. So:
 *
 *  · the registry is gone; there is no `codecFor`, and nothing anywhere maps a
 *    `SpaceOps` back to its codec;
 *  · `defineSpace` HANDS the codec back to the world that built it, once, at
 *    construction;
 *  · the world factory puts it in `WorldEdges` and the host wiring passes that
 *    object to exactly the components that sit at an edge — the wire codec, the
 *    body, the gate, the recorder, the instrument, the lab bridge;
 *  · nothing reachable from a `WorldAdapter`, from `SpaceOps`, or from any
 *    export of `contract/**` produces a codec, a coordinate, or a place built
 *    from numbers.
 *
 * The last point is PROVED rather than asserted: `test/mind-type-graph.test.ts`
 * builds a `ts.Program`, takes the transitive import closure of the seven mind
 * directories, and fails if this file is in it — or if any type reachable from
 * what a mind is constructed with mentions anything declared here. A cast
 * cannot conjure a value that is not in the closure.
 *
 * THIS FILE IS THEREFORE OFF THE MIND'S IMPORT GRAPH BY CONSTRUCTION, and the
 * one file in `contract/` allowed to import it is `contract/wire.ts`, which IS
 * the wire codec. That rule is a test too: a relay here — round 3's route 22 —
 * fails before anyone has to notice a mind imported it.
 */

/**
 * WHAT THE EDGES MAY DO WITH A PLACE.
 *
 * A parser reading a model's JSON, a body being handed a plan, a recorder
 * writing a row, an IPC gate deciding whether untrusted JSON could be a place,
 * an instrument plotting where a story is anchored: each of these genuinely has
 * to open or build one. None of them is the mind, and each is HANDED this by
 * the wiring that built the world.
 *
 * EVERY ENTRY POINT THAT TAKES A PLACE REFUSES A FOREIGN ONE with
 * `ForeignPlaceError` and not a raw `TypeError: Cannot read private member #x…`
 * (round 3 FAIL 2). The refusal is written INSIDE the world's own place class
 * now rather than wrapped around it (round 5 — see `defineSpace`, which checks
 * that it is there). `decode`, `placeOf`, `isPlace` and `owns` are not gated
 * because they do not take a place: they take untrusted JSON, a world's own
 * carrier, or anything at all, and answering "no" is their job.
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
   *
   * The same list is declared on the world's own `place` PARAM
   * (`PlaceParam.fields`), which is what the parser and the prompt's argument
   * paragraph read, because neither of them may hold a codec.
   * `test/world-space.test.ts` pins the two against each other, so they cannot
   * drift.
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
   * goes one way. Undefined when the thing is nowhere this world can name.
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
 * ONE WORLD, AS ITS EDGES HOLD IT — the object the host wiring passes around.
 *
 * It carries the adapter as well as the codec so that an edge component takes
 * ONE argument instead of two that could disagree: `deserializeThinkInput(row,
 * edges)` cannot be handed one world's tables and another's places. A world
 * whose space has its own readers (a plane's `at`/`pointOf`/`xOf`/`yOf`)
 * extends this with them, for its own body, policy and instrument.
 *
 * The direction of the reference matters and is one-way: edges know their
 * adapter, an adapter knows nothing of its edges. That is what keeps a codec
 * unreachable from the object a mind is handed.
 */
export interface WorldEdges {
  readonly adapter: WorldAdapter;
  readonly codec: SpaceCodec;
}

/** A world's whole space: the mind's half and the edges' half, built together. */
export interface SpaceDefinition {
  readonly ops: SpaceOps;
  readonly codec: SpaceCodec;
}

/** What `defineSpace` hands back: the world's own two halves, checked. */
export interface GuardedSpace {
  /** Published on the adapter. Refuses a place this world did not mint. */
  readonly space: SpaceOps;
  /** Handed to the edges, and to nothing else. Refuses one too. */
  readonly codec: SpaceCodec;
}

/**
 * A SPACE WHOSE OPS DO NOT REFUSE A STRANGER — thrown at world construction,
 * out of `defineSpace`, where the mistake is. Not a `ForeignPlaceError`: the
 * argument is fine, the WORLD is wrong.
 */
export class UngatedSpaceError extends Error {
  override readonly name = 'UngatedSpaceError';

  constructor(
    readonly op: string,
    readonly argument: number,
    detail: string,
  ) {
    super(
      `defineSpace: this world's ${op} ${detail} for argument ${argument}. ` +
        `Every entry point that takes a place must throw ForeignPlaceError for a place this world did not mint.`,
    );
  }
}

/**
 * ONE WORLD'S SPACE, CHECKED RATHER THAN WRAPPED (round 5, the perf round).
 *
 * Round 4 wrapped: it built a second `SpaceOps` whose every method asked
 * `codec.owns(a)` and then forwarded to the world's. It was correct, and it
 * cost −3.2% of tick rate at 256 beings and −7.2% at 1,000 against `c727af7`,
 * against a 3% budget — an extra frame and an extra object shape on the hottest
 * question the engine asks (`within`, once per live pending cause per memory
 * observed). Bypassing it measured +0.12%. A CPU profile showed nothing,
 * because there is nothing to see: the cost is shape, not work.
 *
 * So the check moved to where it is free. A world mints its places as instances
 * of its own class with `#private` state, and a static method of that class
 * reading `a.#x` IS the ownership test: on an object the class did not
 * construct, the read throws a `TypeError` natively, and only the `catch`
 * — never taken on the fast path — turns it into `ForeignPlaceError{op,
 * argument}`. See `worlds/plane.ts`.
 *
 * WHAT THIS FUNCTION DOES NOW is make that a rule rather than a convention: it
 * calls every entry point that takes a place, once, with something no world
 * minted, and requires `ForeignPlaceError` naming the right op and the right
 * argument. A future world author who writes `distance` as `a.x - b.x` gets
 * `UngatedSpaceError` the moment their world is built, instead of W1-C's town
 * silently answering for the continent's places (round 2 FAIL 2, which is the
 * whole reason any of this exists).
 *
 * THE PROBE IS ADVERSARIAL, not arbitrary: a frozen object carrying the field
 * names both of today's worlds write a place with. That is exactly the value
 * round 2's gate accepted.
 *
 * It costs ten thrown exceptions per world, once, at construction.
 *
 * IT STILL RETURNS THE CODEC RATHER THAN FILING IT. The round-3 version put it
 * in a `WeakMap` keyed by the guarded ops and exported the lookup; see the
 * header for what one cast then did with that.
 */
export function defineSpace(definition: SpaceDefinition): GuardedSpace {
  const { ops, codec } = definition;

  // Something with the shape of a place and the ownership of nothing. The cast
  // is the point: this is what a caller who ignores the contract passes in.
  const stranger = Object.freeze({ x: 0, y: 0, spot: 'nowhere' }) as unknown as PlaceRef;
  const own = ops.unplaced;
  if (!codec.owns(own)) {
    throw new UngatedSpaceError('unplaced', 0, 'is not a place this world owns, so nothing below could be checked');
  }

  const entries: [string, number, () => unknown][] = [
    ['distance', 1, () => ops.distance(stranger, own)],
    ['distance', 2, () => ops.distance(own, stranger)],
    ['direction', 1, () => ops.direction(stranger, own)],
    ['direction', 2, () => ops.direction(own, stranger)],
    ['within', 1, () => ops.within(stranger, own, 1)],
    ['within', 2, () => ops.within(own, stranger, 1)],
    ['equal', 1, () => ops.equal(stranger, own)],
    ['equal', 2, () => ops.equal(own, stranger)],
    ['label', 1, () => ops.label(stranger)],
    ['encode', 1, () => codec.encode(stranger)],
  ];

  for (const [op, argument, call] of entries) {
    let thrown: unknown;
    try {
      call();
    } catch (error) {
      thrown = error;
    }
    if (thrown === undefined) throw new UngatedSpaceError(op, argument, 'answered for a place it did not mint');
    if (!(thrown instanceof ForeignPlaceError)) {
      throw new UngatedSpaceError(op, argument, `threw ${String((thrown as Error)?.name ?? thrown)}`);
    }
    if (thrown.op !== op || thrown.argument !== argument) {
      throw new UngatedSpaceError(op, argument, `refused as \`${thrown.op}\` argument ${thrown.argument}`);
    }
  }

  Object.freeze(ops);
  Object.freeze(codec);
  return { space: ops, codec };
}
