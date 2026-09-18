import type { Entity } from './Entity.js';
import type { Transform2D } from './Transform2D.js';

/**
 * Instrumentation hook: how many entities the world's scans and spatial
 * queries have looked at. Nothing in the simulation reads it — the benchmark
 * injects one to compare "entity visits per tick" across implementations.
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
 */
const CELL_SIZE = 48;

// Cell coordinates packed into one integer key; good for ±32768 cells.
const CELL_SPAN = 0x10000;
const CELL_BIAS = 0x8000;

function cellOf(x: number, y: number): number {
  return (Math.floor(y / CELL_SIZE) + CELL_BIAS) * CELL_SPAN + (Math.floor(x / CELL_SIZE) + CELL_BIAS);
}

interface Indexed {
  readonly entity: Entity;
  /** Null for an entity that has no position: listed, but never in a cell. */
  readonly transform: Transform2D | null;
  /** Component keys (Transform2D excluded) this entity is bucketed under. */
  readonly keys: string[];
  cell: number;
  /** Position as of the last (re)bucketing — compared against the live transform. */
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
 * An entity with no `Transform2D` is still listed under its components (`each`
 * and `count` see it, as a full scan did) but lives in no cell, so the spatial
 * queries skip it — exactly like the `if (!t) return` in the scans.
 *
 * STAYING IN SYNC. Creation, removal and component changes go through `World`.
 * A position written directly must be followed by `markMoved`; `reconcile` is
 * the safety net that catches a position changed by anyone else (a host
 * relocating a being between ticks) by comparing each record against its live
 * transform.
 */
export class SpatialIndex {
  private readonly records = new Map<number, Indexed>();
  private readonly buckets = new Map<string, Bucket>();
  counter: VisitCounter | null = null;

  insert(entity: Entity): void {
    const transform = (entity.components['Transform2D'] as Transform2D | undefined) ?? null;
    const keys: string[] = [];
    for (const key of Object.keys(entity.components)) if (key !== 'Transform2D') keys.push(key);
    const record: Indexed = {
      entity,
      transform,
      keys,
      cell: transform ? cellOf(transform.x, transform.y) : 0,
      x: transform ? transform.x : 0,
      y: transform ? transform.y : 0,
    };
    this.records.set(entity.id, record);
    for (const key of keys) this.bucketIn(key, record);
  }

  remove(id: number): void {
    const record = this.records.get(id);
    if (!record) return;
    this.records.delete(id);
    for (const key of record.keys) this.bucketOut(key, record);
  }

  clear(): void {
    this.records.clear();
    this.buckets.clear();
  }

  componentAdded(entity: Entity, key: string): void {
    if (key === 'Transform2D') {
      this.remove(entity.id);
      this.insert(entity);
      return;
    }
    const record = this.records.get(entity.id);
    if (!record || record.keys.includes(key)) return;
    record.keys.push(key);
    this.bucketIn(key, record);
  }

  componentRemoved(entity: Entity, key: string): void {
    if (key === 'Transform2D') {
      this.remove(entity.id);
      return;
    }
    const record = this.records.get(entity.id);
    if (!record) return;
    const at = record.keys.indexOf(key);
    if (at < 0) return;
    record.keys.splice(at, 1);
    this.bucketOut(key, record);
  }

  /** Tell the index a position was just written. The sanctioned move path. */
  markMoved(id: number): void {
    const record = this.records.get(id);
    if (record) this.rebucket(record);
  }

  /** Re-home anything whose transform moved without a `markMoved`. O(indexed). */
  reconcile(): void {
    for (const record of this.records.values()) {
      const t = record.transform;
      if (t && (t.x !== record.x || t.y !== record.y)) this.rebucket(record);
    }
  }

  /** Entities with `key` within `radius` (inclusive), ascending by id. */
  within(key: string, x: number, y: number, radius: number): Entity[] {
    const bucket = this.buckets.get(key);
    if (!bucket) return [];
    const r2 = radius * radius;
    const found: Indexed[] = [];
    const cx1 = Math.floor((x + radius) / CELL_SIZE);
    const cy1 = Math.floor((y + radius) / CELL_SIZE);
    for (let cy = Math.floor((y - radius) / CELL_SIZE); cy <= cy1; cy++) {
      const row = (cy + CELL_BIAS) * CELL_SPAN + CELL_BIAS;
      for (let cx = Math.floor((x - radius) / CELL_SIZE); cx <= cx1; cx++) {
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
    if (!bucket) return false;
    const r2 = radius * radius;
    const cx1 = Math.floor((x + radius) / CELL_SIZE);
    const cy1 = Math.floor((y + radius) / CELL_SIZE);
    for (let cy = Math.floor((y - radius) / CELL_SIZE); cy <= cy1; cy++) {
      const row = (cy + CELL_BIAS) * CELL_SPAN + CELL_BIAS;
      for (let cx = Math.floor((x - radius) / CELL_SIZE); cx <= cx1; cx++) {
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
   * systems that must touch all of one kind. The callback must not create or
   * remove entities of that same kind.
   */
  each(key: string, visit: (entity: Entity) => void): void {
    const bucket = this.buckets.get(key);
    if (!bucket) return;
    if (this.counter) this.counter.visits += bucket.all.length;
    for (const record of bucket.all) visit(record.entity);
  }

  /** How many entities carry `key` — for tests and diagnostics. */
  count(key: string): number {
    return this.buckets.get(key)?.all.length ?? 0;
  }

  private bucketIn(key: string, record: Indexed): void {
    let bucket = this.buckets.get(key);
    if (!bucket) this.buckets.set(key, (bucket = { cells: new Map(), all: [] }));
    insertById(bucket.all, record);
    if (record.transform) putInCell(bucket, record.cell, record);
  }

  private bucketOut(key: string, record: Indexed): void {
    const bucket = this.buckets.get(key);
    if (!bucket) return;
    const at = searchById(bucket.all, record.entity.id);
    if (at >= 0) bucket.all.splice(at, 1);
    if (record.transform) dropFromCell(bucket, record.cell, record);
  }

  private rebucket(record: Indexed): void {
    const transform = record.transform;
    if (!transform) return;
    record.x = transform.x;
    record.y = transform.y;
    const cell = cellOf(record.x, record.y);
    if (cell === record.cell) return;
    for (const key of record.keys) {
      const bucket = this.buckets.get(key);
      if (!bucket) continue;
      dropFromCell(bucket, record.cell, record);
      putInCell(bucket, cell, record);
    }
    record.cell = cell;
  }
}

function putInCell(bucket: Bucket, cell: number, record: Indexed): void {
  const list = bucket.cells.get(cell);
  if (list) list.push(record);
  else bucket.cells.set(cell, [record]);
}

function byId(a: Indexed, b: Indexed): number {
  return a.entity.id - b.entity.id;
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
