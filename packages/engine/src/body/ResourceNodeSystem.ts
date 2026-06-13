import type { World } from '../core/World.js';
import type { ObjectKind, ResourceNodeKind } from './contract.js';
import { growthFactor } from './Climate.js';

/** Component key: 'ResourceNode'. */
export interface ResourceNode {
  kind: ResourceNodeKind;
  stock: number;
  maxStock: number;
  /** One unit regrows every this many ticks (0 = never regrows). */
  regrowEvery: number;
  /** Lifetime gather counter — drives deterministic seed yields. */
  gatherCount: number;
}

/** What gathering one unit from a node puts in your hands. */
export const NODE_YIELD: Record<ResourceNodeKind, ObjectKind> = {
  berryBush: 'berry',
  foodPlant: 'berry',
  mushroomPatch: 'mushroomRed',
  tuberPlant: 'tuber',
  nightshadePlant: 'nightshade',
  tree: 'wood',
  stoneDeposit: 'stone',
  waterSource: 'water',
  river: 'water',
  clayDeposit: 'clay',
  fiberPlant: 'fiber',
  copperVein: 'copperOre',
  tinVein: 'tinOre',
  ironVein: 'ironOre',
  coalSeam: 'coal',
  saltFlat: 'salt',
  silverVein: 'silver',
  goldVein: 'gold',
  gemVein: 'gemstone',
};

/** Every Nth gather from a food bush/plant also yields a seed — the
 *  physical fact agriculture can be discovered from. Not a system. */
export const SEED_EVERY_N_GATHERS = 3;

/** Living things regrow (season-gated); minerals/water do not. */
export const DEFAULT_REGROW: Record<ResourceNodeKind, number> = {
  berryBush: 220,
  foodPlant: 220,
  mushroomPatch: 600,
  tuberPlant: 260,
  nightshadePlant: 700,
  fiberPlant: 450,
  tree: 1000,
  stoneDeposit: 0,
  waterSource: 0,
  river: 0,
  clayDeposit: 0,
  copperVein: 0,
  tinVein: 0,
  ironVein: 0,
  coalSeam: 0,
  saltFlat: 0,
  silverVein: 0,
  goldVein: 0,
  gemVein: 0,
};

/** Plant nodes whose regrowth follows the seasons (winter halts them). */
const SEASONAL: ReadonlySet<ResourceNodeKind> = new Set<ResourceNodeKind>([
  'berryBush', 'foodPlant', 'mushroomPatch', 'tuberPlant', 'nightshadePlant', 'fiberPlant', 'tree',
]);

export function createResourceNode(kind: ResourceNodeKind, stock: number): ResourceNode {
  return {
    kind,
    stock,
    maxStock: stock,
    regrowEvery: DEFAULT_REGROW[kind],
    gatherCount: 0,
  };
}

/**
 * Finite stock + slow regrowth — scarcity must be real, because scarcity
 * is the engine of social behavior. Water never depletes.
 */
export class ResourceNodeSystem {
  step(world: World, tick: number): void {
    if (tick <= 0) return;
    const growth = growthFactor(tick); // season gate for living nodes
    world.forEach((entity) => {
      const node = entity.components['ResourceNode'] as ResourceNode | undefined;
      if (!node || node.regrowEvery <= 0 || node.stock >= node.maxStock) return;
      if (tick % node.regrowEvery !== 0) return;
      if (SEASONAL.has(node.kind)) {
        // Winter halts plant regrowth; autumn is half (regrow every other cycle).
        if (growth <= 0) return;
        if (growth < 1 && Math.floor(tick / node.regrowEvery) % 2 !== 0) return;
      }
      node.stock++;
    });
  }
}
