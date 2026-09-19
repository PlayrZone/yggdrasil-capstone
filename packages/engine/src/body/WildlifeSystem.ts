import type { World } from '../core/World.js';
import type { Entity } from '../core/Entity.js';
import type { Transform2D } from '../core/Transform2D.js';
import type { GahallianBody } from './GahallianBody.js';
import type { ResourceNode } from './ResourceNodeSystem.js';
import type { SimEventBus } from './SimEventBus.js';
import { createResourceNode } from './ResourceNodeSystem.js';
import { mulberry32, hashSeed } from './prng.js';
import { CLASSIC_SCALE, classicGeography } from '../world/geography.js';
import type { BodyScale, WorldGeography } from '../world/geography.js';
import {
  ATTACK_COOLDOWN,
  MEAT_PER_PREY,
  PREY,
  PRED_HEALTH,
  WATER_KIND,
  resolveStrike,
} from './animals.js';
import type { Animal, AnimalKind, Quarry } from './animals.js';

export type { Animal, AnimalKind, HomeRange } from './animals.js';

/** Every world's wildlife, as the runtime sees it: something that steps. */
export interface WildlifeRules {
  step(world: World, tick: number, bus: SimEventBus): void;
}

/**
 * The living world beyond the Gahallians: prey to hunt and predators to fear.
 * Deer/hare/boar graze the lowlands and fish swim the waters (all huntable for
 * meat through the normal gather loop); wolves and bears stalk the land while
 * crocodiles lurk in the water, hunting Gahallians who stray too close. Nothing
 * is scripted onto the Gahallians — the danger and the food are simply there.
 *
 * THIS IS THE CLASSIC WORLD'S WILDLIFE and stays exactly as it was: a shared
 * RNG stream, a wandering heading per animal, prey that bolt from predators,
 * and a full rescan every `REFRESH` ticks. It does not scale past a 2 km plane
 * — `stepPrey` alone is O(prey × predators) — which is why the continent has
 * its own (`ContinentWildlife`) rather than this one with bigger numbers.
 */
const REFRESH = 12; // ticks between full entity rescans (perf — animals are slow)

export class WildlifeSystem implements WildlifeRules {
  private readonly rng: () => number;
  private readonly herd: number;
  private spawned = false;
  // Caches refreshed every REFRESH ticks so we don't scan the whole world each
  // tick (there are ~2000 resource entities). Slightly-stale positions are fine
  // for slow-moving wildlife.
  private animalCache: Entity[] = [];
  private peopleCache: Quarry[] = [];
  /** Quarry lookup for the cached people — a predator asks by id every tick. */
  private peopleById = new Map<number, Quarry>();

  constructor(
    seed: string,
    herd: number,
    private readonly geography: WorldGeography = classicGeography,
    private readonly scale: BodyScale = CLASSIC_SCALE,
  ) {
    this.rng = mulberry32(hashSeed(`${seed}:wildlife`));
    this.herd = herd;
  }

  private speedOf(kind: AnimalKind): number {
    return this.scale.animalSpeed[kind] ?? 0.3;
  }

  private habitatOk(kind: AnimalKind, x: number, y: number): boolean {
    if (WATER_KIND.has(kind)) return this.geography.isWater(x, y);
    // Land animals avoid the sea/lakes and the high peaks.
    return !this.geography.isDeepWater(x, y) && this.geography.regionAt(x, y) !== 'mountain';
  }

  private pickKind(): AnimalKind {
    // ~88% prey, ~12% predators. The threat stays real — survival is meant to
    // come from DISCOVERING weapons and fighting back, not from a tame world.
    const r = this.rng();
    if (r < 0.42) return 'deer';
    if (r < 0.56) return 'hare';
    if (r < 0.66) return 'boar';
    if (r < 0.88) return 'fish';
    if (r < 0.95) return 'wolf';
    if (r < 0.98) return 'crocodile';
    return 'bear';
  }

  private spawnOne(world: World, tick: number, kind?: AnimalKind): void {
    const k = kind ?? this.pickKind();
    const span = this.geography.span;
    let x = span / 2;
    let y = span / 2;
    for (let i = 0; i < 60; i++) {
      x = span * 0.08 + this.rng() * span * 0.78;
      y = span * 0.06 + this.rng() * span * 0.88;
      if (this.habitatOk(k, x, y)) break;
    }
    const animal: Animal = {
      kind: k,
      heading: this.rng() * Math.PI * 2,
      changeAt: tick + 80 + Math.floor(this.rng() * 240),
      targetId: 0,
      lastAttack: 0,
      health: PRED_HEALTH[k] ?? 10,
    };
    const components: Record<string, unknown> = { Transform2D: { x, y } satisfies Transform2D, Animal: animal };
    if (PREY.has(k)) components['ResourceNode'] = createResourceNode('game', k === 'fish' ? 2 : MEAT_PER_PREY);
    world.createEntity(components);
  }

  step(world: World, tick: number, bus: SimEventBus): void {
    if (!this.spawned) {
      for (let i = 0; i < this.herd; i++) this.spawnOne(world, tick);
      this.spawned = true;
      return;
    }

    // Rescan the world only periodically; reuse the caches in between.
    if (tick % REFRESH === 0 || this.animalCache.length === 0) {
      const people: Quarry[] = [];
      const animals: Entity[] = [];
      world.spatial.each('Animal', (e) => animals.push(e));
      world.spatial.each('GahallianBody', (e) => {
        const body = e.components['GahallianBody'] as GahallianBody;
        const t = e.components['Transform2D'] as Transform2D | undefined;
        if (body.alive && t) people.push({ id: e.id, x: t.x, y: t.y, body });
      });
      this.animalCache = animals;
      this.peopleCache = people;
      this.peopleById = new Map(people.map((p) => [p.id, p]));
    }
    const people = this.peopleCache;
    const animals = this.animalCache;

    let alive = 0;
    for (const e of animals) {
      const animal = e.components['Animal'] as Animal;
      const t = e.components['Transform2D'] as Transform2D;
      const node = e.components['ResourceNode'] as ResourceNode | undefined;
      if (node && node.stock <= 0) {
        world.removeEntity(e.id); // hunted out
        continue;
      }
      alive++;
      const predator = !PREY.has(animal.kind);
      if (predator) this.stepPredator(world, animal, e.id, t, people, tick, bus);
      else this.stepPrey(world, animal, e.id, t, animals, tick);
    }

    if (alive < this.herd && this.rng() < 0.05) this.spawnOne(world, tick);
  }

  private wander(world: World, id: number, animal: Animal, t: Transform2D, tick: number): void {
    if (tick >= animal.changeAt) {
      animal.heading += (this.rng() - 0.5) * Math.PI;
      animal.changeAt = tick + 80 + Math.floor(this.rng() * 240);
    }
    const sp = this.speedOf(animal.kind);
    const nx = t.x + Math.cos(animal.heading) * sp;
    const ny = t.y + Math.sin(animal.heading) * sp;
    if (this.habitatOk(animal.kind, nx, ny)) {
      t.x = nx;
      t.y = ny;
      this.geography.clamp(t);
      world.spatial.markMoved(id);
    } else {
      animal.heading += Math.PI * 0.7; // turn back into habitat
    }
  }

  private moveToward(
    world: World,
    id: number,
    animal: Animal,
    t: Transform2D,
    tx: number,
    ty: number,
    tick: number,
    mult = 1,
  ): void {
    const dx = tx - t.x;
    const dy = ty - t.y;
    const d = Math.hypot(dx, dy) || 1;
    const sp = this.speedOf(animal.kind) * mult;
    const nx = t.x + (dx / d) * sp;
    const ny = t.y + (dy / d) * sp;
    if (this.habitatOk(animal.kind, nx, ny)) {
      t.x = nx;
      t.y = ny;
      this.geography.clamp(t);
      world.spatial.markMoved(id);
    } else {
      animal.changeAt = tick - 1; // force a new heading and graze instead
      this.wander(world, id, animal, t, tick);
    }
  }

  private stepPrey(world: World, animal: Animal, id: number, t: Transform2D, animals: Entity[], tick: number): void {
    // Bolt from the nearest predator in sight; otherwise graze.
    let nearest: Transform2D | null = null;
    let best = this.scale.preyFear * this.scale.preyFear;
    for (const o of animals) {
      const oa = o.components['Animal'] as Animal;
      if (PREY.has(oa.kind)) continue;
      const ot = o.components['Transform2D'] as Transform2D;
      const dd = (ot.x - t.x) ** 2 + (ot.y - t.y) ** 2;
      if (dd < best) {
        best = dd;
        nearest = ot;
      }
    }
    if (nearest) this.moveToward(world, id, animal, t, 2 * t.x - nearest.x, 2 * t.y - nearest.y, tick, 1.4);
    else this.wander(world, id, animal, t, tick);
  }

  private stepPredator(
    world: World,
    animal: Animal,
    id: number,
    t: Transform2D,
    people: Quarry[],
    tick: number,
    bus: SimEventBus,
  ): void {
    // Re-acquire a quarry periodically.
    if (tick % 16 === 0 || animal.targetId === 0) {
      let best = this.scale.predatorDetect * this.scale.predatorDetect;
      animal.targetId = 0;
      for (const p of people) {
        const dd = (p.x - t.x) ** 2 + (p.y - t.y) ** 2;
        if (dd < best) {
          best = dd;
          animal.targetId = p.id;
        }
      }
    }
    const quarry = animal.targetId ? this.peopleById.get(animal.targetId) : undefined;
    if (!quarry || !quarry.body.alive) {
      animal.targetId = 0;
      this.wander(world, id, animal, t, tick);
      return;
    }
    const dist = Math.hypot(quarry.x - t.x, quarry.y - t.y);
    if (dist > this.scale.predatorGiveUp) {
      animal.targetId = 0; // lost it — go back to roaming
      this.wander(world, id, animal, t, tick);
      return;
    }
    if (dist <= this.scale.predatorAttack + 2) {
      if (tick - animal.lastAttack >= ATTACK_COOLDOWN) resolveStrike(world, bus, tick, id, animal, t, quarry);
    } else {
      this.moveToward(world, id, animal, t, quarry.x, quarry.y, tick, 1);
    }
  }
}
