import type { World } from '../core/World.js';
import type { Entity } from '../core/Entity.js';
import type { Transform2D } from '../core/Transform2D.js';
import { createGahallianBody } from './GahallianBody.js';
import { hashSeed, mulberry32 } from './prng.js';
import { identityAt } from './identities.js';

/**
 * Genesis: the canonical Gahallians scattered across terrain with nothing but
 * their bodies. Their PERSONALITIES are fixed — the same individuals (same
 * traits) in every run (see identities.ts) — but they are born UNNAMED. A name
 * is not assigned; a Gahallian chooses its own once it is conscious (the LLM
 * mind may name itself). The world seed decides only WHERE each is born.
 */

export interface GenesisArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function spawnGahallians(
  world: World,
  count: number,
  seed: string,
  area: GenesisArea,
  birthTick = 0,
): Entity[] {
  const rng = mulberry32(hashSeed(`${seed}:genesis`));
  const agents: Entity[] = [];
  for (let i = 0; i < count; i++) {
    const identity = identityAt(i);
    const x = area.x + rng() * area.width;
    const y = area.y + rng() * area.height;
    agents.push(
      world.createEntity({
        Transform2D: { x, y } satisfies Transform2D,
        // Born unnamed ('') — a conscious Gahallian names itself later.
        GahallianBody: createGahallianBody('', identity.traits, birthTick),
      }),
    );
  }
  return agents;
}
