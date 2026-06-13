import type { RelationshipRecord, SimEventType } from '../contract/types.js';

/**
 * Deterministic per-body-event deltas — the ONLY update path in V2 (the
 * LLM-emitted deltas of the V1 design were removed; rich social judgments
 * live in knowledge via the SocialMiner). Scalars stay sub-social on
 * purpose: trust/respect/friendship/fear are raw material, not "friend".
 */
const EVENT_DELTAS: Partial<
  Record<SimEventType, Partial<Omit<RelationshipRecord, 'interactionCount' | 'lastInteractionTick'>>>
> = {
  ReceivedItem: { trust: 6, friendship: 5 },
  GaveItem: { friendship: 2 },
  WasAttacked: { trust: -15, fear: 12, friendship: -10 },
  AttackedAgent: { fear: -2 },
  WitnessedDeath: { fear: 4 },
  UtteranceSpoken: { friendship: 1 },
  SleptSafely: {},
};

/** Without interaction, every dimension drifts toward neutral (50). */
const DECAY_INTERVAL = 2400;
const DECAY_STEP = 1;
const NEUTRAL = 50;

export class RelationshipStore {
  private pairs = new Map<number, RelationshipRecord>();

  recordFor(partnerId: number, tick: number): RelationshipRecord {
    let r = this.pairs.get(partnerId);
    if (!r) {
      r = {
        trust: NEUTRAL,
        respect: NEUTRAL,
        friendship: NEUTRAL,
        fear: 0,
        interactionCount: 0,
        lastInteractionTick: tick,
      };
      this.pairs.set(partnerId, r);
    }
    return r;
  }

  applyEvent(partnerId: number, type: SimEventType, tick: number): void {
    const deltas = EVENT_DELTAS[type];
    if (!deltas) return;
    const r = this.recordFor(partnerId, tick);
    r.trust = clamp(r.trust + (deltas.trust ?? 0));
    r.respect = clamp(r.respect + (deltas.respect ?? 0));
    r.friendship = clamp(r.friendship + (deltas.friendship ?? 0));
    r.fear = clamp(r.fear + (deltas.fear ?? 0));
    r.interactionCount++;
    r.lastInteractionTick = tick;
  }

  /** Call on a coarse cadence; relationships need maintenance. */
  decay(tick: number): void {
    for (const r of this.pairs.values()) {
      const idle = tick - r.lastInteractionTick;
      if (idle < DECAY_INTERVAL) continue;
      const steps = Math.floor(idle / DECAY_INTERVAL);
      r.trust = drift(r.trust, NEUTRAL, DECAY_STEP * steps);
      r.respect = drift(r.respect, NEUTRAL, DECAY_STEP * steps);
      r.friendship = drift(r.friendship, NEUTRAL, DECAY_STEP * steps);
      r.fear = drift(r.fear, 0, DECAY_STEP * steps);
      r.lastInteractionTick = tick;
    }
  }

  get(partnerId: number): RelationshipRecord | undefined {
    return this.pairs.get(partnerId);
  }

  asMap(): Map<number, RelationshipRecord> {
    return this.pairs;
  }
}

function clamp(v: number): number {
  return Math.min(100, Math.max(0, v));
}

function drift(v: number, toward: number, amount: number): number {
  if (v > toward) return Math.max(toward, v - amount);
  if (v < toward) return Math.min(toward, v + amount);
  return v;
}
