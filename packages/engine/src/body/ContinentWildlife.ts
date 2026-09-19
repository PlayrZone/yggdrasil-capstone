import type { World } from '../core/World.js';
import type { Entity } from '../core/Entity.js';
import type { Transform2D } from '../core/Transform2D.js';
import type { GahallianBody } from './GahallianBody.js';
import type { ResourceNode } from './ResourceNodeSystem.js';
import type { SimEventBus } from './SimEventBus.js';
import { createResourceNode } from './ResourceNodeSystem.js';
import { mulberry32, hashSeed } from './prng.js';
import { ActivityRegions, TiledEntities } from '../world/activity.js';
import type { BodyScale, WorldGeography } from '../world/geography.js';
import {
  ATTACK_COOLDOWN,
  MEAT_PER_PREY,
  PREY,
  PRED_HEALTH,
  WATER_KIND,
  homePosition,
  resolveStrike,
} from './animals.js';
import type { Animal, AnimalKind, HomeRange } from './animals.js';
import type { WildlifeRules } from './WildlifeSystem.js';

const TAU = Math.PI * 2;
const SQRT2 = Math.SQRT2;

/**
 * Animals per km² of tile, chosen so the REALISED density over habitable
 * ground lands on the classic world's 24/km² (90 animals over its 3.73 km² of
 * walkable land) — tiles that are sea, or where no home range fits, place
 * nothing, so the nominal figure has to be higher than the realised one.
 */
export const WILDLIFE_PER_KM2 = 30;
/** Extra prey per km² on plains far from the founding valley: a reason to walk. */
const FAR_GAME_PER_KM2 = 26;
const FAR_GAME_FROM = 2500; // metres from the valley at which "far" begins

/**
 * THE CONTINENT'S WILDLIFE — a home-range model, not a wandering one.
 *
 * `WildlifeSystem` cannot be given sixteen times the animals: prey scan every
 * predator every tick, so it is quadratic, and it carries per-animal heading
 * state off a shared RNG stream, so it cannot be fast-forwarded. Both are
 * fatal at 67 km². This replaces them with a stricter model:
 *
 *  · every animal keeps a FIXED home range and its position at any tick is a
 *    closed-form loop around it — no state, no RNG, no history. A tile nobody
 *    is near costs nothing and is exactly right the instant it wakes;
 *  · the only reactive behaviour left is a predator chasing a PERSON, which is
 *    driven by that person's trajectory, and can only start when the person is
 *    within `predatorDetect` — far inside any activation radius. A predator
 *    that is not chasing is on its loop, so a chase always begins from the same
 *    place whether or not the tile slept in between.
 *
 * WHAT IS DELIBERATELY LOST, and why: prey no longer flee predators (an
 * animal↔animal interaction could occur in a dormant tile, which would make
 * dormancy observable), and a killed animal does not respawn (the herd is
 * twelve times the classic one and reflex beings do not hunt, so attrition over
 * a run is negligible; a per-tile respawn ledger is the fix if it stops being).
 */
export class ContinentWildlife implements WildlifeRules {
  private readonly index: TiledEntities;
  private spawned = false;
  private readonly removals: number[] = [];

  constructor(
    private readonly seed: string,
    private readonly world: World,
    private readonly tiles: ActivityRegions,
    private readonly geography: WorldGeography,
    private readonly scale: BodyScale,
    private readonly valley: { readonly x: number; readonly y: number },
  ) {
    this.index = new TiledEntities(world, tiles, (e: Entity) => e.components['Animal'] !== undefined);
  }

  step(world: World, tick: number, bus: SimEventBus): void {
    if (!this.spawned) {
      this.stock(world, tick);
      this.spawned = true;
      return;
    }
    this.removals.length = 0;
    for (const tile of this.tiles.activeTiles) {
      for (const id of this.index.in(tile)) {
        const entity = world.getEntity(id);
        if (!entity) continue;
        const animal = entity.components['Animal'] as Animal;
        const t = entity.components['Transform2D'] as Transform2D;
        const node = entity.components['ResourceNode'] as ResourceNode | undefined;
        if (node && node.stock <= 0) {
          this.removals.push(id); // hunted out
          continue;
        }
        if (PREY.has(animal.kind)) this.settle(world, id, animal, t, tick);
        else this.stepPredator(world, id, animal, t, tick, bus);
      }
    }
    for (const id of this.removals) world.removeEntity(id);
  }

  /** Put an animal where its loop says it is at `tick`. The fast-forward. */
  private settle(world: World, id: number, animal: Animal, t: Transform2D, tick: number): void {
    const p = homePosition(animal.home!, tick);
    if (t.x === p.x && t.y === p.y) return;
    t.x = p.x;
    t.y = p.y;
    world.spatial.markMoved(id);
  }

  private stepPredator(
    world: World,
    id: number,
    animal: Animal,
    t: Transform2D,
    tick: number,
    bus: SimEventBus,
  ): void {
    if (tick % 16 === 0 || animal.targetId === 0) {
      let best = this.scale.predatorDetect * this.scale.predatorDetect;
      animal.targetId = 0;
      // Ascending by id, so among equidistant quarry the same one wins.
      for (const person of world.spatial.within('GahallianBody', t.x, t.y, this.scale.predatorDetect)) {
        if (!(person.components['GahallianBody'] as GahallianBody).alive) continue;
        const pt = person.components['Transform2D'] as Transform2D;
        const dd = (pt.x - t.x) ** 2 + (pt.y - t.y) ** 2;
        if (dd < best) {
          best = dd;
          animal.targetId = person.id;
        }
      }
    }
    const entity = animal.targetId ? world.getEntity(animal.targetId) : undefined;
    const body = entity?.components['GahallianBody'] as GahallianBody | undefined;
    const qt = entity?.components['Transform2D'] as Transform2D | undefined;
    if (!entity || !body?.alive || !qt) {
      animal.targetId = 0;
      this.settle(world, id, animal, t, tick);
      return;
    }
    const dist = Math.hypot(qt.x - t.x, qt.y - t.y);
    if (dist > this.scale.predatorGiveUp) {
      animal.targetId = 0;
      this.settle(world, id, animal, t, tick);
      return;
    }
    if (dist <= this.scale.predatorAttack + 2) {
      if (tick - animal.lastAttack >= ATTACK_COOLDOWN) {
        resolveStrike(world, bus, tick, id, animal, t, { id: entity.id, x: qt.x, y: qt.y, body });
      }
      return;
    }
    const sp = this.scale.animalSpeed[animal.kind] ?? 0.3;
    const nx = t.x + ((qt.x - t.x) / dist) * sp;
    const ny = t.y + ((qt.y - t.y) / dist) * sp;
    if (!this.habitatOk(animal.kind, nx, ny)) return; // it cannot follow you there
    t.x = nx;
    t.y = ny;
    this.geography.clamp(t);
    world.spatial.markMoved(id);
  }

  private habitatOk(kind: AnimalKind, x: number, y: number): boolean {
    if (WATER_KIND.has(kind)) return this.geography.isWater(x, y);
    return !this.geography.isDeepWater(x, y) && this.geography.regionAt(x, y) !== 'mountain';
  }

  // ── Stocking ─────────────────────────────────────────────────────────────

  private stock(world: World, tick: number): void {
    const tileKm2 = (this.tiles.tileSize * this.tiles.tileSize) / 1e6;
    const base = WILDLIFE_PER_KM2 * tileKm2;
    const extra = FAR_GAME_PER_KM2 * tileKm2;
    for (let ty = 0; ty < this.tiles.cols; ty++) {
      for (let tx = 0; tx < this.tiles.cols; tx++) {
        const rng = mulberry32(hashSeed(`${this.seed}:wildlife:${tx}:${ty}`));
        const x0 = tx * this.tiles.tileSize;
        const y0 = ty * this.tiles.tileSize;
        const cx = x0 + this.tiles.tileSize / 2;
        const cy = y0 + this.tiles.tileSize / 2;
        if (this.geography.isDeepWater(cx, cy)) continue;
        for (let i = 0; i < draw(rng, base); i++) this.placeOne(world, rng, x0, y0, tick, false);
        if (!this.isFarGameCountry(cx, cy)) continue;
        for (let i = 0; i < draw(rng, extra); i++) this.placeOne(world, rng, x0, y0, tick, true);
      }
    }
  }

  /** Open plains a long walk from the founding valley: where the herds are. */
  private isFarGameCountry(x: number, y: number): boolean {
    if (this.geography.regionAt(x, y) !== 'plains') return false;
    return Math.hypot(x - this.valley.x, y - this.valley.y) > FAR_GAME_FROM;
  }

  private placeOne(world: World, rng: () => number, x0: number, y0: number, tick: number, preyOnly: boolean): void {
    const kind = preyOnly ? pickPrey(rng()) : pickKind(rng());
    const water = WATER_KIND.has(kind);
    const size = this.tiles.tileSize;
    for (let tries = 0; tries < 40; tries++) {
      const x = x0 + rng() * size;
      const y = y0 + rng() * size;
      const rx = water ? 8 + rng() * 10 : 40 + rng() * 70;
      const ry = water ? 8 + rng() * 10 : 40 + rng() * 70;
      if (!this.rangeFits(kind, x, y, rx, ry)) continue;
      const speed = this.scale.animalSpeed[kind] ?? 0.3;
      const home: HomeRange = {
        x,
        y,
        rx,
        ry,
        wx: speed / (rx * SQRT2),
        wy: speed / (ry * SQRT2),
        px: rng() * TAU,
        py: rng() * TAU,
      };
      const animal: Animal = {
        kind,
        heading: 0,
        changeAt: 0,
        targetId: 0,
        lastAttack: 0,
        health: PRED_HEALTH[kind] ?? 10,
        home,
      };
      const at = homePosition(home, tick);
      const components: Record<string, unknown> = {
        Transform2D: { x: at.x, y: at.y } satisfies Transform2D,
        Animal: animal,
      };
      if (PREY.has(kind)) components['ResourceNode'] = createResourceNode('game', kind === 'fish' ? 2 : MEAT_PER_PREY);
      world.createEntity(components);
      return;
    }
  }

  /** The whole loop must lie in habitat, so the animal never has to be clamped. */
  private rangeFits(kind: AnimalKind, x: number, y: number, rx: number, ry: number): boolean {
    return (
      this.habitatOk(kind, x, y) &&
      this.habitatOk(kind, x + rx, y) &&
      this.habitatOk(kind, x - rx, y) &&
      this.habitatOk(kind, x, y + ry) &&
      this.habitatOk(kind, x, y - ry)
    );
  }
}

/** Whole part plus a seeded coin for the fraction — a density, not a quota. */
function draw(rng: () => number, expected: number): number {
  const whole = Math.floor(expected);
  return whole + (rng() < expected - whole ? 1 : 0);
}

/** The classic world's own mix: ~88% prey, ~12% predators. */
function pickKind(r: number): AnimalKind {
  if (r < 0.42) return 'deer';
  if (r < 0.56) return 'hare';
  if (r < 0.66) return 'boar';
  if (r < 0.88) return 'fish';
  if (r < 0.95) return 'wolf';
  if (r < 0.98) return 'crocodile';
  return 'bear';
}

function pickPrey(r: number): AnimalKind {
  if (r < 0.48) return 'deer';
  if (r < 0.64) return 'hare';
  if (r < 0.75) return 'boar';
  return 'fish';
}
