import type { World } from '../core/World.js';
import type { Entity } from '../core/Entity.js';
import type { Transform2D } from '../core/Transform2D.js';
import type { Traits } from './contract.js';
import { createGahallianBody } from './GahallianBody.js';
import { hashSeed, mulberry32 } from './prng.js';

/**
 * Genesis: N Gahallians scattered across terrain with nothing but their
 * bodies and traits. Per the genesis rule, nothing here assigns a social
 * identity, an occupation, knowledge, or a backstory — a name, an age of
 * zero, six trait rolls, a position. The PRNG is seeded so identical
 * seeds produce identical populations (determinism requirement).
 */

const SYLLABLES_A = ['Ka', 'Mi', 'To', 'Sa', 'El', 'Ru', 'Ha', 'Ny', 'Or', 'Ve', 'Ja', 'Li'];
const SYLLABLES_B = ['ra', 'len', 'do', 'mir', 'sha', 'nu', 'vek', 'ti', 'gan', 'la', 'rin', 'os'];
const SYLLABLES_C = ['', '', '', 'a', 'is', 'or', 'en', 'ka'];

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
    const name =
      SYLLABLES_A[Math.floor(rng() * SYLLABLES_A.length)]! +
      SYLLABLES_B[Math.floor(rng() * SYLLABLES_B.length)]! +
      SYLLABLES_C[Math.floor(rng() * SYLLABLES_C.length)]!;
    const traits: Traits = {
      curiosity: Math.floor(rng() * 101),
      aggression: Math.floor(rng() * 101),
      compassion: Math.floor(rng() * 101),
      ambition: Math.floor(rng() * 101),
      loyalty: Math.floor(rng() * 101),
      riskTolerance: Math.floor(rng() * 101),
    };
    const x = area.x + rng() * area.width;
    const y = area.y + rng() * area.height;
    agents.push(
      world.createEntity({
        Transform2D: { x, y } satisfies Transform2D,
        GahallianBody: createGahallianBody(name, traits, birthTick),
      }),
    );
  }
  return agents;
}
