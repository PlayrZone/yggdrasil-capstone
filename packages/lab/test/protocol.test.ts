import { describe, expect, it } from 'vitest';
import {
  ACT_COUNT,
  ACT_DANGER,
  ACT_IDLE,
  ACT_RESTING,
  ACT_SOCIAL,
  ACT_WALKING,
  allocFrameArrays,
  beingCapacity,
  COND_HURT,
  COND_SICK,
  COND_STARVING,
  frameBuffers,
  isDetached,
  KIND_UNKNOWN,
  KindCodec,
  PROTOCOL_VERSION,
  resourceBuffers,
  STAGE_ADULT,
  STAGE_CHILD,
  STAGE_ELDER,
  wildlifeCapacity,
} from '../src/renderer/sim/protocol.js';

describe('protocol', () => {
  it('is versioned', () => {
    expect(Number.isInteger(PROTOCOL_VERSION)).toBe(true);
    expect(PROTOCOL_VERSION).toBeGreaterThan(0);
  });

  it('keeps the quiet acts first, so a default-zero lane draws no badge', () => {
    expect(ACT_IDLE).toBe(0);
    expect(ACT_WALKING).toBe(1);
    expect(ACT_COUNT).toBeGreaterThan(ACT_SOCIAL);
    expect(new Set([ACT_IDLE, ACT_WALKING, ACT_RESTING, ACT_DANGER, ACT_SOCIAL]).size).toBe(5);
  });

  it('gives every condition its own bit, so a being can be more than one thing', () => {
    expect(COND_SICK | COND_STARVING | COND_HURT).toBe(7);
    expect(COND_SICK & COND_STARVING).toBe(0);
  });

  it('orders the life stages youngest first', () => {
    expect([STAGE_CHILD, STAGE_ADULT, STAGE_ELDER]).toEqual([0, 1, 2]);
  });
});

describe('frame arrays', () => {
  it('sizes every lane for the requested capacity', () => {
    const a = allocFrameArrays(10, 4);
    expect(beingCapacity(a)).toBe(10);
    expect(wildlifeCapacity(a)).toBe(4);
    expect(a.pos.length).toBe(20);
    expect(a.heading.length).toBe(10);
    expect(a.act.length).toBe(10);
    expect(a.cond.length).toBe(10);
    expect(a.stage.length).toBe(10);
    expect(a.wildPos.length).toBe(8);
    expect(a.wildKind.length).toBe(4);
  });

  it('never allocates a zero-length lane (a detached array must be distinguishable)', () => {
    const a = allocFrameArrays(0, 0);
    expect(beingCapacity(a)).toBe(1);
    expect(wildlifeCapacity(a)).toBe(1);
    expect(isDetached(a)).toBe(false);
  });

  it('lists exactly the buffers to transfer, each one distinct', () => {
    const a = allocFrameArrays(3, 3);
    const buffers = frameBuffers(a);
    expect(buffers).toHaveLength(9);
    expect(new Set(buffers).size).toBe(9);
  });

  it('reports detachment once the buffers are gone', () => {
    const a = allocFrameArrays(3, 3);
    // structuredClone with a transfer list neuters the originals, exactly as
    // postMessage does — this is the state the worker's pool must reject.
    structuredClone(a, { transfer: frameBuffers(a) });
    expect(isDetached(a)).toBe(true);
  });

  it('survives a transfer round trip with its contents intact', () => {
    const a = allocFrameArrays(2, 1);
    a.ids[0] = 42;
    a.pos[0] = 1.5;
    a.act[1] = ACT_RESTING;
    a.cond[1] = COND_SICK | COND_STARVING;
    a.stage[1] = STAGE_ELDER;
    const there = structuredClone(a, { transfer: frameBuffers(a) });
    expect(there.ids[0]).toBe(42);
    expect(there.pos[0]).toBeCloseTo(1.5);
    expect(there.act[1]).toBe(ACT_RESTING);
    expect(there.cond[1]).toBe(COND_SICK | COND_STARVING);
    expect(there.stage[1]).toBe(STAGE_ELDER);
    const back = structuredClone(there, { transfer: frameBuffers(there) });
    expect(back.ids[0]).toBe(42);
    expect(isDetached(there)).toBe(true);
  });

  it('lists the resource buffers to transfer', () => {
    const payload = { kinds: ['berryBush'], count: 1, pos: new Float32Array(2), kind: new Uint8Array(1) };
    expect(new Set(resourceBuffers(payload)).size).toBe(2);
  });
});

describe('KindCodec', () => {
  it('assigns stable codes and reports each name exactly once', () => {
    const codec = new KindCodec();
    expect(codec.codeOf('deer')).toBe(0);
    expect(codec.codeOf('wolf')).toBe(1);
    expect(codec.codeOf('deer')).toBe(0);
    expect(codec.drain()).toEqual(['deer', 'wolf']);
    expect(codec.drain()).toEqual([]);
    expect(codec.codeOf('bear')).toBe(2);
    expect(codec.drain()).toEqual(['bear']);
  });

  it('names() is the code table, in code order', () => {
    const codec = new KindCodec();
    for (const k of ['a', 'b', 'c']) codec.codeOf(k);
    const names = codec.names();
    expect(names).toEqual(['a', 'b', 'c']);
    expect(names[codec.codeOf('b')]).toBe('b');
  });

  it('buckets kinds beyond a Uint8 instead of aliasing a real one', () => {
    const codec = new KindCodec();
    for (let i = 0; i < 255; i++) codec.codeOf(`kind${i}`);
    expect(codec.size).toBe(255);
    expect(codec.codeOf('one-too-many')).toBe(KIND_UNKNOWN);
    expect(codec.codeOf('kind0')).toBe(0);
  });
});
