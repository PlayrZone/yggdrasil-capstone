import { describe, expect, it } from 'vitest';
import { World } from '../src/core/World.js';
import { PerceptionSystem } from '../src/body/PerceptionSystem.js';
import { createGahallianBody } from '../src/body/GahallianBody.js';
import type { GahallianBody } from '../src/body/GahallianBody.js';
import { AgentMind } from '../src/agent/AgentMind.js';
import { foragerAdapter, foragerEdges } from '../src/worlds/forager/adapter.js';
import { RuleIntern } from '../src/knowledge/KnowledgeStore.js';
import { identityAt } from '../src/body/identities.js';
import type { SimEvent } from '../src/contract/types.js';
import { installEventPipeline } from '../src/runner/EventPipeline.js';
import type { EventPipelineHost, ListenerSink } from '../src/runner/EventPipeline.js';
import { RunCounters } from '../src/runner/RunCounters.js';
import type { NarrativeAuthor } from '../src/runner/society/SocietySystem.js';

/**
 * The order the bus listeners are registered in IS the semantics — the
 * recorder's two passes must bracket the world's, and entombing must come
 * last.
 *
 * Positions 1–3 are load bearing behaviourally. Position 4 is NOT, today: the
 * verifier moved `entomb` to first over 73 deaths and every fingerprint held,
 * because nothing above it reads what it frees (see `EventPipeline.ts`). So
 * this file asserts the registration LIST, not a consequence: it captures the
 * four listeners as they are registered and identifies each one. That fails
 * when entomb moves even though no behaviour changes.
 */

const TRAITS = identityAt(0).traits;

function died(actorId: number, tick = 10): SimEvent {
  return { tick, type: 'AgentDied', actorId, targetIds: [], x: 50, y: 50, payload: { cause: 'violence' } };
}

/** A bus that only remembers, in order, what was registered on it. */
class CapturingSink implements ListenerSink {
  readonly listeners: ((event: SimEvent) => void)[] = [];
  on(listener: (event: SimEvent) => void): () => void {
    this.listeners.push(listener);
    return () => void 0;
  }
}

interface Rig {
  host: EventPipelineHost & { bus: CapturingSink; counters: RunCounters };
  narrated: SimEvent[];
  before: SimEvent[];
  after: SimEvent[];
  observeBefore: (e: SimEvent) => void;
  observeAfter: (e: SimEvent) => void;
  minds: Map<number, AgentMind>;
  bodyOf: (id: number) => GahallianBody;
  /** A being that is dead and still holds an episode + its miners. */
  freshCorpse: () => number;
}

function rig(withRecorder: boolean): Rig {
  const world = new World();
  const bus = new CapturingSink();
  const minds = new Map<number, AgentMind>();
  const bodies = new Map<number, GahallianBody>();
  const narrated: SimEvent[] = [];
  const before: SimEvent[] = [];
  const after: SimEvent[] = [];

  const spawn = (x: number, y: number): number => {
    const body = createGahallianBody('', TRAITS, 0);
    const e = world.createEntity({ Transform2D: { x, y }, GahallianBody: body });
    bodies.set(e.id, body);
    minds.set(e.id, new AgentMind(e.id, foragerAdapter));
    return e.id;
  };
  spawn(50, 50);
  spawn(52, 52);

  const narrator: NarrativeAuthor = {
    storyFor: (e) => {
      narrated.push(e);
      return null;
    },
  };
  const observeBefore = (e: SimEvent): void => void before.push(e);
  const observeAfter = (e: SimEvent): void => void after.push(e);
  const host = {
    world,
    bus,
    perception: new PerceptionSystem(),
    minds,
    counters: new RunCounters(),
    agentBody: (id: number): GahallianBody | undefined => bodies.get(id),
  };
  installEventPipeline(host, {
    world: foragerAdapter,
    edges: foragerEdges,
    narrator,
    leadership: true,
    tombstoneRules: new RuleIntern(),
    recorder: withRecorder ? { observeBefore, observeAfter } : null,
  });
  return {
    host,
    narrated,
    before,
    after,
    observeBefore,
    observeAfter,
    minds,
    bodyOf: (id) => bodies.get(id)!,
    freshCorpse: () => {
      const id = 1;
      bodies.get(id)!.alive = false;
      minds.get(id)!.observe({
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
      return id;
    },
  };
}

/** What a captured listener IS, discovered by running it in isolation. */
function identify(r: Rig, listener: (e: SimEvent) => void): string {
  if (listener === r.observeBefore) return 'recorder.observeBefore';
  if (listener === r.observeAfter) return 'recorder.observeAfter';
  const id = r.freshCorpse();
  const mind = r.minds.get(id)!;
  const narratedWas = r.narrated.length;
  const countedWas = r.host.counters.eventCount;
  listener(died(id));
  if (mind.learners.length === 0 && mind.memory.all().length === 0) return 'entomb';
  if (r.narrated.length > narratedWas && r.host.counters.eventCount > countedWas) return 'world pass';
  return 'unknown';
}

describe('event pipeline listener order', () => {
  it('registers exactly four listeners, in the one order that is correct', () => {
    const r = rig(true);
    expect(r.host.bus.listeners).toHaveLength(4);
    expect(r.host.bus.listeners.map((l) => identify(r, l))).toEqual([
      'recorder.observeBefore',
      'world pass',
      'recorder.observeAfter',
      'entomb', // LAST — moving it changes no fingerprint today, which is why this is here
    ]);
  });

  it('registers only the world pass and the entombing one when nothing is recorded', () => {
    const r = rig(false);
    expect(r.host.bus.listeners).toHaveLength(2);
    expect(r.host.bus.listeners.map((l) => identify(r, l))).toEqual(['world pass', 'entomb']);
  });

  it('entombs a being the body holds dead, releasing only the tiers a thinker uses', () => {
    const r = rig(true);
    const id = r.freshCorpse();
    const mind = r.minds.get(id)!;
    mind.narratives.seed('slew:1:0', 'a tale', 1, 1, 0, 2);
    expect(mind.memory.all()).toHaveLength(1);

    for (const l of r.host.bus.listeners) l(died(id));

    expect(mind.memory.all()).toHaveLength(0);
    expect(mind.learners).toHaveLength(0);
    // …and keeps what a tombstone is still read for.
    expect(mind.narratives.all()).toHaveLength(1);
  });

  it('never entombs a being the body still holds alive (an authored death)', () => {
    const r = rig(true);
    const mind = r.minds.get(1)!;
    const learners = mind.learners.length;
    for (const l of r.host.bus.listeners) l(died(1)); // body.alive is still true
    expect(mind.learners).toHaveLength(learners);
  });

  it('counts the event before anything subjective happens to it', () => {
    const r = rig(false);
    r.host.bus.listeners[0]!(died(1));
    expect(r.host.counters.eventCount).toBe(1);
    expect(r.host.counters.deathsByCause['violence']).toBe(1);
  });
});
