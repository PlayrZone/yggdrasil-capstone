import type { World } from '../core/World.js';
import type { Transform2D } from '../core/Transform2D.js';
import type { ObjectKind } from './contract.js';
import type { SimEventBus } from './SimEventBus.js';
import type { ResourceNode } from './ResourceNodeSystem.js';
import { createResourceNode, DEFAULT_REGROW } from './ResourceNodeSystem.js';
import { TICKS_PER_DAY } from './clock.js';

/**
 * The discoverable regularities of reality — physical mechanics only,
 * never systems or labels (V2: the world is the textbook). Agents are
 * never told any constant in this file; they may discover the patterns
 * these mechanics produce, or fail to, or "discover" patterns that
 * aren't here at all.
 */

export { TICKS_PER_DAY } from './clock.js';
/** The final third of each day is night. */
export function isNight(tick: number): boolean {
  return tick % TICKS_PER_DAY >= (TICKS_PER_DAY * 2) / 3;
}

/** A deposited seed becomes a food plant this many ticks later. */
export const SEED_SPROUT_TICKS = 400;
export const SPROUTED_PLANT_STOCK = 4;

/** Eating a poisonous thing brings sickness for this long. */
export const SICKNESS_TICKS = 300;

/**
 * Which foods nourish and which sicken — physical truth, NOT told to agents.
 * Some plants edible, some poisonous; they must discover which by eating (or
 * by watching someone else, or being told). Mirrors MATERIAL_PROPERTIES on
 * the mind side, but the Body owns the consequence.
 */
export const NUTRITIOUS_FOODS: ReadonlySet<ObjectKind> = new Set<ObjectKind>(['berry', 'tuber', 'meat']);
export const SICKENING_FOODS: ReadonlySet<ObjectKind> = new Set<ObjectKind>(['mushroomRed', 'nightshade']);

// Perception radius used to live here as PERCEPTION_RADIUS_DAY/NIGHT. It is
// world data, not a world REGULARITY, and since the scale audit it has lived
// in `BodyScale` (CLASSIC_SCALE.perceptionDay / perceptionNight) where a second
// world can hold its own. The constants here were dead — re-exported, and
// pinned by one test that pinned them to themselves.

/** Being out at night, unsheltered and awake, wears safety + health. */
export const EXPOSURE_SAFETY_PER_TICK = 0.08;
export const EXPOSURE_HEALTH_PER_TICK = 0.015;

/** Component key: 'SeedInGround'. */
export interface SeedInGround {
  plantedTick: number;
}

/**
 * Sprouts deposited seeds into food plants. That this happens — and that
 * nothing announces it — is the entire "agriculture system".
 */
export class WorldRegularitiesSystem {
  /** This world's interval for a food plant, read once — see `plantRegrowth`. */
  private sproutRegrowEvery?: number;

  step(world: World, tick: number, bus: SimEventBus): void {
    const sprouted: number[] = [];
    world.spatial.each('SeedInGround', (entity) => {
      const seed = entity.components['SeedInGround'] as SeedInGround;
      if (tick - seed.plantedTick >= SEED_SPROUT_TICKS) sprouted.push(entity.id);
    });
    for (const id of sprouted) {
      const entity = world.getEntity(id);
      if (!entity) continue;
      const t = entity.components['Transform2D'] as Transform2D;
      const x = t.x;
      const y = t.y;
      world.removeEntity(id);
      const plant = world.createEntity(
        {
          Transform2D: { x, y } satisfies Transform2D,
          ResourceNode: createResourceNode('foodPlant', SPROUTED_PLANT_STOCK, this.plantRegrowth(world)),
        },
        { static: true },
      );
      bus.emit({
        tick,
        type: 'PlantSprouted',
        actorId: 0,
        targetIds: [plant.id],
        x,
        y,
        payload: {},
      });
    }
  }

  /**
   * HOW FAST A SPROUT COMES BACK IS THE WORLD'S NUMBER, NOT THE KIND'S.
   *
   * `createResourceNode`'s table is the CLASSIC world's. The continent divides
   * its founding valley's carrying capacity out into a regrowth interval about
   * six times longer and hands it to every node it scatters
   * (`worlds/forager/continentScenario.ts`) — but a plant that sprouted from a
   * planted seed took the default and came back every 220 ticks against its
   * neighbours' ~1,300. That is a larder the capacity arithmetic never
   * accounted for, handed to whoever discovered planting, in a world whose
   * whole point is that food is finite.
   *
   * Nothing hands this system the scenario, so it reads the answer off the
   * ground it is sprouting into: a bush and a food plant regrow at the same
   * default pace, so whatever this world did to one it did to the other. Read
   * once, from the first such node the world holds; a world holding none falls
   * back to the kind's own default, which is what the classic world's is.
   */
  private plantRegrowth(world: World): number {
    const known = this.sproutRegrowEvery;
    if (known !== undefined) return known;
    const base = DEFAULT_REGROW['foodPlant'];
    let every = base;
    let found = false;
    world.spatial.each('ResourceNode', (entity) => {
      if (found) return;
      const node = entity.components['ResourceNode'] as ResourceNode;
      if (node.regrowEvery <= 0 || DEFAULT_REGROW[node.kind] !== base) return;
      every = node.regrowEvery;
      found = true;
    });
    this.sproutRegrowEvery = every;
    return every;
  }
}
