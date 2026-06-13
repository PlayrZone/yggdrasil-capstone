import type { SimEventType, Needs } from '../contract/types.js';

/**
 * Deterministic importance heuristic. Event-type base in [0, 1] scaled by
 * the magnitude of the need change it caused. Witnessing a death matters
 * more than seeing a tree; nothing here ever consults a model (V2: the LLM
 * does not touch the memory store).
 */
const BASE: Record<SimEventType, number> = {
  GatherSucceeded: 0.25,
  GatherFailed: 0.3,
  AteFood: 0.25,
  DrankWater: 0.15,
  BecameSick: 0.85,
  RecoveredFromSickness: 0.5,
  SleptSafely: 0.15,
  SleptExposed: 0.35,
  SufferedExposure: 0.5,
  ReceivedItem: 0.6,
  GaveItem: 0.45,
  WasAttacked: 0.9,
  AttackedAgent: 0.7,
  AttackedByPredator: 0.92,
  AgentDied: 0.95,
  WitnessedDeath: 0.9,
  SeedDeposited: 0.2,
  PlantSprouted: 0.55,
  BuiltStructure: 0.5,
  DepositedItem: 0.2,
  WithdrewItem: 0.25,
  UtteranceSpoken: 0.35,
  IntentRejected: 0.3,
  SawAgent: 0.1,
  FoundResource: 0.3,
};

export function importanceOf(type: SimEventType, needDeltas: Partial<Needs>): number {
  const base = BASE[type];
  let magnitude = 0;
  for (const delta of Object.values(needDeltas)) {
    magnitude = Math.max(magnitude, Math.abs(delta) / 100);
  }
  return Math.min(1, base + magnitude * 0.3);
}
