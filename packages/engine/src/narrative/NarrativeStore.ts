/**
 * Stories, as distinct from facts. The KnowledgeStore holds general rules ("food
 * is near rivers"); a narrative is a SPECIFIC remembered event about a specific
 * being in a specific place ("Karendo was slain by a bear in the eastern
 * forest"). Humans don't only pass facts — they pass stories, and shared stories
 * become a group's identity. Each narrative has a stable id so retellings of the
 * same event cluster, no matter who tells it.
 */
export interface Narrative {
  id: string;
  text: string;
  firstTick: number;
  /** True if this being witnessed it; false if it was only retold to them. */
  firsthand: boolean;
  retellable: number; // ticks before it can be retold again (rate-limit per teller)
}

export class NarrativeStore {
  private readonly stories = new Map<string, Narrative>();

  remember(id: string, text: string, tick: number, firsthand: boolean): void {
    const existing = this.stories.get(id);
    if (existing) {
      if (firsthand) existing.firsthand = true; // hearing then witnessing upgrades it
      return;
    }
    this.stories.set(id, { id, text, firstTick: tick, firsthand, retellable: 0 });
  }

  has(id: string): boolean {
    return this.stories.has(id);
  }

  /** A story this being can pass on right now (not retold too recently). */
  pickToRetell(tick: number): Narrative | undefined {
    let best: Narrative | undefined;
    for (const n of this.stories.values()) {
      if (tick < n.retellable) continue;
      // Prefer the oldest, most-established stories — the ones worth repeating.
      if (!best || n.firstTick < best.firstTick) best = n;
    }
    if (best) best.retellable = tick + 900;
    return best;
  }

  all(): Narrative[] {
    return [...this.stories.values()];
  }

  get size(): number {
    return this.stories.size;
  }
}
