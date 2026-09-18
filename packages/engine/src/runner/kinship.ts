import type { KinTie } from '../contract/types.js';
import type { BirthRecord } from './RuntimeView.js';

/** The kin a being knows it has — parents and children, by name. */
export function kinOf(births: readonly BirthRecord[], nameOf: (id: number) => string, agentId: number): KinTie[] {
  const kin: KinTie[] = [];
  for (const b of births) {
    if (b.child === agentId) for (const p of b.parents) kin.push({ name: nameOf(p), relation: 'parent' });
    if (b.parents.includes(agentId)) kin.push({ name: nameOf(b.child), relation: 'child' });
  }
  return kin;
}
