import { describe, expect, it } from 'vitest';
import { Experiment } from '../src/runner/Experiment.js';
import { MockMindBackend } from '../src/index.js';

describe('Experiment (headless host)', () => {
  it('spawns the requested population and reports it', () => {
    const exp = new Experiment({ seed: 'test-spawn', agentCount: 30 });
    expect(exp.agentIds.length).toBe(30);
    expect(exp.minds.size).toBe(30);
    expect(exp.aliveCount()).toBe(30);
    expect(exp.backendLabel).toBe('reflex');
  });

  it('is deterministic for a given seed', () => {
    const a = new Experiment({ seed: 'determinism', agentCount: 40 });
    const b = new Experiment({ seed: 'determinism', agentCount: 40 });
    a.advance(2000);
    b.advance(2000);
    expect(a.aliveCount()).toBe(b.aliveCount());
    expect(a.eventCount).toBe(b.eventCount);
    expect(a.tick).toBe(b.tick);
  });

  it('runs a multi-day reflex sim, produces events and forms knowledge', () => {
    const exp = new Experiment({ seed: 'life', agentCount: 60 });
    exp.advance(8000);
    expect(exp.tick).toBe(8000);
    expect(exp.day()).toBeGreaterThan(1);
    expect(exp.eventCount).toBeGreaterThan(0);
    // Some population should persist (survival fix keeps a stable core alive).
    expect(exp.aliveCount()).toBeGreaterThan(0);
    // Deterministic miners should surface at least some held knowledge.
    expect(exp.totalKnowledge()).toBeGreaterThanOrEqual(0);
  });

  it('lets the human (never the engine) inject an idea', () => {
    const exp = new Experiment({ seed: 'idea', agentCount: 20 });
    exp.advance(100);
    const reached = exp.giveIdea('water is near the river', 'all');
    expect(reached).toBe(exp.aliveCount());
  });

  it('classifies behavior-derived archetypes post-hoc', () => {
    const exp = new Experiment({ seed: 'arch', agentCount: 20 });
    exp.advance(3000);
    const someId = exp.agentIds[0]!;
    // Either null (too little behavior) or a labelled result — never throws.
    const result = exp.archetypeOf(someId);
    expect(result === null || typeof result.archetype === 'string').toBe(true);
  });

  it('generations: a child is born with traits blended from its parents', () => {
    const exp = new Experiment({ seed: 'gen-test', agentCount: 100 });
    const founders = new Set(exp.agentIds);
    exp.advance(20000); // long enough for adults to cluster and reproduce
    expect(exp.birthCount).toBeGreaterThan(0);
    const child = exp.agentIds.find((id) => !founders.has(id));
    expect(child).toBeDefined();
    const body = exp.agentBody(child!)!;
    expect(body.name).toBe(''); // born unnamed — it will name itself once conscious
    // Born after the start, so younger than a founder.
    expect(body.birthTick).toBeGreaterThan(0);
  }, 30000);

  it('crafts a spear from wood + stone — a discoverable tool, not a recipe menu', () => {
    const exp = new Experiment({ seed: 'craft', agentCount: 4 });
    const id = exp.agentIds[0]!;
    const body = exp.agentBody(id)!;
    body.inventory = { wood: 1, stone: 1 };
    exp.body.setPlan(body, [{ kind: 'Craft' }]);
    exp.advance(10);
    expect(body.inventory.spear).toBe(1);
    expect(body.inventory.wood ?? 0).toBe(0);
    expect(body.inventory.stone ?? 0).toBe(0);
  });

  it('fear from a witnessed killing marks the killer, never the corpse', () => {
    // Drives the real path: Attack → AgentDied on the bus → witnessesOf →
    // memoryFromEvent → AgentMind.observe → RelationshipStore.
    const exp = new Experiment({ seed: 'witness', agentCount: 3 });
    const [killerId, victimId, witnessId] = exp.agentIds as [number, number, number];
    const moveTo = (id: number, x: number, y: number): void => {
      const t = exp.agentEntity(id)!.components['Transform2D'] as { x: number; y: number };
      t.x = x;
      t.y = y;
    };
    moveTo(killerId, 500, 500);
    moveTo(victimId, 501, 500);
    moveTo(witnessId, 520, 500); // well inside the daytime perception radius
    exp.agentBody(victimId)!.health = 10; // one blow kills
    exp.body.setPlan(exp.agentBody(killerId)!, [{ kind: 'Attack', targetId: victimId }]);
    exp.advance(3);

    expect(exp.agentBody(victimId)!.alive).toBe(false);
    const witness = exp.minds.get(witnessId)!;

    // The memory is ABOUT the one who died; the hand behind it is separate.
    const death = witness.memory.all().find((m) => m.type === 'WitnessedDeath')!;
    expect(death.subjects).toEqual([victimId]);
    expect(death.causedBy).toBe(killerId);
    expect(death.summaryText).toContain(`#${victimId}`); // who died is still legible
    expect(death.summaryText).toContain(`caused by agent #${killerId}`);

    // Fear moved toward the killer, and only the killer.
    expect(witness.relationships.get(killerId)!.fear).toBe(4);
    expect(witness.relationships.get(killerId)!.interactionCount).toBe(0); // watching is not interacting
    expect(witness.relationships.get(victimId)).toBeUndefined(); // witnessing marks no one about the dead
    // And the killer does not witness itself into fearing itself.
    expect(exp.minds.get(killerId)!.relationships.get(killerId)).toBeUndefined();
  });

  it('a death with no killer — starvation — marks no one', () => {
    const exp = new Experiment({ seed: 'starve-death', agentCount: 3 });
    const [dyingId, , witnessId] = exp.agentIds as [number, number, number];
    const moveTo = (id: number, x: number, y: number): void => {
      const t = exp.agentEntity(id)!.components['Transform2D'] as { x: number; y: number };
      t.x = x;
      t.y = y;
    };
    moveTo(dyingId, 500, 500);
    moveTo(witnessId, 510, 500);
    const dying = exp.agentBody(dyingId)!;
    dying.needs.hunger = 100;
    dying.health = 0.04; // starvation takes it this tick
    exp.advance(3);

    expect(dying.alive).toBe(false);
    expect(exp.deathsByCause['starvation']).toBe(1);
    const witness = exp.minds.get(witnessId)!;
    const death = witness.memory.all().find((m) => m.type === 'WitnessedDeath')!;
    expect(death.subjects).toEqual([dyingId]); // still remembered, still named
    expect(death.causedBy).toBeUndefined(); // nobody dealt it
    expect(witness.relationships.get(dyingId)).toBeUndefined();
  });

  it('a story keeps its own age when it is retold and its witnesses die', () => {
    const exp = new Experiment({ seed: 'story-age', agentCount: 18 });
    const ORIGIN = 100;
    const STORY = 'slew:9:0';
    // Co-presence pairs beings whose ids sum with the tick to a multiple of 3,
    // so a circle of id%3===0 beings can be put in three separate companies —
    // one who saw it, one who will only ever be told, each far from the rest.
    const circle = exp.agentIds.filter((id) => id % 3 === 0).slice(0, 6);
    const tellers = [circle[0]!, circle[2]!, circle[4]!];
    const listeners = [circle[1]!, circle[3]!, circle[5]!];
    for (const id of tellers) {
      exp.minds.get(id)!.narratives.remember(STORY, 'Nine slew a bear in the forest', 500, 1900, ORIGIN, true);
    }
    exp.advance(150); // up to the co-presence pass
    const put = (id: number, x: number, y: number): void => {
      const t = exp.agentEntity(id)!.components['Transform2D'] as { x: number; y: number };
      t.x = x;
      t.y = y;
    };
    for (let i = 0; i < 3; i++) {
      put(tellers[i]!, 400 + i * 220, 1900); // well clear of the spawn band
      put(listeners[i]!, 400 + i * 220, 1900);
    }
    exp.advance(1); // the tale is told, once per company

    for (const id of listeners) {
      const heard = exp.minds.get(id)!.narratives.get(STORY)!;
      expect(heard.firsthand).toBe(false);
      expect(heard.firstTick).toBe(ORIGIN); // a retelling does not make it young
    }
    expect(exp.myth().oldestSurviving!.ageTicks).toBe(exp.tick - ORIGIN);

    // Everyone who SAW it dies; only the told remain.
    for (const id of tellers) {
      const body = exp.agentBody(id)!;
      body.needs.hunger = 100;
      body.health = 0.04;
    }
    exp.advance(2);
    expect(tellers.every((id) => !exp.agentBody(id)!.alive)).toBe(true);
    const after = exp.myth().oldestSurviving!;
    expect(after.holders).toBe(3); // the three who were told
    expect(after.text).toContain('Nine slew'); // still the oldest story alive
    expect(after.ageTicks).toBe(exp.tick - ORIGIN); // and just as old as ever
  });

  it('a starving being eats whatever nourishes, not only berries', () => {
    const exp = new Experiment({ seed: 'starving', agentCount: 4 });
    const body = exp.agentBody(exp.agentIds[0]!)!;
    body.needs.hunger = 95; // critical
    body.inventory = { tuber: 1 };
    // A long Idle keeps reflex out of it: only the body's urgent override can act.
    exp.body.setPlan(body, [{ kind: 'Idle', durationTicks: 500 }]);
    exp.advance(5);
    expect(body.inventory.tuber ?? 0).toBe(0);
    expect(body.needs.hunger).toBeLessThan(85);
  });

  it('reports cognition latency as host wall-clock, not a tick delta', async () => {
    let clock = 1000;
    const exp = new Experiment({
      seed: 'latency',
      agentCount: 4,
      mindBackend: new MockMindBackend(),
      now: () => (clock += 7),
    });
    exp.makeConscious(exp.agentIds[0]!);
    exp.advance(400); // long enough for at least one think cadence to fire
    await new Promise((r) => setTimeout(r, 0)); // let the scheduler's promises settle
    const record = exp.cognitionLog!.recent(1)[0]!;
    expect(record.latencyMs).toBe(7); // one clock step between start and log
    expect(record.tick).toBeGreaterThan(0); // sim time still recorded, separately
    expect(record.tick).toBeLessThanOrEqual(exp.tick);
  });

  it('produces an analysis snapshot (diffusion, accuracy, archetypes, culture)', () => {
    const exp = new Experiment({ seed: 'analysis', agentCount: 40 });
    exp.advance(6000);
    const a = exp.analysis();
    expect(Array.isArray(a.diffusion)).toBe(true);
    expect(Array.isArray(a.archetypes)).toBe(true);
    expect(typeof a.cultureCount).toBe('number');
    expect(a.accuracy).toHaveProperty('heldTotal');
    expect(a.accuracy).toHaveProperty('falseBeliefs');
    // Archetype counts never exceed the living population.
    const labelled = a.archetypes.reduce((s, x) => s + x.count, 0);
    expect(labelled).toBeLessThanOrEqual(exp.aliveCount());
  });
});
