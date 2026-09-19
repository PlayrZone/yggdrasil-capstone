import { defineWorld } from '../../src/contract/adapter.js';
import type { WorldAdapter } from '../../src/contract/adapter.js';

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
    time: {
      ticksPerDay: 10,
      ticksPerSeason: 40,
      ticksPerYear: 160,
      adultAge: 40,
      seasonAt: () => 'always',
    },
    cognitionDefaults: {
      thinkInterval: { base: 7, scale: 1, weights: [] },
      consolidateInterval: { base: 11, scale: 1, weights: [] },
      memoryHotCapacity: { base: 32, scale: 1, weights: [] },
    },
  });
}

/** The toy world, as the end-to-end test uses it. */
export const toyWorld = makeToyWorld('toy', 0.8);
