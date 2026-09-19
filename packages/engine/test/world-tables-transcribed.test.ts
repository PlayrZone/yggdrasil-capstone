import { foragerEdges } from '../src/index.js';
import { describe, expect, it } from 'vitest';
import { World } from '../src/core/World.js';
import { PerceptionSystem } from '../src/body/PerceptionSystem.js';
import { createGahallianBody } from '../src/body/GahallianBody.js';
import type { GahallianBody } from '../src/body/GahallianBody.js';
import { identityAt } from '../src/body/identities.js';
import { seasonAt } from '../src/body/Climate.js';
import { AgentMind } from '../src/agent/AgentMind.js';
import { RuleIntern } from '../src/knowledge/KnowledgeStore.js';
import { featureActive, traitCurveValue } from '../src/contract/adapter.js';
import { inlinePlace } from '../src/contract/wire.js';
import type { MemoryRecord, SimEvent, Traits } from '../src/contract/types.js';
import type { ContextFeatureKey, ContextFeatures, SimEventType } from '../src/worlds/forager/types.js';
import { importanceOf } from '../src/memory/importance.js';
import { memoryFromEvent } from '../src/memory/memoryFromEvent.js';
import { RelationshipStore } from '../src/relationships/RelationshipStore.js';
import { SuccessionMiner } from '../src/learning/SuccessionMiner.js';
import { installEventPipeline } from '../src/runner/EventPipeline.js';
import type { EventPipelineHost, ListenerSink } from '../src/runner/EventPipeline.js';
import { RunCounters } from '../src/runner/RunCounters.js';
import { ForagerNarrator } from '../src/runner/society/Narration.js';
import type { NarrativeAuthor } from '../src/runner/society/SocietySystem.js';
import { foragerAdapter } from '../src/worlds/forager/adapter.js';
import {
  BASE,
  DEFAULT_EXCLUDE,
  EVENT_DELTAS,
  EVENT_IDS,
  FEATURES,
  NEED_THRESHOLD,
  OBSERVER_APPLICABLE,
  WAS_MIND_OPTIONS,
  WAS_NEED_CRITICAL,
  WAS_NEED_PRESSING,
  wasFeatureActive,
  wasMemoryFromEvent,
} from './fixtures/foragerTablesBefore.js';
import type { Deltas } from './fixtures/foragerTablesBefore.js';

const foragerPlaces = foragerEdges.codec;

/**
 * W1-B1 MOVED TABLES; IT DID NOT WRITE THEM. `fixtures/foragerTablesBefore.ts`
 * holds them as they stood the moment before, copied out of the mind files they
 * lived in; this file checks the adapter reproduces every one exactly.
 *
 * It exists because the reflex goldens cannot see all of this. A reflex being
 * never gives anything away, never kills a predator and never consults the slow
 * mind, so `GaveItem`'s deltas, the prestige rule and the think cadence pass
 * through 3,000 golden ticks untouched — a transcription error in any of them
 * would have been invisible. Verified by breaking each: the goldens do not
 * move, and these do.
 */

describe('the forager tables, as they stood before the move', () => {
  it('declares every event the world has, in the same order, and no others', () => {
    expect(foragerAdapter.events.map((e) => e.id)).toEqual(EVENT_IDS);
  });

  it('carries the same salience for each', () => {
    expect(Object.fromEntries(foragerAdapter.events.map((e) => [e.id, e.salience]))).toEqual(BASE);
  });

  it('carries the same relationship deltas — including the empty one', () => {
    const moved: Partial<Record<SimEventType, Deltas>> = {};
    for (const e of foragerAdapter.events) {
      if (e.relationshipDeltas) moved[e.id as SimEventType] = { ...e.relationshipDeltas };
    }
    expect(moved).toEqual(EVENT_DELTAS);
    // Present-but-empty is not the same as absent: it still counts as having met.
    expect(foragerAdapter.eventById.get('SleptSafely')!.relationshipDeltas).toEqual({});
    expect(foragerAdapter.eventById.get('AteFood')!.relationshipDeltas).toBeUndefined();
  });

  it('applies exactly the same witness allowlist, with the same deltas', () => {
    const moved = foragerAdapter.events.filter((e) => e.observerDeltas).map((e) => e.id);
    expect(new Set(moved)).toEqual(OBSERVER_APPLICABLE);
    for (const id of moved) {
      expect(foragerAdapter.eventById.get(id)!.observerDeltas).toEqual(EVENT_DELTAS[id as SimEventType]);
    }
  });

  it('keeps the context features in the order the miners iterated them', () => {
    expect(foragerAdapter.context.map((c) => c.id)).toEqual(FEATURES);
  });

  it('projects each feature out of a context exactly as the miners did', () => {
    for (const nearWater of [false, true]) {
      for (const night of [false, true]) {
        for (const inShelter of [false, true]) {
          for (const elevationBand of [0, 1, 2]) {
            const context: ContextFeatures = { nearWater, night, inShelter, elevationBand };
            for (const schema of foragerAdapter.context) {
              expect(featureActive(context, schema), `${schema.id} in ${JSON.stringify(context)}`).toBe(
                wasFeatureActive(context, schema.id as ContextFeatureKey),
              );
            }
          }
        }
      }
    }
  });

  it('keeps every drive threshold, in the order the reflex policy scanned them', () => {
    expect(foragerAdapter.drives.map((d) => [d.id, d.pressingAt, d.criticalAt, d.actsAt])).toEqual([
      ['hunger', WAS_NEED_PRESSING, WAS_NEED_CRITICAL, NEED_THRESHOLD.hunger],
      ['rest', WAS_NEED_PRESSING, WAS_NEED_CRITICAL, NEED_THRESHOLD.rest],
      ['safety', WAS_NEED_PRESSING, WAS_NEED_CRITICAL, NEED_THRESHOLD.safety],
      ['socialConnection', WAS_NEED_PRESSING, WAS_NEED_CRITICAL, NEED_THRESHOLD.socialConnection],
    ]);
  });

  it('excludes the same events from succession mining, and the miner still reads it', () => {
    const moved = foragerAdapter.events.filter((e) => e.causal === false).map((e) => e.id);
    expect(new Set(moved)).toEqual(new Set(DEFAULT_EXCLUDE));
    const miner = new SuccessionMiner(foragerAdapter);
    for (const tick of [0, 10]) for (const type of DEFAULT_EXCLUDE) miner.observe(mem(tick, type));
    expect(miner.consolidate()).toEqual([]);
  });

  it('carries the prestige rule the pipeline used to hard-code', () => {
    expect(foragerAdapter.eventById.get('KilledPredator')!.prestige).toEqual({ respect: 5 });
    expect(foragerAdapter.eventById.get('BuiltStructure')!.prestige).toEqual({
      respect: 3,
      whenPayload: { key: 'buildKind', equals: 'shelter' },
    });
    expect(foragerAdapter.events.filter((e) => e.prestige)).toHaveLength(2);
  });

  it('names the one event that ends a life', () => {
    expect(foragerAdapter.events.filter((e) => e.endsLife).map((e) => e.id)).toEqual(['AgentDied']);
  });

  it('gives the same cognition parameters the expressions gave', () => {
    const divergences: string[] = [];
    for (let curiosity = 0; curiosity <= 100; curiosity += 0.5) {
      for (let ambition = 0; ambition <= 100; ambition += 0.5) {
        const tr: Traits = { curiosity, aggression: 0, compassion: 0, ambition, loyalty: 0, riskTolerance: 0 };
        for (const key of ['thinkInterval', 'consolidateInterval', 'memoryHotCapacity'] as const) {
          const was = WAS_MIND_OPTIONS[key](tr);
          const now = traitCurveValue(foragerAdapter.cognitionDefaults[key], tr);
          if (was !== now) divergences.push(`${key}(${curiosity},${ambition}): ${was} ≠ ${now}`);
        }
      }
    }
    expect(divergences.slice(0, 5)).toEqual([]);
  });

  it('declares exactly the events its narrator can author a story from', () => {
    const narrator = new ForagerNarrator({ nameOf: (id) => `#${id}` });
    const authorable = foragerAdapter.events
      .filter((e) =>
        narrator.storyFor({
          tick: 0,
          type: e.id,
          actorId: 1,
          targetIds: [2],
          x: 0,
          y: 0,
          // Both conditional narrations satisfied, so this asks "could it ever".
          payload: { cause: 'violence', buildKind: 'shelter' },
        }) !== null,
      )
      .map((e) => e.id);
    expect(authorable).toHaveLength(4); // a slaying, a violent death, a home, an attack
    expect(foragerAdapter.events.filter((e) => e.narratable).map((e) => e.id)).toEqual(authorable);
  });

  // The VALUES are pinned against the body's own constants in climate.test.ts,
  // which reaches the body through an import order that initialises it
  // correctly; this file cannot (it loads PerceptionSystem first, which is the
  // order the body's import cycle breaks under).
  /**
   * W1-B3 moved two more tables here — this world's verbs and its stuff. They
   * are transcribed the same way, against the same kind of independent
   * "before" (`fixtures/foragerVerbsBefore.ts`), in `world-actions.test.ts`;
   * the counts are pinned here so a member added in either place reddens a test
   * in both files rather than only in the one someone remembered to open.
   */
  it('declares this world’s verbs and stuff, in the numbers it had', () => {
    expect(foragerAdapter.actions).toHaveLength(16);
    expect(foragerAdapter.kinds).toHaveLength(55);
    expect(foragerAdapter.reflexPolicy).toBeDefined();
  });

  it('keeps the clock the runtime, the recorder and the founders read', () => {
    expect(foragerAdapter.time).toMatchObject({
      ticksPerDay: 2400,
      ticksPerSeason: 9600,
      ticksPerYear: 38400,
      adultAge: 9600,
    });
    // And hands out the body's OWN season function, not a second copy of it.
    expect(foragerAdapter.time.seasonAt).toBe(seasonAt);
  });
});

function mem(tick: number, type: SimEventType): MemoryRecord {
  return {
    id: tick * 100 + EVENT_IDS.indexOf(type),
    tick,
    type,
    subjects: [],
    context: { nearWater: false, night: false, inShelter: false, elevationBand: 0 },
    needDeltas: {},
    outcome: 'neutral',
    summaryText: type,
    importance: importanceOf(foragerAdapter, type, {}),
    origin: 'experience',
  };
}

describe('the perspective switch became data without changing', () => {
  const CONTEXT: ContextFeatures = { nearWater: true, night: false, inShelter: false, elevationBand: 2 };
  const PAYLOADS: Record<string, unknown>[] = [
    {},
    { needDeltas: { hunger: -40 }, targetNeedDeltas: { safety: 12 }, objectKind: 'berry' },
    { killerId: 7 },
    { killerId: 3 }, // the witness's own id, below — a killer does not fear itself
    { killerId: 'nobody' },
    { utterance: { speechAct: 'inform', text: 'hello' }, inputs: { wood: 2 } },
  ];

  it('produces the identical memory for every event, every perspective, every payload', () => {
    const divergences: string[] = [];
    for (const type of EVENT_IDS) {
      for (const payload of PAYLOADS) {
        const event: SimEvent = { tick: 42, type, actorId: 1, targetIds: [2], x: 5, y: 6, payload };
        for (const selfId of [1, 2, 3]) {
          const was = wasMemoryFromEvent(event, selfId, CONTEXT);
          const built = memoryFromEvent(foragerAdapter, event, selfId, CONTEXT, foragerPlaces.placeOf(event));
          // W1-B4: the memory holds an opaque place where it held `x`/`y`, and
          // the place IS those two fields — so what is compared is the memory
          // as it WRITES (`inlinePlace`, through the world's own `space.encode`), which is the form a corpus row and a
          // digest have always seen. Same bytes, same slot, same order.
          const now = built === undefined ? undefined : inlinePlace(foragerEdges.codec, built);
          if (JSON.stringify(was) !== JSON.stringify(now)) {
            divergences.push(`${type}/self=${selfId}/${JSON.stringify(payload)}`);
          }
        }
      }
    }
    expect(divergences).toEqual([]);
  });

  it('is a comparison that can fail', () => {
    const died: SimEvent = { tick: 1, type: 'AgentDied', actorId: 1, targetIds: [], x: 0, y: 0, payload: { killerId: 7 } };
    const bystander = memoryFromEvent(foragerAdapter, died, 3, CONTEXT, foragerPlaces.placeOf(died))!;
    expect(bystander.type).toBe('WitnessedDeath');
    expect(bystander.causedBy).toBe(7);
    expect(JSON.stringify(bystander)).not.toEqual(
      JSON.stringify(memoryFromEvent(foragerAdapter, died, 1, CONTEXT, foragerPlaces.placeOf(died))),
    );
  });
});

describe('the relationship deltas reach a record the same way', () => {
  it('moves the same scalars on the same events, participant and witness', () => {
    for (const type of EVENT_IDS) {
      const store = new RelationshipStore(foragerAdapter);
      store.applyEvent(9, type, 100);
      const was = EVENT_DELTAS[type];
      if (!was) {
        expect(store.get(9), `${type} should not have opened a record`).toBeUndefined();
      } else {
        const r = store.get(9)!;
        expect({ trust: r.trust, respect: r.respect, friendship: r.friendship, fear: r.fear }, type).toEqual({
          trust: 50 + (was.trust ?? 0),
          respect: 50 + (was.respect ?? 0),
          friendship: 50 + (was.friendship ?? 0),
          fear: Math.max(0, was.fear ?? 0),
        });
        expect(r.interactionCount, type).toBe(1);
      }

      const witness = new RelationshipStore(foragerAdapter);
      witness.applyObservedEvent(9, type, 100);
      if (OBSERVER_APPLICABLE.has(type)) {
        expect(witness.get(9)!.fear, type).toBe(was!.fear ?? 0);
        expect(witness.get(9)!.interactionCount, type).toBe(0); // watching is not interacting
      } else {
        expect(witness.get(9), type).toBeUndefined();
      }
    }
  });
});

describe('the prestige rule reaches a witness the same way', () => {
  /** Two beings side by side, watching each other through the real pipeline. */
  function rig(leadership: boolean): { emit: (e: SimEvent) => void; minds: Map<number, AgentMind> } {
    const world = new World();
    const listeners: ((e: SimEvent) => void)[] = [];
    const bus: ListenerSink = {
      on: (l) => {
        listeners.push(l);
        return () => void 0;
      },
    };
    const minds = new Map<number, AgentMind>();
    const bodies = new Map<number, GahallianBody>();
    for (const [x, y] of [
      [50, 50],
      [52, 52],
    ]) {
      const body = createGahallianBody('', identityAt(0).traits, 0);
      const e = world.createEntity({ Transform2D: { x: x!, y: y! }, GahallianBody: body });
      bodies.set(e.id, body);
      minds.set(e.id, new AgentMind(e.id, foragerAdapter));
    }
    const narrator: NarrativeAuthor = { storyFor: () => null };
    const host: EventPipelineHost = {
      world,
      bus,
      perception: new PerceptionSystem(),
      minds,
      counters: new RunCounters(),
      agentBody: (id) => bodies.get(id),
    };
    installEventPipeline(host, {
      world: foragerAdapter,
    edges: foragerEdges,
      narrator,
      leadership,
      tombstoneRules: new RuleIntern(),
      recorder: null,
    });
    return { emit: (e) => listeners.forEach((l) => l(e)), minds };
  }

  /** What the OTHER being now thinks of the actor, after watching it act. */
  function respectOfActor(event: SimEvent, leadership = true): number | undefined {
    const r = rig(leadership);
    r.emit(event);
    return r.minds.get(2)!.relationships.get(1)?.respect;
  }

  const at = { actorId: 1, targetIds: [] as number[], x: 50, y: 50, tick: 5 };

  it('gives +5 for a slain predator and +3 for a raised shelter', () => {
    expect(respectOfActor({ ...at, type: 'KilledPredator', payload: {} })).toBe(55);
    expect(respectOfActor({ ...at, type: 'BuiltStructure', payload: { buildKind: 'shelter' } })).toBe(53);
  });

  // Nothing granted means no record was ever opened — not a neutral one.
  it('gives nothing for a build that is not a shelter, or for any other deed', () => {
    expect(respectOfActor({ ...at, type: 'BuiltStructure', payload: { buildKind: 'wall' } })).toBeUndefined();
    expect(respectOfActor({ ...at, type: 'Crafted', payload: {} })).toBeUndefined();
  });

  it('gives nothing at all when the run says respect does not grow', () => {
    expect(respectOfActor({ ...at, type: 'KilledPredator', payload: {} }, false)).toBeUndefined();
  });
});
