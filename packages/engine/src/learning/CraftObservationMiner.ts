import type { WorldAdapter } from '../contract/adapter.js';
import type { ItemCounts, KindId } from '../contract/ids.js';
import type { MemoryRecord } from '../contract/types.js';
import type { EvidenceReport, ILearner, ProvenanceLevel } from './ILearner.js';
import { ProvenanceSample } from './ILearner.js';

interface RecipeTally {
  /** Weighted count of crafts seen: performing fully, watching at a discount. */
  seen: number;
  inputs: ItemCounts;
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
 *
 * WHICH events are a making is the world's `events[].demonstrates`, which also
 * names the parts of the memory that carry what was made and what went in. The
 * miner never asks what an event is called.
 */
export class CraftObservationMiner implements ILearner {
  constructor(
    private readonly world: WorldAdapter,
    private readonly provenance: ProvenanceLevel = 'compact',
  ) {}

  private recipes = new Map<KindId, RecipeTally>();

  observe(memory: MemoryRecord): void {
    const demonstrates = this.world.eventById.get(memory.type)?.demonstrates;
    if (!demonstrates) return;
    const output = memory[demonstrates.output];
    if (!output) return;
    const weight = memory.origin === 'experience' ? 1 : memory.origin === 'observation' ? OBSERVE_WEIGHT : 0;
    if (weight === 0) return; // testimony is not a craft-learning channel
    let t = this.recipes.get(output);
    if (!t) {
      t = { seen: 0, inputs: {}, provenance: new ProvenanceSample(this.provenance) };
      this.recipes.set(output, t);
    }
    t.seen += weight;
    // What the demonstration showed going in — COPIED, because one making
    // hands the same `inputs` object to every witness (and it is the world's own
    // recipe table), so keeping the reference would let every watcher's belief
    // share one object with the world's physics.
    const inputs = memory[demonstrates.inputs];
    if (inputs) t.inputs = { ...inputs };
    t.provenance.add(memory);
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
        provenance: t.provenance.snapshots(),
      });
    }
    return reports;
  }
}
