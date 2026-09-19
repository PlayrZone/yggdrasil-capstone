import type { KinTie } from '../contract/types.js';
import type { BirthRecord } from './RuntimeView.js';

/**
 * Which generation a being belongs to: founders are 1, a child is one past its
 * eldest-known parent. Computed from the births ledger — the only record of
 * lineage. Used to measure how a skill propagates DOWN the generations.
 */
export function generationOf(births: readonly BirthRecord[], id: number): number {
  const parentOf = new Map<number, [number, number]>();
  for (const b of births) parentOf.set(b.child, b.parents);
  const cache = new Map<number, number>();
  const depth = (a: number, guard: number): number => {
    if (cache.has(a)) return cache.get(a)!;
    const parents = parentOf.get(a);
    if (!parents || guard > 100) {
      cache.set(a, 1);
      return 1;
    }
    const g = 1 + Math.max(depth(parents[0], guard + 1), depth(parents[1], guard + 1));
    cache.set(a, g);
    return g;
  };
  return depth(id, 0);
}

/** The kin a being knows it has — parents and children, by name. */
export function kinOf(births: readonly BirthRecord[], nameOf: (id: number) => string, agentId: number): KinTie[] {
  const kin: KinTie[] = [];
  for (const b of births) {
    if (b.child === agentId) for (const p of b.parents) kin.push({ name: nameOf(p), relation: 'parent' });
    if (b.parents.includes(agentId)) kin.push({ name: nameOf(b.child), relation: 'child' });
  }
  return kin;
}
