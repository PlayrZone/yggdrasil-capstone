import { describe, expect, it } from 'vitest';
import { World } from '../src/core/World.js';
import { SimEventBus } from '../src/body/SimEventBus.js';
import { createGahallianBody } from '../src/body/GahallianBody.js';
import type { GahallianBody } from '../src/body/GahallianBody.js';
import { identityAt } from '../src/body/identities.js';
import { AgentMind } from '../src/agent/AgentMind.js';
import { foragerAdapter } from '../src/worlds/forager/adapter.js';
import type { SimEvent, Traits } from '../src/contract/types.js';
import type { BirthRecord } from '../src/runner/RuntimeView.js';
import type { SocietyHost } from '../src/runner/society/SocietySystem.js';
import { CoPresenceSystem } from '../src/runner/society/CoPresence.js';
import { ReproductionSystem } from '../src/runner/society/Reproduction.js';
import { ForagerNarrator } from '../src/runner/society/Narration.js';
import type { Demography } from '../src/runner/Scenario.js';

/**
 * The three population-level processes, tested apart from the world for the
 * first time. W1-D reworks what they do; these hold what they do TODAY —
 * cadence, pairing order and RNG consumption included — so the rework has a
 * baseline to argue with.
 */

const DEMOGRAPHY: Demography = {
  adultAge: 400,
  reproCooldown: 400,
  reproInterval: 300,
  reproRange: 14,
  maxPopulation: 320,
};

class TestHost implements SocietyHost {
  readonly world = new World();
  readonly bus = new SimEventBus();
  readonly agentIds: number[] = [];
  readonly minds = new Map<number, AgentMind>();
  readonly births: BirthRecord[] = [];
  readonly emitted: SimEvent[] = [];
  readonly admitted: number[] = [];

  constructor() {
    this.bus.on((e) => this.emitted.push(e));
  }

  spawn(x: number, y: number, traits: Traits = identityAt(0).traits, birthTick = -1000): number {
    const entity = this.world.createEntity({
      Transform2D: { x, y },
      GahallianBody: createGahallianBody('', traits, birthTick),
    });
    this.admit(entity.id, traits);
    return entity.id;
  }

  agentBody(id: number): GahallianBody | undefined {
    return this.world.getEntity(id)?.components['GahallianBody'] as GahallianBody | undefined;
  }

  positionOf(id: number): { x: number; y: number } | undefined {
    return this.world.getEntity(id)?.components['Transform2D'] as { x: number; y: number } | undefined;
  }

  aliveCount(): number {
    return this.agentIds.filter((id) => this.agentBody(id)?.alive).length;
  }

  admit(agentId: number, _traits: Traits): void {
    this.agentIds.push(agentId);
    this.minds.set(agentId, new AgentMind(agentId, foragerAdapter));
    this.admitted.push(agentId);
  }

  recordBirth(birth: BirthRecord): void {
    this.births.push(birth);
  }
}

describe('CoPresenceSystem', () => {
  it('runs every 150 ticks', () => {
    expect(new CoPresenceSystem(new TestHost()).intervalTicks).toBe(150);
  });

  it('builds a bond both ways between beings who are together, and ignores the distant', () => {
    const host = new TestHost();
    const a = host.spawn(100, 100);
    const b = host.spawn(105, 100); // within 13
    const far = host.spawn(400, 400);
    new CoPresenceSystem(host).step(150);

    expect(host.minds.get(a)!.relationships.asMap().has(b)).toBe(true);
    expect(host.minds.get(b)!.relationships.asMap().has(a)).toBe(true);
    expect(host.minds.get(far)!.relationships.asMap().size).toBe(0);
  });

  it('skips the dead', () => {
    const host = new TestHost();
    const a = host.spawn(100, 100);
    const b = host.spawn(104, 100);
    host.agentBody(b)!.alive = false;
    new CoPresenceSystem(host).step(150);
    expect(host.minds.get(a)!.relationships.asMap().size).toBe(0);
  });

  it('retells a story only on the pair-and-tick parity, and the retelling drifts', () => {
    const host = new TestHost();
    const a = host.spawn(100, 100);
    const b = host.spawn(103, 100);
    host.minds.get(a)!.narratives.seed('slew:7:0', 'Aro slew a wolf in the forest', 20, 20, 0, 3);
    const system = new CoPresenceSystem(host);

    const offParity = (300 + a + b) % 3 === 0 ? 301 : 300;
    system.step(offParity);
    expect(host.minds.get(b)!.narratives.all()).toHaveLength(0);

    let onParity = offParity;
    while ((onParity + a + b) % 3 !== 0) onParity++;
    system.step(onParity);
    const heard = host.minds.get(b)!.narratives.all();
    expect(heard).toHaveLength(1);
    expect(heard[0]!.id).toBe('slew:7:0');
    expect(heard[0]!.firsthand).toBe(false);
    // The tale keeps its own age, not the hour it was told.
    expect(heard[0]!.firstTick).toBe(0);
  });
});

describe('ReproductionSystem', () => {
  it('runs on the scenario’s interval', () => {
    const host = new TestHost();
    expect(new ReproductionSystem(host, DEMOGRAPHY, 'seed').intervalTicks).toBe(300);
  });

  it('bears a child from two well-fed adults who are together, and writes it down', () => {
    const host = new TestHost();
    const a = host.spawn(100, 100);
    const b = host.spawn(106, 100);
    // Nudge the seed until this pair's first roll passes — the point is what a
    // birth DOES, not how often the coin lands.
    let system = new ReproductionSystem(host, DEMOGRAPHY, 'r0');
    for (let i = 1; host.births.length === 0 && i < 40; i++) {
      system.step(300);
      if (host.births.length === 0) system = new ReproductionSystem(host, DEMOGRAPHY, `r${i}`);
    }
    expect(host.births).toHaveLength(1);

    const birth = host.births[0]!;
    expect(birth.parents).toEqual([a, b]);
    expect(birth.tick).toBe(300);
    expect(host.admitted).toEqual([a, b, birth.child]);
    expect(host.minds.has(birth.child)).toBe(true);
    // Cooldowns on both parents, and one ChildBorn on the bus.
    expect(host.agentBody(a)!.reproCooldownUntil).toBe(300 + DEMOGRAPHY.reproCooldown);
    expect(host.agentBody(b)!.reproCooldownUntil).toBe(300 + DEMOGRAPHY.reproCooldown);
    expect(host.emitted.filter((e) => e.type === 'ChildBorn')).toHaveLength(1);

    const child = host.agentBody(birth.child)!;
    expect(child.birthTick).toBe(300);
    expect(child.name).toBe('');
    for (const k of Object.keys(child.traits) as (keyof Traits)[]) {
      const mid = (host.agentBody(a)!.traits[k] + host.agentBody(b)!.traits[k]) / 2;
      expect(Math.abs(child.traits[k] - mid)).toBeLessThanOrEqual(8); // ±8 mutation
    }
  });

  it('consumes its own RNG stream identically for the same seed', () => {
    const run = (): number[] => {
      const host = new TestHost();
      host.spawn(100, 100);
      host.spawn(106, 100);
      host.spawn(112, 100);
      const system = new ReproductionSystem(host, DEMOGRAPHY, 'stream');
      for (let t = 300; t <= 3000; t += 300) system.step(t);
      return host.births.flatMap((b) => [b.child, b.tick, ...Object.values(host.agentBody(b.child)!.traits)]);
    };
    expect(run()).toEqual(run());
    expect(run().length).toBeGreaterThan(0);
  });

  it('refuses the young, the hungry, the hurt, the recently-parted and the crowded', () => {
    const cases: [string, (host: TestHost, a: number, b: number) => void][] = [
      ['young', (h, a) => void (h.agentBody(a)!.birthTick = 299)],
      ['hungry', (h, a) => void (h.agentBody(a)!.needs.hunger = 46)],
      ['hurt', (h, a) => void (h.agentBody(a)!.health = 64)],
      ['cooling down', (h, a) => void (h.agentBody(a)!.reproCooldownUntil = 301)],
      ['dead', (h, a) => void (h.agentBody(a)!.alive = false)],
    ];
    for (const [label, spoil] of cases) {
      const host = new TestHost();
      const a = host.spawn(100, 100);
      const b = host.spawn(106, 100);
      spoil(host, a, b);
      for (let i = 0; i < 12; i++) new ReproductionSystem(host, DEMOGRAPHY, `s${i}`).step(300);
      expect(host.births, label).toHaveLength(0);
    }
  });

  it('stops at the population ceiling', () => {
    const host = new TestHost();
    host.spawn(100, 100);
    host.spawn(106, 100);
    const capped: Demography = { ...DEMOGRAPHY, maxPopulation: 2 };
    for (let i = 0; i < 12; i++) new ReproductionSystem(host, capped, `c${i}`).step(300);
    expect(host.births).toHaveLength(0);
  });
});

describe('ForagerNarrator', () => {
  const narrator = new ForagerNarrator({ nameOf: (id) => `Being#${id}` });
  const event = (type: SimEvent['type'], payload: Record<string, unknown> = {}, targetIds: number[] = []): SimEvent => ({
    tick: 900,
    type,
    actorId: 7,
    targetIds,
    x: 40,
    y: 40,
    payload,
  });

  it('tells of a slaying, a home, a violent death and an attack — and nothing else', () => {
    expect(narrator.storyFor(event('KilledPredator', { predator: 'wolf' }))!.id).toBe('slew:7:3');
    expect(narrator.storyFor(event('BuiltStructure', { buildKind: 'shelter' }))!.id).toBe('home:7:3');
    expect(narrator.storyFor(event('AgentDied', { cause: 'violence' }))!.id).toBe('fell:7:3');
    expect(narrator.storyFor(event('AttackedAgent', {}, [9]))!.id).toBe('attack:7:3');

    expect(narrator.storyFor(event('AgentDied', { cause: 'starvation' }))).toBeNull();
    expect(narrator.storyFor(event('BuiltStructure', { buildKind: 'wall' }))).toBeNull();
    expect(narrator.storyFor(event('AteFood'))).toBeNull();
    expect(narrator.storyFor(event('Crafted'))).toBeNull();
  });

  it('keys a story so every witness of the same deed carries the same one', () => {
    const a = narrator.storyFor(event('KilledPredator', { predator: 'bear' }))!;
    const b = narrator.storyFor(event('KilledPredator', { predator: 'bear' }))!;
    expect(a).toEqual(b);
    expect(a.x).toBe(40);
    expect(a.text).toContain('Being#7');
    expect(a.text).toContain('bear');
  });

  it('buckets by 300 ticks, so the same hunter’s next kill is a new tale', () => {
    const later = { ...event('KilledPredator', { predator: 'wolf' }), tick: 1200 };
    expect(narrator.storyFor(later)!.id).toBe('slew:7:4');
  });
});
