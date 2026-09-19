import type { World } from '../core/World.js';
import type { Entity } from '../core/Entity.js';
import type { ActivityRegions, TiledEntities } from '../world/activity.js';
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
  game: 'meat',
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
  game: 0, // an animal is one carcass; the wildlife system respawns the herd
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

/** Does this node gain a unit of stock at exactly this tick? */
function regrowsAt(kind: ResourceNodeKind, regrowEvery: number, tick: number): boolean {
  if (tick <= 0 || tick % regrowEvery !== 0) return false;
  if (!SEASONAL.has(kind)) return true;
  const growth = growthFactor(tick);
  // Winter halts plant regrowth; autumn is half (regrow every other cycle).
  if (growth <= 0) return false;
  return !(growth < 1 && Math.floor(tick / regrowEvery) % 2 !== 0);
}

/**
 * HOW MUCH A NODE REGREW WHILE NOBODY WAS LOOKING — the closed form of the
 * per-tick rule above over the half-open interval (from, to].
 *
 * Growth only ever ADDS stock and nothing can take any while a tile is
 * dormant, so "step it `to − from` times" and "add the number of growth ticks
 * in between, capped" are the same number. That equality is what lets a tile
 * sleep for a season and wake up correct; `test/continent-activity.test.ts`
 * checks it against the literal loop across season boundaries.
 *
 * `deficit` bounds the work: counting stops once the node would be full, so a
 * tile dormant for a year costs what its emptiest node was short, not a year.
 */
export function regrowthCount(
  kind: ResourceNodeKind,
  regrowEvery: number,
  from: number,
  to: number,
  deficit: number,
): number {
  if (regrowEvery <= 0 || deficit <= 0 || to <= from) return 0;
  let grown = 0;
  const first = Math.max(1, Math.floor(from / regrowEvery) + 1);
  const last = Math.floor(to / regrowEvery);
  for (let k = first; k <= last; k++) {
    if (regrowsAt(kind, regrowEvery, k * regrowEvery)) {
      if (++grown >= deficit) return grown;
    }
  }
  return grown;
}

/**
 * Finite stock + slow regrowth — scarcity must be real, because scarcity
 * is the engine of social behavior. Water never depletes.
 *
 * Given an activity tiling it steps only the tiles a being is near, catching
 * each one up with `regrowthCount` when it wakes; given nothing it walks every
 * node every tick, as it always did. The two produce the same world — the
 * classic scenario runs the tiled path with every tile permanently live, and
 * its goldens are bit-identical.
 */
export class ResourceNodeSystem {
  constructor(
    private readonly tiles?: ActivityRegions,
    private readonly nodes?: TiledEntities,
  ) {}

  /** Entities this system's tile index must hold: nodes that can regrow. */
  static readonly REGROWABLE = (entity: Entity): boolean => {
    const node = entity.components['ResourceNode'] as ResourceNode | undefined;
    return node !== undefined && node.regrowEvery > 0;
  };

  step(world: World, tick: number): void {
    if (tick <= 0) return;
    const tiles = this.tiles;
    const index = this.nodes;
    if (!tiles || !index) {
      world.spatial.each('ResourceNode', (entity) => {
        const node = entity.components['ResourceNode'] as ResourceNode;
        if (regrowsAt(node.kind, node.regrowEvery, tick) && node.stock < node.maxStock) node.stock++;
      });
      return;
    }
    for (const tile of tiles.activeTiles) {
      const from = tiles.lastStepped(tile);
      if (from !== tick) {
        for (const id of index.in(tile)) {
          const node = world.getEntity(id)?.components['ResourceNode'] as ResourceNode | undefined;
          if (!node) continue;
          const deficit = node.maxStock - node.stock;
          if (deficit <= 0) continue;
          node.stock += regrowthCount(node.kind, node.regrowEvery, from, tick, deficit);
        }
        tiles.markStepped(tile, tick);
      }
    }
  }
}
