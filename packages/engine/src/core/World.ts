import type { Entity } from './Entity.js';
import { EventBus } from '../core/EventBus.js';

export type WorldEvents = {
  entityCreated: { id: number };
  entityRemoved: { id: number };
};

export class World {
  private nextId = 1;
  private entities = new Map<number, Entity>();
  readonly events = new EventBus<WorldEvents>();

  createEntity(initial: Record<string, unknown> = {}): Entity {
    const id = this.nextId++;
    const entity: Entity = { id, components: { ...initial } };
    this.entities.set(id, entity);
    this.events.emit('entityCreated', { id });
    return entity;
  }

  removeEntity(id: number): boolean {
    const removed = this.entities.delete(id);
    if (removed) this.events.emit('entityRemoved', { id });
    return removed;
  }

  getEntity(id: number): Entity | undefined {
    return this.entities.get(id);
  }

  addComponent(id: number, name: string, data: unknown): void {
    const entity = this.entities.get(id);
    if (!entity) throw new Error(`World.addComponent: entity ${id} not found`);
    entity.components[name] = data;
  }

  removeComponent(id: number, name: string): void {
    const entity = this.entities.get(id);
    if (!entity) return;
    delete entity.components[name];
  }

  forEach(callback: (entity: Entity) => void): void {
    for (const entity of this.entities.values()) callback(entity);
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
    for (const id of ids) {
      this.entities.delete(id);
      this.events.emit('entityRemoved', { id });
    }
    this.nextId = 1;
  }
}
