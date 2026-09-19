import type { World } from '../core/World.js';
import type { Entity } from '../core/Entity.js';
import type { Transform2D } from '../core/Transform2D.js';
import type { GahallianBody } from '../body/GahallianBody.js';

/**
 * ACTIVITY REGIONS — why a 67 km² world costs what a 4 km² one does.
 *
 * A world sixteen times larger holds sixteen times the plants and animals, and
 * every system that walked all of them once a tick (regrowth, wildlife) would
 * cost sixteen times as much whether or not anyone was there to see it. So the
 * world is tiled, a tile is ACTIVE while any living being is within a generous
 * radius of it, and only active tiles are stepped.
 *
 * THE CONTRACT THAT MAKES THAT HONEST: a dormant tile must be indistinguishable
 * from a stepped one the moment it wakes. Two rules buy that, and both are
 * enforced by design rather than by hope —
 *
 *  1. everything a dormant tile would have DONE is closed form in elapsed
 *     ticks (`regrowthCount`, and the continent's home-range walk), so waking
 *     it is a calculation, not a replay;
 *  2. nothing a dormant tile contains can be CHANGED from outside it, because
 *     the activation radius is far larger than any range at which a being can
 *     reach, see, or be noticed by anything.
 *
 * Together those mean the result depends on the beings' trajectories and the
 * seed, never on when a tile happened to wake —
 * `test/continent-activity.test.ts` runs the same world at two radii and
 * compares everything any being could have perceived.
 *
 * The classic world uses `everywhere()`, whose tiles are all active always, so
 * it steps exactly what it always stepped; the goldens are the proof.
 */
export class ActivityRegions {
  readonly tileSize: number;
  readonly cols: number;
  readonly count: number;
  /** Metres from a living being within which a tile is stepped. */
  readonly radius: number;
  /** True when no being is needed: every tile is always live (classic world). */
  readonly alwaysActive: boolean;

  /** Tick at which each tile was last stepped. The fast-forward's `from`. */
  private readonly stepped: Int32Array;
  /** Tick at which each tile was last marked active, for O(1) membership. */
  private readonly stamp: Int32Array;
  private readonly live: number[] = [];
  private stampedTick = -1;

  private constructor(span: number, tileSize: number, radius: number, alwaysActive: boolean) {
    this.tileSize = tileSize;
    this.cols = Math.max(1, Math.ceil(span / tileSize));
    this.count = this.cols * this.cols;
    this.radius = radius;
    this.alwaysActive = alwaysActive;
    this.stepped = new Int32Array(this.count);
    this.stamp = new Int32Array(this.count).fill(-1);
    if (alwaysActive) for (let i = 0; i < this.count; i++) this.live.push(i);
  }

  static within(span: number, tileSize: number, radius: number): ActivityRegions {
    return new ActivityRegions(span, tileSize, radius, false);
  }

  /** Every tile, always. The classic world's setting, and the control. */
  static everywhere(span: number, tileSize: number): ActivityRegions {
    return new ActivityRegions(span, tileSize, Number.POSITIVE_INFINITY, true);
  }

  tileOf(x: number, y: number): number {
    const cx = Math.min(this.cols - 1, Math.max(0, Math.floor(x / this.tileSize)));
    const cy = Math.min(this.cols - 1, Math.max(0, Math.floor(y / this.tileSize)));
    return cy * this.cols + cx;
  }

  /** The active set for this tick. Ascending by tile index. */
  get activeTiles(): readonly number[] {
    return this.live;
  }

  /**
   * Recompute which tiles are live. Called once per tick, before any system
   * that reads it. O(living beings × tiles in reach), and beings cluster, so
   * the stamp keeps each tile out of the list however many beings claim it.
   */
  update(world: World, tick: number): void {
    if (this.alwaysActive) return;
    this.live.length = 0;
    this.stampedTick = tick;
    const reach = Math.ceil(this.radius / this.tileSize);
    world.spatial.each('GahallianBody', (entity: Entity) => {
      if (!(entity.components['GahallianBody'] as GahallianBody).alive) return;
      const t = entity.components['Transform2D'] as Transform2D | undefined;
      if (!t || !Number.isFinite(t.x) || !Number.isFinite(t.y)) return;
      const cx = Math.floor(t.x / this.tileSize);
      const cy = Math.floor(t.y / this.tileSize);
      for (let ty = cy - reach; ty <= cy + reach; ty++) {
        if (ty < 0 || ty >= this.cols) continue;
        const row = ty * this.cols;
        for (let tx = cx - reach; tx <= cx + reach; tx++) {
          if (tx < 0 || tx >= this.cols) continue;
          const tile = row + tx;
          if (this.stamp[tile] === tick) continue;
          this.stamp[tile] = tick;
          this.live.push(tile);
        }
      }
    });
    // Ascending, so every system that walks the active set walks it in the
    // same order however the beings were found.
    this.live.sort(ascending);
  }

  isActive(tile: number): boolean {
    return this.alwaysActive || this.stamp[tile] === this.stampedTick;
  }

  /** The tick this tile was last stepped — the `from` of its fast-forward. */
  lastStepped(tile: number): number {
    return this.stepped[tile]!;
  }

  markStepped(tile: number, tick: number): void {
    this.stepped[tile] = tick;
  }
}

function ascending(a: number, b: number): number {
  return a - b;
}

/**
 * WHICH ENTITIES OF ONE KIND SIT IN WHICH TILE, maintained incrementally off
 * the world's own create/remove events so a system never has to scan for them.
 *
 * Only for things that DO NOT MOVE — plants and animal home ranges. The
 * spatial index already answers "what is near here" for everything else; this
 * answers "what belongs to this tile", which is a different question and the
 * one a dormant tile needs.
 */
export class TiledEntities {
  private readonly byTile: number[][];
  private readonly tileOfId = new Map<number, number>();

  constructor(
    private readonly world: World,
    private readonly tiles: ActivityRegions,
    private readonly accepts: (entity: Entity) => boolean,
  ) {
    this.byTile = Array.from({ length: tiles.count }, () => []);
    world.events.on('entityCreated', ({ id }) => this.add(id));
    world.events.on('entityRemoved', ({ id }) => this.drop(id));
  }

  private add(id: number): void {
    const entity = this.world.getEntity(id);
    if (!entity || !this.accepts(entity)) return;
    const t = entity.components['Transform2D'] as Transform2D | undefined;
    if (!t || !Number.isFinite(t.x) || !Number.isFinite(t.y)) return;
    const tile = this.tiles.tileOf(t.x, t.y);
    this.byTile[tile]!.push(id);
    this.tileOfId.set(id, tile);
  }

  private drop(id: number): void {
    const tile = this.tileOfId.get(id);
    if (tile === undefined) return;
    this.tileOfId.delete(id);
    const list = this.byTile[tile]!;
    const at = list.indexOf(id);
    if (at >= 0) list.splice(at, 1);
  }

  /** Entity ids in this tile, in creation order (which is ascending by id). */
  in(tile: number): readonly number[] {
    return this.byTile[tile]!;
  }

  get size(): number {
    return this.tileOfId.size;
  }
}
