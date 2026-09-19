import { describe, expect, it } from 'vitest';
import { AgentMind } from '../src/agent/AgentMind.js';
import { defineWorld, emptyContext, heardEvent } from '../src/contract/adapter.js';
import type { EventSchema, WorldAdapter } from '../src/contract/adapter.js';
import type { ContextRecord } from '../src/contract/ids.js';
import type { KnowledgeRule, MemoryRecord, SimEvent } from '../src/contract/types.js';
import { memoryFromEvent } from '../src/memory/memoryFromEvent.js';
import { WorldGate } from '../src/contract/gate.js';
import { foragerAdapter } from '../src/worlds/forager/adapter.js';
import { toyWorld } from './fixtures/toyAdapter.js';
import { CTX } from './helpers.js';

/**
 * THE EDGE BETWEEN A WORLD AND A MIND (W1-B2).
 *
 * The mind holds opaque ids, so nothing in its types can tell it whether the
 * world it lives in has heard of one. These are the four places that question
 * is asked, plus the proof that a world handed to a mind is genuinely
 * read-only — the W1-B1 verifier demonstrated that `eventById.set(...)` edited
 * the world for every mind on it.
 */

const event = (type: string, actorId = 1, targetIds: number[] = []): SimEvent => ({
  tick: 5,
  type,
  actorId,
  targetIds,
  x: 0,
  y: 0,
  payload: {},
});

describe('a world cannot be written back into', () => {
  const mutators: [string, (m: Map<string, EventSchema>) => unknown][] = [
    ['set', (m) => m.set('AteFood', { id: 'AteFood', salience: 0.99 })],
    ['delete', (m) => m.delete('AteFood')],
    ['clear', (m) => m.clear()],
  ];

  for (const [name, mutate] of mutators) {
    it(`refuses eventById.${name}`, () => {
      const live = foragerAdapter.eventById as Map<string, EventSchema>;
      expect(() => mutate(live)).toThrow(TypeError);
      expect(foragerAdapter.eventById.get('AteFood')!.salience).toBe(0.25);
      expect(foragerAdapter.eventById.size).toBe(29);
    });
  }

  it('still reads like the Map it replaced', () => {
    const table = foragerAdapter.eventById;
    expect(table.has('AteFood')).toBe(true);
    expect(table.has('nothing-of-the-sort')).toBe(false);
    expect(table.get('nothing-of-the-sort')).toBeUndefined();
    expect([...table.keys()]).toEqual(foragerAdapter.events.map((e) => e.id));
    expect([...table.values()]).toEqual([...foragerAdapter.events]);
    expect([...table].map(([id]) => id)).toEqual(foragerAdapter.events.map((e) => e.id));
    expect([...table.entries()].map(([, schema]) => schema.salience)).toEqual(
      foragerAdapter.events.map((e) => e.salience),
    );
    const seen: string[] = [];
    table.forEach((schema, id, map) => {
      seen.push(id);
      expect(map).toBe(table);
      expect(schema).toBe(foragerAdapter.eventById.get(id));
    });
    expect(seen).toEqual(foragerAdapter.events.map((e) => e.id));
  });

  it('is frozen as an object too — the table cannot be swapped out', () => {
    expect(Object.isFrozen(foragerAdapter.eventById)).toBe(true);
    expect(Object.isFrozen(foragerAdapter)).toBe(true);
  });
});

describe('an event the world does not declare forms no memory', () => {
  it('is refused rather than remembered with no salience', () => {
    const gate = new WorldGate();
    expect(memoryFromEvent(foragerAdapter, event('SoldShares'), 1, CTX, gate)).toBeUndefined();
    expect(gate.counts.undeclaredEvent).toBe(1);
    // …and a declared one still is.
    expect(memoryFromEvent(foragerAdapter, event('AteFood'), 1, CTX, gate)?.importance).toBe(0.25);
    expect(gate.counts.undeclaredEvent).toBe(1);
  });

  it('is refused when a ROLE records it as something undeclared', () => {
    // A world that knows how to GIVE but has no word for being given to.
    const half = defineWorld({
      id: 'half',
      version: '1',
      drives: [],
      context: [],
      events: [{ id: 'GaveItem', salience: 0.5, roles: { target: { recordsAs: 'ReceivedItem' } } }],
      actions: [],
      kinds: [],
      time: { ticksPerDay: 1, ticksPerSeason: 1, ticksPerYear: 1, adultAge: 1, seasonAt: () => 'one' },
      cognitionDefaults: {
        thinkInterval: { base: 1, scale: 1, weights: [] },
        consolidateInterval: { base: 1, scale: 1, weights: [] },
        memoryHotCapacity: { base: 1, scale: 1, weights: [] },
      },
    });
    const gate = new WorldGate();
    // The giver remembers giving — that id is declared.
    expect(memoryFromEvent(half, event('GaveItem', 1, [2]), 1, CTX, gate)?.type).toBe('GaveItem');
    // The receiver would remember an id this world never declared.
    expect(memoryFromEvent(half, event('GaveItem', 1, [2]), 2, CTX, gate)).toBeUndefined();
    expect(gate.counts.undeclaredEvent).toBe(1);
  });

  it('never fires in the forager world, because the body emits only what it declares', () => {
    const gate = new WorldGate();
    for (const schema of foragerAdapter.events) {
      for (const selfId of [1, 2, 3]) {
        memoryFromEvent(foragerAdapter, event(schema.id, 1, [2]), selfId, CTX, gate);
      }
    }
    expect(gate.counts).toEqual({
      undeclaredEvent: 0,
      undeclaredMemory: 0,
      undeclaredDrive: 0,
      undeclaredTestimony: 0,
      undeclaredAction: 0,
      badParam: 0,
      deferredParam: 0,
      authoredClamp: 0,
    });
  });
});

describe('what a HOST offers a mind is checked too', () => {
  const record = (type: string): Omit<MemoryRecord, 'id'> => ({
    tick: 1,
    type,
    subjects: [],
    context: CTX,
    needDeltas: {},
    outcome: 'neutral',
    summaryText: type,
    importance: 0.5,
    origin: 'experience',
  });

  it('refuses a memory naming an event this world has never heard of', () => {
    const mind = new AgentMind(1, foragerAdapter);
    expect(mind.observe(record('SoldShares'))).toBeUndefined();
    expect(mind.memory.totalCount).toBe(0);
    expect(mind.gate.counts.undeclaredMemory).toBe(1);
    expect(mind.observe(record('AteFood'))?.id).toBe(1);
    expect(mind.gate.counts.undeclaredMemory).toBe(1);
  });

  it('refuses testimony that names something undeclared, and keeps the rest', () => {
    const mind = new AgentMind(1, foragerAdapter);
    const heard = (rule: KnowledgeRule): Omit<MemoryRecord, 'id'> => ({
      ...record('UtteranceSpoken'),
      origin: 'testimony',
      toldBy: 9,
      utterance: { speechAct: 'share-knowledge', rule, ruleConfidence: 0.9 },
    });
    mind.observe(
      heard({ kind: 'succession', causeType: 'AteFood', effectType: 'BoughtLunch' }),
    );
    expect(mind.knowledge.all()).toEqual([]);
    expect(mind.gate.counts.undeclaredTestimony).toBe(1);

    mind.observe(heard({ kind: 'succession', causeType: 'AteFood', effectType: 'BecameSick' }));
    expect(mind.knowledge.all()).toHaveLength(1);
    expect(mind.gate.counts.undeclaredTestimony).toBe(1);
    // The memory of HEARING it is kept either way — you were spoken to.
    expect(mind.memory.totalCount).toBe(2);
  });

  it('checks every id a rule can name, and nothing a world has not declared yet', () => {
    const gate = new WorldGate();
    const undeclared: KnowledgeRule[] = [
      { kind: 'context-association', event: 'AteFood', feature: 'indoors', direction: 'positive' },
      { kind: 'context-association', event: 'BoughtLunch', feature: 'night', direction: 'positive' },
      { kind: 'succession', causeType: 'BoughtLunch', effectType: 'AteFood' },
      { kind: 'outcome-association', actionType: 'AteFood', feature: null, need: 'money', direction: 'relieves' },
      { kind: 'outcome-association', actionType: 'AteFood', feature: 'indoors', need: 'hunger', direction: 'relieves' },
      // W1-B3: kinds are declared now, so a recipe for a thing this world does
      // not contain is refused rather than taken on trust — it could never be
      // made, reinforced or contradicted.
      { kind: 'craft-recipe', output: 'hovercraft', inputs: { wood: 2 } },
      { kind: 'craft-recipe', output: 'spear', inputs: { unobtainium: 2 } },
      { kind: 'succession', causeType: 'AteFood', causeObject: 'ambrosia', effectType: 'BecameSick' },
      { kind: 'context-association', event: 'AteFood', objectKind: 'ambrosia', feature: 'night', direction: 'positive' },
    ];
    for (const rule of undeclared) expect(gate.admitTestimony(foragerAdapter, rule)).toBe(false);
    expect(gate.counts.undeclaredTestimony).toBe(undeclared.length);

    const declared: KnowledgeRule[] = [
      { kind: 'context-association', event: 'AteFood', feature: 'highland', direction: 'negative' },
      { kind: 'context-association', event: 'AteFood', objectKind: 'berry', feature: 'night', direction: 'positive' },
      { kind: 'succession', causeType: 'AteFood', causeObject: 'mushroomRed', effectType: 'BecameSick' },
      { kind: 'outcome-association', actionType: 'AteFood', feature: 'night', need: 'hunger', direction: 'relieves' },
      { kind: 'social-contingency', partnerId: 4, pattern: 'generous' },
      // A recipe every part of which this world contains — the shape the
      // engine's own `seedRecipe` produces out of `CRAFT_RECIPES`.
      { kind: 'craft-recipe', output: 'spear', inputs: { wood: 1, stone: 1 } },
    ];
    for (const rule of declared) expect(gate.admitTestimony(foragerAdapter, rule)).toBe(true);
    expect(gate.counts.undeclaredTestimony).toBe(undeclared.length);
  });
});

describe('a pressure the world declares no drive for', () => {
  it('is counted, and the snapshot is left exactly as the body wrote it', () => {
    const mind = new AgentMind(1, foragerAdapter);
    const needs = { hunger: 10, rest: 20, safety: 30, socialConnection: 40, bandwidth: 99 };
    const snapshot = {
      id: 1,
      name: 'x',
      ageTicks: 0,
      traits: { curiosity: 0, aggression: 0, compassion: 0, ambition: 0, loyalty: 0, riskTolerance: 0 },
      needs,
      health: 100,
      sick: false,
      x: 0,
      y: 0,
      inventory: {},
      context: CTX,
    };
    const view = { tick: 0, night: false, season: 'spring', agents: [], resources: [], structures: [] };
    const built = mind.buildThinkInput(snapshot, view, 'periodic');
    expect(mind.gate.counts.undeclaredDrive).toBe(1);
    expect(built.snapshot.needs).toBe(needs); // not rewritten — a record must hold what was shown
    expect(Object.keys(built.snapshot.needs)).toEqual([...Object.keys(needs)]);
  });

  it('stays at zero for a body that reports what its world declares', () => {
    const mind = new AgentMind(1, foragerAdapter);
    mind.buildThinkInput(
      {
        id: 1,
        name: 'x',
        ageTicks: 0,
        traits: { curiosity: 0, aggression: 0, compassion: 0, ambition: 0, loyalty: 0, riskTolerance: 0 },
        needs: { hunger: 1, rest: 2, safety: 3, socialConnection: 4 },
        health: 100,
        sick: false,
        x: 0,
        y: 0,
        inventory: {},
        context: CTX,
      },
      { tick: 0, night: false, season: 'spring', agents: [], resources: [], structures: [] },
      'periodic',
    );
    expect(mind.gate.counts.undeclaredDrive).toBe(0);
  });
});

describe('an idea whispered in from outside comes from the HOST', () => {
  it('reads the forager world’s own answers — the literal injectIdea used to hold', () => {
    expect(heardEvent(foragerAdapter)).toBe('UtteranceSpoken');
    const nowhere = emptyContext(foragerAdapter);
    expect(nowhere).toEqual({ nearWater: false, night: false, inShelter: false, elevationBand: 0 });
    // Key ORDER is part of the answer: a memory's context is serialized into
    // the corpus, and reordering it would change the bytes of every row.
    expect(Object.keys(nowhere)).toEqual(['nearWater', 'night', 'inShelter', 'elevationBand']);
  });

  it('lands the same memory the hard-coded one did', () => {
    const mind = new AgentMind(1, foragerAdapter);
    mind.injectIdea('try making something', 7, heardEvent(foragerAdapter)!, emptyContext(foragerAdapter));
    expect(mind.memory.all()).toEqual([
      {
        id: 1,
        tick: 7,
        type: 'UtteranceSpoken',
        subjects: [],
        context: { nearWater: false, night: false, inShelter: false, elevationBand: 0 },
        needDeltas: {},
        outcome: 'neutral',
        summaryText: 'A thought came to you: "try making something"',
        importance: 0.97,
        origin: 'testimony',
        toldBy: 0,
        utterance: { speechAct: 'inform', text: 'try making something' },
      },
    ]);
  });

  it('answers for a world of its own, and refuses one it cannot place', () => {
    // The toy world declares no `heard` role at all: nothing there carries a
    // telling, so nothing can be whispered into it.
    expect(heardEvent(toyWorld)).toBeUndefined();
    const mind = new AgentMind(1, toyWorld);
    mind.injectIdea('hello', 1, 'UtteranceSpoken', {});
    expect(mind.memory.totalCount).toBe(0);
    expect(mind.gate.counts.undeclaredMemory).toBe(1);
  });

  it('builds an empty context out of whatever features a world declares', () => {
    const banded: WorldAdapter = defineWorld({
      id: 'banded',
      version: '1',
      drives: [],
      context: [
        { id: 'deep', source: 'depth', kind: 'band', band: 0 },
        { id: 'wet', source: 'wet', kind: 'flag' },
      ],
      events: [],
      actions: [],
      kinds: [],
      time: { ticksPerDay: 1, ticksPerSeason: 1, ticksPerYear: 1, adultAge: 1, seasonAt: () => 'one' },
      cognitionDefaults: {
        thinkInterval: { base: 1, scale: 1, weights: [] },
        consolidateInterval: { base: 1, scale: 1, weights: [] },
        memoryHotCapacity: { base: 1, scale: 1, weights: [] },
      },
    });
    const nowhere: ContextRecord = emptyContext(banded);
    expect(nowhere).toEqual({ depth: 1, wet: false }); // a band declared at 0 must not read as active
    for (const feature of banded.context) {
      expect(nowhere[feature.source] === feature.band, feature.id).toBe(false);
    }
  });
});
