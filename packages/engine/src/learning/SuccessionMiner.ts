import type { WorldAdapter } from '../contract/adapter.js';
import type { EventId } from '../contract/ids.js';
import type { EvidenceSnapshot, MemoryRecord } from '../contract/types.js';
import type { EvidenceReport, ILearner, ProvenanceLevel } from './ILearner.js';
import { ProvenanceSample, snapshotOf } from './ILearner.js';

interface PendingCause {
  key: string;
  tick: number;
  x?: number;
  y?: number;
  /** The cause episode itself: an effect can arrive after the memory is gone. */
  memory: EvidenceSnapshot;
  /** Pair keys already credited for this cause instance. */
  matched: Set<string>;
}

export interface SuccessionMinerOptions {
  /** Effect must occur within this many ticks of the cause. */
  windowTicks?: number;
  /** When both memories carry coords, they must be this close. */
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
    this.window = options.windowTicks ?? 600;
    this.radius = options.radius ?? 8;
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
      if (
        cause.x !== undefined &&
        cause.y !== undefined &&
        memory.x !== undefined &&
        memory.y !== undefined
      ) {
        const dx = cause.x - memory.x;
        const dy = cause.y - memory.y;
        if (dx * dx + dy * dy > this.radius * this.radius) continue;
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
      x: memory.x,
      y: memory.y,
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
