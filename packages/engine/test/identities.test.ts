import { describe, expect, it } from 'vitest';
import { CANONICAL_IDENTITIES, identityAt, Experiment } from '../src/index.js';

describe('canonical identities', () => {
  it('is a fixed roster of 256 stable individuals', () => {
    expect(CANONICAL_IDENTITIES.length).toBe(256);
    expect(CANONICAL_IDENTITIES[0]!.index).toBe(0);
    // Names are non-empty and traits are in range.
    for (const id of CANONICAL_IDENTITIES.slice(0, 20)) {
      expect(id.name.length).toBeGreaterThan(1);
      expect(id.traits.curiosity).toBeGreaterThanOrEqual(0);
      expect(id.traits.curiosity).toBeLessThanOrEqual(100);
    }
  });

  it('gives every name a unique label', () => {
    const names = new Set(CANONICAL_IDENTITIES.map((i) => i.name));
    expect(names.size).toBe(CANONICAL_IDENTITIES.length);
  });

  it('wraps past the roster end', () => {
    expect(identityAt(0)).toBe(CANONICAL_IDENTITIES[0]);
    expect(identityAt(256)).toBe(CANONICAL_IDENTITIES[0]);
    expect(identityAt(257)).toBe(CANONICAL_IDENTITIES[1]);
  });

  it('spawns the SAME individuals regardless of world seed', () => {
    const a = new Experiment({ seed: 'world-alpha', agentCount: 50 });
    const b = new Experiment({ seed: 'totally-different', agentCount: 50 });
    const namesA = a.agentIds.map((id) => a.agentBody(id)!.name);
    const namesB = b.agentIds.map((id) => b.agentBody(id)!.name);
    // Same cast, same order — identity is independent of the world seed.
    expect(namesA).toEqual(namesB);
    expect(namesA[0]).toBe(CANONICAL_IDENTITIES[0]!.name);
  });

  it('still places them differently per seed (world differs, people do not)', () => {
    const a = new Experiment({ seed: 'world-alpha', agentCount: 50 });
    const b = new Experiment({ seed: 'world-beta', agentCount: 50 });
    const posA = a.agentInfos().map((i) => `${i.x.toFixed(2)},${i.y.toFixed(2)}`);
    const posB = b.agentInfos().map((i) => `${i.x.toFixed(2)},${i.y.toFixed(2)}`);
    expect(posA).not.toEqual(posB);
  });
});
