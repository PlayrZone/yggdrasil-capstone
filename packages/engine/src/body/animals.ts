import type { World } from '../core/World.js';
import type { Transform2D } from '../core/Transform2D.js';
import type { GahallianBody } from './GahallianBody.js';
import type { SimEventBus } from './SimEventBus.js';
import { createResourceNode } from './ResourceNodeSystem.js';

export type AnimalKind = 'deer' | 'hare' | 'boar' | 'fish' | 'wolf' | 'bear' | 'crocodile';

/**
 * A HOME RANGE — a fixed point and a closed-form loop around it, in metres.
 *
 * Present only on the continent's animals. It is what makes a 67 km² world
 * affordable: an animal's position is a pure function of the tick, so a tile
 * of wilderness nobody is standing in needs no simulating at all and is exactly
 * right the moment someone walks into it. The parameters never change after
 * the animal is born.
 */
export interface HomeRange {
  readonly x: number;
  readonly y: number;
  readonly rx: number;
  readonly ry: number;
  readonly wx: number;
  readonly wy: number;
  readonly px: number;
  readonly py: number;
}

/** Component key: 'Animal'. Prey are also `game` ResourceNodes (huntable for
 *  meat); predators are threats that hunt Gahallians. */
export interface Animal {
  kind: AnimalKind;
  heading: number;
  changeAt: number;
  /** Predators only: current quarry + attack cooldown + health (can be killed). */
  targetId: number;
  lastAttack: number;
  health: number;
  /** Continent scenario only — see `HomeRange`. Absent in the classic world. */
  home?: HomeRange;
}

// What a held weapon does to a predator that attacks you. Emergent: you only
// have one if you DISCOVERED how to craft it. Best weapon in hand is used.
const WEAPON_DAMAGE: Record<string, number> = { spear: 12, handaxe: 9, club: 6 };
export const PRED_HEALTH: Record<string, number> = { wolf: 18, bear: 34, crocodile: 24 };
export const DAMAGE: Record<string, number> = { wolf: 4, bear: 8, crocodile: 7 };
export const PREY: ReadonlySet<AnimalKind> = new Set<AnimalKind>(['deer', 'hare', 'boar', 'fish']);
export const WATER_KIND: ReadonlySet<AnimalKind> = new Set<AnimalKind>(['fish', 'crocodile']);
export const ATTACK_COOLDOWN = 60; // ~slow maulings, not a death ray
export const MEAT_PER_PREY = 4;

export function bestWeaponDamage(inv: Partial<Record<string, number>>): number {
  let best = 0;
  for (const [w, d] of Object.entries(WEAPON_DAMAGE)) if ((inv[w] ?? 0) > 0 && d > best) best = d;
  return best;
}

/** The one being a predator has hold of, as both wildlife systems see it. */
export interface Quarry {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly body: GahallianBody;
}

/**
 * A MAULING, AND WHAT IT PROVOKES — shared verbatim by the classic world's
 * wildlife and the continent's, because the two differ in how a beast MOVES
 * and not at all in what happens when it reaches you. Emits the same three
 * events in the same order; the classic goldens hold across the extraction.
 */
export function resolveStrike(
  world: World,
  bus: SimEventBus,
  tick: number,
  animalId: number,
  animal: Animal,
  at: Transform2D,
  quarry: Quarry,
): void {
  animal.lastAttack = tick;
  const dmg = DAMAGE[animal.kind] ?? 6;
  quarry.body.health -= dmg;
  quarry.body.needs.safety = Math.min(100, quarry.body.needs.safety + 38); // terror
  quarry.body.hitThisTick = true;
  bus.emit({
    tick,
    type: 'AttackedByPredator',
    actorId: quarry.id,
    targetIds: [animalId],
    x: quarry.x,
    y: quarry.y,
    payload: { predator: animal.kind, damage: dmg },
  });
  // An ARMED Gahallian fights back — the whole point of weapons. They
  // only have one if they discovered how to craft it.
  const wdmg = bestWeaponDamage(quarry.body.inventory as Partial<Record<string, number>>);
  if (wdmg <= 0) return;
  animal.health -= wdmg;
  bus.emit({
    tick,
    type: 'FoughtPredator',
    actorId: quarry.id,
    targetIds: [animalId],
    x: quarry.x,
    y: quarry.y,
    payload: { predator: animal.kind, damage: wdmg },
  });
  if (animal.health > 0) return;
  world.removeEntity(animalId); // the beast is slain
  world.createEntity({
    Transform2D: { x: at.x, y: at.y } satisfies Transform2D,
    ResourceNode: createResourceNode('game', 2), // a carcass to butcher
  });
  bus.emit({
    tick,
    type: 'KilledPredator',
    actorId: quarry.id,
    targetIds: [],
    x: quarry.x,
    y: quarry.y,
    payload: { predator: animal.kind },
  });
  quarry.body.needs.safety = Math.max(0, quarry.body.needs.safety - 25); // relief
}

/** Where a home-ranging animal is at `tick` — pure, and the whole point. */
export function homePosition(home: HomeRange, tick: number): { x: number; y: number } {
  return {
    x: home.x + home.rx * Math.cos(home.wx * tick + home.px),
    y: home.y + home.ry * Math.sin(home.wy * tick + home.py),
  };
}
