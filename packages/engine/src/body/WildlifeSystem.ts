import type { World } from '../core/World.js';
import type { Transform2D } from '../core/Transform2D.js';
import type { ResourceNode } from './ResourceNodeSystem.js';
import { createResourceNode } from './ResourceNodeSystem.js';
import { mulberry32, hashSeed } from './prng.js';
import { WORLD, regionAt, clampToWorld } from '../world/regions.js';

export type AnimalKind = 'deer' | 'hare' | 'boar';

/** Component key: 'Animal'. A wild animal that wanders; it is also a `game`
 *  ResourceNode, so hunting it (gathering) yields meat through the normal loop. */
export interface Animal {
  kind: AnimalKind;
  heading: number; // radians
  changeAt: number; // tick to pick a new heading
}

const ANIMAL_SPEED = 0.32; // slower than a Gahallian (0.5) — catchable
const MEAT_PER_ANIMAL = 4;

/** Animals graze the fertile lowlands; they avoid the sea and the high peaks. */
function grazeable(x: number, y: number): boolean {
  const r = regionAt(x, y);
  return r !== 'coast' && r !== 'mountain' && r !== 'lake';
}

/**
 * Wild animals — the world's mobile food and a reason to range. They wander
 * the lowlands; a Gahallian who catches one and gathers it gets meat. Nothing
 * tells anyone to hunt; the animals are simply there, moving. When a carcass
 * is used up the herd is replenished elsewhere, so wildlife persists.
 */
export class WildlifeSystem {
  private readonly rng: () => number;
  private readonly herd: number;
  private spawned = false;

  constructor(seed: string, herd: number) {
    this.rng = mulberry32(hashSeed(`${seed}:wildlife`));
    this.herd = herd;
  }

  private spawnOne(world: World, tick: number): void {
    const kinds: AnimalKind[] = ['deer', 'deer', 'hare', 'boar'];
    let x = 0;
    let y = 0;
    for (let i = 0; i < 40; i++) {
      x = WORLD * 0.1 + this.rng() * WORLD * 0.7;
      y = WORLD * 0.08 + this.rng() * WORLD * 0.84;
      if (grazeable(x, y)) break;
    }
    world.createEntity({
      Transform2D: { x, y } satisfies Transform2D,
      ResourceNode: createResourceNode('game', MEAT_PER_ANIMAL),
      Animal: {
        kind: kinds[Math.floor(this.rng() * kinds.length)]!,
        heading: this.rng() * Math.PI * 2,
        changeAt: tick + 80 + Math.floor(this.rng() * 240),
      } satisfies Animal,
    });
  }

  step(world: World, tick: number): void {
    if (!this.spawned) {
      for (let i = 0; i < this.herd; i++) this.spawnOne(world, tick);
      this.spawned = true;
      return;
    }
    let alive = 0;
    world.forEach((e) => {
      const animal = e.components['Animal'] as Animal | undefined;
      if (!animal) return;
      const node = e.components['ResourceNode'] as ResourceNode | undefined;
      const t = e.components['Transform2D'] as Transform2D | undefined;
      if (!node || !t) return;
      if (node.stock <= 0) {
        world.removeEntity(e.id); // hunted out — becomes a carcass elsewhere
        return;
      }
      alive++;
      if (tick >= animal.changeAt) {
        animal.heading += (this.rng() - 0.5) * Math.PI;
        animal.changeAt = tick + 80 + Math.floor(this.rng() * 240);
      }
      const nx = t.x + Math.cos(animal.heading) * ANIMAL_SPEED;
      const ny = t.y + Math.sin(animal.heading) * ANIMAL_SPEED;
      if (grazeable(nx, ny)) {
        t.x = nx;
        t.y = ny;
        clampToWorld(t);
      } else {
        animal.heading += Math.PI * 0.6; // turn away from sea/peaks
      }
    });
    // Replenish the herd so wildlife never vanishes entirely.
    if (alive < this.herd && this.rng() < 0.04) this.spawnOne(world, tick);
  }
}
