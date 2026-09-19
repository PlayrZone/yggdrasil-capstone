import { describe, expect, it } from 'vitest';
import { AgentMind } from '../src/agent/AgentMind.js';
import { defineWorld, traitCurveValue } from '../src/contract/adapter.js';
import type { SimEvent, Traits } from '../src/contract/types.js';
import type { ContextFeatures } from '../src/worlds/forager/types.js';
import { importanceOf } from '../src/memory/importance.js';
import { memoryFromEvent } from '../src/memory/memoryFromEvent.js';
import { foragerAdapter } from '../src/worlds/forager/adapter.js';
import { makeToyWorld, toyWorld } from './fixtures/toyAdapter.js';

/**
 * The mind, run in a world that is not this one. Everything here is fed to the
 * SAME classes the forager continent uses; only the adapter differs. A mind
 * module that kept a table of its own shows up as a wrong number.
 */

/** The toy world's one feature reads the `nearWater` slot; it calls it something else. */
const IN_IT: ContextFeatures = { nearWater: true, night: false, inShelter: false, elevationBand: 0 };
const OUT_OF_IT: ContextFeatures = { nearWater: false, night: false, inShelter: false, elevationBand: 0 };

function event(type: SimEvent['type'], actorId: number, targetIds: number[] = [], tick = 0): SimEvent {
  return { tick, type, actorId, targetIds, x: 0, y: 0, payload: {} };
}

describe('a mind in a toy world', () => {
  it('remembers with the toy world’s salience, not the forager’s', () => {
    expect(importanceOf(toyWorld, 'ReceivedItem', {})).toBe(0.8);
    expect(importanceOf(foragerAdapter, 'ReceivedItem', {})).toBe(0.6);
  });

  it('takes its perspectives from the toy world’s roles', () => {
    const given = event('GaveItem', 1, [2]);
    // The giver remembers giving; the receiver remembers receiving — both worlds.
    expect(memoryFromEvent(toyWorld, given, 1, OUT_OF_IT)?.type).toBe('GaveItem');
    expect(memoryFromEvent(toyWorld, given, 2, OUT_OF_IT)?.type).toBe('ReceivedItem');
    // …but in the toy world a bystander sees nothing at all, where a forager
    // bystander records an observation. Same code, different world.
    expect(memoryFromEvent(toyWorld, given, 3, OUT_OF_IT)).toBeUndefined();
    expect(memoryFromEvent(foragerAdapter, given, 3, OUT_OF_IT)?.origin).toBe('observation');
  });

  it('moves relationships by the toy world’s deltas', () => {
    const mind = new AgentMind(1, toyWorld);
    mind.observe(memoryFromEvent(toyWorld, event('GaveItem', 2, [1]), 1, OUT_OF_IT)!);
    const r = mind.relationships.get(2)!;
    expect({ trust: r.trust, friendship: r.friendship }).toEqual({ trust: 80, friendship: 90 });

    // The forager world, same act, same class: its own much smaller numbers.
    const forager = new AgentMind(1, foragerAdapter);
    forager.observe(memoryFromEvent(foragerAdapter, event('GaveItem', 2, [1]), 1, OUT_OF_IT)!);
    const f = forager.relationships.get(2)!;
    expect({ trust: f.trust, friendship: f.friendship }).toEqual({ trust: 56, friendship: 55 });
  });

  it('mines knowledge over the toy world’s one context feature', () => {
    const mind = new AgentMind(1, toyWorld, { consolidateInterval: 1 });
    // Five meals in it, five gifts out of it: the feature co-occurs with eating
    // at twice chance, which clears the miner's lift threshold.
    for (let i = 0; i < 5; i++) {
      mind.observe(memoryFromEvent(toyWorld, event('AteFood', 1, [], i), 1, IN_IT)!);
      mind.observe(memoryFromEvent(toyWorld, event('GaveItem', 1, [2], i), 1, OUT_OF_IT)!);
    }
    mind.consolidate(100);

    const held = mind.knowledge.held().map((k) => k.rule);
    const association = held.find((r) => r.kind === 'context-association');
    // The feature it learned is the TOY'S id — and the forager feature whose
    // slot that id happens to read is false in every one of those memories, so
    // no leftover table could have produced this.
    expect(association).toMatchObject({ event: 'AteFood', feature: 'inShelter', direction: 'positive' });
    expect(held.every((r) => r.kind !== 'context-association' || r.feature === 'inShelter')).toBe(true);
  });
});

describe('two worlds in one process', () => {
  it('never lets one world colour another', () => {
    const rich = makeToyWorld('rich', 0.9);
    const plain = makeToyWorld('plain', 0.2);
    const inhabitants = [
      { world: rich, mind: new AgentMind(1, rich), salience: 0.9 },
      { world: plain, mind: new AgentMind(2, plain), salience: 0.2 },
      { world: foragerAdapter, mind: new AgentMind(3, foragerAdapter), salience: 0.6 },
      { world: rich, mind: new AgentMind(4, rich), salience: 0.9 },
    ];
    // Interleaved, so an accidental shared table would be overwritten between
    // beings rather than merely being wrong once.
    for (let tick = 0; tick < 4; tick++) {
      for (const { world, mind } of inhabitants) {
        const received = event('ReceivedItem', 9, [mind.agentId], tick);
        mind.observe(memoryFromEvent(world, received, mind.agentId, OUT_OF_IT)!);
      }
    }
    for (const { mind, salience } of inhabitants) {
      expect(mind.memory.all().map((m) => m.importance), `#${mind.agentId}`).toEqual([
        salience,
        salience,
        salience,
        salience,
      ]);
    }
    // …and the two toy worlds still say what they said.
    expect(rich.eventById.get('ReceivedItem')!.salience).toBe(0.9);
    expect(plain.eventById.get('ReceivedItem')!.salience).toBe(0.2);
  });

  it('hands out a world nothing can write back into', () => {
    expect(Object.isFrozen(foragerAdapter)).toBe(true);
    expect(Object.isFrozen(foragerAdapter.events)).toBe(true);
    expect(Object.isFrozen(foragerAdapter.eventById.get('ReceivedItem'))).toBe(true);
    expect(Object.isFrozen(foragerAdapter.eventById.get('ReceivedItem')!.relationshipDeltas)).toBe(true);
  });

  it('indexes exactly the events it declares', () => {
    for (const world of [foragerAdapter, toyWorld]) {
      expect(world.eventById.size).toBe(world.events.length);
      for (const e of world.events) expect(world.eventById.get(e.id)).toBe(e);
    }
  });
});

describe('a world is sealed when it is defined', () => {
  it('reads a trait curve as the world wrote it', () => {
    const traits: Traits = { curiosity: 10, aggression: 0, compassion: 0, ambition: 4, loyalty: 0, riskTolerance: 0 };
    expect(traitCurveValue({ base: 100, scale: -2, weights: [['curiosity', 1], ['ambition', 0.5]] }, traits)).toBe(76);
    expect(traitCurveValue({ base: 7, scale: 1, weights: [] }, traits)).toBe(7);
  });

  it('rejects nothing, but freezes everything it is given', () => {
    const world = defineWorld({
      id: 'probe',
      version: '1',
      drives: [{ id: 'hunger', pressingAt: 1, criticalAt: 2, actsAt: 0 }],
      context: [],
      events: [{ id: 'AteFood', salience: 0.5 }],
      time: { ticksPerDay: 1, ticksPerSeason: 1, ticksPerYear: 1, adultAge: 1, seasonAt: () => 'one' },
      cognitionDefaults: {
        thinkInterval: { base: 1, scale: 1, weights: [] },
        consolidateInterval: { base: 1, scale: 1, weights: [] },
        memoryHotCapacity: { base: 1, scale: 1, weights: [] },
      },
    });
    expect(Object.isFrozen(world.drives[0])).toBe(true);
    expect(() => {
      (world.events[0] as { salience: number }).salience = 9;
    }).toThrow();
  });
});
