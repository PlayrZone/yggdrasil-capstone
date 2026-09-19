import { featureActive } from '../contract/adapter.js';
import type { ContextSchema, WorldAdapter } from '../contract/adapter.js';
import type { ContextFeatureKey, MemoryRecord, NeedKey } from '../contract/types.js';
import type { EvidenceReport, ILearner, ProvenanceLevel } from './ILearner.js';
import { ProvenanceSample } from './ILearner.js';

interface OutcomeCell {
  relieves: number;
  worsens: number;
  provenance: ProvenanceSample;
}

const MIN_SAMPLES = 3;

/**
 * Mines own-action → need-delta correlations, overall and conditioned on
 * context: "Sleeping in shelter eases rest", "Eating (mushroomRed)
 * worsens safety". Negative deltas are relief (needs are pressure). The
 * world declares which context features exist, and in which order.
 */
export class OutcomeMiner implements ILearner {
  private readonly features: readonly ContextSchema[];

  constructor(
    world: WorldAdapter,
    private readonly provenance: ProvenanceLevel = 'compact',
  ) {
    this.features = world.context;
  }

  private cells = new Map<string, OutcomeCell>();
  private keyParts = new Map<
    string,
    { actionType: MemoryRecord['type']; feature: ContextFeatureKey | null; need: NeedKey }
  >();

  observe(memory: MemoryRecord): void {
    // First-hand experience teaches fully; WATCHING someone else (demonstration)
    // teaches at a discount — you didn't feel it, you inferred it. Testimony is
    // handled separately (KnowledgeStore), so it is ignored here.
    const weight = memory.origin === 'experience' ? 1 : memory.origin === 'observation' ? 0.4 : 0;
    if (weight === 0) return;
    for (const [need, delta] of Object.entries(memory.needDeltas) as [NeedKey, number][]) {
      if (delta === 0) continue;
      const conditions: (ContextFeatureKey | null)[] = [
        null,
        ...this.features.filter((f) => featureActive(memory.context, f)).map((f) => f.id),
      ];
      for (const feature of conditions) {
        const key = `${memory.type}:${feature ?? '*'}:${need}`;
        let cell = this.cells.get(key);
        if (!cell) {
          cell = { relieves: 0, worsens: 0, provenance: new ProvenanceSample(this.provenance) };
          this.cells.set(key, cell);
          this.keyParts.set(key, { actionType: memory.type, feature, need });
        }
        if (delta < 0) cell.relieves += weight;
        else cell.worsens += weight;
        cell.provenance.add(memory);
      }
    }
  }

  consolidate(): EvidenceReport[] {
    const reports: EvidenceReport[] = [];
    for (const [key, cell] of this.cells) {
      const total = cell.relieves + cell.worsens;
      if (total < MIN_SAMPLES) continue;
      const parts = this.keyParts.get(key)!;
      const relieving = cell.relieves >= cell.worsens;
      const majority = relieving ? cell.relieves : cell.worsens;
      reports.push({
        rule: {
          kind: 'outcome-association',
          actionType: parts.actionType,
          feature: parts.feature,
          need: parts.need,
          direction: relieving ? 'relieves' : 'worsens',
        },
        confidence: (majority + 1) / (total + 2),
        evidenceCount: majority,
        contradictionCount: total - majority,
        sourceMemoryIds: cell.provenance.ids(),
        provenance: cell.provenance.snapshots(),
      });
    }
    return reports;
  }
}
