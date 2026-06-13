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
import {
  PERCEPTION_RADIUS_DAY,
  PERCEPTION_RADIUS_NIGHT,
  isNight,
} from './WorldRegularities.js';
import { seasonAt } from './Climate.js';

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

const NEAR_WATER_RADIUS = 12;
const IN_SHELTER_RADIUS = 4;

/**
 * Radius + light-modified perception. One global event truth, N partial
 * views — perception is where subjectivity (and therefore rumor and
 * belief divergence) begins.
 */
export class PerceptionSystem {
  constructor(private readonly terrain?: TerrainField) {}

  radius(tick: number): number {
    return isNight(tick) ? PERCEPTION_RADIUS_NIGHT : PERCEPTION_RADIUS_DAY;
  }

  /** Context features at a position — the miners' feature space. */
  contextAt(world: World, x: number, y: number, tick: number): ContextFeatures {
    let nearWater = false;
    let inShelter = false;
    world.forEach((entity) => {
      const t = entity.components['Transform2D'] as Transform2D | undefined;
      if (!t) return;
      const dx = t.x - x;
      const dy = t.y - y;
      const d2 = dx * dx + dy * dy;
      const node = entity.components['ResourceNode'] as ResourceNode | undefined;
      if (
        (node?.kind === 'waterSource' || node?.kind === 'river') &&
        d2 <= NEAR_WATER_RADIUS * NEAR_WATER_RADIUS
      ) {
        nearWater = true;
      }
      const structure = entity.components['Structure'] as Structure | undefined;
      if (structure?.kind === 'shelter' && d2 <= IN_SHELTER_RADIUS * IN_SHELTER_RADIUS) {
        inShelter = true;
      }
    });
    const elevationBand = this.terrain?.elevationBand(x, y) ?? 0;
    return { nearWater, night: isNight(tick), inShelter, elevationBand };
  }

  /** Everything one agent can currently see. */
  worldViewFor(world: World, agentEntity: Entity, tick: number): WorldView {
    const self = agentEntity.components['Transform2D'] as Transform2D;
    const r = this.radius(tick);
    const r2 = r * r;
    const view: WorldView = {
      tick,
      night: isNight(tick),
      season: seasonAt(tick),
      agents: [],
      resources: [],
      structures: [],
    };
    world.forEach((entity) => {
      if (entity.id === agentEntity.id) return;
      const t = entity.components['Transform2D'] as Transform2D | undefined;
      if (!t) return;
      const dx = t.x - self.x;
      const dy = t.y - self.y;
      if (dx * dx + dy * dy > r2) return;

      const body = entity.components['GahallianBody'] as GahallianBody | undefined;
      if (body?.alive) view.agents.push({ id: entity.id, x: t.x, y: t.y });
      const node = entity.components['ResourceNode'] as ResourceNode | undefined;
      if (node) view.resources.push({ id: entity.id, kind: node.kind, x: t.x, y: t.y, stock: node.stock });
      const structure = entity.components['Structure'] as Structure | undefined;
      if (structure) view.structures.push({ id: entity.id, kind: structure.kind, x: t.x, y: t.y });
    });
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
    const r = this.radius(event.tick);
    const r2 = r * r;
    const ids: number[] = [];
    world.forEach((entity) => {
      const body = entity.components['GahallianBody'] as GahallianBody | undefined;
      if (!body?.alive) return;
      const t = entity.components['Transform2D'] as Transform2D | undefined;
      if (!t) return;
      const dx = t.x - event.x;
      const dy = t.y - event.y;
      if (dx * dx + dy * dy <= r2) ids.push(entity.id);
    });
    return ids;
  }
}
