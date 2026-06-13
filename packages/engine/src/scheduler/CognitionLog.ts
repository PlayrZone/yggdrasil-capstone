import type { CognitionRecord } from '../consciousness/LlmMind.js';

/**
 * The `cognition_log`: every mind call's full prompt + output. Simultaneously
 * the debugging record, the research record of every thought any Gahallian
 * had, and the Yggdrasil model's future training corpus. Bounded in memory;
 * the run DB (Y2-deferred) is the durable home.
 */
export class CognitionLog {
  private readonly records: CognitionRecord[] = [];
  private dropped = 0;

  constructor(private readonly cap = 2000) {}

  push = (record: CognitionRecord): void => {
    this.records.push(record);
    if (this.records.length > this.cap) {
      this.records.shift();
      this.dropped++;
    }
  };

  recent(n: number): CognitionRecord[] {
    return this.records.slice(-n);
  }

  latestFor(agentId: number): CognitionRecord | undefined {
    for (let i = this.records.length - 1; i >= 0; i--) {
      if (this.records[i]!.agentId === agentId) return this.records[i];
    }
    return undefined;
  }

  get count(): number {
    return this.records.length;
  }

  get droppedCount(): number {
    return this.dropped;
  }

  /** Validity rate across retained records — a quick model-health gauge. */
  validityRate(): number | null {
    if (this.records.length === 0) return null;
    const valid = this.records.filter((r) => r.valid).length;
    return valid / this.records.length;
  }
}
