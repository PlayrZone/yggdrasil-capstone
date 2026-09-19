import type { Entity } from './Entity.js';
import type { Transform2D } from './Transform2D.js';

/**
 * Instrumentation hook: how many entities the world's scans, spatial queries,
 * `each` walks and per-tick reconciles have looked at. Nothing in the
 * simulation reads it — the benchmark injects one to compare "entity visits
 * per tick" across implementations.
 */
export interface VisitCounter {
  visits: number;
}

/**
 * Cell edge in world units — about half the largest query radius in the engine
 * (daytime perception, 92). A perception query therefore touches 5×5 cells,
 * while the frequent short-range queries (company 8, water 12, shelter 4) touch
 * at most 3×3. Smaller cells would multiply the bookkeeping the wide queries
 * pay; larger ones would make the narrow ones sweep mostly-irrelevant ground.
 *
 * SIZED OFF THE CLASSIC WORLD, MEASURED AGAINST THE CONTINENT. Both use the
 * same perception radius, so the argument carries; so do the numbers. Total
 * ms/tick at 150 founders over 600 ticks, at cell 24 / 48 / 96 / 192: classic
 * 0.271 / 0.258 / 0.263 / 0.266, continent 0.240 / 0.218 / 0.205 / 0.219 —
 * a few per cent either way, inside run-to-run noise. It stays one engine-wide
 * constant rather than becoming a scenario knob with nothing to tune.
 */
const CELL_SIZE = 48;

// Cell coordinates are packed into one integer key, so they must stay inside
// ±CELL_BIAS or two different cells could share a key. Coordinates beyond
// ±(CELL_BIAS · CELL_SIZE) ≈ ±1.57M world units — far outside any world the
// engine models — are clamped into the outermost cell. Queries clamp the same
// way, so a clamped entity is still found by a query centred near it, and the
// exact distance test still decides membership.
/**
 * Ticks between full `reconcile` passes that also cover the static set. A
 * tenth of a sim-day: amortised it costs 0.4 % of scanning everything every
 * tick, and it is short enough that a host quietly moving a static entity
 * shows up inside a run rather than after it.
 */
const STATIC_AUDIT_EVERY = 256;

const CELL_SPAN = 0x10000;
const CELL_BIAS = 0x8000;
const CELL_MIN = -CELL_BIAS;
const CELL_MAX = CELL_BIAS - 1;

function cellAxis(v: number): number {
  const c = Math.floor(v / CELL_SIZE);
  return c < CELL_MIN ? CELL_MIN : c > CELL_MAX ? CELL_MAX : c;
}

function cellOf(x: number, y: number): number {
  return (cellAxis(y) + CELL_BIAS) * CELL_SPAN + (cellAxis(x) + CELL_BIAS);
}

interface Indexed {
  readonly entity: Entity;
  /** The position component as last seen, or null when the entity has none. */
  transform: Transform2D | null;
  /** Component keys (Transform2D excluded) this entity is listed under. */
  readonly keys: string[];
  /** True while this record occupies `cell` in every one of its buckets. */
  inCells: boolean;
  cell: number;
  /** Position as of the last settle — what the queries measure against. */
  x: number;
  y: number;
}

interface Bucket {
  /** Packed cell key → the positioned entities of this kind inside it. */
  readonly cells: Map<number, Indexed[]>;
  /** Every entity of this kind, positioned or not, ascending by id. */
  readonly all: Indexed[];
}

/**
 * A uniform-grid spatial hash over everything in the world that has a position,
 * bucketed per component kind. It exists so the body can ask "what is near
 * here" without walking every entity: the full-world scans it replaces were
 * O(agents × entities) per tick.
 *
 * CANONICAL ORDER. `within` and `each` return entities ascending by id, which
 * is exactly the order a `World.forEach` scan yielded them (ids are allocated
 * ascending and a Map iterates in insertion order). That is what keeps
 * nearest-wins tie-breaking, RNG consumption and event ordering identical.
 *
 * MEMBERSHIP IS NOT POSITION. An entity is listed under its components whether
 * or not it has a `Transform2D`, and whether or not that position is finite —
 * `each` and `count` see it, as a full scan did. Only the spatial queries skip
 * it, exactly like the `if (!t) return` in the scans. Gaining, losing or
 * replacing the position moves it in and out of the grid, never off the list.
 *
 * NON-FINITE INPUT. A query centred on, or sized by, a non-finite number
 * describes no disc, so it finds nothing: the alternative is a cell walk whose
 * bounds are both `Infinity`, which never terminates. An entity whose position
 * is non-finite is treated as having none until it is finite again.
 *
 * STAYING IN SYNC. Creation, removal and component changes go through `World`.
 * A position written directly must be followed by `markMoved`; `reconcile` is
 * the safety net — it re-reads each entity's position component, so a host that
 * moves a being, swaps its `Transform2D` for a new object, or drops it
 * altogether between ticks is picked up.
 *
 * STATIC ENTITIES. A bush, a seam and a hut never move, and on a 67 km² world
 * they outnumber what does two hundred to one — re-reading all of them every
 * tick was 38 % of a continent tick. `markStatic` takes a record off the
 * per-tick pass. The safety net is kept rather than traded away: every
 * `STATIC_AUDIT_EVERY` ticks the pass covers the static set too, re-homes
 * anything that did move and counts it in `staticDrift`, so a host that moves
 * a "static" entity is found late and visibly rather than never.
 *
 * MUTATION DURING ITERATION. `each` walks a snapshot and re-checks liveness, so
 * a callback may create or remove entities: it visits exactly those of that
 * kind present at the call and still present when reached, in id order. The
 * `match` predicate of `anyWithin` must be pure — it runs inside a live cell
 * walk, so moving or removing entities from it has undefined coverage.
 */
export class SpatialIndex {
  private readonly records = new Map<number, Indexed>();
  /** The subset `reconcile` walks every tick: everything not marked static. */
  private readonly moving = new Map<number, Indexed>();
  private readonly buckets = new Map<string, Bucket>();
  counter: VisitCounter | null = null;
  /** How often a static entity was found to have moved anyway. Must stay 0. */
  staticDrift = 0;

  /** Idempotent: re-inserting an entity replaces whatever was listed for it. */
  insert(entity: Entity): void {
    this.remove(entity.id);
    const keys: string[] = [];
    for (const key of Object.keys(entity.components)) if (key !== 'Transform2D') keys.push(key);
    const record: Indexed = {
      entity,
      transform: (entity.components['Transform2D'] as Transform2D | undefined) ?? null,
      keys,
      inCells: false,
      cell: 0,
      x: 0,
      y: 0,
    };
    this.records.set(entity.id, record);
    this.moving.set(entity.id, record);
    for (const key of keys) this.listIn(key, record);
    this.settle(record);
  }

  /** Promise this entity only ever moves through `markMoved`. It then leaves
   *  the per-tick `reconcile` pass; the periodic audit still covers it. */
  markStatic(id: number): void {
    this.moving.delete(id);
  }

  remove(id: number): void {
    const record = this.records.get(id);
    if (!record) return;
    this.records.delete(id);
    this.moving.delete(id);
    for (const key of record.keys) this.listOut(key, record);
  }

  clear(): void {
    this.records.clear();
    this.moving.clear();
    this.buckets.clear();
  }

  componentAdded(entity: Entity, key: string): void {
    const record = this.records.get(entity.id);
    if (!record) {
      this.insert(entity);
      return;
    }
    if (key === 'Transform2D') {
      record.transform = (entity.components['Transform2D'] as Transform2D | undefined) ?? null;
      this.settle(record);
      return;
    }
    if (record.keys.includes(key)) return;
    record.keys.push(key);
    this.listIn(key, record);
  }

  componentRemoved(entity: Entity, key: string): void {
    const record = this.records.get(entity.id);
    if (!record) return;
    if (key === 'Transform2D') {
      // The entity stays listed — a scan still saw it — it just leaves the grid.
      record.transform = null;
      this.settle(record);
      return;
    }
    const at = record.keys.indexOf(key);
    if (at < 0) return;
    record.keys.splice(at, 1);
    this.listOut(key, record);
  }

  /** Tell the index a position was just written. The sanctioned move path. */
  markMoved(id: number): void {
    const record = this.records.get(id);
    if (record) this.settle(record);
  }

  /**
   * Re-home anything whose position changed without a `markMoved` — including a
   * `Transform2D` that was replaced, added or dropped straight on the entity.
   * O(movable) per call, and O(indexed) on the audit tick. `tick` schedules
   * that audit; called without one it walks the movable set only.
   */
  reconcile(tick?: number): void {
    const auditing =
      tick !== undefined && tick % STATIC_AUDIT_EVERY === 0 && this.moving.size !== this.records.size;
    const scanned = auditing ? this.records : this.moving;
    if (this.counter) this.counter.visits += scanned.size;
    for (const record of scanned.values()) {
      const t = (record.entity.components['Transform2D'] as Transform2D | undefined) ?? null;
      if (t === record.transform) {
        if (!t || (t.x === record.x && t.y === record.y)) continue;
      } else {
        record.transform = t;
      }
      if (auditing && !this.moving.has(record.entity.id)) this.staticDrift++;
      this.settle(record);
    }
  }

  /** Entities with `key` within `radius` (inclusive), ascending by id. */
  within(key: string, x: number, y: number, radius: number): Entity[] {
    const bucket = this.buckets.get(key);
    if (!bucket || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(radius)) return [];
    const r = radius < 0 ? -radius : radius;
    const r2 = radius * radius;
    const found: Indexed[] = [];
    const cx0 = cellAxis(x - r);
    const cx1 = cellAxis(x + r);
    const cy0 = cellAxis(y - r);
    const cy1 = cellAxis(y + r);
    if ((cx1 - cx0 + 1) * (cy1 - cy0 + 1) > bucket.all.length) {
      // More cells to probe than there are entities of this kind: the scan the
      // grid replaced is cheaper, and bounds the cost of a world-wide radius.
      if (this.counter) this.counter.visits += bucket.all.length;
      for (const record of bucket.all) {
        if (!record.inCells) continue;
        const dx = record.x - x;
        const dy = record.y - y;
        if (dx * dx + dy * dy <= r2) found.push(record);
      }
    } else {
      for (let cy = cy0; cy <= cy1; cy++) {
        const row = (cy + CELL_BIAS) * CELL_SPAN + CELL_BIAS;
        for (let cx = cx0; cx <= cx1; cx++) {
          const list = bucket.cells.get(row + cx);
          if (!list) continue;
          if (this.counter) this.counter.visits += list.length;
          for (const record of list) {
            const dx = record.x - x;
            const dy = record.y - y;
            if (dx * dx + dy * dy <= r2) found.push(record);
          }
        }
      }
    }
    found.sort(byId);
    const out: Entity[] = new Array(found.length);
    for (let i = 0; i < found.length; i++) out[i] = found[i]!.entity;
    return out;
  }

  /**
   * Is any entity with `key` within `radius` (inclusive) a match? Allocation-
   * free and short-circuiting — for the boolean questions (is there water near,
   * is anyone near) where order cannot matter.
   */
  anyWithin(
    key: string,
    x: number,
    y: number,
    radius: number,
    match: (entity: Entity) => boolean,
    excludeId?: number,
  ): boolean {
    const bucket = this.buckets.get(key);
    if (!bucket || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(radius)) return false;
    const r = radius < 0 ? -radius : radius;
    const r2 = radius * radius;
    const cx0 = cellAxis(x - r);
    const cx1 = cellAxis(x + r);
    const cy0 = cellAxis(y - r);
    const cy1 = cellAxis(y + r);
    if ((cx1 - cx0 + 1) * (cy1 - cy0 + 1) > bucket.all.length) {
      if (this.counter) this.counter.visits += bucket.all.length;
      for (const record of bucket.all) {
        if (!record.inCells || record.entity.id === excludeId) continue;
        const dx = record.x - x;
        const dy = record.y - y;
        if (dx * dx + dy * dy <= r2 && match(record.entity)) return true;
      }
      return false;
    }
    for (let cy = cy0; cy <= cy1; cy++) {
      const row = (cy + CELL_BIAS) * CELL_SPAN + CELL_BIAS;
      for (let cx = cx0; cx <= cx1; cx++) {
        const list = bucket.cells.get(row + cx);
        if (!list) continue;
        if (this.counter) this.counter.visits += list.length;
        for (const record of list) {
          if (record.entity.id === excludeId) continue;
          const dx = record.x - x;
          const dy = record.y - y;
          if (dx * dx + dy * dy <= r2 && match(record.entity)) return true;
        }
      }
    }
    return false;
  }

  /**
   * Every entity with `key`, ascending by id — the un-spatial query, for the
   * systems that must touch all of one kind, positioned or not.
   */
  each(key: string, visit: (entity: Entity) => void): void {
    const bucket = this.buckets.get(key);
    if (!bucket) return;
    if (this.counter) this.counter.visits += bucket.all.length;
    for (const record of bucket.all.slice()) {
      if (this.records.get(record.entity.id) === record) visit(record.entity);
    }
  }

  /** How many entities carry `key` — for tests and diagnostics. */
  count(key: string): number {
    return this.buckets.get(key)?.all.length ?? 0;
  }

  private listIn(key: string, record: Indexed): void {
    let bucket = this.buckets.get(key);
    if (!bucket) this.buckets.set(key, (bucket = { cells: new Map(), all: [] }));
    insertById(bucket.all, record);
    if (record.inCells) putInCell(bucket, record.cell, record);
  }

  private listOut(key: string, record: Indexed): void {
    const bucket = this.buckets.get(key);
    if (!bucket) return;
    const at = searchById(bucket.all, record.entity.id);
    if (at >= 0) bucket.all.splice(at, 1);
    if (record.inCells) dropFromCell(bucket, record.cell, record);
  }

  /** The one place that decides which cell (if any) a record belongs in. */
  private settle(record: Indexed): void {
    const t = record.transform;
    const positioned = t !== null && Number.isFinite(t.x) && Number.isFinite(t.y);
    if (positioned) {
      const cell = cellOf(t.x, t.y);
      record.x = t.x;
      record.y = t.y;
      if (record.inCells && cell === record.cell) return; // moved within its cell
      if (!record.inCells) {
        record.cell = cell;
        for (const key of record.keys) {
          const bucket = this.buckets.get(key);
          if (bucket) putInCell(bucket, cell, record);
        }
        record.inCells = true;
        return;
      }
      for (const key of record.keys) {
        const bucket = this.buckets.get(key);
        if (!bucket) continue;
        dropFromCell(bucket, record.cell, record);
        putInCell(bucket, cell, record);
      }
      record.cell = cell;
      return;
    }
    if (!record.inCells) return;
    for (const key of record.keys) {
      const bucket = this.buckets.get(key);
      if (bucket) dropFromCell(bucket, record.cell, record);
    }
    record.inCells = false;
  }
}

function byId(a: Indexed, b: Indexed): number {
  return a.entity.id - b.entity.id;
}

function putInCell(bucket: Bucket, cell: number, record: Indexed): void {
  const list = bucket.cells.get(cell);
  if (list) list.push(record);
  else bucket.cells.set(cell, [record]);
}

function dropFromCell(bucket: Bucket, cell: number, record: Indexed): void {
  const list = bucket.cells.get(cell);
  if (!list) return;
  const at = list.indexOf(record);
  if (at >= 0) list.splice(at, 1);
  if (list.length === 0) bucket.cells.delete(cell);
}

/** Ids are normally allocated ascending, so the common case is a push. */
function insertById(all: Indexed[], record: Indexed): void {
  const id = record.entity.id;
  if (all.length === 0 || all[all.length - 1]!.entity.id < id) {
    all.push(record);
    return;
  }
  let lo = 0;
  let hi = all.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (all[mid]!.entity.id < id) lo = mid + 1;
    else hi = mid;
  }
  all.splice(lo, 0, record);
}

function searchById(all: Indexed[], id: number): number {
  let lo = 0;
  let hi = all.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const at = all[mid]!.entity.id;
    if (at === id) return mid;
    if (at < id) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}
