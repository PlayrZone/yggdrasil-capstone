import { describe, expect, it } from 'vitest';
import { AgentMind, ForeignPlaceError, buildThinkPrompt, foragerAdapter, at, pointOf } from '../src/index.js';
import type { AgentSnapshot, PlaceRef, SimEvent, WorldView } from '../src/index.js';
import { memoryFromEvent } from '../src/memory/memoryFromEvent.js';
import { SuccessionMiner } from '../src/learning/SuccessionMiner.js';
import { toyWorld } from './fixtures/toyAdapter.js';
import { TOY_SPOTS, spot } from './fixtures/toySpace.js';
import { mem, resetIds } from './helpers.js';

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
      const written = foragerAdapter.space.encode(at(x, y));
      expect(written).toEqual({ x, y });
      const back = foragerAdapter.space.decode(written)!;
      expect(Object.is(pointOf(back).x, x)).toBe(true);
      expect(Object.is(pointOf(back).y, y)).toBe(true);
    }
    // Half a place survives as half a place: a model writes one, and the body
    // has always been the one to answer for it.
    expect(foragerAdapter.space.encode(foragerAdapter.space.decode({ x: 5 })!)).toEqual({ x: 5 });
    expect(foragerAdapter.space.decode({})).toBeUndefined();
    expect(foragerAdapter.space.decode({ x: 'far' })).toBeUndefined();
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
    const memory = memoryFromEvent(toyWorld, happening, 1, ctx)!;
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
    expect(toyWorld.space.encode(spot('ridge'))).toEqual({ spot: 'ridge' });
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
describe('a world refuses a place another world minted', () => {
  const foreign = spot('hollow');
  const other = spot('well');
  const here = at(3, 4);

  it('used to say two different places were the same place, and now says whose they are', () => {
    // What it did: `hollow` and `well` are different spots, and the continent
    // called them equal.
    expect(toyWorld.space.equal(foreign, other)).toBe(false);
    expect(() => foragerAdapter.space.equal(foreign, other)).toThrow(ForeignPlaceError);
  });

  it('refuses at every entry point that takes one, naming the op and the argument', () => {
    const calls: [string, number, () => unknown][] = [
      ['distance', 1, () => foragerAdapter.space.distance(foreign, here)],
      ['distance', 2, () => foragerAdapter.space.distance(here, foreign)],
      ['direction', 1, () => foragerAdapter.space.direction(foreign, here)],
      ['direction', 2, () => foragerAdapter.space.direction(here, foreign)],
      ['within', 1, () => foragerAdapter.space.within(foreign, here, 8)],
      ['within', 2, () => foragerAdapter.space.within(here, foreign, 8)],
      ['equal', 1, () => foragerAdapter.space.equal(foreign, here)],
      ['equal', 2, () => foragerAdapter.space.equal(here, foreign)],
      ['label', 1, () => foragerAdapter.space.label(foreign)],
      ['encode', 1, () => foragerAdapter.space.encode(foreign)],
    ];
    for (const [op, argument, call] of calls) {
      let thrown: unknown;
      try {
        call();
      } catch (err) {
        thrown = err;
      }
      expect(thrown, `${op} argument ${argument}`).toBeInstanceOf(ForeignPlaceError);
      const error = thrown as ForeignPlaceError;
      expect(error.op).toBe(op);
      expect(error.argument).toBe(argument);
      expect(error.name).toBe('ForeignPlaceError');
      expect(error.message).toBe(`space.${op}: argument ${argument} is not a place of this world`);
    }
  });

  it('is symmetric — the toy world refuses the continent’s places too', () => {
    expect(() => toyWorld.space.distance(here, foreign)).toThrow(ForeignPlaceError);
    expect(() => toyWorld.space.label(here)).toThrow(ForeignPlaceError);
    // …and it is not vacuous: its own places still work.
    expect(toyWorld.space.distance(foreign, other)).toBe(2);
  });

  it('refuses an object that is no world’s place at all', () => {
    for (const nonsense of [{}, { z: 1 }, [], 'here', 42]) {
      expect(() => foragerAdapter.space.label(nonsense as unknown as PlaceRef), JSON.stringify(nonsense)).toThrow(
        ForeignPlaceError,
      );
    }
  });

  /**
   * THE GATE ASKS OWNERSHIP, NOT USABILITY, and the difference is why it is not
   * simply `isPlace`. This world MINTS non-finite and half-written places of its
   * own — an event authored with a NaN coordinate becomes a memory whose site
   * renders into a prompt, and a model's `{"kind":"MoveTo","x":5}` reaches the
   * body as half a place — and `isPlace`, which is the EDGE's question about
   * untrusted JSON, says no to both. Refusing them here would throw inside a run
   * that has always worked, so the gate asks the weaker question: does this carry
   * any of the fields this world writes a place with?
   */
  it('lets through the unusable places this world really does mint', () => {
    const nan = at(Number.NaN, 0);
    const half = foragerAdapter.space.decode({ x: 5 })!;
    expect(foragerAdapter.space.isPlace(nan)).toBe(false);
    expect(foragerAdapter.space.isPlace(half)).toBe(true);
    expect(foragerAdapter.space.distance(nan, at(0, 0))).toBeNaN();
    expect(foragerAdapter.space.distance(half, at(0, 0))).toBeNaN();
    expect(foragerAdapter.space.encode(half)).toEqual({ x: 5 });
  });

  /** The three that take `unknown` by contract still ANSWER rather than throw. */
  it('still answers the edge’s questions about a stranger instead of throwing', () => {
    expect(foragerAdapter.space.isPlace(foreign)).toBe(false);
    expect(foragerAdapter.space.placeOf(foreign)).toBeUndefined();
    expect(foragerAdapter.space.decode({ spot: 'hollow' })).toBeUndefined();
  });
});
