import { describe, expect, it } from 'vitest';
import { Experiment } from '../src/runner/Experiment.js';
import { MemoryStream } from '../src/memory/MemoryStream.js';
import { classifyArchetype, classifyFromCounts } from '../src/analysis/archetype.js';
import { mem, resetIds } from './helpers.js';

/**
 * FOOTPRINT LOCK (W0-E). The episodic tier is the only unbounded thing a mind
 * used to hold: eviction moved records into an archive that only grew, and a
 * dead being kept every record it ever formed. These hold the bound that
 * replaced both — the amount of episodic memory a run retains must be a
 * function of the LIVING population, never of how long the run has gone on.
 */

/** Long enough that minds have evicted and the world has buried someone. */
const AGENTS = 36;
const TICKS = 7200; // three days per leg

interface Census {
  /** Records still held, by the living and (must be zero) by the dead. */
  living: number;
  dead: number;
  livingMinds: number;
  deadMinds: number;
  /** Capacity the living are collectively entitled to — the bound. */
  allowed: number;
  /** Memories ever formed, dropped ones included. */
  everFormed: number;
  /** …of which were formed by beings that are now dead. */
  deadFormed: number;
}

function census(exp: Experiment): Census {
  const c: Census = { living: 0, dead: 0, livingMinds: 0, deadMinds: 0, allowed: 0, everFormed: 0, deadFormed: 0 };
  for (const id of exp.agentIds) {
    const mind = exp.minds.get(id);
    if (!mind) continue;
    c.everFormed += mind.memory.totalCount;
    if (exp.agentBody(id)?.alive) {
      c.livingMinds++;
      c.living += mind.memory.hotCount;
      c.allowed += mind.memory.capacity;
    } else {
      c.deadMinds++;
      c.dead += mind.memory.hotCount;
      c.deadFormed += mind.memory.totalCount;
    }
  }
  return c;
}

describe('episodic memory is bounded by the living population', () => {
  it('stays inside the living capacity while memories keep being formed', () => {
    const exp = new Experiment({ seed: 'bound-alpha', agentCount: AGENTS });
    exp.advance(TICKS);
    const early = census(exp);

    let checkedLiving = 0;
    let buried = 0;
    for (const id of exp.agentIds) {
      const mind = exp.minds.get(id);
      if (!mind) continue;
      if (exp.agentBody(id)?.alive) {
        checkedLiving++;
        expect(mind.memory.hotCount).toBeLessThanOrEqual(mind.memory.capacity);
        expect(mind.memory.all()).toHaveLength(mind.memory.hotCount);
      } else {
        buried++;
        expect(mind.memory.hotCount).toBe(0);
        expect(mind.memory.all()).toEqual([]);
        // …but the tombstone still knows the being lived, and what it did.
        expect(mind.memory.totalCount).toBeGreaterThan(0);
      }
    }
    expect(checkedLiving).toBeGreaterThan(10);
    expect(buried).toBeGreaterThan(0); // otherwise the dead half proves nothing
    expect(early.dead).toBe(0);
    expect(early.living).toBeLessThanOrEqual(early.allowed);

    exp.advance(TICKS);
    const late = census(exp);

    expect(late.deadMinds).toBeGreaterThan(early.deadMinds); // more have died…
    expect(late.dead).toBe(0); // …and they still hold nothing

    // THE PLATEAU. Memories keep being formed, but what is RETAINED has come
    // off that curve: it can never exceed the living population's capacity,
    // whatever the run length, and the dead — who form a large share of every
    // long run's memories — retain nothing at all. Before this change retained
    // and ever-formed were the same number, for the living and the dead alike.
    expect(late.everFormed).toBeGreaterThan(early.everFormed * 1.5);
    expect(early.living).toBeLessThanOrEqual(early.allowed);
    expect(late.living).toBeLessThanOrEqual(late.allowed);
    expect(late.deadFormed).toBeGreaterThan(late.everFormed * 0.15);
    expect(late.living + late.dead).toBeLessThan(late.everFormed * 0.8);
  }, 60_000);
});

describe('MemoryStream after eviction', () => {
  it('drops the record, keeps the count, and answers get() in O(1)', () => {
    resetIds();
    const stream = new MemoryStream(8);
    const ids: number[] = [];
    for (let i = 0; i < 40; i++) {
      ids.push(stream.append(mem(i, 'GatherSucceeded', { objectKind: 'berry' })).id);
    }
    expect(stream.hotCount).toBeLessThanOrEqual(8);
    expect(stream.totalCount).toBe(40);
    expect(stream.all()).toHaveLength(stream.hotCount);

    const held = stream.all().map((m) => m.id);
    for (const id of held) expect(stream.get(id)?.id).toBe(id);
    for (const id of ids.filter((i) => !held.includes(i))) expect(stream.get(id)).toBeUndefined();
  });

  it('classifies the same archetype from the tally as from the whole life', () => {
    resetIds();
    const stream = new MemoryStream(8);
    const whole = [];
    for (let i = 0; i < 30; i++) whole.push(mem(i, 'GatherSucceeded', { objectKind: 'wood' }));
    for (let i = 0; i < 6; i++) whole.push(mem(100 + i, 'GaveItem', { subjects: [2] }));
    for (const m of whole) stream.append(m);

    // Most of those records are gone; the label must still be the life's.
    expect(stream.hotCount).toBeLessThan(whole.length);
    expect(classifyFromCounts(stream.experienceCounts())).toEqual(classifyArchetype(whole));
    expect(classifyFromCounts(stream.experienceCounts()).archetype).toBe('woodcutter');
  });

  it('release() frees the records but not what the being did', () => {
    resetIds();
    const stream = new MemoryStream(64);
    for (let i = 0; i < 20; i++) stream.append(mem(i, 'BuiltStructure'));
    const before = classifyFromCounts(stream.experienceCounts());

    stream.release();
    expect(stream.hotCount).toBe(0);
    expect(stream.all()).toEqual([]);
    expect(stream.totalCount).toBe(20);
    expect(classifyFromCounts(stream.experienceCounts())).toEqual(before);
  });
});
