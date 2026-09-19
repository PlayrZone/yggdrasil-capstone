import type { WorldAdapter } from '../contract/adapter.js';
import type { EventId } from '../contract/ids.js';
import type { PlaceRef } from '../contract/space.js';
import type { EvidenceSnapshot, MemoryRecord } from '../contract/types.js';
import type { EvidenceReport, ILearner, ProvenanceLevel } from './ILearner.js';
import { ProvenanceSample, snapshotOf } from './ILearner.js';

interface PendingCause {
  key: string;
  tick: number;
  place?: PlaceRef;
  /** The cause episode itself: an effect can arrive after the memory is gone. */
  memory: EvidenceSnapshot;
  /** Pair keys already credited for this cause instance. */
  matched: Set<string>;
}

export interface SuccessionMinerOptions {
  /** Effect must occur within this many ticks of the cause. Default: the world's. */
  windowTicks?: number;
  /** When both memories carry a place, they must be this near. Default: the world's. */
  radius?: number;
  /** Overrides the world's own list of events that carry no causal signal. */
  exclude?: EventId[];
  /** How much evidence each mined rule keeps about itself. */
  provenance?: ProvenanceLevel;
}

/**
 * Mines temporal succession: cause-event followed by effect-event within a
 * time window (and near the same place when locations are known).
 * "SeedDeposited → PlantSprouted", "AteFood(mushroomRed) → BecameSick" —
 * and, given an unlucky life, "rain → death"-class superstition. Confidence
 * is Laplace P(effect follows | cause happened); causes that expire
 * unanswered are the contradictions.
 */
export class SuccessionMiner implements ILearner {
  private readonly world: WorldAdapter;
  private readonly window: number;
  private readonly radius: number;
  private readonly exclude: Set<EventId>;
  private readonly provenanceLevel: ProvenanceLevel;

  private pending: PendingCause[] = [];
  private causeTotals = new Map<string, number>();
  private pairCounts = new Map<string, number>();
  private provenance = new Map<string, ProvenanceSample>();
  private keyParts = new Map<string, { type: EventId; objectKind?: MemoryRecord['objectKind'] }>();

  constructor(world: WorldAdapter, options: SuccessionMinerOptions = {}) {
    this.world = world;
    // How near in time and in space two things have to be to look like cause
    // and effect is a fact about a WORLD, not about mining: 600 ticks is a
    // quarter of the forager day and 8 is eight of its units, and both used to
    // be written here (W1-B3 verifier, what B4 inherits).
    this.window = options.windowTicks ?? world.cognitionDefaults.successionWindowTicks;
    this.radius = options.radius ?? world.cognitionDefaults.successionRadius;
    this.exclude = new Set(
      options.exclude ?? world.events.filter((e) => e.causal === false).map((e) => e.id),
    );
    this.provenanceLevel = options.provenance ?? 'compact';
  }

  observe(memory: MemoryRecord): void {
    if (this.exclude.has(memory.type)) return;
    const key = `${memory.type}:${memory.objectKind ?? '*'}`;
    if (!this.keyParts.has(key)) {
      this.keyParts.set(key, { type: memory.type, objectKind: memory.objectKind });
    }

    // Prune causes that fell out of the window.
    this.pending = this.pending.filter((p) => memory.tick - p.tick <= this.window);

    // This memory is a potential EFFECT of every live pending cause.
    for (const cause of this.pending) {
      if (cause.key === key) continue;
      // Near the same place, when both are somewhere at all — and WHAT "near"
      // means is the world's arithmetic, not this file's (W1-B4).
      if (cause.place !== undefined && memory.place !== undefined) {
        if (!this.world.space.within(cause.place, memory.place, this.radius)) continue;
      }
      const pairKey = `${cause.key}>${key}`;
      if (cause.matched.has(pairKey)) continue;
      cause.matched.add(pairKey);
      this.pairCounts.set(pairKey, (this.pairCounts.get(pairKey) ?? 0) + 1);
      let prov = this.provenance.get(pairKey);
      if (!prov) {
        prov = new ProvenanceSample(this.provenanceLevel);
        this.provenance.set(pairKey, prov);
      }
      prov.addSnapshot(cause.memory);
      prov.add(memory);
    }

    // And it is a potential CAUSE of what comes next.
    this.causeTotals.set(key, (this.causeTotals.get(key) ?? 0) + 1);
    this.pending.push({
      key,
      tick: memory.tick,
      place: memory.place,
      memory: snapshotOf(memory),
      matched: new Set(),
    });
  }

  consolidate(): EvidenceReport[] {
    const reports: EvidenceReport[] = [];
    for (const [pairKey, count] of this.pairCounts) {
      if (count < 2) continue;
      const sep = pairKey.indexOf('>');
      const causeKey = pairKey.slice(0, sep);
      const effectKey = pairKey.slice(sep + 1);
      const cause = this.keyParts.get(causeKey)!;
      const effect = this.keyParts.get(effectKey)!;
      const causeTotal = this.causeTotals.get(causeKey) ?? count;
      const prov = this.provenance.get(pairKey);
      reports.push({
        rule: {
          kind: 'succession',
          causeType: cause.type,
          causeObject: cause.objectKind,
          effectType: effect.type,
          effectObject: effect.objectKind,
        },
        confidence: (count + 1) / (causeTotal + 2),
        evidenceCount: count,
        contradictionCount: causeTotal - count,
        sourceMemoryIds: prov?.ids() ?? [],
        ...(prov ? { provenance: prov.snapshots() } : {}),
      });
    }
    return reports;
  }
}
