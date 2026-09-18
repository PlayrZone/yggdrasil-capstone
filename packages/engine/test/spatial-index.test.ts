import { describe, expect, it } from 'vitest';
import { World } from '../src/core/World.js';
import type { Entity } from '../src/core/Entity.js';
import type { Transform2D } from '../src/core/Transform2D.js';
import { mulberry32, hashSeed } from '../src/body/prng.js';

/** The scan the index replaces: every entity with this component, in world order. */
function bruteForce(world: World, key: string, x: number, y: number, radius: number): number[] {
  const ids: number[] = [];
  const r2 = radius * radius;
  world.forEach((entity) => {
    if (!entity.components[key]) return;
    const t = entity.components['Transform2D'] as Transform2D | undefined;
    if (!t) return;
    const dx = t.x - x;
    const dy = t.y - y;
    if (dx * dx + dy * dy <= r2) ids.push(entity.id);
  });
  return ids;
}

function ids(entities: Entity[]): number[] {
  return entities.map((e) => e.id);
}

function place(world: World, x: number, y: number, key = 'Mark'): Entity {
  return world.createEntity({ Transform2D: { x, y } satisfies Transform2D, [key]: {} });
}

describe('SpatialIndex', () => {
  it('finds what is inside the radius and nothing outside it', () => {
    const world = new World();
    const inside = place(world, 100, 100);
    const onTheEdge = place(world, 110, 100); // exactly r away — inclusive, as the scans were
    const outside = place(world, 110.001, 100);
    expect(ids(world.spatial.within('Mark', 100, 100, 10))).toEqual([inside.id, onTheEdge.id]);
    expect(ids(world.spatial.within('Mark', 100, 100, 10))).not.toContain(outside.id);
  });

  it('separates component kinds', () => {
    const world = new World();
    const mark = place(world, 50, 50, 'Mark');
    place(world, 50, 50, 'Other');
    expect(ids(world.spatial.within('Mark', 50, 50, 5))).toEqual([mark.id]);
    expect(world.spatial.within('Nothing', 50, 50, 5)).toEqual([]);
    expect(world.spatial.count('Mark')).toBe(1);
  });

  it('lists a positionless entity but never finds it in space', () => {
    // A full scan saw it and skipped it on `if (!t) return` — systems that walk
    // every entity of a kind (resource regrowth) must still reach it.
    const world = new World();
    const nowhere = world.createEntity({ Mark: {} });
    const somewhere = place(world, 10, 10);
    expect(world.spatial.within('Mark', 10, 10, 5000)).toEqual([somewhere]);
    expect(world.spatial.anyWithin('Mark', 0, 0, 5000, () => true)).toBe(true);
    const seen: number[] = [];
    world.spatial.each('Mark', (e) => seen.push(e.id));
    expect(seen).toEqual([nowhere.id, somewhere.id]);
    expect(world.spatial.count('Mark')).toBe(2);
    world.removeEntity(nowhere.id);
    expect(world.spatial.count('Mark')).toBe(1);
  });

  it('starts indexing an entity in space once it gains a position', () => {
    const world = new World();
    const e = world.createEntity({ Mark: {} });
    expect(world.spatial.within('Mark', 300, 300, 5)).toEqual([]);
    world.addComponent(e.id, 'Transform2D', { x: 300, y: 300 });
    expect(ids(world.spatial.within('Mark', 300, 300, 5))).toEqual([e.id]);
    expect(world.spatial.count('Mark')).toBe(1);
  });

  it('spans cell boundaries and negative coordinates', () => {
    const world = new World();
    // CELL_SIZE is 48; these straddle several cell edges either side of zero.
    const points: [number, number][] = [
      [0, 0],
      [47.999, 47.999],
      [48, 48],
      [-1, -1],
      [-48, 0],
      [-96.5, 95.5],
      [96, -48],
    ];
    for (const [x, y] of points) place(world, x, y);
    for (const [x, y] of points) {
      for (const radius of [0, 1, 48, 100, 250]) {
        expect(ids(world.spatial.within('Mark', x, y, radius))).toEqual(bruteForce(world, 'Mark', x, y, radius));
      }
    }
  });

  it('matches brute force on random data at every radius, in canonical order', () => {
    const world = new World();
    const rng = mulberry32(hashSeed('spatial-index'));
    for (let i = 0; i < 400; i++) place(world, rng() * 2000, rng() * 2000, i % 3 === 0 ? 'Other' : 'Mark');
    for (let q = 0; q < 200; q++) {
      const x = rng() * 2000;
      const y = rng() * 2000;
      const radius = [4, 12, 48, 92, 300][q % 5]!;
      const found = ids(world.spatial.within('Mark', x, y, radius));
      expect(found).toEqual(bruteForce(world, 'Mark', x, y, radius));
      // Canonical order is ascending id — what a full scan yielded.
      expect(found).toEqual([...found].sort((a, b) => a - b));
    }
  });

  it('tracks a move once the index is told, and survives crossing many cells', () => {
    const world = new World();
    const mover = place(world, 10, 10);
    place(world, 900, 900);
    const t = mover.components['Transform2D'] as Transform2D;
    for (const [x, y] of [[500, 500], [900, 880], [10, 10], [1999, 1999]] as [number, number][]) {
      t.x = x;
      t.y = y;
      world.spatial.markMoved(mover.id);
      expect(ids(world.spatial.within('Mark', x, y, 1))).toEqual([mover.id]);
      expect(ids(world.spatial.within('Mark', 10, 10, 1))).toEqual(x === 10 ? [mover.id] : []);
    }
  });

  it('reconcile catches a position written by someone who never told it', () => {
    const world = new World();
    const mover = place(world, 10, 10);
    const t = mover.components['Transform2D'] as Transform2D;
    t.x = 1500; // a host relocating a being, exactly as the experiment drivers do
    t.y = 1500;
    expect(ids(world.spatial.within('Mark', 1500, 1500, 1))).toEqual([]); // stale cell
    world.spatial.reconcile();
    expect(ids(world.spatial.within('Mark', 1500, 1500, 1))).toEqual([mover.id]);
    expect(ids(world.spatial.within('Mark', 10, 10, 1))).toEqual([]);
  });

  it('drops removed entities and forgets a cleared world', () => {
    const world = new World();
    const a = place(world, 100, 100);
    const b = place(world, 101, 100);
    world.removeEntity(a.id);
    expect(ids(world.spatial.within('Mark', 100, 100, 50))).toEqual([b.id]);
    world.clear();
    expect(world.spatial.within('Mark', 100, 100, 50)).toEqual([]);
    expect(world.spatial.count('Mark')).toBe(0);
    // A cleared world re-allocates ids from 1; the index must not hold ghosts.
    const fresh = place(world, 100, 100);
    expect(ids(world.spatial.within('Mark', 100, 100, 50))).toEqual([fresh.id]);
  });

  it('follows components added and removed after creation', () => {
    const world = new World();
    const e = place(world, 100, 100);
    world.addComponent(e.id, 'Later', {});
    expect(ids(world.spatial.within('Later', 100, 100, 5))).toEqual([e.id]);
    world.removeComponent(e.id, 'Later');
    expect(world.spatial.within('Later', 100, 100, 5)).toEqual([]);
    expect(ids(world.spatial.within('Mark', 100, 100, 5))).toEqual([e.id]);
    // Losing the position removes it from the index entirely.
    world.removeComponent(e.id, 'Transform2D');
    expect(world.spatial.within('Mark', 100, 100, 5)).toEqual([]);
  });

  it('anyWithin answers the boolean questions exactly as a scan would', () => {
    const world = new World();
    const rng = mulberry32(hashSeed('any-within'));
    const flagged = new Set<number>();
    for (let i = 0; i < 200; i++) {
      const e = place(world, rng() * 500, rng() * 500);
      if (i % 4 === 0) flagged.add(e.id);
    }
    const isFlagged = (e: Entity): boolean => flagged.has(e.id);
    for (let q = 0; q < 100; q++) {
      const x = rng() * 500;
      const y = rng() * 500;
      const radius = [3, 20, 92][q % 3]!;
      const expected = bruteForce(world, 'Mark', x, y, radius).some((id) => flagged.has(id));
      expect(world.spatial.anyWithin('Mark', x, y, radius, isFlagged)).toBe(expected);
    }
    // excludeId skips exactly one entity, whatever the predicate says.
    const only = place(world, 900, 900);
    flagged.add(only.id);
    expect(world.spatial.anyWithin('Mark', 900, 900, 5, isFlagged)).toBe(true);
    expect(world.spatial.anyWithin('Mark', 900, 900, 5, isFlagged, only.id)).toBe(false);
  });

  it('each yields every entity of a kind, ascending by id', () => {
    const world = new World();
    const made: number[] = [];
    const rng = mulberry32(hashSeed('each'));
    for (let i = 0; i < 50; i++) made.push(place(world, rng() * 2000, rng() * 2000).id);
    world.removeEntity(made[7]!);
    world.removeEntity(made[0]!);
    const seen: number[] = [];
    world.spatial.each('Mark', (e) => seen.push(e.id));
    expect(seen).toEqual(made.filter((id) => id !== made[7] && id !== made[0]));
  });

  it('counts the entities its queries look at', () => {
    const world = new World();
    for (let i = 0; i < 50; i++) place(world, 100 + i, 100);
    place(world, 1900, 1900);
    const counter = { visits: 0 };
    world.setVisitCounter(counter);
    world.spatial.within('Mark', 100, 100, 10);
    const local = counter.visits;
    expect(local).toBeGreaterThan(0);
    expect(local).toBeLessThan(51); // local density, not the whole world
    counter.visits = 0;
    world.forEach(() => {});
    expect(counter.visits).toBe(51); // a full scan visits everything
    world.setVisitCounter(null);
  });
});
