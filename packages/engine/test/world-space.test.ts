import { foragerEdges } from '../src/index.js';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  AgentMind,
  ForeignPlaceError,
  buildThinkPrompt,
  createPlaneSpace,
  foragerAdapter,
  at,
  pointOf,
} from '../src/index.js';
// Straight from the edge module rather than the barrel: `defineSpace` is a
// world-construction tool and `UngatedSpaceError` is what it throws at a world
// author. Neither belongs on the public surface a host reads.
import { UngatedSpaceError, defineSpace } from '../src/contract/edges.js';
import type { AgentSnapshot, PlaceRef, SimEvent, SpaceOps, WorldView } from '../src/index.js';
import { memoryFromEvent } from '../src/memory/memoryFromEvent.js';
import { SuccessionMiner } from '../src/learning/SuccessionMiner.js';
import { toyWorld } from './fixtures/toyAdapter.js';
import { TOY_SPOTS, spot, toyCodec } from './fixtures/toySpace.js';
import { mem, resetIds } from './helpers.js';

const places = foragerEdges.codec;
const toyPlaces = toyCodec;

/**
 * W1-B4 — THE MIND STOPPED KNOWING GEOMETRY.
 *
 * Two halves. First: the forager continent's space answers with the exact
 * expressions that used to stand inside the mind, operation for operation, so
 * every comparison lands on the same side of every boundary it ever did. Then:
 * a world that is a graph of named spots runs the same unchanged mind — it
 * remembers a place, is told of one, and asks which way and how far — and
 * nothing of the forager continent is reachable from any of it.
 */

const CTX = { nearWater: false, night: false, inShelter: false, elevationBand: 0 };

// The expressions as they stood in `prompt.ts` and `SuccessionMiner.ts` the
// moment before. Written out, not imported: a transcription is only evidence if
// it is compared against something that cannot move with it.
const wasDistance = (ax: number, ay: number, bx: number, by: number): number => Math.hypot(bx - ax, by - ay);
const wasCompass = (dx: number, dy: number): string => {
  const ns = dy < -4 ? 'north' : dy > 4 ? 'south' : '';
  const ew = dx > 4 ? 'east' : dx < -4 ? 'west' : '';
  return `${ns}${ew}` || 'near here';
};
const wasNear = (ax: number, ay: number, bx: number, by: number, r: number): boolean => {
  const dx = ax - bx;
  const dy = ay - by;
  return !(dx * dx + dy * dy > r * r);
};

const SAMPLES: [number, number][] = [
  [0, 0], [4, 4], [4.0001, -4], [-5, 5], [5, -5], [-3.5, 0], [0, 12], [900, 120], [-0, 0], [1e-9, -1e-9],
];

describe('the forager plane answers exactly as the mind used to', () => {
  it('measures the same distance, bit for bit', () => {
    for (const [ax, ay] of SAMPLES) {
      for (const [bx, by] of SAMPLES) {
        expect(foragerAdapter.space.distance(at(ax, ay), at(bx, by)), `${ax},${ay}->${bx},${by}`).toBe(
          wasDistance(ax, ay, bx, by),
        );
      }
    }
  });

  it('names the same direction, including the four-unit dead zone', () => {
    for (const [ax, ay] of SAMPLES) {
      for (const [bx, by] of SAMPLES) {
        expect(foragerAdapter.space.direction(at(ax, ay), at(bx, by)), `${ax},${ay}->${bx},${by}`).toBe(
          wasCompass(bx - ax, by - ay),
        );
      }
    }
    // Every word it can produce is a word it declares.
    for (const [ax, ay] of SAMPLES) {
      for (const [bx, by] of SAMPLES) {
        expect(foragerAdapter.space.directions).toContain(foragerAdapter.space.direction(at(ax, ay), at(bx, by)));
      }
    }
  });

  it('gives the same boolean at the succession radius, squares and all', () => {
    for (const r of [0, 1, 8, 8.0001]) {
      for (const [ax, ay] of SAMPLES) {
        for (const [bx, by] of SAMPLES) {
          expect(foragerAdapter.space.within(at(ax, ay), at(bx, by), r), `${r}:${ax},${ay}->${bx},${by}`).toBe(
            wasNear(ax, ay, bx, by, r),
          );
        }
      }
    }
  });

  it('reads the miner’s window and radius off the world, and they are the old numbers', () => {
    expect(foragerAdapter.cognitionDefaults.successionWindowTicks).toBe(600);
    expect(foragerAdapter.cognitionDefaults.successionRadius).toBe(8);
    // The miner pairs a cause and an effect 8 apart and refuses one 9 apart —
    // the boundary the constants used to sit on, now the world's.
    resetIds();
    const miner = new SuccessionMiner(foragerAdapter);
    for (const dx of [8, 8]) {
      miner.observe(mem(100, 'SeedDeposited', { place: at(0, 0) }));
      miner.observe(mem(200, 'PlantSprouted', { place: at(dx, 0) }));
    }
    expect(miner.consolidate()).toHaveLength(1);
    const far = new SuccessionMiner(foragerAdapter);
    for (let i = 0; i < 2; i++) {
      far.observe(mem(100, 'SeedDeposited', { place: at(0, 0) }));
      far.observe(mem(200, 'PlantSprouted', { place: at(9, 0) }));
    }
    expect(far.consolidate()).toEqual([]);
  });

  it('writes a place down the way the prompt has always written one', () => {
    expect(foragerAdapter.space.label(at(899.6, 120.4))).toBe('900,120');
  });

  /** The handle round-trips the exact floats, which is why a corpus row did not move. */
  it('round-trips a place through its wire fields exactly', () => {
    for (const [x, y] of [...SAMPLES, [0.1 + 0.2, 1 / 3] as [number, number]]) {
      const written = places.encode(at(x, y));
      expect(written).toEqual({ x, y });
      const back = places.decode(written)!;
      expect(Object.is(pointOf(back).x, x)).toBe(true);
      expect(Object.is(pointOf(back).y, y)).toBe(true);
    }
    // Half a place survives as half a place: a model writes one, and the body
    // has always been the one to answer for it.
    expect(places.encode(places.decode({ x: 5 })!)).toEqual({ x: 5 });
    expect(places.decode({})).toBeUndefined();
    expect(places.decode({ x: 'far' })).toBeUndefined();
  });

  it('compares places by value, because two of the same place are two objects', () => {
    expect(at(3, 4) === at(3, 4)).toBe(false);
    expect(foragerAdapter.space.equal(at(3, 4), at(3, 4))).toBe(true);
    expect(foragerAdapter.space.equal(at(3, 4), at(3, 5))).toBe(false);
  });
});

/**
 * A WORLD THAT IS NOT A PLANE. Four named spots and the ways between them:
 *
 *     hollow ── ridge ── well
 *        │
 *      burrow
 */
describe('the same mind lives in a world with no coordinates in it', () => {
  const ctx = { nearWater: false };

  const snapshot = (place: AgentSnapshot['place']): AgentSnapshot => ({
    id: 1,
    name: 'Toy',
    ageTicks: 50,
    traits: { curiosity: 50, aggression: 10, compassion: 50, ambition: 50, loyalty: 50, riskTolerance: 50 },
    needs: { hunger: 10, rest: 10 },
    health: 100,
    sick: false,
    place,
    inventory: {},
    context: ctx,
  });
  const view = (): WorldView => ({
    tick: 10,
    night: false,
    season: 'always',
    agents: [],
    resources: [],
    structures: [],
  });

  it('measures in hops and points at the next spot along the way', () => {
    expect(toyWorld.space.distance(spot('hollow'), spot('well'))).toBe(2);
    expect(toyWorld.space.distance(spot('burrow'), spot('well'))).toBe(3);
    expect(toyWorld.space.distance(spot('well'), spot('well'))).toBe(0);
    expect(toyWorld.space.direction(spot('burrow'), spot('well'))).toBe('hollow');
    expect(toyWorld.space.direction(spot('hollow'), spot('well'))).toBe('ridge');
    expect(toyWorld.space.direction(spot('well'), spot('well'))).toBe('here');
    expect(toyWorld.space.within(spot('hollow'), spot('well'), 1)).toBe(false);
    expect(toyWorld.space.within(spot('hollow'), spot('well'), 2)).toBe(true);
    // Nothing a plane would answer: no distance here is ever fractional.
    for (const a of TOY_SPOTS) {
      for (const b of TOY_SPOTS) {
        expect(Number.isInteger(toyWorld.space.distance(spot(a), spot(b))), `${a}->${b}`).toBe(true);
      }
    }
  });

  it('remembers WHERE something happened, and can be asked how far away that is', () => {
    const mind = new AgentMind(1, toyWorld);
    // The world's own carrier: this one names a spot where the forager
    // continent's names two numbers. `memoryFromEvent` reads neither.
    const happening = {
      tick: 5,
      type: 'AteFood',
      actorId: 1,
      targetIds: [],
      spot: 'well',
      payload: {},
    } as unknown as SimEvent;
    const memory = memoryFromEvent(toyWorld, happening, 1, ctx, toyPlaces.placeOf(happening))!;
    expect(memory.place).toBeDefined();
    expect(toyWorld.space.label(memory.place!)).toBe('well');
    expect(toyWorld.space.distance(spot('burrow'), memory.place!)).toBe(3);
    mind.observe(memory);
    expect(mind.memory.all()[0]!.place).toBe(memory.place);
  });

  it('is TOLD of a place it has never been, and asks which way it lies', () => {
    const mind = new AgentMind(1, toyWorld);
    // A tale it was told, not one it witnessed — the pilgrimage shape.
    mind.narratives.remember('home:9', 'someone raised a home at the well', spot('well'), 1, false);
    const input = mind.buildThinkInput(snapshot(spot('burrow')), view(), 'periodic');
    expect(input.sacredPlace).toBeDefined();
    expect(toyWorld.space.equal(input.sacredPlace!, spot('well'))).toBe(true);
    expect(toyWorld.space.direction(input.snapshot.place, input.sacredPlace!)).toBe('hollow');
    expect(toyWorld.space.distance(input.snapshot.place, input.sacredPlace!)).toBe(3);

    // …and the prompt says so in this world's words, not another world's.
    const prompt = buildThinkPrompt(input, toyWorld);
    expect(prompt.user).toContain('it lies hollow, about 3 away (toward well)');
  });

  it('reaches nothing of the forager continent while doing it', () => {
    const mind = new AgentMind(1, toyWorld);
    mind.narratives.remember('home:9', 'someone raised a home at the well', spot('well'), 1, false);
    const input = mind.buildThinkInput(snapshot(spot('burrow')), view(), 'periodic');
    const whole = `${buildThinkPrompt(input, toyWorld).system}\n${buildThinkPrompt(input, toyWorld).user}`;
    for (const word of foragerAdapter.space.directions) expect(whole, word).not.toContain(word);
    // As a VERB it could be offered or as a SHAPE it could be described. Not as
    // a bare substring: the skeleton's own prose says "Speak as yourself", and
    // that word happening to be one world's action id is a coincidence B5 will
    // remove along with the rest of the prose.
    for (const action of foragerAdapter.actions) {
      expect(whole, action.id).not.toContain(`, ${action.id},`);
      expect(whole, action.id).not.toContain(`${action.id}{`);
    }
    for (const drive of foragerAdapter.drives) {
      if (toyWorld.drives.some((d) => d.id === drive.id)) continue;
      expect(whole, drive.id).not.toContain(drive.id);
    }
    // The needs paragraph is rendered from the world's own drives now, so a
    // world with two of them is shown two (B3 verifier, round 2, backlog 2).
    expect(whole).toContain('hunger 10, rest 10');
    // And its place is written the way IT writes one: a word, not a pair.
    expect(toyPlaces.encode(spot('ridge'))).toEqual({ spot: 'ridge' });
  });
});

/**
 * TWO WORLDS IN ONE PROCESS, AND NEITHER ANSWERS FOR THE OTHER (W1-B4 verifier,
 * backlog 4).
 *
 * A place carries no world tag, so until `guardPlaces` existed the continent
 * answered questions about the toy world's places — and answered them WRONGLY
 * and QUIETLY. `equal`, "the only comparison a mind is allowed to make",
 * returned TRUE for two places that are not the same place and were never in the
 * same world, because neither had an `x` and `undefined === undefined`. `label`,
 * which `prompt.ts` splices into a prompt someone is paying for, said
 * `"NaN,NaN"`.
 *
 * THE CHOICE, and it is a choice: every entry point THROWS a typed
 * `ForeignPlaceError`. Not `unplaced`, not a counter — a mind that reached the
 * wrong world has a bug, and a bug that returns a plausible number is the
 * expensive kind. W1-C is the step that puts two worlds in one process.
 */
/**
 * ─── OWNERSHIP: TWO PLANAR WORLDS, AND NEITHER ANSWERS FOR THE OTHER ────────
 *
 * W1-B4 verifier, round 2, FAIL 2. The first gate asked "does this value carry
 * any of the fields I write a place with", and a second plane's `{x: 3, y: 9}`
 * answered YES — `distance` 1080.41, `direction` "southeast", `equal` TRUE for
 * two places that were never in the same world. W1-C's town is a plane.
 *
 * Ownership is now a `#private` brand: `#x in v`, which only the class that
 * minted the instance can ask, which nothing can forge and no Proxy can trap.
 */
describe('a world refuses a place another world minted', () => {
  const foreign = spot('hollow');
  const other = spot('well');
  const here = at(3, 4);

  /** A SECOND PLANE — the shape W1-C's town will have. */
  const town = createPlaneSpace();

  const refusals = (space: SpaceOps, stranger: PlaceRef, own: PlaceRef): [string, number, () => unknown][] => [
    ['distance', 1, () => space.distance(stranger, own)],
    ['distance', 2, () => space.distance(own, stranger)],
    ['direction', 1, () => space.direction(stranger, own)],
    ['direction', 2, () => space.direction(own, stranger)],
    ['within', 1, () => space.within(stranger, own, 8)],
    ['within', 2, () => space.within(own, stranger, 8)],
    ['equal', 1, () => space.equal(stranger, own)],
    ['equal', 2, () => space.equal(own, stranger)],
    ['label', 1, () => space.label(stranger)],
  ];

  const expectForeign = (op: string, argument: number, call: () => unknown, what = ''): void => {
    let thrown: unknown;
    try {
      call();
    } catch (err) {
      thrown = err;
    }
    expect(thrown, `${what}${op} argument ${argument}`).toBeInstanceOf(ForeignPlaceError);
    const error = thrown as ForeignPlaceError;
    expect(error.op).toBe(op);
    expect(error.argument).toBe(argument);
    expect(error.name).toBe('ForeignPlaceError');
    expect(error.message).toBe(`space.${op}: argument ${argument} is not a place of this world`);
  };

  it('used to say two different places were the same place, and now says whose they are', () => {
    expect(toyWorld.space.equal(foreign, other)).toBe(false);
    expect(() => foragerAdapter.space.equal(foreign, other)).toThrow(ForeignPlaceError);
  });

  it('refuses at every entry point that takes one, naming the op and the argument', () => {
    for (const [op, argument, call] of refusals(foragerAdapter.space, foreign, here)) {
      expectForeign(op, argument, call);
    }
  });

  /**
   * THE ONE THAT ROUND 2 BROKE THE OLD GATE WITH. Two planes, same fields, same
   * arithmetic, same everything except WHICH CLASS MINTED THE HANDLE — and that
   * is now the whole of the question.
   */
  it('refuses a second PLANAR world’s places, which is the case the gate exists for', () => {
    const theirs = town.at(3, 9);
    for (const [op, argument, call] of refusals(foragerAdapter.space, theirs, here)) {
      expectForeign(op, argument, call);
    }
    // …and symmetrically: the town does not answer for the continent either.
    for (const [op, argument, call] of refusals(town.space, here, theirs)) {
      expectForeign(op, argument, call);
    }
    // Each is perfectly happy with its own.
    expect(town.space.distance(town.at(0, 0), town.at(3, 4))).toBe(5);
    expect(foragerAdapter.space.distance(at(0, 0), here)).toBe(5);
    // And neither codec will read the other's handle as a place.
    expect(town.codec.isPlace(here)).toBe(false);
    expect(places.isPlace(theirs)).toBe(false);
    expect(town.codec.owns(here)).toBe(false);
    expect(places.owns(theirs)).toBe(false);
    expect(places.owns(here)).toBe(true);
  });

  it('refuses every hand-built thing that used to pass for a place', () => {
    const nullProto = Object.create(null) as Record<string, number>;
    nullProto['x'] = 3;
    nullProto['y'] = 9;
    const arrayWithAnX = Object.assign([1, 2], { x: 3, y: 9 });
    const strangers: [string, unknown][] = [
      ['a plain pair', { x: 3, y: 9 }],
      ['a stringly pair', { x: '120', y: '2' }],
      ['a pair with an extra key', { x: 1, y: 2, z: 3 }],
      ['an array carrying an x', arrayWithAnX],
      ['a null-prototype pair', nullProto],
      ['an empty object', {}],
      ['another world’s field name', { spot: 'ridge' }],
      ['an array', []],
      ['a string', 'here'],
      ['a number', 42],
      ['null', null],
      ['undefined', undefined],
      ['a Date', new Date(0)],
      ['this world’s own place, wrapped in a Proxy', new Proxy(here as unknown as object, {})],
    ];
    for (const [what, stranger] of strangers) {
      expect(() => foragerAdapter.space.label(stranger as PlaceRef), what).toThrow(ForeignPlaceError);
      expect(() => foragerAdapter.space.equal(stranger as PlaceRef, here), what).toThrow(ForeignPlaceError);
    }
  });

  /**
   * UNTHROWABLE BY CONSTRUCTION (round 2, FAIL 2, last paragraph). The old gate
   * called `isPlace` first, which READ `x` — so a throwing getter escaped as a
   * raw `Error` rather than a `ForeignPlaceError`. A private-brand test reads no
   * property at all.
   */
  it('answers a trapping value with a ForeignPlaceError, never with its own exception', () => {
    const boom = (): never => {
      throw new Error('boom');
    };
    const revoked = Proxy.revocable({ x: 1, y: 2 }, {});
    revoked.revoke();
    const traps: [string, unknown][] = [
      ['a throwing getter', Object.defineProperty({ y: 2 }, 'x', { get: boom, enumerable: true })],
      ['a get-trap that throws', new Proxy({ x: 1, y: 2 }, { get: boom })],
      ['a has-trap that throws', new Proxy({ x: 1, y: 2 }, { has: boom })],
      ['an ownKeys-trap that throws', new Proxy({ x: 1, y: 2 }, { ownKeys: boom })],
      ['a getPrototypeOf-trap that throws', new Proxy({ x: 1, y: 2 }, { getPrototypeOf: boom })],
      ['a revoked Proxy', revoked.proxy],
      ['a descriptor liar', new Proxy({ x: 1, y: 2 }, { getOwnPropertyDescriptor: boom })],
    ];
    for (const [what, trap] of traps) {
      for (const [op, argument, call] of refusals(foragerAdapter.space, trap as PlaceRef, here)) {
        expectForeign(op, argument, call, `${what}: `);
      }
    }
  });

  it('is symmetric — the toy world refuses the continent’s places too', () => {
    expect(() => toyWorld.space.distance(here, foreign)).toThrow(ForeignPlaceError);
    expect(() => toyWorld.space.label(here)).toThrow(ForeignPlaceError);
    expect(toyWorld.space.distance(foreign, other)).toBe(2);
  });

  /**
   * `unplaced` IS A REAL PLACE OF THIS WORLD, not a sentinel: the mind files a
   * siteless tale at it and then asks how far away it is, and a gate that
   * refused it would throw inside the one path that has no alternative.
   */
  it('mints its own `unplaced`, so a siteless tale can still be asked about', () => {
    expect(places.owns(foragerAdapter.space.unplaced)).toBe(true);
    expect(foragerAdapter.space.distance(foragerAdapter.space.unplaced, at(3, 4))).toBe(5);
    expect(places.encode(foragerAdapter.space.unplaced)).toEqual({ x: 0, y: 0 });
    expect(toyPlaces.owns(toyWorld.space.unplaced)).toBe(true);
    expect(toyWorld.space.label(toyWorld.space.unplaced)).toBe('hollow');
    // …and it is not the same place in two worlds: each world minted its own.
    expect(() => foragerAdapter.space.label(toyWorld.space.unplaced)).toThrow(ForeignPlaceError);
  });

  /**
   * THE GATE ASKS OWNERSHIP, NOT USABILITY, and the difference is why it is not
   * simply `isPlace`. This world MINTS non-finite and half-written places of its
   * own — an event authored with a NaN coordinate becomes a memory whose site
   * renders into a prompt, and a model's `{"kind":"MoveTo","x":5}` reaches the
   * body as half a place — and `isPlace`, which is the EDGE's question about
   * untrusted JSON, says no to both. Refusing them here would throw inside a run
   * that has always worked.
   */
  it('lets through the unusable places this world really does mint', () => {
    const nan = at(Number.NaN, 0);
    const half = places.decode({ x: 5 })!;
    expect(places.isPlace(nan)).toBe(false);
    expect(places.isPlace(half)).toBe(true);
    expect(places.owns(nan)).toBe(true);
    expect(places.owns(half)).toBe(true);
    expect(foragerAdapter.space.distance(nan, at(0, 0))).toBeNaN();
    expect(foragerAdapter.space.distance(half, at(0, 0))).toBeNaN();
    expect(places.encode(half)).toEqual({ x: 5 });
  });

  /** The three that take `unknown` by contract still ANSWER rather than throw. */
  it('still answers the edge’s questions about a stranger instead of throwing', () => {
    expect(places.isPlace(foreign)).toBe(false);
    expect(places.placeOf(foreign)).toBeUndefined();
    expect(places.decode({ spot: 'hollow' })).toBeUndefined();
  });
});

/**
 * ─── THE 22 ROUTES, RUN ─────────────────────────────────────────────────────
 *
 * The W1-B4 verifier's round 2 wrote 22 ways out of the handle into a mind
 * directory, ALL of which compiled with zero errors and ALL of which passed
 * every static guard — because not one of them makes an expression whose TYPE
 * is `PlaceRef`. A nominal brand is a name, and a name is a thing a mind author
 * need never say.
 *
 * So the answer is not another checker rule, it is that THERE IS NOTHING THERE:
 * a place's whole state is `#private`, its prototype is empty, and the codec is
 * not reachable from the object a mind is handed. This runs all 22 against a
 * real forager place and asserts that not one coordinate comes back.
 *
 * TWO OF THEM STILL YIELD, deliberately and with an owner. They are asserted to
 * yield, so that closing them is a visible change and not a silent one:
 *
 *   19  `label(p)` renders `"900,120"` — text a mind could parse. B5 gives
 *       places WORDS; until then the prompt's bytes may not move. The static
 *       guard narrows it: a `label` result in a mind directory may only flow
 *       into string concatenation or a template.
 *   18  `SimEvent` still carries this world's own `x`/`y`. B6, with the rest of
 *       the per-world instrument.
 */
describe('the 22 routes out of a place, run against a real one', () => {
  const X = 900.5;
  const Y = 120.25;
  const probe = at(X, Y);
  const origin = at(0, 0);

  /** Does anything anywhere in this value carry one of the two coordinates? */
  const leaks = (value: unknown, depth = 0): boolean => {
    if (depth > 6) return false;
    if (typeof value === 'number') return value === X || value === Y;
    if (typeof value === 'string') return value.includes(String(X)) || value.includes(String(Y));
    if (value === null || value === undefined) return false;
    if (typeof value !== 'object') return false;
    if (Array.isArray(value)) return value.some((v) => leaks(v, depth + 1));
    try {
      return Reflect.ownKeys(value as object).some((k) => {
        const v = (value as Record<string | symbol, unknown>)[k];
        return leaks(typeof k === 'string' ? k : '', depth + 1) || leaks(v, depth + 1);
      });
    } catch {
      return false;
    }
  };

  /** A route's verdict: what it produced, or the fact that it could not. */
  const run = (route: () => unknown): { leaked: boolean; threw: boolean; got: unknown } => {
    try {
      const got = route();
      return { leaked: leaks(got), threw: false, got };
    } catch {
      return { leaked: false, threw: true, got: undefined };
    }
  };

  const asObject = (p: PlaceRef): object => p as unknown as object;
  const asAny = (p: PlaceRef): Record<string, unknown> => p as unknown as Record<string, unknown>;
  const K = 'x';
  const K2 = 'y';

  const ROUTES: [number, string, () => unknown][] = [
    [1, 'Object.values through an `object` parameter', () => Object.values(asObject(probe))],
    [2, 'a generic helper that widens to object', () => (<T,>(v: T) => Object.values(v as unknown as object))(probe)],
    [3, 'a parameter typed unknown', () => ((v: unknown) => Object.values(v as object))(probe)],
    [
      4,
      'an intermediate `const o: object = p`, then Object.entries',
      () => {
        const o: object = asObject(probe);
        return Object.entries(o);
      },
    ],
    [5, '…then Array.from', () => Array.from(asObject(probe) as ArrayLike<number>)],
    [6, '…then new Map(Object.entries(o))', () => [...new Map(Object.entries(asObject(probe)))]],
    [7, '…then spread', () => ({ ...asObject(probe) })],
    [
      8,
      '…then for…in',
      () => {
        const seen: string[] = [];
        for (const k in asObject(probe)) seen.push(`${k}=${String(asAny(probe)[k])}`);
        return seen;
      },
    ],
    [9, '…then Object.assign', () => Object.assign({}, asObject(probe))],
    [10, '…then structuredClone', () => structuredClone(asObject(probe))],
    [
      11,
      '…then Object.getOwnPropertyNames',
      () => Object.getOwnPropertyNames(asObject(probe)).map((k) => asAny(probe)[k]),
    ],
    [
      12,
      '…then Reflect.ownKeys',
      () => Reflect.ownKeys(asObject(probe)).map((k) => (asAny(probe) as Record<string | symbol, unknown>)[k]),
    ],
    [13, 'an any alias read by const key', () => [asAny(probe)[K], asAny(probe)[K2]]],
    [14, 'JSON round trip of a RECORD that carries one', () => JSON.parse(JSON.stringify({ id: 1, place: probe })) as unknown],
    [15, '`satisfies object`, then opened', () => Object.keys(asObject(probe) satisfies object)],
    [
      16,
      'a type predicate that calls it array-like',
      () => {
        const arrayish = (v: object): v is ArrayLike<number> => typeof (v as ArrayLike<number>).length === 'number';
        const o = asObject(probe);
        return arrayish(o) ? [o.length, o[0], o[1]] : [(o as ArrayLike<number>)[0], (o as ArrayLike<number>)[1]];
      },
    ],
    [
      17,
      'new Function / eval',
      () =>
        (
          new Function('p', 'return [p.x, p.y, JSON.stringify(p), String(p && p.constructor)]') as (
            p: unknown,
          ) => unknown
        )(probe),
    ],
    // 18 and 19 are the two documented residuals; see the block above.
    [
      20,
      'the codec’s own door, off the object a mind holds',
      () => (foragerAdapter.space as unknown as { encode?: (p: PlaceRef) => unknown }).encode?.(probe),
    ],
    [
      21,
      'minting one from numbers a mind chose',
      () =>
        (foragerAdapter.space as unknown as { decode?: (f: Record<string, unknown>) => unknown }).decode?.({
          [K]: X,
          [K2]: Y,
        }),
    ],
    [
      22,
      'triangulating against places a mind minted for itself',
      () => {
        const space = foragerAdapter.space as unknown as {
          decode?: (f: Record<string, unknown>) => PlaceRef | undefined;
        };
        const a = space.decode?.({ [K]: 0, [K2]: 0 });
        const b = space.decode?.({ [K]: 1, [K2]: 0 });
        if (!a || !b) return undefined;
        return [foragerAdapter.space.distance(probe, a), foragerAdapter.space.distance(probe, b)];
      },
    ],
    // Everything else the verifier listed as "the same leak wearing other clothes".
    [23, 'Object.keys', () => Object.keys(asObject(probe))],
    [24, 'Object.getOwnPropertySymbols', () => Object.getOwnPropertySymbols(asObject(probe))],
    [25, 'Object.getOwnPropertyDescriptors', () => Object.getOwnPropertyDescriptors(asObject(probe))],
    [
      26,
      'the prototype chain, and the constructor on it',
      () => {
        const proto = Object.getPrototypeOf(asObject(probe)) as object | null;
        return [proto, proto === null ? null : Object.getOwnPropertyNames(proto), asAny(probe)['constructor']];
      },
    ],
    [27, 'JSON.stringify of the handle itself', () => JSON.stringify(probe)],
    [28, 'String() and a template', () => `${String(probe)}`],
    [29, 'Object.fromEntries of its entries', () => Object.fromEntries(Object.entries(asObject(probe)))],
    [
      30,
      'writing to it, then reading back',
      () => {
        try {
          asAny(probe)[K] = X;
        } catch {
          /* frozen, which is the point */
        }
        return asAny(probe)[K];
      },
    ],
  ];

  for (const [n, what, route] of ROUTES) {
    it(`route ${n} — ${what} — yields no coordinate`, () => {
      const verdict = run(route);
      // Described rather than stringified: some of these produce a value with
      // no `toString` at all, which is itself part of the answer.
      let described = '<unprintable>';
      try {
        described = JSON.stringify(verdict.got) ?? String(verdict.got);
      } catch {
        /* an opaque handle has nothing to print */
      }
      expect(verdict.leaked, `route ${n} produced ${described}`).toBe(false);
    });
  }

  /** The probe really does hold those two numbers, or the table proves nothing. */
  it('is not vacuous: the world itself can still read the place', () => {
    expect(places.encode(probe)).toEqual({ x: X, y: Y });
    expect(pointOf(probe)).toEqual({ x: X, y: Y });
    expect(foragerAdapter.space.distance(probe, origin)).toBe(Math.hypot(X, Y));
    // …and the detector is not vacuous either.
    expect(leaks({ deep: [{ here: X }] })).toBe(true);
    expect(leaks(`about ${X} away`)).toBe(true);
    expect(leaks({ id: 1, kind: 'berry' })).toBe(false);
  });

  /**
   * THE TWO THAT STILL YIELD, pinned as they are so that fixing them is a
   * deliberate change with a failing test attached to it.
   */
  it('route 19 — `label` is still parseable text — RESIDUAL, owner B5 (lexicon)', () => {
    expect(foragerAdapter.space.label(at(900, 120)).split(',').map(Number)).toEqual([900, 120]);
  });

  it('route 18 — a SimEvent still carries this world’s x and y — RESIDUAL, owner B6', () => {
    const event = { tick: 1, type: 'AteFood', actorId: 1, targetIds: [], x: X, y: Y, payload: {} } as unknown as SimEvent;
    expect(leaks((event as unknown as Record<string, unknown>)[K])).toBe(true);
  });
});


/**
 * ─── THE CODEC IS INSIDE THE GATE TOO (W1-B4 verifier, round 3, FAIL 2) ─────
 *
 * `defineSpace` guarded the five `SpaceOps` functions and left `SpaceCodec`
 * outside, so a place from another world reaching a SERIALISATION seam —
 * `writeIntent`, `inlinePlace`, `encodeThinkInputPlaces`, `withPlacesWritten`,
 * every one of which calls `codec.encode(place)` — produced a raw
 * `TypeError: Cannot read private member #x from an object whose class did not
 * declare it`. No `op`, no `argument`, no mention of worlds, and NOT the error
 * written for exactly this case. The verifier put a second plane's place into a
 * live conscious cohort and got eleven rows reading `answered | TypeError:
 * Cannot read private member #x` — a plausible substituted decision, which is
 * the outcome `ForeignPlaceError` exists to prevent.
 *
 * Every codec entry point that TAKES a place is inside the gate now. `decode`,
 * `placeOf`, `isPlace` and `owns` are not, and are not meant to be: they take
 * untrusted JSON, a world's own carrier, or anything at all, and answering "no"
 * is their whole job.
 */
describe('a codec refuses another world’s place, by name (W1-B4 round 4)', () => {
  const town = createPlaneSpace();
  const foragerPlace = at(748.25, -311.5);

  const expectForeignPlace = (op: string, call: () => unknown, what: string): void => {
    let thrown: unknown;
    try {
      call();
    } catch (err) {
      thrown = err;
    }
    expect(thrown, `${what}: ${op}`).toBeInstanceOf(ForeignPlaceError);
    const error = thrown as ForeignPlaceError;
    expect(error.op, what).toBe(op);
    expect(error.argument, what).toBe(1);
    // …and the refusal says nothing about where the place was.
    expect(error.message).not.toMatch(/748|311/);
  };

  it('refuses a second plane’s place at `encode`, both ways round', () => {
    expectForeignPlace('encode', () => foragerEdges.codec.encode(town.at(3, 9)), 'town place, forager codec');
    expectForeignPlace('encode', () => town.codec.encode(foragerPlace), 'forager place, town codec');
  });

  it('refuses a world with no plane in it at all, both ways round', () => {
    expectForeignPlace('encode', () => foragerEdges.codec.encode(spot('ridge')), 'toy place, forager codec');
    expectForeignPlace('encode', () => toyCodec.encode(foragerPlace), 'forager place, toy codec');
    expectForeignPlace('encode', () => toyCodec.encode(town.at(1, 1)), 'town place, toy codec');
  });

  it('refuses one at `pointOf` — the world’s own reader, which an instrument holds', () => {
    expectForeignPlace('pointOf', () => pointOf(town.at(3, 9)), 'town place, forager pointOf');
    expectForeignPlace('pointOf', () => town.pointOf(foragerPlace), 'forager place, town pointOf');
    expectForeignPlace('pointOf', () => town.pointOf(spot('well')), 'toy place, town pointOf');
  });

  it('does NOT refuse the questions about untrusted data — they answer no instead', () => {
    // `isPlace` is the edge's question about JSON, so a foreign handle is simply
    // not one; `owns` is the brand test and says so; `decode` reads fields.
    expect(foragerEdges.codec.isPlace(town.at(3, 9))).toBe(false);
    expect(foragerEdges.codec.owns(town.at(3, 9))).toBe(false);
    expect(toyCodec.isPlace(foragerPlace)).toBe(false);
    expect(() => foragerEdges.codec.decode({ x: 1, y: 2 })).not.toThrow();
  });

  it('still lets a world encode its OWN places, or the gate is vacuous', () => {
    expect(foragerEdges.codec.encode(foragerPlace)).toEqual({ x: 748.25, y: -311.5 });
    expect(town.codec.encode(town.at(3, 9))).toEqual({ x: 3, y: 9 });
    expect(toyCodec.encode(spot('ridge'))).toEqual({ spot: 'ridge' });
  });
});

/**
 * ─── THERE IS NO LAYER BETWEEN A CALL AND THE READ (round 5, the perf round) ─
 *
 * Round 4 published a world's ops through a wrapper built in `defineSpace`:
 * every call asked `codec.owns(a)`, then `codec.owns(b)`, then forwarded. It
 * was correct and it was the whole of the step's regression — −3.2% of tick
 * rate at 256 beings and −7.2% at 1,000, against a 3% budget, on a CPU profile
 * that showed parity because an extra frame and an extra object shape are not
 * work a sampler can see. Bypassing it measured +0.12%.
 *
 * The check now lives inside the world's own place class, where `a.#x` IS the
 * ownership test. The two tests below are the ones that keep it there, and
 * NEITHER OF THEM IS A TIMING TEST — a timing test on a shared machine fails on
 * Tuesdays. The first is identity: what a world publishes must be the very
 * functions it wrote. The second is the reason that is safe to demand:
 * `defineSpace` refuses, loudly, to publish a space whose ops do not refuse a
 * stranger themselves. Delete the refusals from `plane.ts` to make it faster
 * and the world stops being constructible.
 */
describe('a world publishes its own functions, and must have written the refusal into them', () => {
  it('hands back exactly what it was given — no wrapper object, no forwarding closure', () => {
    const plane = createPlaneSpace();
    const twin = createPlaneSpace();
    // Each world's ops are ITS OWN class's statics, so two worlds never share
    // one: that is what makes the ownership check exact per instance rather
    // than structural, and it is why the check can live inside the function.
    expect(typeof plane.space.distance).toBe('function');
    expect(plane.space.distance).not.toBe(twin.space.distance);
    // The published `SpaceOps` is the object the world built, frozen in place.
    expect(Object.isFrozen(plane.space)).toBe(true);
    expect(Object.isFrozen(plane.codec)).toBe(true);
    expect(Object.isFrozen(foragerAdapter.space)).toBe(true);

    // The load-bearing claim, stated where it cannot be fudged: `defineSpace`
    // returns its arguments, so a world's own function IS what a mind calls.
    const ops: SpaceOps = plane.space;
    const echoed = defineSpace({ ops, codec: plane.codec });
    expect(echoed.space).toBe(ops);
    expect(echoed.codec).toBe(plane.codec);
    for (const op of ['distance', 'direction', 'within', 'equal', 'label'] as const) {
      expect(echoed.space[op], op).toBe(ops[op]);
    }
    expect(echoed.codec.encode).toBe(plane.codec.encode);
  });

  /**
   * THE REPLACEMENT FOR THE WRAPPER. A world author who writes the obvious
   * thing — read `x` off whatever came in — used to be caught by the gate that
   * was wrapped around them. Now they are caught here, at construction, with
   * the op and the argument named.
   */
  it('refuses to publish a space that answers for a place it did not mint', () => {
    const real = createPlaneSpace();
    const pair = (p: PlaceRef): { x: number; y: number } => p as unknown as { x: number; y: number };
    const naive: SpaceOps = {
      ...real.space,
      // Round 2's gate, and W1-C's town, in one line: structural, not owned.
      distance: (a, b) => Math.hypot(pair(b).x - pair(a).x, pair(b).y - pair(a).y),
    };
    let thrown: unknown;
    try {
      defineSpace({ ops: naive, codec: real.codec });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(UngatedSpaceError);
    const error = thrown as UngatedSpaceError;
    expect(error.name).toBe('UngatedSpaceError');
    expect(error.op).toBe('distance');
    expect(error.argument).toBe(1);
    expect(error.message).toMatch(/must throw ForeignPlaceError/);
  });

  it('refuses one that throws the wrong thing, or refuses the wrong argument', () => {
    const real = createPlaneSpace();
    const raw: SpaceOps = {
      ...real.space,
      // The raw `TypeError` round 3 shipped at the serialisation seam.
      label: (place) => (place as unknown as { x: number }).x.toFixed(0),
    };
    expect(() => defineSpace({ ops: raw, codec: real.codec })).toThrow(UngatedSpaceError);

    const misnamed: SpaceOps = {
      ...real.space,
      within: (a, b, r) => {
        if (!real.codec.owns(b)) throw new ForeignPlaceError('within', 1);
        return real.space.within(a, b, r);
      },
    };
    expect(() => defineSpace({ ops: misnamed, codec: real.codec })).toThrow(/refused as `within` argument 1/);
  });

  /** …and the two real worlds got through it, or the check above proves nothing. */
  it('is not vacuous — both of this repo’s worlds are built through it', () => {
    expect(foragerAdapter.space.distance(at(0, 0), at(3, 4))).toBe(5);
    expect(toyWorld.space.distance(spot('hollow'), spot('well'))).toBe(2);
  });
});

/**
 * ─── WHAT A WITNESS REMEMBERS ABOUT *WHERE* (verifier round 1, item 8) ──────
 *
 * `c727af7` copied `event.x` and `event.y` onto every memory unconditionally.
 * Round 3's `placeOf` asked for two `number`s first, so four shapes a host can
 * author — `{x:5}`, `{y:6}`, `{x:"5",y:6}`, `{x:5,y:null}` — formed a memory
 * with NO place where base formed one carrying exactly what was written.
 * Reachable only through `authorEvent` plus a witness, which is why no golden
 * caught it; it would have moved one the first time it bit.
 *
 * The fixture beside this was produced by running base's own `memoryFromEvent`
 * in the permanent `c727af7` checkout. The comparison is on what the place
 * ENCODES back to, because that is the form a row has always stored and the
 * only form the two versions can be compared in at all.
 */
describe('a memory carries where it happened, exactly as `c727af7` did', () => {
  const BASE = JSON.parse(
    readFileSync(new URL('./fixtures/memoryPlaces.c727af7.json', import.meta.url), 'utf8'),
  ) as Record<string, { x: unknown; y: unknown }>;

  const SHAPES: Record<string, Record<string, unknown>> = {
    'x-only': { x: 5 },
    'y-only': { y: 6 },
    'x-string': { x: '5', y: 6 },
    'y-null': { x: 5, y: null },
    'x-nan': { x: NaN, y: 6 },
    both: { x: 7, y: 8 },
    'minus-zero': { x: -0, y: 0 },
  };

  /** Base wrote `undefined`, `NaN` and `-0` straight onto the memory; JSON cannot
   *  hold any of the three, so the fixture spells them and so does this. */
  const show = (v: unknown): unknown =>
    typeof v === 'number' && Number.isNaN(v) ? 'NaN' : Object.is(v, -0) ? '-0' : v === undefined ? '<absent>' : v;

  it('a carrier with NEITHER field is nowhere — the one deliberate divergence, named in the fixture', () => {
    expect(typeof BASE['neither']).toBe('string');
    expect(foragerEdges.codec.placeOf({ tick: 1 })).toBeUndefined();
    // …and this is the shape that actually reaches it: another world's handle.
    expect(foragerEdges.codec.placeOf(spot('ridge'))).toBeUndefined();
  });

  for (const [name, coords] of Object.entries(SHAPES)) {
    it(`stores ${name} the way base did`, () => {
      const event = { tick: 3, type: 'FoundResource', actorId: 1, targetIds: [], payload: {}, ...coords } as unknown as SimEvent;
      const place = foragerEdges.codec.placeOf(event);
      expect(place, `${name}: base formed a memory here`).toBeDefined();
      const written = foragerEdges.codec.encode(place!);
      expect({ x: show(written['x']), y: show(written['y']) }).toEqual({
        x: show(BASE[name]!.x === '<absent>' ? undefined : BASE[name]!.x === 'NaN' ? NaN : BASE[name]!.x === '-0' ? -0 : BASE[name]!.x),
        y: show(BASE[name]!.y === '<absent>' ? undefined : BASE[name]!.y === 'NaN' ? NaN : BASE[name]!.y === '-0' ? -0 : BASE[name]!.y),
      });
    });
  }

  it('and the memory a witness forms really does carry it', () => {
    const event = { tick: 3, type: 'FoundResource', actorId: 1, targetIds: [], payload: {}, x: 5 } as unknown as SimEvent;
    const place = foragerEdges.codec.placeOf(event);
    const memory = memoryFromEvent(foragerAdapter, event, 2, { nearWater: false, night: false, inShelter: false, elevationBand: 0 }, place);
    expect(memory, 'round 3 formed none at all').toBeDefined();
    expect(memory!.place, 'round 3 left it undefined').toBeDefined();
    expect(foragerEdges.codec.encode(memory!.place!)).toEqual({ x: 5 });
  });
});
