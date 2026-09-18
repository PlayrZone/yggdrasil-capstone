import type { GahallianBody } from '../../body/GahallianBody.js';
import { createGahallianBody } from '../../body/index.js';
import { mulberry32, hashSeed } from '../../body/prng.js';
import type { Traits } from '../../contract/types.js';
// World geography reached from a society process — inherited leakage
// (audit 01 §4). It moves to the adapter's `space` in W1-B; moving it now
// would change where children land, and the goldens lock that.
import { clampToWorld, isDeepWater } from '../../world/regions.js';
import type { Demography } from '../Scenario.js';
import type { SocietyHost, SocietySystem } from './SocietySystem.js';

interface Candidate {
  id: number;
  body: GahallianBody;
  x: number;
  y: number;
}

/**
 * Generations: well-fed adults who are together may have a child — born
 * unnamed, age 0, with traits BLENDED from its parents (+ mutation) and a
 * mind whose cognition is derived from those inherited traits, so lineages of
 * the curious or the cautious can form. Nothing assigns family; birth is
 * simply possible when conditions are met. Born among knowledgeable elders, a
 * child learns by observation + testimony (existing channels) — the vertical
 * transmission civilization needs.
 */
export class ReproductionSystem implements SocietySystem {
  readonly intervalTicks: number;
  /** Its own stream, keyed `<seed>:repro`, consumed only here. */
  private readonly rng: () => number;

  constructor(
    private readonly host: SocietyHost,
    private readonly demography: Demography,
    seed: string,
  ) {
    this.intervalTicks = demography.reproInterval;
    this.rng = mulberry32(hashSeed(`${seed}:repro`));
  }

  step(tick: number): void {
    const host = this.host;
    if (host.aliveCount() >= this.demography.maxPopulation) return;
    const eligible: Candidate[] = [];
    for (const id of host.agentIds) {
      const body = host.agentBody(id);
      if (!body?.alive) continue;
      if (tick - body.birthTick < this.demography.adultAge) continue; // must be an adult
      if (tick < body.reproCooldownUntil) continue; // not too soon after a birth
      if (body.needs.hunger > 45 || body.health < 65) continue; // well-fed + healthy
      const t = host.positionOf(id)!;
      eligible.push({ id, body, x: t.x, y: t.y });
    }
    // Same pairing as the old O(n²) double loop: each candidate against the
    // eligible ones after it, ascending by id — so the reproduction RNG is
    // consumed in the same order, for the same pairs.
    const eligibleById = new Map(eligible.map((e) => [e.id, e]));
    const used = new Set<number>();
    for (const A of eligible) {
      if (used.has(A.id)) continue;
      for (const near of host.world.spatial.within('GahallianBody', A.x, A.y, this.demography.reproRange)) {
        if (near.id <= A.id) continue;
        const B = eligibleById.get(near.id);
        if (!B || used.has(B.id)) continue;
        if (this.rng() > 0.5) continue; // togetherness doesn't always make a child
        this.bearChild(A, B, tick);
        used.add(A.id);
        used.add(B.id);
        if (host.aliveCount() >= this.demography.maxPopulation) return;
        break;
      }
    }
  }

  private bearChild(a: Candidate, b: Candidate, tick: number): void {
    const host = this.host;
    const blend = (k: keyof Traits): number => {
      const base = (a.body.traits[k] + b.body.traits[k]) / 2;
      return Math.max(0, Math.min(100, Math.round(base + (this.rng() - 0.5) * 16))); // ±8 mutation
    };
    const traits: Traits = {
      curiosity: blend('curiosity'),
      aggression: blend('aggression'),
      compassion: blend('compassion'),
      ambition: blend('ambition'),
      loyalty: blend('loyalty'),
      riskTolerance: blend('riskTolerance'),
    };
    const pos = { x: (a.x + b.x) / 2 + (this.rng() - 0.5) * 6, y: (a.y + b.y) / 2 + (this.rng() - 0.5) * 6 };
    clampToWorld(pos);
    if (isDeepWater(pos.x, pos.y)) {
      pos.x = a.x;
      pos.y = a.y;
    }
    const child = host.world.createEntity({
      Transform2D: { x: pos.x, y: pos.y },
      GahallianBody: createGahallianBody('', traits, tick), // unnamed, age 0
    });
    host.admit(child.id, traits);
    host.recordBirth({ child: child.id, parents: [a.id, b.id], tick });
    a.body.reproCooldownUntil = tick + this.demography.reproCooldown;
    b.body.reproCooldownUntil = tick + this.demography.reproCooldown;
    host.bus.emit({ tick, type: 'ChildBorn', actorId: child.id, targetIds: [a.id, b.id], x: pos.x, y: pos.y, payload: { parents: [a.id, b.id] } });
  }
}
