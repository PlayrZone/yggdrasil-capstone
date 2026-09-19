import { defineWorld } from '../../src/contract/adapter.js';
import type { WorldAdapter } from '../../src/contract/adapter.js';
import { toySpace } from './toySpace.js';

/**
 * A WHOLE WORLD IN TWENTY LINES — two drives, three events, one context
 * feature — and nothing in it agrees with the forager continent about anything
 * except the names it is forced to borrow (B1 keeps the mind typed against the
 * forager unions; B2 makes these opaque ids and the borrowing stops).
 *
 * Its job is to fail loudly if any mind module still has an opinion of its own:
 * every salience, every scalar, every mined feature here is deliberately a
 * different number from the forager's, so a leftover table shows up as a wrong
 * value rather than as a crash.
 *
 * `salience` scales every number, so two toy worlds that differ only in it are
 * the cross-talk probe: one mind's world must never colour another's.
 */
export function makeToyWorld(id: string, salience: number): WorldAdapter {
  return defineWorld({
    id,
    version: '1',
    drives: [
      { id: 'hunger', pressingAt: 10, criticalAt: 20, actsAt: 5 },
      { id: 'rest', pressingAt: 30, criticalAt: 40, actsAt: 25 },
    ],
    // ONE feature, and it is not called what the field it reads is called —
    // so a miner that still knows the forager's names cannot fake this.
    context: [{ id: 'inShelter', source: 'nearWater', kind: 'flag' }],
    events: [
      // Being given something: worth a lot here, and it makes a firm friend.
      {
        id: 'ReceivedItem',
        salience,
        outcome: 'success',
        relationshipDeltas: { trust: 30, friendship: 40 },
      },
      // The same act, from the giver's side — and a bystander sees nothing.
      {
        id: 'GaveItem',
        salience: salience / 2,
        roles: { target: { recordsAs: 'ReceivedItem' }, bystander: { ignores: true } },
      },
      // Eating: the only thing the one context feature can be mined against.
      { id: 'AteFood', salience: salience / 4 },
    ],
    // THIS WORLD HAS NO BODY TO ANSWER FOR AN ARGUMENT, so its own edge does:
    // an aimless `Snaffle`, a `Nibble` at the lever, a nap longer than it can
    // sit through, and an argument an act does not take at all are all refused
    // at the mind→body edge and counted as `badParam`. The forager continent
    // declares the opposite and means it — there the body refuses, and its
    // refusal is a memory. Keeping one world of each is what keeps both paths
    // through `WorldGate.admitIntent` under test.
    strictArgs: true,
    // FOUR VERBS, FOUR CORE VERBS, AND NOT ONE OF THEM IS A FORAGER VERB
    // (W1-B3). A mind parsed against this world must accept `Snaffle` and
    // refuse `Gather`; a prompt built for it must offer these and not those.
    // `Snaffle` is the only REQUIRED param anywhere in the repo.
    actions: [
      // ONE place param, written as ONE named spot — where the forager
      // continent writes two numbers. Same mind, same `Intent.place`, nothing
      // shared on the wire (W1-B4).
      { id: 'Shuffle', core: 'Move', params: [{ id: 'place', type: 'place' }] },
      { id: 'Snaffle', core: 'Take', params: [{ id: 'targetId', type: 'ref', required: true }] },
      {
        id: 'Nibble',
        core: 'Use',
        params: [{ id: 'objectKind', type: 'kind', tag: 'edible', hint: 'nibbles something edible' }],
      },
      // Bounded on purpose: a duration this world cannot sit through is a
      // refusal at the edge, where the forager continent has no bounds at all.
      { id: 'Dawdle', core: 'Wait', params: [{ id: 'durationTicks', type: 'duration', min: 0, max: 99 }] },
    ],
    // Two things, tagged differently — so a `kind` arg filtered by `edible`
    // takes the crumb and refuses the lever.
    kinds: [
      { id: 'crumb', tags: ['object', 'edible', 'nourishing'] },
      { id: 'lever', tags: ['object', 'tool'] },
    ],
    time: {
      ticksPerDay: 10,
      ticksPerSeason: 40,
      ticksPerYear: 160,
      adultAge: 40,
      seasonAt: () => 'always',
    },
    // FOUR NAMED SPOTS AND THE WAYS BETWEEN THEM — no plane, no coordinates,
    // no compass. See `toySpace.ts`.
    space: toySpace,
    cognitionDefaults: {
      thinkInterval: { base: 7, scale: 1, weights: [] },
      consolidateInterval: { base: 11, scale: 1, weights: [] },
      memoryHotCapacity: { base: 32, scale: 1, weights: [] },
      // Two ticks and one hop: nothing here shares a unit with the forager's
      // 600 and 8, so a miner that still held either would show up at once.
      successionWindowTicks: 2,
      successionRadius: 1,
    },
  });
}

/** The toy world, as the end-to-end test uses it. */
export const toyWorld = makeToyWorld('toy', 0.8);
