import { describe, expect, it } from 'vitest';
import { World } from '../src/core/World.js';
import { SimEventBus } from '../src/body/SimEventBus.js';
import { PerceptionSystem } from '../src/body/PerceptionSystem.js';
import { createGahallianBody } from '../src/body/GahallianBody.js';
import type { GahallianBody } from '../src/body/GahallianBody.js';
import { AgentMind } from '../src/agent/AgentMind.js';
import { RuleIntern } from '../src/knowledge/KnowledgeStore.js';
import { identityAt } from '../src/body/identities.js';
import type { SimEvent } from '../src/contract/types.js';
import { installEventPipeline } from '../src/runner/EventPipeline.js';
import type { EventPipelineHost } from '../src/runner/EventPipeline.js';
import { RunCounters } from '../src/runner/RunCounters.js';
import type { NarrativeAuthor } from '../src/runner/society/SocietySystem.js';

/**
 * The order the bus listeners are registered in IS the semantics — the
 * recorder's two passes must bracket the world's, and entombing must come
 * last. Before W1-A that order was four `bus.on` calls buried in a 1,400-line
 * constructor with a comment asking you to believe it. It now has one home
 * (`EventPipeline`) and this test.
 */

const SPEAR_TRAITS = identityAt(0).traits;

function died(actorId: number, tick = 10): SimEvent {
  return { tick, type: 'AgentDied', actorId, targetIds: [], x: 50, y: 50, payload: { cause: 'violence' } };
}

interface Rig {
  host: EventPipelineHost & { world: World; bus: SimEventBus; counters: RunCounters };
  order: string[];
  minds: Map<number, AgentMind>;
  bodyOf: (id: number) => GahallianBody;
}

function rig(withRecorder: boolean): Rig {
  const world = new World();
  const bus = new SimEventBus();
  const minds = new Map<number, AgentMind>();
  const order: string[] = [];
  const bodies = new Map<number, GahallianBody>();

  const spawn = (x: number, y: number): number => {
    const body = createGahallianBody('', SPEAR_TRAITS, 0);
    const e = world.createEntity({ Transform2D: { x, y }, GahallianBody: body });
    bodies.set(e.id, body);
    minds.set(e.id, new AgentMind(e.id));
    return e.id;
  };
  spawn(50, 50);
  spawn(52, 52);

  const narrator: NarrativeAuthor = {
    storyFor: () => {
      order.push('narrate');
      return null;
    },
  };
  const host = {
    world,
    bus,
    perception: new PerceptionSystem(),
    minds,
    counters: new RunCounters(),
    agentBody: (id: number): GahallianBody | undefined => bodies.get(id),
  };
  installEventPipeline(host, {
    narrator,
    leadership: true,
    tombstoneRules: new RuleIntern(),
    recorder: withRecorder
      ? {
          observeBefore: () => order.push('before'),
          observeAfter: () => order.push('after'),
        }
      : null,
  });
  return { host, order, minds, bodyOf: (id) => bodies.get(id)! };
}

describe('event pipeline listener order', () => {
  it('brackets the world pass with the recorder: before · world · after · entomb', () => {
    const r = rig(true);
    const id = r.host.world.getEntity(1)!.id;
    r.bodyOf(id).alive = false;
    const mind = r.minds.get(id)!;
    // Something in the episodic tier, so entombing is observable.
    mind.observe({
      tick: 1,
      type: 'AteFood',
      subjects: [],
      context: { nearWater: false, night: false, inShelter: false, elevationBand: 0 },
      needDeltas: {},
      outcome: 'success',
      summaryText: 'ate',
      importance: 0.5,
      origin: 'experience',
    });
    expect(mind.memory.all().length).toBe(1);

    r.host.bus.emit(died(id));

    // 'narrate' is the first thing the world pass does, so it stands for it.
    expect(r.order).toEqual(['before', 'narrate', 'after']);
    // …and the entombing listener ran after all three.
    expect(mind.memory.all().length).toBe(0);
    expect(mind.learners.length).toBe(0);
  });

  it('registers only the world pass and the entombing one when nothing is recorded', () => {
    const r = rig(false);
    const id = 1;
    r.bodyOf(id).alive = false;
    r.host.bus.emit(died(id));
    expect(r.order).toEqual(['narrate']);
  });

  it('never entombs a being the body still holds alive (an authored death)', () => {
    const r = rig(true);
    const mind = r.minds.get(1)!;
    const learners = mind.learners.length;
    r.host.bus.emit(died(1)); // body.alive is still true
    expect(mind.learners.length).toBe(learners);
  });

  it('counts the event before anything subjective happens to it', () => {
    const r = rig(false);
    r.host.bus.emit(died(1));
    expect(r.host.counters.eventCount).toBe(1);
    expect(r.host.counters.deathsByCause['violence']).toBe(1);
  });
});
