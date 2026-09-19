import type { RelationshipDeltas, WorldAdapter } from '../contract/adapter.js';
import type { EventId } from '../contract/ids.js';
import type { RelationshipRecord } from '../contract/types.js';

/** Without interaction, every dimension drifts toward neutral (50). */
const DECAY_INTERVAL = 2400;
const DECAY_STEP = 1;
const NEUTRAL = 50;

/**
 * The scalars one being holds about another. Deterministic per-body-event
 * deltas are the ONLY update path in V2 (the LLM-emitted deltas of the V1
 * design were removed; rich social judgments live in knowledge via the
 * SocialMiner). Scalars stay sub-social on purpose: trust/respect/friendship/
 * fear are raw material, not "friend".
 *
 * WHICH events move WHAT is the world's (`events[].relationshipDeltas` and
 * `observerDeltas`); this class only knows that some do.
 */
export class RelationshipStore {
  private pairs = new Map<number, RelationshipRecord>();

  constructor(private readonly world: WorldAdapter) {}

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

  applyEvent(partnerId: number, type: EventId, tick: number): void {
    const deltas = this.world.eventById.get(type)?.relationshipDeltas;
    if (!deltas) return;
    const r = this.recordFor(partnerId, tick);
    apply(r, deltas);
    r.interactionCount++;
    r.lastInteractionTick = tick;
  }

  /**
   * What an event moves in you about someone you only WATCHED. The world names
   * the few events that mark you without your ever touching the person; every
   * other kind of watching is miner input, not a relationship event. Watching
   * is not interacting, so — like `gainRespect` — this leaves
   * `interactionCount` alone: the scalar moves, the familiarity does not.
   */
  applyObservedEvent(partnerId: number, type: EventId, tick: number): void {
    const deltas = this.world.eventById.get(type)?.observerDeltas;
    if (!deltas) return;
    apply(this.recordFor(partnerId, tick), deltas);
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

function apply(r: RelationshipRecord, deltas: RelationshipDeltas): void {
  r.trust = clamp(r.trust + (deltas.trust ?? 0));
  r.respect = clamp(r.respect + (deltas.respect ?? 0));
  r.friendship = clamp(r.friendship + (deltas.friendship ?? 0));
  r.fear = clamp(r.fear + (deltas.fear ?? 0));
}

function clamp(v: number): number {
  return Math.min(100, Math.max(0, v));
}

function drift(v: number, toward: number, amount: number): number {
  if (v > toward) return Math.max(toward, v - amount);
  if (v < toward) return Math.min(toward, v + amount);
  return v;
}
