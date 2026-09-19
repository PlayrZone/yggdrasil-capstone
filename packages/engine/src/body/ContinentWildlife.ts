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
/** Share of a far-game tile's stock that is the extra herd — see `respawn`. */
const FAR_GAME_SHARE = FAR_GAME_PER_KM2 / (WILDLIFE_PER_KM2 + FAR_GAME_PER_KM2);

/**
 * Ticks before a killed animal is replaced, in the tile it was killed in.
 * Three sim-days: long enough that hunting out the herd beside the camp is
 * felt for days and shows in what a being can find, short enough that a
 * century of predation cannot empty the continent.
 */
const RESPAWN_TICKS = 7200;
/**
 * Retry delay when the replacement could not be made this time — either the
 * tile had no habitat for its loop, or somebody was standing close enough to
 * watch it arrive (see `clearance`). A quarter of a day; the entry keeps its
 * place in the ledger, so nothing is lost, only deferred.
 */
const RESPAWN_RETRY = 600;

/** Smallest home range a re-anchored animal will accept, in metres. */
const MIN_RANGE = 6;
/** Phases tried when re-anchoring — eight points of the compass. */
const PHASES = 8;

/**
 * THE CONTINENT'S WILDLIFE — a home-range model, not a wandering one.
 *
 * `WildlifeSystem` cannot be given sixteen times the animals: prey scan every
 * predator every tick, so it is quadratic, and it carries per-animal heading
 * state off a shared RNG stream, so it cannot be fast-forwarded. Both are
 * fatal at 67 km². This replaces them with a stricter model:
 *
 *  · every animal keeps a home range and its position at any tick is a
 *    closed-form loop around it — no state, no RNG, no history. A tile nobody
 *    is near costs nothing and is exactly right the instant it wakes;
 *  · the only reactive behaviour left is a predator chasing a PERSON, which is
 *    driven by that person's trajectory, and can only start when the person is
 *    within `predatorDetect` — far inside any activation radius.
 *
 * WHAT A CHASE COSTS, AND WHY IT IS NOT A TELEPORT. A predator that gives up
 * is somewhere else: the first draft put it straight back on its loop, which
 * measured as a 526 m jump, 156 m of it inside a being's own eyesight. A home
 * range is not a leash — it is where the animal lives — so the range MOVES to
 * where the chase ended (`reanchor`), with its phases solved so the loop runs
 * through the animal's feet at that exact tick. Every step an animal takes,
 * chasing or not, is then at most its own speed.
 *
 * …AND WHY A CHASE IS STEPPED EVEN WHERE NOBODY IS. `reanchor` phases the new
 * loop on the tick the chase was seen to END, so if that tick is the tick the
 * predator's ground happened to WAKE, the animal's whole future depends on the
 * activation radius — measured, at 12 days, as two animals 14 m and 34 m apart
 * between radii, one of them still holding a dead quarry's id. Nothing a being
 * could perceive, and nothing `settled.ts` can repair, because the divergence
 * is baked into `home`, which is state and not a closed form. So a predator
 * that HOLDS A TARGET is stepped every tick whether its tile is live or not
 * (`walkTiles`). The set is tiny — a target is only acquired inside
 * `predatorDetect`, and a live target within `predatorGiveUp` lights its own
 * ground — so this costs a handful of animals for one tick after their quarry
 * dies or escapes, and buys a chase whose end tick is the world's, not the
 * scheduler's.
 *
 * WHAT IS DELIBERATELY LOST: prey no longer flee predators — an animal↔animal
 * interaction could occur in a dormant tile, which would make dormancy
 * observable. Killing, however, is now remembered: see the respawn ledger.
 */
export class ContinentWildlife implements WildlifeRules {
  private readonly index: TiledEntities;
  private spawned = false;
  private readonly removals: number[] = [];
  private readonly rehomed: number[] = [];
  /** Tick reached by the last `step` — the clock a removal is dated by. */
  private now = 0;
  /**
   * Predators that currently hold a quarry. Stepped every tick, live ground or
   * not, so the tick a chase ends is a fact about the world — see the class
   * comment. Membership is a function of the chase, never of the tiling.
   */
  private readonly chasing = new Set<number>();
  /** Scratch for `walkTiles`, reused so the common case allocates nothing. */
  private readonly walk: number[] = [];
  /**
   * How far from every living being a replacement animal must appear: the
   * furthest anyone can see, plus the furthest anyone can travel in the tick it
   * appears (beings are stepped after the wildlife is), plus a metre. Derived,
   * not tuned, and — like everything else in the ledger — independent of the
   * activation radius, because living beings are stepped wherever they stand.
   */
  private readonly clearance: number;

  /**
   * THE RESPAWN LEDGER. A killed animal books a replacement in its own tile,
   * `RESPAWN_TICKS` later, drawn from that tile's own seeded stream by
   * ordinal. Two properties make it honest at scale:
   *
   *  · it CONSERVES — one death, one replacement — so a hunted valley thins
   *    and recovers while the continent's herds neither vanish nor multiply;
   *  · it is run every tick for every due entry, dormant tile or not. That
   *    costs nothing (the queue is almost always empty) and buys the thing
   *    that matters: which entity exists, and with which id, does not depend
   *    on when a tile happened to wake. The closed form is the queue itself —
   *    a tile asleep for a season wakes with exactly the animals it would
   *    have had.
   *
   * AND IT MAY NOT MATERIALISE IN FRONT OF ANYONE. The first draft drew the
   * replacement's home uniformly from the dead animal's 256 m tile with no
   * regard for who was standing in it: of 23 animals killed inside the
   * founders' eyesight, 18 replacements appeared inside a being's 92 m sight,
   * the nearest 15.9 m away — a deer that was not there and then was. A being
   * whose world is real may watch an animal WALK into view and never watch one
   * begin. So a replacement is only made at a point no living being could
   * witness (`clearance`); if the tile offers none this tick — because the
   * band is camped in it — the entry is re-booked, not dropped, and the herd
   * comes back when there is room to come back into.
   */
  private readonly due: { tick: number; tile: number }[] = [];
  private readonly respawnCount: number[] = [];
  private readonly farGame: boolean[] = [];

  constructor(
    private readonly seed: string,
    private readonly world: World,
    private readonly tiles: ActivityRegions,
    private readonly geography: WorldGeography,
    private readonly scale: BodyScale,
    private readonly valley: { readonly x: number; readonly y: number },
  ) {
    // Subscribed BEFORE the tile index, so a removal is seen while the index
    // still knows which tile the animal belonged to.
    world.events.on('entityRemoved', ({ id }) => this.onRemoved(id));
    this.index = new TiledEntities(world, tiles, (e: Entity) => e.components['Animal'] !== undefined);
    this.clearance = scale.perceptionDay + scale.moveSpeed * scale.fleeSpeed + 1;
    for (let i = 0; i < tiles.count; i++) {
      this.respawnCount.push(0);
      this.farGame.push(false);
    }
  }

  step(world: World, tick: number, bus: SimEventBus): void {
    this.now = tick;
    if (!this.spawned) {
      this.stock(world, tick);
      this.spawned = true;
      return;
    }
    this.respawn(world, tick);
    this.removals.length = 0;
    this.rehomed.length = 0;
    for (const tile of this.walkTiles()) {
      const live = this.tiles.isActive(tile);
      for (const id of this.index.in(tile)) {
        // Dormant ground is walked only for the chase it happens to hold.
        if (!live && !this.chasing.has(id)) continue;
        const entity = world.getEntity(id);
        if (!entity) continue;
        const animal = entity.components['Animal'] as Animal;
        const t = entity.components['Transform2D'] as Transform2D;
        const node = entity.components['ResourceNode'] as ResourceNode | undefined;
        if (node && node.stock <= 0) {
          this.removals.push(id); // hunted out
          continue;
        }
        if (PREY.has(animal.kind)) {
          this.settle(world, id, animal, t, tick);
          continue;
        }
        this.stepPredator(world, id, animal, t, tick, bus);
        if (animal.targetId !== 0) this.chasing.add(id);
        else this.chasing.delete(id);
      }
    }
    // Deferred: both mutate lists the loop above is walking.
    for (const id of this.rehomed) this.index.relocate(id);
    for (const id of this.removals) world.removeEntity(id);
  }

  /**
   * The ground to walk this tick: the live tiles, plus the tile of any chasing
   * predator whose own ground has gone dormant under it. Ascending, so the
   * order predators act in — and therefore the order they strike in — is the
   * order a world that never sleeps would use, restricted to the same animals.
   */
  private walkTiles(): readonly number[] {
    const live = this.tiles.activeTiles;
    if (this.chasing.size === 0) return live;
    let dormant: number[] | undefined;
    for (const id of this.chasing) {
      const tile = this.index.tileFor(id);
      if (tile === undefined || this.tiles.isActive(tile)) continue;
      if (!dormant) dormant = [];
      if (!dormant.includes(tile)) dormant.push(tile);
    }
    if (!dormant) return live;
    this.walk.length = 0;
    for (const tile of live) this.walk.push(tile);
    for (const tile of dormant) this.walk.push(tile);
    this.walk.sort(ascending);
    return this.walk;
  }

  /** Put an animal where its loop says it is at `tick`. The fast-forward. */
  private settle(world: World, id: number, animal: Animal, t: Transform2D, tick: number): void {
    const p = homePosition(animal.home!, tick);
    if (t.x === p.x && t.y === p.y) return;
    t.x = p.x;
    t.y = p.y;
    world.spatial.markMoved(id);
  }

  /**
   * A chase has ended. Move the home range to the ground the animal is
   * standing on, phased so its loop passes through that point at `tick` — the
   * animal does not move this tick, and every tick after is a loop step.
   *
   * `tick` is the tick the chase ENDED, which is a fact about the quarry and
   * not about the tiling: a predator holding a target is stepped wherever it
   * stands (`walkTiles`), so this is reached on the same tick at every
   * activation radius, and the home it writes is the same home.
   */
  private reanchor(id: number, animal: Animal, t: Transform2D, tick: number): void {
    const old = animal.home!;
    const speed = this.scale.animalSpeed[animal.kind] ?? 0.3;
    let rx = old.rx;
    let ry = old.ry;
    for (;;) {
      // The smallest range is accepted unconditionally: the animal is standing
      // on habitable ground, so a few metres of it are habitable, and there
      // must always be an answer — which is why `k = 0` always returns once the
      // range has shrunk to `MIN_RANGE`, and why this loop terminates.
      const smallest = rx <= MIN_RANGE && ry <= MIN_RANGE;
      for (let k = 0; k < PHASES; k++) {
        const theta = (k / PHASES) * TAU;
        const cx = t.x - rx * Math.cos(theta);
        const cy = t.y - ry * Math.sin(theta);
        if (!smallest && !this.rangeFits(animal.kind, cx, cy, rx, ry)) continue;
        const wx = speed / (rx * SQRT2);
        const wy = speed / (ry * SQRT2);
        animal.home = { x: cx, y: cy, rx, ry, wx, wy, px: theta - wx * tick, py: theta - wy * tick };
        this.rehomed.push(id);
        return;
      }
      rx = Math.max(MIN_RANGE, rx / 2);
      ry = Math.max(MIN_RANGE, ry / 2);
    }
  }

  private stepPredator(
    world: World,
    id: number,
    animal: Animal,
    t: Transform2D,
    tick: number,
    bus: SimEventBus,
  ): void {
    const wasChasing = animal.targetId !== 0;
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
    const giveUp = (): void => {
      animal.targetId = 0;
      if (wasChasing) this.reanchor(id, animal, t, tick);
      else this.settle(world, id, animal, t, tick);
    };
    if (!entity || !body?.alive || !qt) return giveUp();
    const dist = Math.hypot(qt.x - t.x, qt.y - t.y);
    if (dist > this.scale.predatorGiveUp) return giveUp();
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
    this.rehomed.push(id);
  }

  private habitatOk(kind: AnimalKind, x: number, y: number): boolean {
    if (WATER_KIND.has(kind)) return this.geography.isWater(x, y);
    return !this.geography.isDeepWater(x, y) && this.geography.regionAt(x, y) !== 'mountain';
  }

  // ── The respawn ledger ───────────────────────────────────────────────────

  private onRemoved(id: number): void {
    this.chasing.delete(id);
    const tile = this.index.tileFor(id);
    if (tile === undefined) return;
    this.book(tile, this.now + RESPAWN_TICKS);
  }

  /** Kept ascending by tick, then by tile: the order replacements are made. */
  private book(tile: number, at: number): void {
    let i = this.due.length;
    while (i > 0 && (this.due[i - 1]!.tick > at || (this.due[i - 1]!.tick === at && this.due[i - 1]!.tile > tile))) i--;
    this.due.splice(i, 0, { tick: at, tile });
  }

  private respawn(world: World, tick: number): void {
    while (this.due.length > 0 && this.due[0]!.tick <= tick) {
      const { tile } = this.due.shift()!;
      const ordinal = this.respawnCount[tile]!++;
      const rng = mulberry32(hashSeed(`${this.seed}:respawn:${tile}:${ordinal}`));
      const size = this.tiles.tileSize;
      const x0 = (tile % this.tiles.cols) * size;
      const y0 = Math.floor(tile / this.tiles.cols) * size;
      const preyOnly = this.farGame[tile] === true && rng() < FAR_GAME_SHARE;
      // Unlike the opening stock, a replacement has an audience to avoid.
      if (!this.placeOne(world, rng, x0, y0, tick, preyOnly, this.clearance)) {
        this.book(tile, tick + RESPAWN_RETRY);
      }
    }
  }

  /** Could any living being witness something appear here? */
  private unwatched(world: World, x: number, y: number, clearance: number): boolean {
    return !world.spatial.anyWithin('GahallianBody', x, y, clearance, alive);
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
        for (let i = 0; i < draw(rng, base); i++) this.placeOne(world, rng, x0, y0, tick, false, 0);
        if (!this.isFarGameCountry(cx, cy)) continue;
        this.farGame[ty * this.tiles.cols + tx] = true;
        for (let i = 0; i < draw(rng, extra); i++) this.placeOne(world, rng, x0, y0, tick, true, 0);
      }
    }
  }

  /** Open plains a long walk from the founding valley: where the herds are. */
  private isFarGameCountry(x: number, y: number): boolean {
    if (this.geography.regionAt(x, y) !== 'plains') return false;
    return Math.hypot(x - this.valley.x, y - this.valley.y) > FAR_GAME_FROM;
  }

  /**
   * Try to put one animal somewhere in a tile. `clearance` is the distance it
   * must keep from every living being where it first stands: zero when the
   * world is being stocked (nobody has perceived anything yet — that is the
   * world beginning, not a thing appearing), and `this.clearance` for a
   * replacement, which arrives into a world that is already being watched.
   */
  private placeOne(
    world: World,
    rng: () => number,
    x0: number,
    y0: number,
    tick: number,
    preyOnly: boolean,
    clearance: number,
  ): boolean {
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
      if (clearance > 0 && !this.unwatched(world, at.x, at.y, clearance)) continue;
      const components: Record<string, unknown> = {
        Transform2D: { x: at.x, y: at.y } satisfies Transform2D,
        Animal: animal,
      };
      if (PREY.has(kind)) components['ResourceNode'] = createResourceNode('game', kind === 'fish' ? 2 : MEAT_PER_PREY);
      world.createEntity(components);
      return true;
    }
    return false;
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

function ascending(a: number, b: number): number {
  return a - b;
}

function alive(entity: Entity): boolean {
  return (entity.components['GahallianBody'] as GahallianBody).alive;
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
