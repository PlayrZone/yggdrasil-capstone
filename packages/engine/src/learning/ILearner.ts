import type { KnowledgeRule, MemoryRecord } from '../contract/types.js';

/**
 * What a miner asserts about one rule after looking at the evidence.
 * Confidence is computed by the miner (each family owns its math);
 * lifecycle/status is the KnowledgeStore's job.
 */
export interface EvidenceReport {
  rule: KnowledgeRule;
  confidence: number;
  evidenceCount: number;
  contradictionCount: number;
  sourceMemoryIds: number[];
}

/**
 * A learner observes memories as they form (streaming counters) and emits
 * evidence reports at consolidation. Deterministic: same memory sequence
 * in, same reports out — learners participate in replay. Learners discover;
 * they never decide (V2 separation).
 */
export interface ILearner {
  observe(memory: MemoryRecord): void;
  consolidate(): EvidenceReport[];
}

/** Keep a bounded, deterministic provenance sample: first 4 + latest 4. */
export class ProvenanceSample {
  private first: number[] = [];
  private last: number[] = [];

  add(memoryId: number): void {
    if (this.first.length < 4) this.first.push(memoryId);
    else {
      this.last.push(memoryId);
      if (this.last.length > 4) this.last.shift();
    }
  }

  ids(): number[] {
    return [...this.first, ...this.last];
  }
}
