import type { World } from '../core/World.js';
import type { Entity } from '../core/Entity.js';
import type { Transform2D } from '../core/Transform2D.js';
import type { GahallianBody } from './GahallianBody.js';
import type { ResourceNode } from './ResourceNodeSystem.js';
import type {
  AgentSnapshot,
  ContextFeatures,
  SimEvent,
  WorldView,
} from './contract.js';
import { isNight } from './WorldRegularities.js';
import { seasonAt } from './Climate.js';
import { CLASSIC_SCALE } from '../world/geography.js';
import type { BodyScale } from '../world/geography.js';

/** Component key: 'Structure'. */
export interface Structure {
  kind: 'shelter' | 'wall' | 'container';
  builtBy: number;
  builtTick: number;
  inventory: Partial<Record<string, number>>;
}

/**
 * Terrain elevation provider — the host (Observatory) supplies it so the
 * `highland` context feature varies by region (mountains vs river valley).
 * Without it the world is flat (elevationBand 0 everywhere), as in Y1.
 */
export interface TerrainField {
  /** 0 lowland · 1 midland · 2 highland at a world point. */
  elevationBand(x: number, y: number): number;
}

// Hoisted so the per-tick, per-witness queries below allocate nothing.
const IS_DRINKABLE = (entity: Entity): boolean => {
  const node = entity.components['ResourceNode'] as ResourceNode;
  return node.kind === 'waterSource' || node.kind === 'river';
};
const IS_SHELTER = (entity: Entity): boolean =>
  (entity.components['Structure'] as Structure).kind === 'shelter';
const IS_ALIVE = (entity: Entity): boolean =>
  (entity.components['GahallianBody'] as GahallianBody).alive;

/**
 * Radius + light-modified perception. One global event truth, N partial
 * views — perception is where subjectivity (and therefore rumor and
 * belief divergence) begins.
 */
export class PerceptionSystem {
  constructor(
    private readonly terrain?: TerrainField,
    private readonly scale: BodyScale = CLASSIC_SCALE,
  ) {}

  radius(tick: number): number {
    return isNight(tick) ? this.scale.perceptionNight : this.scale.perceptionDay;
  }

  /** Context features at a position — the miners' feature space. */
  contextAt(world: World, x: number, y: number, tick: number): ContextFeatures {
    const nearWater = world.spatial.anyWithin('ResourceNode', x, y, this.scale.nearWaterRadius, IS_DRINKABLE);
    const inShelter = world.spatial.anyWithin('Structure', x, y, this.scale.inShelterRadius, IS_SHELTER);
    const elevationBand = this.terrain?.elevationBand(x, y) ?? 0;
    return { nearWater, night: isNight(tick), inShelter, elevationBand };
  }

  /** Everything one agent can currently see. */
  worldViewFor(world: World, agentEntity: Entity, tick: number): WorldView {
    const self = agentEntity.components['Transform2D'] as Transform2D;
    const r = this.radius(tick);
    const view: WorldView = {
      tick,
      night: isNight(tick),
      season: seasonAt(tick),
      agents: [],
      resources: [],
      structures: [],
    };
    // Three ascending-by-id queries, which is exactly what the single ascending
    // full scan this replaces pushed into these three lists.
    for (const entity of world.spatial.within('GahallianBody', self.x, self.y, r)) {
      if (entity.id === agentEntity.id) continue;
      if (!(entity.components['GahallianBody'] as GahallianBody).alive) continue;
      const t = entity.components['Transform2D'] as Transform2D;
      view.agents.push({ id: entity.id, x: t.x, y: t.y });
    }
    for (const entity of world.spatial.within('ResourceNode', self.x, self.y, r)) {
      if (entity.id === agentEntity.id) continue;
      const node = entity.components['ResourceNode'] as ResourceNode;
      const t = entity.components['Transform2D'] as Transform2D;
      view.resources.push({ id: entity.id, kind: node.kind, x: t.x, y: t.y, stock: node.stock });
    }
    for (const entity of world.spatial.within('Structure', self.x, self.y, r)) {
      if (entity.id === agentEntity.id) continue;
      const structure = entity.components['Structure'] as Structure;
      const t = entity.components['Transform2D'] as Transform2D;
      view.structures.push({ id: entity.id, kind: structure.kind, x: t.x, y: t.y });
    }
    return view;
  }

  snapshotFor(world: World, agentEntity: Entity, tick: number): AgentSnapshot {
    const body = agentEntity.components['GahallianBody'] as GahallianBody;
    const t = agentEntity.components['Transform2D'] as Transform2D;
    return {
      id: agentEntity.id,
      name: body.name,
      ageTicks: tick - body.birthTick,
      traits: body.traits,
      needs: { ...body.needs },
      health: body.health,
      sick: body.sickUntil > tick,
      x: t.x,
      y: t.y,
      inventory: { ...body.inventory },
      context: this.contextAt(world, t.x, t.y, tick),
    };
  }

  /** Which living agents perceive an event at its location. */
  witnessesOf(world: World, event: SimEvent): number[] {
    const ids: number[] = [];
    for (const entity of world.spatial.within('GahallianBody', event.x, event.y, this.radius(event.tick))) {
      if (IS_ALIVE(entity)) ids.push(entity.id);
    }
    return ids;
  }
}
