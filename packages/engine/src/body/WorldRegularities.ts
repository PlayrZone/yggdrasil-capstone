import type { World } from '../core/World.js';
import type { Transform2D } from '../core/Transform2D.js';
import type { ObjectKind } from './contract.js';
import type { SimEventBus } from './SimEventBus.js';
import { createResourceNode } from './ResourceNodeSystem.js';
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

/** Perception radius, day vs night (darkness narrows the world). Widened for
 *  the larger continent — at 56 a Gahallian was effectively blind in a 2000-
 *  wide world and starved before finding food. */
export const PERCEPTION_RADIUS_DAY = 92;
export const PERCEPTION_RADIUS_NIGHT = 38;

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
      const plant = world.createEntity({
        Transform2D: { x, y } satisfies Transform2D,
        ResourceNode: createResourceNode('foodPlant', SPROUTED_PLANT_STOCK),
      });
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
}
