import type { Intent, Needs, ObjectKind, Traits } from './contract.js';

/**
 * The physical existence of one Gahallian. The body experiences reality;
 * it never thinks (V2 separation). Component key: 'GahallianBody'.
 *
 * Per the genesis rule this carries zero social identity and zero
 * knowledge: a name, an age, traits, needs, a position, an inventory.
 */
export interface GahallianBody {
  name: string;
  birthTick: number;
  traits: Traits;
  /** Pressure values 0–100; 0 = satisfied (see contract thresholds). */
  needs: Needs;
  health: number;
  alive: boolean;
  /** Tick the current sickness ends; 0 = not sick. */
  sickUntil: number;
  inventory: Partial<Record<ObjectKind, number>>;
  /** Current plan (set by the host from MindOutput) + execution cursor. */
  plan: Intent[];
  planStep: number;
  /** True when the plan ran out — the host's planCompleted think trigger. */
  planDone: boolean;
  /** Tick sleep ends; 0 = awake. */
  sleepingUntil: number;
  /** Set when sleep started in shelter (affects recovery + the wake event). */
  sleptInShelter: boolean;
  /** Rest pressure when sleep began — the wake event reports the delta. */
  sleepStartRest: number;
  /** Ticks spent on the current intent (Flee/Idle/Follow timeouts). */
  intentTicks: number;
  /** True if violence landed this tick (death-cause attribution). */
  hitThisTick: boolean;
  /** Tick before which this Gahallian cannot reproduce again; 0 = ready. */
  reproCooldownUntil: number;
}

export function createGahallianBody(name: string, traits: Traits, birthTick: number): GahallianBody {
  return {
    name,
    birthTick,
    traits,
    needs: { hunger: 30, rest: 20, safety: 10, socialConnection: 30 },
    health: 100,
    alive: true,
    sickUntil: 0,
    inventory: {},
    plan: [],
    planStep: 0,
    planDone: true,
    sleepingUntil: 0,
    sleptInShelter: false,
    sleepStartRest: 0,
    intentTicks: 0,
    hitThisTick: false,
    reproCooldownUntil: 0,
  };
}
