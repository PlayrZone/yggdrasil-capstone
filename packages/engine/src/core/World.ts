import type { Entity } from './Entity.js';
import { EventBus } from '../core/EventBus.js';
import { SpatialIndex } from './SpatialIndex.js';
import type { VisitCounter } from './SpatialIndex.js';

export type WorldEvents = {
  entityCreated: { id: number };
  entityRemoved: { id: number };
};

export type { VisitCounter } from './SpatialIndex.js';

export class World {
  private nextId = 1;
  private entities = new Map<number, Entity>();
  readonly events = new EventBus<WorldEvents>();
  /**
   * "What is near here", maintained incrementally. The world owns it because
   * the world owns entity lifetime; a position written directly must be
   * followed by `spatial.markMoved`, and `spatial.reconcile` catches the rest.
   */
  readonly spatial = new SpatialIndex();
  private counter: VisitCounter | null = null;

  createEntity(initial: Record<string, unknown> = {}): Entity {
    const id = this.nextId++;
    const entity: Entity = { id, components: { ...initial } };
    this.entities.set(id, entity);
    this.spatial.insert(entity); // indexed before anyone can hear about it
    this.events.emit('entityCreated', { id });
    return entity;
  }

  removeEntity(id: number): boolean {
    const removed = this.entities.delete(id);
    if (removed) {
      this.spatial.remove(id);
      this.events.emit('entityRemoved', { id });
    }
    return removed;
  }

  getEntity(id: number): Entity | undefined {
    return this.entities.get(id);
  }

  addComponent(id: number, name: string, data: unknown): void {
    const entity = this.entities.get(id);
    if (!entity) throw new Error(`World.addComponent: entity ${id} not found`);
    entity.components[name] = data;
    this.spatial.componentAdded(entity, name);
  }

  removeComponent(id: number, name: string): void {
    const entity = this.entities.get(id);
    if (!entity) return;
    delete entity.components[name];
    this.spatial.componentRemoved(entity, name);
  }

  forEach(callback: (entity: Entity) => void): void {
    if (this.counter) this.counter.visits += this.entities.size;
    for (const entity of this.entities.values()) callback(entity);
  }

  /** Count every entity a scan or a spatial query looks at. Benchmarks only. */
  setVisitCounter(counter: VisitCounter | null): void {
    this.counter = counter;
    this.spatial.counter = counter;
  }

  size(): number {
    return this.entities.size;
  }

  /**
   * Remove all entities, emitting `entityRemoved` for each. Used by scene
   * transitions to tear down the active scene before loading a new one.
   * Resets the entity-id allocator so loaded scenes start from id 1 again.
   */
  clear(): void {
    const ids = [...this.entities.keys()];
    this.spatial.clear();
    for (const id of ids) {
      this.entities.delete(id);
      this.events.emit('entityRemoved', { id });
    }
    this.nextId = 1;
  }
}
