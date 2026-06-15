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
  /** Where the event happened — so a story can draw beings to, or away from, a place. */
  x: number;
  y: number;
  firstTick: number;
  /** True if this being witnessed it; false if it was only retold to them. */
  firsthand: boolean;
  /** How many times this being has heard/witnessed it — intrinsic salience. A tale
   * told to you again and again is the one your people tell most; the most-heard
   * story is what a being would call its people's best-known tale. */
  timesHeard: number;
  retellable: number; // ticks before it can be retold again (rate-limit per teller)
}

/**
 * The ESCALATION LADDER. Each step is a single believable exaggeration; applied
 * one rung at a time over many retellings, a humble event climbs into legend:
 *   raised a home → a great hall → founded a settlement → founded our people →
 *   was chosen by the spirits.
 * A slaying and a death have their own ladders. This is how, across generations,
 * "Karendo raised a home" becomes "Karendo was chosen by the spirits."
 */
const LADDER: [string, string][] = [
  // home → founder myth
  ['raised a home', 'raised a great hall'],
  ['raised a great hall', 'founded a settlement'],
  ['founded a settlement', 'founded our people'],
  ['founded our people', 'was chosen by the spirits to lead us'],
  // slaying → champion myth
  ['slew a bear', 'slew a great bear'],
  ['slew a wolf', 'slew a fierce wolf'],
  ['slew a crocodile', 'slew a monstrous crocodile'],
  ['slew a beast', 'slew a terrible beast'],
  ['slew a great bear', 'slew the dread beast of the wild'],
  ['slew a fierce wolf', 'slew the dread beast of the wild'],
  ['slew a monstrous crocodile', 'slew the dread beast of the wild'],
  ['slew a terrible beast', 'slew the dread beast of the wild'],
  ['slew the dread beast of the wild', 'was our champion against the wild'],
  ['was our champion against the wild', 'was sent by the spirits to shield us'],
  // death → legend of loss
  ['fell to violence', 'was lost to us'],
  ['was lost to us', 'was taken by the darkness'],
  // attack → villain myth
  ['attacked', 'turned on'],
  ['turned on', 'betrayed'],
];

/**
 * How a story changes in one retelling. Most retellings are faithful (a story
 * isn't noise); a minority lose a detail (the place is forgotten) or climb ONE
 * rung of the escalation ladder (the home becomes a great hall). Deterministic
 * in `h`. Because the teller passes their ALREADY-drifted text, distortion
 * ACCUMULATES — over hundreds of retellings across generations a memory becomes
 * a myth, and a myth becomes a legend.
 */
export function mutateNarrative(text: string, h: number): string {
  const r = h % 100;
  if (r < 75) return text; // faithfully retold
  if (r < 87) return text.replace(/ in the \w+$/, ''); // a detail is lost (the place)
  for (const [from, to] of LADDER) if (text.includes(from)) return text.replace(from, to); // one rung grander
  return text.includes('they say') ? text : `${text}, they say`;
}

export class NarrativeStore {
  private readonly stories = new Map<string, Narrative>();

  remember(id: string, text: string, x: number, y: number, tick: number, firsthand: boolean): void {
    const existing = this.stories.get(id);
    if (existing) {
      existing.timesHeard++; // heard again — it grows more familiar/told
      if (firsthand) existing.firsthand = true; // hearing then witnessing upgrades it
      return;
    }
    this.stories.set(id, { id, text, x, y, firstTick: tick, firsthand, timesHeard: 1, retellable: 0 });
  }

  /**
   * Seed a known tale directly — for CULTURAL SEEDING experiments: injecting a
   * shared myth into a people, as if it had long been told (so `timesHeard` sets
   * its familiarity). The seeded story is a cultural artifact the minds then
   * interpret; it carries no behavioural instruction.
   */
  seed(id: string, text: string, x: number, y: number, tick: number, timesHeard: number): void {
    this.stories.set(id, { id, text, x, y, firstTick: tick, firsthand: false, timesHeard, retellable: 0 });
  }

  has(id: string): boolean {
    return this.stories.has(id);
  }

  /** A story this being can pass on right now (not retold too recently). */
  pickToRetell(tick: number): Narrative | undefined {
    let best: Narrative | undefined;
    for (const n of this.stories.values()) {
      if (tick < n.retellable) continue;
      // Prefer the tale this being knows BEST — the one it has heard most — and
      // among equally-familiar ones, the oldest. The most-told story is the one a
      // people repeats most (rich-get-richer: a dominant cultural myth emerges, and
      // a deliberately-told myth can spread instead of being buried by its newness).
      if (!best || n.timesHeard > best.timesHeard || (n.timesHeard === best.timesHeard && n.firstTick < best.firstTick)) best = n;
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
