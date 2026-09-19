import type { ObjectKind } from '../worlds/forager/types.js';

/**
 * Materials have PROPERTIES, not recipes (yggdrasil_world_design.md). Agents
 * discover what a material *does* by acting on it under conditions (heat,
 * force, time); the engine never exposes a crafting recipe. This table is the
 * physical truth — what each material is and can become — read by the Body
 * when an action is applied and by the Observatory for analysis. It is NOT
 * given to agents; they must learn it.
 *
 * `tier` is descriptive (analysis/distribution), not a tech gate.
 */
export type MaterialTier = 'basic' | 'intermediate' | 'advanced' | 'rare' | 'built';

export interface MaterialProps {
  tier: MaterialTier;
  /** Eating relieves hunger. */
  edible?: boolean;
  /** Eating causes sickness. */
  poisonous?: boolean;
  /** Burns as fuel (enables fire → the heat-dependent discoveries). */
  burns?: boolean;
  /** Burns hot enough to smelt ore (coal). */
  burnsHot?: boolean;
  /** Can be shaped while soft, hardens with heat (clay → brick). */
  moldable?: boolean;
  /** Can be twisted/woven (fiber → rope). */
  twistable?: boolean;
  /** Usable as a building material. */
  builds?: boolean;
  /** Ore that yields this metal under high heat. */
  smeltsTo?: ObjectKind;
  /** Preserves food (salt). */
  preserves?: boolean;
  /** Worked/tanned into this (hide → leather). */
  worksTo?: ObjectKind;
}

export const MATERIAL_PROPERTIES: Partial<Record<ObjectKind, MaterialProps>> = {
  // basic
  water: { tier: 'basic' },
  wood: { tier: 'basic', burns: true, builds: true },
  stone: { tier: 'basic', builds: true },
  clay: { tier: 'basic', moldable: true },
  fiber: { tier: 'basic', twistable: true },
  berry: { tier: 'basic', edible: true },
  tuber: { tier: 'basic', edible: true },
  seed: { tier: 'basic' },
  mushroomRed: { tier: 'basic', poisonous: true },
  nightshade: { tier: 'basic', poisonous: true },
  meat: { tier: 'basic', edible: true },
  hide: { tier: 'basic', worksTo: 'leather' },
  // intermediate (heat/force/time outcomes — Slice 2 mechanics)
  charcoal: { tier: 'intermediate', burns: true, burnsHot: true },
  leather: { tier: 'intermediate', builds: true },
  rope: { tier: 'intermediate' },
  brick: { tier: 'intermediate', builds: true },
  copper: { tier: 'intermediate', builds: true },
  tin: { tier: 'intermediate' },
  iron: { tier: 'intermediate', builds: true },
  bronze: { tier: 'intermediate', builds: true },
  // advanced
  copperOre: { tier: 'advanced', smeltsTo: 'copper' },
  tinOre: { tier: 'advanced', smeltsTo: 'tin' },
  ironOre: { tier: 'advanced', smeltsTo: 'iron' },
  coal: { tier: 'advanced', burns: true, burnsHot: true },
  salt: { tier: 'advanced', preserves: true },
  // rare
  silver: { tier: 'rare' },
  gold: { tier: 'rare' },
  gemstone: { tier: 'rare' },
};

/** Materials whose eating relieves hunger. */
export function isEdible(kind: ObjectKind): boolean {
  return MATERIAL_PROPERTIES[kind]?.edible === true;
}

/** Materials whose eating causes sickness. */
export function isPoisonous(kind: ObjectKind): boolean {
  return MATERIAL_PROPERTIES[kind]?.poisonous === true;
}
