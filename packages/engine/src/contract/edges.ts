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
 * EVERY ENTRY POINT THAT TAKES A PLACE IS INSIDE THE OWNERSHIP GATE
 * (`defineSpace`), so a place from another world reaches `ForeignPlaceError`
 * and not a raw `TypeError: Cannot read private member #x…` (round 3 FAIL 2).
 * `decode`, `placeOf`, `isPlace` and `owns` are not gated because they do not
 * take a place: they take untrusted JSON, a world's own carrier, or anything at
 * all, and answering "no" is their job.
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

/** What `defineSpace` hands back: both halves, each with the gate around it. */
export interface GuardedSpace {
  /** Published on the adapter. Refuses a place this world did not mint. */
  readonly space: SpaceOps;
  /** Handed to the edges, and to nothing else. Refuses one too. */
  readonly codec: SpaceCodec;
}

/**
 * ONE WORLD'S SPACE, WITH THE DOOR SHUT. A world builds its ops and its codec
 * and hands both here; what comes back is the pair it publishes, each entry
 * point that takes a place wrapped so it refuses one this world did not mint.
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
 *
 * IT RETURNS THE CODEC RATHER THAN FILING IT. The round-3 version put it in a
 * `WeakMap` keyed by the guarded ops and exported the lookup; see the header for
 * what one cast then did with that.
 */
export function defineSpace(definition: SpaceDefinition): GuardedSpace {
  const { ops, codec } = definition;
  const owns = codec.owns;
  const check = (op: string, argument: number, value: PlaceRef): void => {
    if (!owns(value)) throw new ForeignPlaceError(op, argument);
  };
  const space: SpaceOps = {
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
  const guardedCodec: SpaceCodec = {
    fields: codec.fields,
    encode(place) {
      check('encode', 1, place);
      return codec.encode(place);
    },
    decode: codec.decode,
    isPlace: codec.isPlace,
    placeOf: codec.placeOf,
    owns,
  };
  Object.freeze(space);
  Object.freeze(guardedCodec);
  return { space, codec: guardedCodec };
}
