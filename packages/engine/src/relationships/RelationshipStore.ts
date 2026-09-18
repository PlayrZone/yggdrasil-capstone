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

/**
 * The few deltas a WITNESS may feel — the ones that mark you about a person
 * without your ever touching them. Seeing a killing is the whole list:
 * `WitnessedDeath` only ever arises in the bystander perspective
 * (memory/memoryFromEvent), where its subject is the KILLER, and only when a
 * person did it — so fear lands on someone still alive, or on no one.
 * Deliberately an allowlist: watching is otherwise miner input, not a
 * relationship event.
 */
const OBSERVER_APPLICABLE: ReadonlySet<SimEventType> = new Set<SimEventType>(['WitnessedDeath']);

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

  /**
   * The same deltas, felt from the outside: applied only for the allowlisted
   * witness events. Watching is not interacting, so — like `gainRespect` —
   * this leaves `interactionCount` alone; the scalar moves, the familiarity
   * does not.
   */
  applyObservedEvent(partnerId: number, type: SimEventType, tick: number): void {
    if (!OBSERVER_APPLICABLE.has(type)) return;
    const deltas = EVENT_DELTAS[type];
    if (!deltas) return;
    const r = this.recordFor(partnerId, tick);
    r.trust = clamp(r.trust + (deltas.trust ?? 0));
    r.respect = clamp(r.respect + (deltas.respect ?? 0));
    r.friendship = clamp(r.friendship + (deltas.friendship ?? 0));
    r.fear = clamp(r.fear + (deltas.fear ?? 0));
  }

  /**
   * Familiarity from simply spending time near someone — the slow, ambient way
   * a bond actually forms. Without this, relationships only moved on rare
   * discrete acts (a gift, an attack), so beings could cluster for days and
   * stay strangers; co-presence is what turns proximity into social identity.
   */
  coPresence(partnerId: number, tick: number): void {
    const r = this.recordFor(partnerId, tick);
    r.friendship = clamp(r.friendship + 0.4);
    r.trust = clamp(r.trust + 0.25);
    r.interactionCount++;
    r.lastInteractionTick = tick;
  }

  /**
   * Prestige (Cycle 13): respect earned by witnessing someone's competence. Not
   * an interaction with them — you can respect someone from afar — so this does
   * NOT touch interactionCount; respect decays toward neutral like everything
   * else, so prestige fades unless re-earned.
   */
  gainRespect(partnerId: number, amount: number, tick: number): void {
    const r = this.recordFor(partnerId, tick);
    r.respect = clamp(r.respect + amount);
  }

  /** Call on a coarse cadence; relationships need maintenance. */
  decay(tick: number): void {
    for (const r of this.pairs.values()) {
      const idle = tick - r.lastInteractionTick;
      if (idle < DECAY_INTERVAL) continue;
      const steps = Math.floor(idle / DECAY_INTERVAL);
      // RELATIONSHIP MEMORY PERSISTENCE: an established bond (many shared
      // interactions) fades far more slowly than a passing acquaintance — the
      // memory of who someone is to you persists, which is what lets a social
      // identity outlast the moment.
      const amount = (DECAY_STEP * steps) / (1 + r.interactionCount * 0.06);
      r.trust = drift(r.trust, NEUTRAL, amount);
      r.respect = drift(r.respect, NEUTRAL, amount);
      r.friendship = drift(r.friendship, NEUTRAL, amount);
      r.fear = drift(r.fear, 0, amount);
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
