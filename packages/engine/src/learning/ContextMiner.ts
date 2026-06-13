import type { ContextFeatureKey, MemoryRecord } from '../contract/types.js';
import type { EvidenceReport, ILearner } from './ILearner.js';
import { ProvenanceSample } from './ILearner.js';

interface EventCell {
  /** n(event) — occurrences of this event key. */
  total: number;
  /** n(event ∧ feature) per feature. */
  withFeature: Map<ContextFeatureKey, number>;
  provenance: Map<ContextFeatureKey, ProvenanceSample>;
}

const FEATURES: ContextFeatureKey[] = ['nearWater', 'night', 'inShelter', 'highland'];

const MIN_JOINT = 3;
const MIN_LIFT_POSITIVE = 1.5;
const MAX_LIFT_NEGATIVE = 0.5;
const MIN_EVENT_FOR_NEGATIVE = 6;

function featureActive(m: MemoryRecord, f: ContextFeatureKey): boolean {
  if (f === 'highland') return m.context.elevationBand === 2;
  return m.context[f];
}

/**
 * Mines event ⇆ context-feature associations by lift:
 * "GatherSucceeded(berry) co-occurs with nearWater far above chance"
 * → "Gathering berries succeeds mostly near water."
 *
 * Pure counting — no truth oracle, no model. A coincidental correlation
 * that clears the thresholds becomes knowledge; that is by design.
 */
export class ContextMiner implements ILearner {
  private totalMemories = 0;
  private featureTotals = new Map<ContextFeatureKey, number>();
  private events = new Map<string, EventCell>();
  private keyParts = new Map<string, { type: MemoryRecord['type']; objectKind?: MemoryRecord['objectKind'] }>();

  observe(memory: MemoryRecord): void {
    this.totalMemories++;
    const active = FEATURES.filter((f) => featureActive(memory, f));
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
        prov = new ProvenanceSample();
        cell.provenance.set(f, prov);
      }
      prov.add(memory.id);
    }
  }

  consolidate(): EvidenceReport[] {
    const reports: EvidenceReport[] = [];
    if (this.totalMemories === 0) return reports;

    for (const [key, cell] of this.events) {
      const parts = this.keyParts.get(key)!;
      for (const feature of FEATURES) {
        const joint = cell.withFeature.get(feature) ?? 0;
        const featureTotal = this.featureTotals.get(feature) ?? 0;
        if (featureTotal === 0) continue;

        const pFeatureGivenEvent = joint / cell.total;
        const pFeature = featureTotal / this.totalMemories;
        const lift = pFeatureGivenEvent / pFeature;

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
            sourceMemoryIds: cell.provenance.get(feature)?.ids() ?? [],
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
            sourceMemoryIds: cell.provenance.get(feature)?.ids() ?? [],
          });
        }
      }
    }
    return reports;
  }
}
