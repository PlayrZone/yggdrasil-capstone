import { featureActive } from '../contract/adapter.js';
import type { ContextSchema, WorldAdapter } from '../contract/adapter.js';
import type { ContextFeatureKey, MemoryRecord } from '../contract/types.js';
import type { EvidenceReport, ILearner, ProvenanceLevel } from './ILearner.js';
import { ProvenanceSample } from './ILearner.js';

interface EventCell {
  /** n(event) — occurrences of this event key. */
  total: number;
  /** n(event ∧ feature) per feature. */
  withFeature: Map<ContextFeatureKey, number>;
  provenance: Map<ContextFeatureKey, ProvenanceSample>;
}

const MIN_JOINT = 3;
const MIN_LIFT_POSITIVE = 1.5;
const MAX_LIFT_NEGATIVE = 0.5;
const MIN_EVENT_FOR_NEGATIVE = 6;

/**
 * Mines event ⇆ context-feature associations by lift:
 * "GatherSucceeded(berry) co-occurs with nearWater far above chance"
 * → "Gathering berries succeeds mostly near water."
 *
 * Pure counting — no truth oracle, no model. A coincidental correlation
 * that clears the thresholds becomes knowledge; that is by design. WHICH
 * features exist is the world's to declare, and the order it declares them
 * in is the order evidence comes out in.
 */
export class ContextMiner implements ILearner {
  private readonly features: readonly ContextSchema[];

  constructor(
    world: WorldAdapter,
    private readonly provenance: ProvenanceLevel = 'compact',
  ) {
    this.features = world.context;
  }

  private totalMemories = 0;
  private featureTotals = new Map<ContextFeatureKey, number>();
  private events = new Map<string, EventCell>();
  private keyParts = new Map<string, { type: MemoryRecord['type']; objectKind?: MemoryRecord['objectKind'] }>();

  observe(memory: MemoryRecord): void {
    this.totalMemories++;
    const active = this.features.filter((f) => featureActive(memory.context, f)).map((f) => f.id);
    for (const f of active) {
      this.featureTotals.set(f, (this.featureTotals.get(f) ?? 0) + 1);
    }

    const key = `${memory.type}:${memory.objectKind ?? '*'}`;
    let cell = this.events.get(key);
    if (!cell) {
      cell = { total: 0, withFeature: new Map(), provenance: new Map() };
      this.events.set(key, cell);
      this.keyParts.set(key, { type: memory.type, objectKind: memory.objectKind });
    }
    cell.total++;
    for (const f of active) {
      cell.withFeature.set(f, (cell.withFeature.get(f) ?? 0) + 1);
      let prov = cell.provenance.get(f);
      if (!prov) {
        prov = new ProvenanceSample(this.provenance);
        cell.provenance.set(f, prov);
      }
      prov.add(memory);
    }
  }

  consolidate(): EvidenceReport[] {
    const reports: EvidenceReport[] = [];
    if (this.totalMemories === 0) return reports;

    for (const [key, cell] of this.events) {
      const parts = this.keyParts.get(key)!;
      for (const { id: feature } of this.features) {
        const joint = cell.withFeature.get(feature) ?? 0;
        const featureTotal = this.featureTotals.get(feature) ?? 0;
        if (featureTotal === 0) continue;

        const pFeatureGivenEvent = joint / cell.total;
        const pFeature = featureTotal / this.totalMemories;
        const lift = pFeatureGivenEvent / pFeature;
        const prov = cell.provenance.get(feature);

        if (joint >= MIN_JOINT && lift >= MIN_LIFT_POSITIVE) {
          reports.push({
            rule: {
              kind: 'context-association',
              event: parts.type,
              objectKind: parts.objectKind,
              feature,
              direction: 'positive',
            },
            confidence: (joint + 1) / (cell.total + 2),
            evidenceCount: joint,
            contradictionCount: cell.total - joint,
            sourceMemoryIds: prov?.ids() ?? [],
            ...(prov ? { provenance: prov.snapshots() } : {}),
          });
        } else if (cell.total >= MIN_EVENT_FOR_NEGATIVE && lift <= MAX_LIFT_NEGATIVE && pFeature >= 0.2) {
          reports.push({
            rule: {
              kind: 'context-association',
              event: parts.type,
              objectKind: parts.objectKind,
              feature,
              direction: 'negative',
            },
            confidence: (cell.total - joint + 1) / (cell.total + 2),
            evidenceCount: cell.total - joint,
            contradictionCount: joint,
            sourceMemoryIds: prov?.ids() ?? [],
            ...(prov ? { provenance: prov.snapshots() } : {}),
          });
        }
      }
    }
    return reports;
  }
}
