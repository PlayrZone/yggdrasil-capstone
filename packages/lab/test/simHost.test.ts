import { describe, expect, it } from 'vitest';
import { Experiment, TICKS_PER_DAY, at, foragerAdapter } from '@yggdrasil/engine';
import { daylightAt, ProxyMindBackend, SimHost, type HostPort } from '../src/renderer/sim/host.js';
import {
  ACT_COUNT,
  COND_HURT,
  COND_SICK,
  COND_STARVING,
  STAGE_ADULT,
  STAGE_ELDER,
  type FrameMessage,
  type SimMessage,
  type StatsMessage,
  type WorldMessage,
} from '../src/renderer/sim/protocol.js';

/** Collects what the host would post; transfer lists are inert in-process. */
class Recorder implements HostPort {
  readonly messages: SimMessage[] = [];
  readonly transfers: (ArrayBuffer[] | undefined)[] = [];

  post(message: SimMessage, transfer?: ArrayBuffer[]): void {
    this.messages.push(message);
    this.transfers.push(transfer);
  }

  last<K extends SimMessage['kind']>(kind: K): Extract<SimMessage, { kind: K }> | undefined {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const m = this.messages[i]!;
      if (m.kind === kind) return m as Extract<SimMessage, { kind: K }>;
    }
    return undefined;
  }

  all<K extends SimMessage['kind']>(kind: K): Extract<SimMessage, { kind: K }>[] {
    return this.messages.filter((m): m is Extract<SimMessage, { kind: K }> => m.kind === kind);
  }
}

/**
 * A clock the test moves by hand. It does not advance *during* a pump, so the
 * host's time budget never trips and the number of ticks a pump runs is a pure
 * function of the dt handed to it — which is what makes the equivalence test
 * deterministic.
 */
function fakeClock(): { now: () => number; advance: (ms: number) => void } {
  let t = 1000;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

/**
 * A clock that advances on every read — a machine too slow to keep up. It is
 * what makes the advance budget trip, which the frozen clock above can never do.
 */
function slowClock(costPerReadMs: number): { now: () => number; advance: (ms: number) => void } {
  let t = 1000;
  return { now: () => (t += costPerReadMs), advance: (ms) => { t += ms; } };
}

function boot(seed = 'genesis-01', population = 40): { host: SimHost; port: Recorder; clock: ReturnType<typeof fakeClock> } {
  const port = new Recorder();
  const clock = fakeClock();
  const host = new SimHost(port, clock.now);
  host.handle({ kind: 'create', seed, population, llm: null });
  return { host, port, clock };
}

/** Everything a tick can move: counters, the ledger, and every body's state. */
function fingerprint(exp: Experiment): string {
  const parts = [
    `tick=${exp.tick}`,
    `alive=${exp.aliveCount()}`,
    `agents=${exp.agentIds.length}`,
    `births=${exp.birthCount}`,
    `events=${exp.eventCount}`,
    `knowledge=${exp.totalKnowledge()}`,
    `exchanges=${exp.exchangeCount}`,
    `conflicts=${exp.conflictCount}`,
    `sickness=${exp.sicknessCount}`,
    `shares=${exp.shareCount}`,
    `seeds=${exp.seedPlantCount}`,
    `sprouts=${exp.sproutCount}`,
    `builds=${exp.buildCount}`,
    `deaths=${JSON.stringify(exp.deathsByCause)}`,
  ];
  for (const a of exp.agentInfos()) {
    parts.push(`${a.id}:${a.alive ? 1 : 0}:${a.x.toFixed(6)}:${a.y.toFixed(6)}:${a.sleeping ? 1 : 0}${a.sick ? 1 : 0}${a.hungerCritical ? 1 : 0}`);
  }
  for (const b of exp.births) parts.push(`birth:${b.child}<${b.parents[0]},${b.parents[1]}>@${b.tick}`);
  return parts.join('|');
}

describe('SimHost — equivalence with an in-thread run', () => {
  it('same seed, same ticks, same world as a direct Experiment', () => {
    const { host, clock } = boot('genesis-01', 60);
    host.handle({ kind: 'speed', mult: 2400 });
    host.handle({ kind: 'run', running: true });
    while ((host.experiment?.tick ?? 0) < 600) {
      clock.advance(16);
      host.pump();
    }
    const hosted = host.experiment!;
    const direct = new Experiment({ seed: 'genesis-01', agentCount: 60 });
    direct.advance(hosted.tick);
    expect(hosted.tick).toBeGreaterThanOrEqual(600);
    expect(fingerprint(hosted)).toBe(fingerprint(direct));
  });

  it('drops the ticks it cannot afford, reports them, and stays exact on the ones it ran', () => {
    // The clock moves on every read, so the advance budget genuinely trips and
    // the host abandons the backlog — the path the frozen-clock test can never
    // reach. What it *did* run must still match a direct run tick for tick.
    const port = new Recorder();
    const clock = slowClock(3);
    const host = new SimHost(port, clock.now);
    host.handle({ kind: 'create', seed: 'slowmachine', population: 40, llm: null });
    host.handle({ kind: 'speed', mult: 2400 });
    host.handle({ kind: 'run', running: true });
    for (let i = 0; i < 30; i++) {
      clock.advance(100); // 80 ticks fall due; the budget affords far fewer
      host.pump();
    }
    const hosted = host.experiment!;
    const last = port.last('stats')!;
    expect(last.ticksDropped).toBeGreaterThan(0);
    expect(hosted.tick).toBeGreaterThan(0);
    expect(hosted.tick).toBeLessThan(30 * 80); // it really did fall behind

    const direct = new Experiment({ seed: 'slowmachine', agentCount: 40 });
    direct.advance(hosted.tick);
    expect(fingerprint(hosted)).toBe(fingerprint(direct));
  });

  it('advancing in many small pumps equals advancing in one large step', () => {
    const { host, clock } = boot('drip', 30);
    host.handle({ kind: 'speed', mult: 120 });
    host.handle({ kind: 'run', running: true });
    for (let i = 0; i < 120; i++) {
      clock.advance(8);
      host.pump();
    }
    const direct = new Experiment({ seed: 'drip', agentCount: 30 });
    direct.advance(host.experiment!.tick);
    expect(host.experiment!.tick).toBeGreaterThan(0);
    expect(fingerprint(host.experiment!)).toBe(fingerprint(direct));
  });
});

describe('SimHost — world lifecycle', () => {
  it('announces the world and its resource nodes once', () => {
    const { port } = boot();
    const world = port.last('world') as WorldMessage;
    expect(world.seed).toBe('genesis-01');
    expect(world.backend).toBe('reflex');
    expect(world.resources.count).toBeGreaterThan(100);
    expect(world.resources.kinds).toContain('berryBush');
    expect(world.resources.pos.length).toBe(world.resources.count * 2);
    expect(port.all('world')).toHaveLength(1);
  });

  it('sends a frame and stats immediately, so a paused world is not blank', () => {
    const { port } = boot();
    const frame = port.last('frame') as FrameMessage;
    const stats = port.last('stats') as StatsMessage;
    expect(frame.beings).toBe(40);
    expect(stats.alive).toBe(40);
    expect(stats.day).toBe(1);
  });

  it('asks to be left alone until it is running, and again once disposed', () => {
    const { host } = boot();
    expect(host.nextWakeMs()).toBe(-1);
    host.handle({ kind: 'run', running: true });
    expect(host.nextWakeMs()).toBeGreaterThanOrEqual(0);
    host.handle({ kind: 'run', running: false });
    expect(host.nextWakeMs()).toBe(-1); // a paused world costs nothing
    host.handle({ kind: 'dispose' });
    expect(host.nextWakeMs()).toBe(-1);
    expect(host.experiment).toBeNull();
  });

  it('sleeps until the next tick is due instead of spinning at slow speeds', () => {
    const { host, clock } = boot('slow', 20);
    host.handle({ kind: 'speed', mult: 1 }); // one tick every ~3 s
    host.handle({ kind: 'frames', on: false });
    host.handle({ kind: 'run', running: true });
    clock.advance(16);
    host.pump();
    // Stats (250 ms) is the soonest thing due — not a busy 0 ms spin.
    const wait = host.nextWakeMs();
    expect(wait).toBeGreaterThan(100);
    expect(wait).toBeLessThanOrEqual(250);
  });
});

describe('SimHost — frames', () => {
  it('draws every living being: no silent cap', () => {
    const { host, port, clock } = boot('crowd', 256);
    host.handle({ kind: 'speed', mult: 600 });
    host.handle({ kind: 'run', running: true });
    for (let i = 0; i < 20; i++) {
      clock.advance(16);
      host.pump();
    }
    const frame = port.last('frame') as FrameMessage;
    expect(frame.beings).toBe(frame.beingsAlive);
    expect(frame.beings).toBe(host.experiment!.aliveCount());
    expect(frame.wildlife).toBe(frame.wildlifeTotal);
  });

  it('carries the ids, states and interpolated positions of the living', () => {
    const { host, port } = boot('ids', 25);
    const frame = port.last('frame') as FrameMessage;
    const living = host.experiment!.agentInfos().filter((a) => a.alive);
    expect([...frame.arrays.ids.subarray(0, frame.beings)].sort((a, b) => a - b)).toEqual(living.map((a) => a.id).sort((a, b) => a - b));
    for (let i = 0; i < frame.beings; i++) {
      const info = living.find((a) => a.id === frame.arrays.ids[i]);
      expect(frame.arrays.pos[i * 2]).toBeCloseTo(info!.x, 3);
      expect(frame.arrays.pos[i * 2 + 1]).toBeCloseTo(info!.y, 3);
      expect(frame.arrays.act[i]).toBeLessThan(ACT_COUNT);
      expect(frame.arrays.cond[i]! & ~(COND_SICK | COND_STARVING | COND_HURT)).toBe(0);
      expect(frame.arrays.stage[i]).toBeLessThanOrEqual(STAGE_ELDER);
    }
  });

  it('gives every being a life stage, and says who is a child', () => {
    const { host, port } = boot('stages', 40);
    const frame = port.last('frame') as FrameMessage;
    // Founders are seeded at adult age, so a fresh world holds no children.
    for (let i = 0; i < frame.beings; i++) expect(frame.arrays.stage[i]).toBe(STAGE_ADULT);
  });

  it('sends each name once, and an unnamed being as the empty string', () => {
    const { host, port, clock } = boot('names', 20);
    const first = port.last('frame') as FrameMessage;
    expect(first.names).toHaveLength(first.beings);
    // Beings are born unnamed in this engine; only a conscious mind names itself.
    expect(first.names.every((n) => n.name === '')).toBe(true);
    host.handle({ kind: 'run', running: true });
    clock.advance(32);
    host.pump();
    expect((port.all('frame').at(-1) as FrameMessage).names).toEqual([]);
  });

  /**
   * The view must never show light the sim denies. `isNight()` turns true two
   * thirds through the day, so full daylight has to end exactly there, and the
   * whole dusk-and-dawn crossfade has to live inside the engine's night.
   */
  it('reports the light the engine says it is', () => {
    expect(daylightAt(0)).toBe(1);
    expect(daylightAt(TICKS_PER_DAY / 2)).toBe(1);
    expect(daylightAt(Math.floor(TICKS_PER_DAY * (2 / 3)) - 1)).toBe(1);
    expect(daylightAt(Math.ceil(TICKS_PER_DAY * (2 / 3)) + 1)).toBeLessThan(1);
    expect(daylightAt(Math.floor(TICKS_PER_DAY * 0.8))).toBe(0);
    expect(daylightAt(Math.floor(TICKS_PER_DAY * 0.95))).toBe(0);
    expect(daylightAt(TICKS_PER_DAY)).toBe(1); // the next day, wrapped
    expect(daylightAt(TICKS_PER_DAY * 3 + 100)).toBe(1);
  });

  it('answers who a being is kin to and bonded to', async () => {
    const { host, port } = boot('ties', 30);
    const id = host.experiment!.agentIds[0]!;
    host.handle({ kind: 'query', reqId: 7, request: { name: 'ties', id } });
    const answer = port.all('query-result').at(-1) as { name: string; result: { id: number; kin: number[]; bonded: number[] } };
    expect(answer.name).toBe('ties');
    expect(answer.result.id).toBe(id);
    expect(answer.result.kin).not.toContain(id); // never its own kin
    expect(answer.result.bonded).not.toContain(id);
  });

  it('names each animal kind exactly once, then refers to it by code', () => {
    // Wildlife is spawned by the first step, so the tick-0 frame carries none.
    const { host, port, clock } = boot('beasts', 20);
    host.handle({ kind: 'speed', mult: 2400 });
    host.handle({ kind: 'run', running: true });
    clock.advance(32);
    host.pump();
    const first = port.all('frame').at(-1) as FrameMessage;
    expect(first.wildlife).toBeGreaterThan(0);
    expect(first.animalKinds.length).toBeGreaterThan(0);

    clock.advance(32);
    host.pump();
    const later = port.all('frame').at(-1) as FrameMessage;
    expect(later).not.toBe(first);
    expect(later.animalKinds).toEqual([]); // the table is already over there
    expect(later.arrays.wildKind[0]).toBeLessThan(first.animalKinds.length);
  });

  it('recycles acked buffers and allocates fresh ones when none come home', () => {
    const { host, port, clock } = boot('pool', 20);
    host.handle({ kind: 'run', running: true });
    const first = port.last('frame') as FrameMessage;
    host.handle({ kind: 'ack', arrays: first.arrays });
    clock.advance(32);
    host.pump();
    const second = port.all('frame').at(-1) as FrameMessage;
    expect(second.arrays).toBe(first.arrays);

    clock.advance(32);
    host.pump(); // nothing acked this time
    const third = port.all('frame').at(-1) as FrameMessage;
    expect(third.arrays).not.toBe(second.arrays);
  });

  it('stops sending frames when nothing is drawing them', () => {
    const { host, port, clock } = boot('hidden', 20);
    host.handle({ kind: 'speed', mult: 2400 });
    host.handle({ kind: 'run', running: true });
    host.handle({ kind: 'frames', on: false });
    const before = port.all('frame').length;
    for (let i = 0; i < 10; i++) {
      clock.advance(16);
      host.pump();
    }
    expect(port.all('frame').length).toBe(before);
    expect(host.experiment!.tick).toBeGreaterThan(0); // still simulating
    host.handle({ kind: 'frames', on: true });
    expect(port.all('frame').length).toBe(before + 1);
  });
});

describe('SimHost — reading the world costs what drawing it costs', () => {
  it('samples the world once per emitted frame, not once per pump', () => {
    const { host, port, clock } = boot('alloc', 60);
    const exp = host.experiment!;
    let infoCalls = 0;
    let animalCalls = 0;
    const realInfos = exp.agentInfos.bind(exp);
    const realAnimals = exp.animals.bind(exp);
    exp.agentInfos = (): ReturnType<typeof realInfos> => {
      infoCalls++;
      return realInfos();
    };
    exp.animals = (): ReturnType<typeof realAnimals> => {
      animalCalls++;
      return realAnimals();
    };

    host.handle({ kind: 'speed', mult: 2400 });
    host.handle({ kind: 'run', running: true });
    const framesBefore = port.all('frame').length;
    const PUMPS = 2000;
    for (let i = 0; i < PUMPS; i++) {
      clock.advance(1);
      host.pump();
    }
    const frames = port.all('frame').length - framesBefore;

    expect(frames).toBeGreaterThan(50);
    expect(frames).toBeLessThan(PUMPS / 5); // pumps vastly outnumber frames…
    expect(infoCalls).toBeLessThanOrEqual(frames + 1); // …and reads track frames
    expect(animalCalls).toBeLessThanOrEqual(frames + 1);
    expect(host.experiment!.tick).toBeGreaterThan(1000); // while still simulating hard
  });

  it('does not sample at all while nothing is drawing', () => {
    const { host, port, clock } = boot('nodraw', 40);
    const exp = host.experiment!;
    let infoCalls = 0;
    const real = exp.agentInfos.bind(exp);
    exp.agentInfos = (): ReturnType<typeof real> => {
      infoCalls++;
      return real();
    };
    host.handle({ kind: 'speed', mult: 2400 });
    host.handle({ kind: 'frames', on: false });
    host.handle({ kind: 'run', running: true });
    for (let i = 0; i < 500; i++) {
      clock.advance(2);
      host.pump();
    }
    expect(port.all('frame').length).toBe(1); // only the one from create
    expect(infoCalls).toBe(0);
    expect(host.experiment!.tick).toBeGreaterThan(500);
  });
});

describe('SimHost — the speed label must not lie', () => {
  it('reports the achieved multiplier alongside the requested one', () => {
    const { host, port, clock } = boot('rate', 40);
    host.handle({ kind: 'speed', mult: 600 });
    host.handle({ kind: 'run', running: true });
    for (let i = 0; i < 200; i++) {
      clock.advance(16);
      host.pump();
    }
    const last = port.last('stats')!;
    expect(last.requestedMult).toBe(600);
    // The fake clock never charges for a tick, so this machine keeps up exactly.
    expect(last.achievedMult).toBeGreaterThan(540);
    expect(last.achievedMult).toBeLessThan(660);
    expect(last.ticksDropped).toBe(0);
  });

  it('reports a lower achieved multiplier when the machine cannot keep up', () => {
    const port = new Recorder();
    const clock = slowClock(3);
    const host = new SimHost(port, clock.now);
    host.handle({ kind: 'create', seed: 'rate-slow', population: 40, llm: null });
    host.handle({ kind: 'speed', mult: 2400 });
    host.handle({ kind: 'run', running: true });
    for (let i = 0; i < 40; i++) {
      clock.advance(100);
      host.pump();
    }
    const last = port.last('stats')!;
    expect(last.requestedMult).toBe(2400);
    expect(last.achievedMult).toBeGreaterThan(0);
    expect(last.achievedMult).toBeLessThan(2400 * 0.95);
  });

  it('reports 0× while paused rather than the speed it used to manage', () => {
    const { host, port, clock } = boot('rate-pause', 20);
    host.handle({ kind: 'speed', mult: 600 });
    host.handle({ kind: 'run', running: true });
    for (let i = 0; i < 100; i++) {
      clock.advance(16);
      host.pump();
    }
    host.handle({ kind: 'run', running: false });
    expect(port.last('stats')!.achievedMult).toBe(0);
  });
});

describe('SimHost — queries and selection', () => {
  it('pushes the selected being, and clears it', () => {
    const { host, port } = boot('sel', 20);
    const id = host.experiment!.agentIds[3]!;
    host.handle({ kind: 'select', id });
    expect(port.last('detail')).toMatchObject({ id, detail: { id } });
    host.handle({ kind: 'select', id: null });
    expect(port.last('detail')?.detail).toBeNull();
  });

  it('answers every heavy read-out by request id, in the worker', () => {
    const { host, port } = boot('query', 20);
    const id = host.experiment!.agentIds[0]!;
    host.handle({ kind: 'query', reqId: 1, request: { name: 'detail', id } });
    host.handle({ kind: 'query', reqId: 2, request: { name: 'analysis' } });
    host.handle({ kind: 'query', reqId: 3, request: { name: 'society' } });
    host.handle({ kind: 'query', reqId: 4, request: { name: 'culture' } });
    const answers = port.all('query-result');
    expect(answers.map((a) => [a.reqId, a.name])).toEqual([[1, 'detail'], [2, 'analysis'], [3, 'society'], [4, 'culture']]);
    expect(answers[1]!.result).toHaveProperty('diffusion');
    expect(answers[2]!.result).toHaveProperty('influence');
    expect(answers[3]!.result).toHaveProperty('culture');
  });

  it('answers a query about a world that is gone, so no asker waits forever', () => {
    const { host, port } = boot('gone', 20);
    host.handle({ kind: 'dispose' });
    host.handle({ kind: 'query', reqId: 7, request: { name: 'analysis' } });
    expect(port.last('query-failed')).toEqual({ kind: 'query-failed', reqId: 7, message: 'NO_WORLD' });
  });

  it('lands a given idea in exactly one head', () => {
    const { host } = boot('idea', 20);
    const exp = host.experiment!;
    const id = exp.agentIds[2]!;
    const before = exp.minds.get(id)!.memory.all().length;
    host.handle({ kind: 'idea', text: 'the mountains hold metal', targetId: id });
    expect(exp.minds.get(id)!.memory.all().length).toBe(before + 1);
    expect(exp.minds.get(exp.agentIds[3]!)!.memory.all().length).toBe(before);
  });
});

describe('SimHost — stats', () => {
  it('sends only the events since the last tick of the feed', () => {
    const { host, port, clock } = boot('feed', 40);
    host.handle({ kind: 'speed', mult: 2400 });
    host.handle({ kind: 'run', running: true });
    for (let i = 0; i < 160; i++) {
      clock.advance(16);
      host.pump();
    }
    const feeds = port.all('stats');
    expect(feeds.length).toBeGreaterThan(1);
    const later = feeds.slice(1);
    expect(later.some((s) => s.newFeed.length > 0)).toBe(true);
    for (const s of later) {
      expect(s.newFeed.length).toBeLessThanOrEqual(50);
      for (const line of s.newFeed) {
        expect(line.day).toBeGreaterThanOrEqual(1);
        expect(line.who).not.toBe('');
      }
    }
  });

  it('stamps every feed line with a unique, increasing id (the row key)', () => {
    const { host, port, clock } = boot('keys', 40);
    host.handle({ kind: 'speed', mult: 2400 });
    host.handle({ kind: 'run', running: true });
    for (let i = 0; i < 160; i++) {
      clock.advance(16);
      host.pump();
    }
    const seqs = port.all('stats').flatMap((s) => s.newFeed.map((f) => f.seq));
    expect(seqs.length).toBeGreaterThan(20);
    expect(new Set(seqs).size).toBe(seqs.length);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
  });
});

describe('ProxyMindBackend', () => {
  it('posts a think request and resolves with what comes back', async () => {
    const port = new Recorder();
    const backend = new ProxyMindBackend('model-x', port, foragerAdapter);
    const prompt = { system: 'you are', user: 'hungry. what now?' };
    const promise = backend.complete(prompt as never, { situation: 'hungry' } as never);
    const request = port.last('llm-request')!;
    // Both halves travel: the exact messages the engine composed, and the
    // situation behind them. A transport bridge must never rebuild one from
    // the other.
    // …and the world it was composed FOR, so main can rebuild it to check.
    expect(request).toMatchObject({ reqId: 1, prompt, input: { situation: 'hungry' }, worldId: foragerAdapter.id });
    backend.settle(request.reqId, '{"plan":[]}');
    await expect(promise).resolves.toBe('{"plan":[]}');
  });

  /**
   * THE PLACES GO OUT AS THE WORLD WRITES THEM (W1-B4 round 3). A place is an
   * opaque handle now, and `postMessage`'s structured clone copies own
   * enumerable properties — of which a place has none. Untranslated it would
   * arrive as `{}`, main's gate would refuse the input and no conscious being in
   * the lab would ever think. These are the same bytes that crossed before the
   * step, when a place WAS its two fields.
   */
  it('writes every place out as this world writes one, so the clone carries it', async () => {
    const port = new Recorder();
    const backend = new ProxyMindBackend('model-x', port, foragerAdapter);
    const input = {
      snapshot: { id: 1, place: at(120, 80) },
      worldView: { agents: [{ id: 2, place: at(3, 4) }], resources: [], structures: [] },
      recalledMemories: [{ id: 9, place: at(5, 6) }, { id: 10 }],
      sacredPlace: at(900, 120),
      tragedyPlaces: [at(7, 8)],
    };
    void backend.complete({ system: '', user: '' } as never, input as never);
    const sent = port.last('llm-request')!.input as Record<string, never>;
    // What a structured clone would carry — checked on the CLONE, not on the
    // object, because the object is what used to survive and no longer does.
    const cloned = structuredClone(sent) as Record<string, Record<string, unknown>>;
    expect(cloned['snapshot']).toEqual({ id: 1, place: { x: 120, y: 80 } });
    expect(cloned['worldView']!['agents']).toEqual([{ id: 2, place: { x: 3, y: 4 } }]);
    expect(cloned['recalledMemories']).toEqual([{ id: 9, place: { x: 5, y: 6 } }, { id: 10 }]);
    expect(cloned['sacredPlace']).toEqual({ x: 900, y: 120 });
    expect(cloned['tragedyPlaces']).toEqual([{ x: 7, y: 8 }]);
    // …and the negative control: the handle itself clones to nothing at all.
    expect(structuredClone(at(120, 80) as unknown as object)).toEqual({});
  });

  it('rejects with the message main sent, so NO_LLM_KEY still reads as NO_LLM_KEY', async () => {
    const port = new Recorder();
    const backend = new ProxyMindBackend('model-x', port, foragerAdapter);
    const promise = backend.complete({} as never, {} as never);
    backend.settle(1, undefined, 'NO_LLM_KEY');
    await expect(promise).rejects.toThrow('NO_LLM_KEY');
  });

  it('ignores a reply for a request it does not have, and fails the rest on abort', async () => {
    const port = new Recorder();
    const backend = new ProxyMindBackend('model-x', port, foragerAdapter);
    expect(() => backend.settle(999, 'stray')).not.toThrow();
    const promise = backend.complete({} as never, {} as never);
    backend.abort();
    await expect(promise).rejects.toThrow('DISPOSED');
  });
});
