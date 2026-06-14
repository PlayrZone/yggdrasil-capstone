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

// Believable embellishments — what a teller adds to make a tale grander.
const EMBELLISH: [string, string][] = [
  ['a bear', 'a great bear'],
  ['a wolf', 'a fierce wolf'],
  ['a crocodile', 'a monstrous crocodile'],
  ['a beast', 'a terrible beast'],
  ['slew', 'single-handedly slew'],
  ['raised a home', 'raised a great hall'],
  ['fell to violence', 'was struck down in battle'],
  ['attacked', 'turned on'],
];

/**
 * How a story changes in one retelling. Most retellings are faithful (a story
 * isn't noise); a minority lose a detail (the place is forgotten) or gain an
 * embellishment (the bear becomes a great bear). Deterministic in `h`, so a
 * given teller→listener pair always drifts the same way — but because the
 * teller's text already carries prior drift, distortion ACCUMULATES along a
 * chain of retellings. That accumulation is how a memory becomes a myth.
 */
export function mutateNarrative(text: string, h: number): string {
  const r = h % 100;
  if (r < 72) return text; // faithfully retold
  if (r < 86) return text.replace(/ in the \w+$/, ''); // a detail is lost (the place)
  for (const [from, to] of EMBELLISH) if (text.includes(from)) return text.replace(from, to); // embellished
  return text.includes('they say') ? text : `${text}, they say`;
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
