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
 * ─── THE THREAT MODEL, STATED ONCE (W1-B4 round 4) ───────────────────────────
 *
 * Three rounds of a hostile verifier were spent re-discovering that a defence
 * written down vaguely is a defence that gets re-litigated, so this is the whole
 * claim and the whole of what is NOT claimed. The same paragraph is in
 * `docs/rework/W1-B-worldadapter.md`; if the two ever disagree, this one is the
 * code and wins.
 *
 * WHAT IS NOT CLAIMED. Same-process TypeScript cannot sandbox deliberate code.
 * A file that WANTS a coordinate and is willing to write `node:inspector`,
 * `eval`, or a patch to this file will get one. Nothing below is a capability
 * boundary in the operating-system sense and nothing below should ever be cited
 * as one.
 *
 * WHAT IS CLAIMED: the mind cannot couple itself to one world's geometry BY
 * ACCIDENT — by reaching for the obvious thing, by a convenience import, by a
 * cast someone wrote to silence the compiler. Three facts hold that line:
 *
 *  (i)  **A held place reveals nothing to any language operation.** A world
 *       mints places as instances of its own class whose whole state is
 *       ECMAScript `#private` fields. `Object.keys/values/entries`, spread,
 *       `for…in`, `Object.assign`, `structuredClone`, `v8.serialize`,
 *       `JSON.stringify`, `Reflect.ownKeys`,
 *       `getOwnPropertyNames/Symbols/Descriptors` and `p?.[K]` all come back
 *       empty; the prototype is emptied, so `constructor` — and with it `new`,
 *       and with `new` the minting that made round 2's triangulation work — is
 *       gone; `${p}`, `p + 1` and `String(p)` throw rather than render; and no
 *       error message anywhere carries a coordinate.
 *  (ii) **No importable function turns places or spaces into coordinates, or
 *       numbers into places.** The codec is not looked up, it is HANDED OVER:
 *       `defineSpace` returns it to the world factory, the world factory puts it
 *       in `WorldEdges`, and the host wiring passes that object to exactly the
 *       edge components that parse, serialise, gate or instrument. There is no
 *       registry to import, so widening a lookup's type (round 3's one cast)
 *       has nothing to widen. `test/mind-type-graph.test.ts` proves the negative
 *       STRUCTURALLY: the mind's transitive import closure contains no
 *       declaration of the codec or of a plane's readers, and neither does the
 *       type graph of anything a mind is constructed with.
 *  (iii)**Ownership is unforgeable, per world INSTANCE.** `#x in value` is an
 *       exact brand test only the minting class can perform: no Proxy traps it,
 *       no prototype inherits it, and two worlds built on the same plane refuse
 *       each other's places (`ForeignPlaceError`). Every `SpaceOps` entry point
 *       and every codec entry point that takes a place checks it.
 *
 * DECLARED RESIDUALS, each with the step that closes it. These are holes, they
 * are known, and a hole that is written down is cheaper than a guard that does
 * not hold:
 *
 *  · **`label(place)` renders text a mind can parse** — `"900,120"` on a plane.
 *    Round 3 evaded a narrowed static guard on it five ways without a single
 *    cast, so the guard has been DELETED rather than left as decoration.
 *    `test/mind-no-geometry.test.ts` pins the residual as still-yielding, so
 *    B5 closing it (places get WORDS, not coordinates) is a visible change.
 *    OWNER: B5, the lexicon.
 *  · **The wire FIELD NAMES are in the prompt.** `MoveTo{x,y}` is in the
 *    argument paragraph every model has always been shown, so the names are
 *    readable from a mind by construction. They are names, not values, and they
 *    are prose. OWNER: B5, with the rest of the paragraph.
 *  · **`SimEvent` still carries `x`/`y`** (`contract/types.ts`). It is a TYPE
 *    surface: exactly one mind file mentions `SimEvent` and it reads no
 *    coordinate off one. OWNER: B6, with the per-world instrument.
 *  · **`node:inspector` reads `#x` directly** (`Runtime.getProperties` →
 *    `privateProperties`, no flags). It is out of reach from `src/` only
 *    because the engine's tsconfig ships no node types — an accident, not a
 *    defence. Deliberate code was never in scope (see WHAT IS NOT CLAIMED).
 *  · **Mind and worlds are one package.** Import bans are checked by tests, not
 *    enforced by a module system. OWNER: W1-C, packaging.
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
 * name is a thing a mind need never say. The defence is fact (i) above.
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
 * is MADE of, and there is deliberately no way to get from here to the codec —
 * which now means what it says, because the codec is not reachable from
 * anything this file exports (fact (ii) above).
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
   * also when this stops being parseable text — the first declared residual in
   * the header.
   */
  label(place: PlaceRef): string;
}

/**
 * A PLACE FROM SOMEWHERE ELSE, REFUSED OUT LOUD (W1-B4 verifier, backlog 4,
 * round 2 FAIL 2 and round 3 FAIL 2).
 *
 * A place carries no world tag, and until this existed nothing noticed when one
 * world was handed another's: `equal` returned TRUE for two places that are not
 * the same place and were never in the same world, `distance` answered `0` or
 * `NaN`, and `label` — which `prompt.ts` splices into a prompt a model is paid
 * to read — produced `"NaN,NaN"` or `undefined`. Silent garbage, in the one
 * comparison a mind is allowed to make.
 *
 * THE CHOICE, stated so it is not rediscovered: every entry point that takes a
 * place THROWS. It does not substitute `unplaced` and it does not count and
 * carry on, because both of those answer a question that was never asked — a
 * mind that reached the wrong world has a bug, and a bug that returns a
 * plausible number is the expensive kind. W1-C puts two worlds in one process;
 * this is what it will hit instead of a wrong answer.
 *
 * ROUND 3 FOUND THE HALF THAT WAS MISSING: `SpaceOps` was gated and the CODEC
 * was not, so a foreign place at a serialisation seam produced a raw
 * `TypeError: Cannot read private member #x…` with no op, no argument and no
 * mention of worlds. Every codec entry point taking a place is inside the gate
 * now (`defineSpace`, `contract/edges.ts`).
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
