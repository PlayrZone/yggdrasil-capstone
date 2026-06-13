import type { World } from '../core/World.js';
import type { Entity } from '../core/Entity.js';
import type { Transform2D } from '../core/Transform2D.js';
import type { GahallianBody } from './GahallianBody.js';
import type { ResourceNode } from './ResourceNodeSystem.js';
import type { SimEventBus } from './SimEventBus.js';
import { createResourceNode } from './ResourceNodeSystem.js';
import { mulberry32, hashSeed } from './prng.js';
import { WORLD, regionAt, isWater, isDeepWater, clampToWorld } from '../world/regions.js';

export type AnimalKind = 'deer' | 'hare' | 'boar' | 'fish' | 'wolf' | 'bear' | 'crocodile';

/** Component key: 'Animal'. Prey are also `game` ResourceNodes (huntable for
 *  meat); predators are threats that hunt Gahallians. */
export interface Animal {
  kind: AnimalKind;
  heading: number;
  changeAt: number;
  /** Predators only: current quarry + attack cooldown + health (can be killed). */
  targetId: number;
  lastAttack: number;
  health: number;
}

// What a held weapon does to a predator that attacks you. Emergent: you only
// have one if you DISCOVERED how to craft it. Best weapon in hand is used.
const WEAPON_DAMAGE: Record<string, number> = { spear: 12, handaxe: 9, club: 6 };
const PRED_HEALTH: Record<string, number> = { wolf: 18, bear: 34, crocodile: 24 };

function bestWeaponDamage(inv: Partial<Record<string, number>>): number {
  let best = 0;
  for (const [w, d] of Object.entries(WEAPON_DAMAGE)) if ((inv[w] ?? 0) > 0 && d > best) best = d;
  return best;
}

const PREY: ReadonlySet<AnimalKind> = new Set<AnimalKind>(['deer', 'hare', 'boar', 'fish']);
const WATER_KIND: ReadonlySet<AnimalKind> = new Set<AnimalKind>(['fish', 'crocodile']);
// Predators are slower than a Gahallian (0.5) so a fleeing one can escape.
const SPEED: Record<AnimalKind, number> = { deer: 0.34, hare: 0.4, boar: 0.3, fish: 0.3, wolf: 0.44, bear: 0.36, crocodile: 0.4 };
const DAMAGE: Record<string, number> = { wolf: 4, bear: 8, crocodile: 7 };
const DETECT = 42; // a predator only notices a Gahallian this close
const GIVE_UP_DIST = 70; // and abandons a chase past here
const ATTACK_R = 7;
const ATTACK_COOLDOWN = 60; // ~slow maulings, not a death ray
const FEAR_R = 46; // prey bolt from a predator within this range
const MEAT_PER_PREY = 4;

function habitatOk(kind: AnimalKind, x: number, y: number): boolean {
  if (WATER_KIND.has(kind)) return isWater(x, y);
  // Land animals avoid the sea/lakes and the high peaks.
  const r = regionAt(x, y);
  return !isDeepWater(x, y) && r !== 'mountain';
}

/**
 * The living world beyond the Gahallians: prey to hunt and predators to fear.
 * Deer/hare/boar graze the lowlands and fish swim the waters (all huntable for
 * meat through the normal gather loop); wolves and bears stalk the land while
 * crocodiles lurk in the water, hunting Gahallians who stray too close. Nothing
 * is scripted onto the Gahallians — the danger and the food are simply there.
 */
const REFRESH = 12; // ticks between full entity rescans (perf — animals are slow)

export class WildlifeSystem {
  private readonly rng: () => number;
  private readonly herd: number;
  private spawned = false;
  // Caches refreshed every REFRESH ticks so we don't scan the whole world each
  // tick (there are ~2000 resource entities). Slightly-stale positions are fine
  // for slow-moving wildlife.
  private animalCache: Entity[] = [];
  private peopleCache: { id: number; x: number; y: number; body: GahallianBody }[] = [];

  constructor(seed: string, herd: number) {
    this.rng = mulberry32(hashSeed(`${seed}:wildlife`));
    this.herd = herd;
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
    let x = WORLD / 2;
    let y = WORLD / 2;
    for (let i = 0; i < 60; i++) {
      x = WORLD * 0.08 + this.rng() * WORLD * 0.78;
      y = WORLD * 0.06 + this.rng() * WORLD * 0.88;
      if (habitatOk(k, x, y)) break;
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
      const people: { id: number; x: number; y: number; body: GahallianBody }[] = [];
      const animals: Entity[] = [];
      world.forEach((e) => {
        if (e.components['Animal']) {
          animals.push(e);
          return;
        }
        const body = e.components['GahallianBody'] as GahallianBody | undefined;
        const t = e.components['Transform2D'] as Transform2D | undefined;
        if (body?.alive && t) people.push({ id: e.id, x: t.x, y: t.y, body });
      });
      this.animalCache = animals;
      this.peopleCache = people;
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
      else this.stepPrey(animal, t, animals, tick);
    }

    if (alive < this.herd && this.rng() < 0.05) this.spawnOne(world, tick);
  }

  private wander(animal: Animal, t: Transform2D, tick: number): void {
    if (tick >= animal.changeAt) {
      animal.heading += (this.rng() - 0.5) * Math.PI;
      animal.changeAt = tick + 80 + Math.floor(this.rng() * 240);
    }
    const sp = SPEED[animal.kind];
    const nx = t.x + Math.cos(animal.heading) * sp;
    const ny = t.y + Math.sin(animal.heading) * sp;
    if (habitatOk(animal.kind, nx, ny)) {
      t.x = nx;
      t.y = ny;
      clampToWorld(t);
    } else {
      animal.heading += Math.PI * 0.7; // turn back into habitat
    }
  }

  private moveToward(animal: Animal, t: Transform2D, tx: number, ty: number, tick: number, mult = 1): void {
    const dx = tx - t.x;
    const dy = ty - t.y;
    const d = Math.hypot(dx, dy) || 1;
    const sp = SPEED[animal.kind] * mult;
    const nx = t.x + (dx / d) * sp;
    const ny = t.y + (dy / d) * sp;
    if (habitatOk(animal.kind, nx, ny)) {
      t.x = nx;
      t.y = ny;
      clampToWorld(t);
    } else {
      animal.changeAt = tick - 1; // force a new heading and graze instead
      this.wander(animal, t, tick);
    }
  }

  private stepPrey(animal: Animal, t: Transform2D, animals: Entity[], tick: number): void {
    // Bolt from the nearest predator in sight; otherwise graze.
    let nearest: Transform2D | null = null;
    let best = FEAR_R * FEAR_R;
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
    if (nearest) this.moveToward(animal, t, 2 * t.x - nearest.x, 2 * t.y - nearest.y, tick, 1.4);
    else this.wander(animal, t, tick);
  }

  private stepPredator(
    world: World,
    animal: Animal,
    id: number,
    t: Transform2D,
    people: { id: number; x: number; y: number; body: GahallianBody }[],
    tick: number,
    bus: SimEventBus,
  ): void {
    // Re-acquire a quarry periodically.
    if (tick % 16 === 0 || animal.targetId === 0) {
      let best = DETECT * DETECT;
      animal.targetId = 0;
      for (const p of people) {
        const dd = (p.x - t.x) ** 2 + (p.y - t.y) ** 2;
        if (dd < best) {
          best = dd;
          animal.targetId = p.id;
        }
      }
    }
    const quarry = animal.targetId ? people.find((p) => p.id === animal.targetId) : undefined;
    if (!quarry || !quarry.body.alive) {
      animal.targetId = 0;
      this.wander(animal, t, tick);
      return;
    }
    const dist = Math.hypot(quarry.x - t.x, quarry.y - t.y);
    if (dist > GIVE_UP_DIST) {
      animal.targetId = 0; // lost it — go back to roaming
      this.wander(animal, t, tick);
      return;
    }
    if (dist <= ATTACK_R + 2) {
      if (tick - animal.lastAttack >= ATTACK_COOLDOWN) {
        animal.lastAttack = tick;
        const dmg = DAMAGE[animal.kind] ?? 6;
        quarry.body.health -= dmg;
        quarry.body.needs.safety = Math.min(100, quarry.body.needs.safety + 38); // terror
        quarry.body.hitThisTick = true;
        bus.emit({
          tick,
          type: 'AttackedByPredator',
          actorId: quarry.id,
          targetIds: [id],
          x: quarry.x,
          y: quarry.y,
          payload: { predator: animal.kind, damage: dmg },
        });
        // An ARMED Gahallian fights back — the whole point of weapons. They
        // only have one if they discovered how to craft it.
        const wdmg = bestWeaponDamage(quarry.body.inventory as Partial<Record<string, number>>);
        if (wdmg > 0) {
          animal.health -= wdmg;
          bus.emit({ tick, type: 'FoughtPredator', actorId: quarry.id, targetIds: [id], x: quarry.x, y: quarry.y, payload: { predator: animal.kind, damage: wdmg } });
          if (animal.health <= 0) {
            world.removeEntity(id); // the beast is slain
            world.createEntity({ Transform2D: { x: t.x, y: t.y } satisfies Transform2D, ResourceNode: createResourceNode('game', 2) }); // a carcass to butcher
            bus.emit({ tick, type: 'KilledPredator', actorId: quarry.id, targetIds: [], x: quarry.x, y: quarry.y, payload: { predator: animal.kind } });
            quarry.body.needs.safety = Math.max(0, quarry.body.needs.safety - 25); // relief
          }
        }
      }
    } else {
      this.moveToward(animal, t, quarry.x, quarry.y, tick, 1);
    }
  }
}
