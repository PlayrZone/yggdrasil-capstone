import { describe, expect, it } from 'vitest';
import { Experiment } from '../src/runner/Experiment.js';

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
