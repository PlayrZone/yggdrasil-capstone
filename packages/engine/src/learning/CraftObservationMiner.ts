import type { MemoryRecord, ObjectKind } from '../contract/types.js';
import type { EvidenceReport, ILearner } from './ILearner.js';
import { ProvenanceSample } from './ILearner.js';

interface RecipeTally {
  /** Weighted count of crafts seen: performing fully, watching at a discount. */
  seen: number;
  inputs: Partial<Record<ObjectKind, number>>;
  provenance: ProvenanceSample;
}

// How many demonstrations it takes before the recipe is held depends on this
// plus the KnowledgeStore's HELD_MIN_EVIDENCE (4). Observation is discounted
// (you watched, you didn't do it), so learning a craft by WATCHING a master
// takes repeated viewings — the "spend years with the master" cost. Doing it
// yourself reinforces fully. This discount mirrors OutcomeMiner / memoryFromEvent
// (observed need-deltas ×0.5) — the engine's standing demonstration discount.
const OBSERVE_WEIGHT = 0.5;
const MIN_SAMPLES = 3;

/**
 * Mines "I have seen this made" into a craft-recipe rule — the demonstration
 * channel for a PRACTICE rather than a correlation. Watching a maker combine
 * materials into a tool, enough times, teaches the recipe; doing it yourself
 * teaches faster. Testimony is intentionally NOT a source: you cannot be told
 * a craft into your hands, you learn it by watching it done (apprenticeship,
 * not hearsay). This is what lets a skill — and a technology — be inherited.
 */
export class CraftObservationMiner implements ILearner {
  private recipes = new Map<ObjectKind, RecipeTally>();

  observe(memory: MemoryRecord): void {
    if (memory.type !== 'Crafted') return;
    const output = memory.objectKind;
    if (!output) return;
    const weight = memory.origin === 'experience' ? 1 : memory.origin === 'observation' ? OBSERVE_WEIGHT : 0;
    if (weight === 0) return; // testimony is not a craft-learning channel
    let t = this.recipes.get(output);
    if (!t) {
      t = { seen: 0, inputs: {}, provenance: new ProvenanceSample() };
      this.recipes.set(output, t);
    }
    t.seen += weight;
    if (memory.craftInputs) t.inputs = memory.craftInputs; // what the demonstration showed going in
    t.provenance.add(memory.id);
  }

  consolidate(): EvidenceReport[] {
    const reports: EvidenceReport[] = [];
    for (const [output, t] of this.recipes) {
      if (t.seen < MIN_SAMPLES) continue;
      const evidence = Math.round(t.seen);
      reports.push({
        rule: { kind: 'craft-recipe', output, inputs: t.inputs },
        // Deterministic, Laplace-smoothed; climbs with each demonstration and
        // never contradicts (a craft that succeeds is unambiguous).
        confidence: (evidence + 1) / (evidence + 2),
        evidenceCount: evidence,
        contradictionCount: 0,
        sourceMemoryIds: t.provenance.ids(),
      });
    }
    return reports;
  }
}
