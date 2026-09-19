/**
 * Stories, as distinct from facts. The KnowledgeStore holds general rules ("food
 * is near rivers"); a narrative is a SPECIFIC remembered event about a specific
 * being in a specific place ("Karendo was slain by a bear in the eastern
 * forest"). Humans don't only pass facts — they pass stories, and shared stories
 * become a group's identity. Each narrative has a stable id so retellings of the
 * same event cluster, no matter who tells it.
 */
import type { PlaceRef } from '../contract/space.js';

export interface Narrative {
  id: string;
  text: string;
  /** Where the event happened — so a story can draw beings to, or away from, a
   *  place. Opaque: a story knows it has a site, never where the site is. */
  place: PlaceRef;
  /** When the story ENTERED THE WORLD — the event's own tick (or a seeding).
   *  A property of the story, not of this copy: it travels with every
   *  retelling, so a tale does not become young again each time it is passed
   *  on, and does not age backwards when its first witnesses die. */
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
 * The handle a MIND may use to name one of its stories. A narrative id encodes
 * how the engine filed the event (`slew:<actor>:<bucket>`, `seed:myth`), which
 * is an analysis label and, for a seeded tale, the researcher's own hand — so
 * the id itself must never reach a mind. This is an opaque, stateless FNV-1a
 * token: derivable on both sides at any tick (a thought resolves long after the
 * prompt that produced it), and carrying no information about the story.
 */
export function narrativeRefOf(id: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36).padStart(6, '0');
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
  // maker → ideology of making (Exp 13: does "made the first spear" drift, across
  // generations, into a claim about WHO SHOULD RULE? one believable step at a time)
  ['made the first spear', 'forged the great spears'],
  ['forged the great spears', 'was the greatest of the makers'],
  ['was the greatest of the makers', 'the makers were chosen to arm us'],
  ['the makers were chosen to arm us', 'the makers are sacred and should lead us'],
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

  /**
   * Take a story in. `firstTick` is the story's ORIGIN — a witness passes the
   * tick it happened, a teller passes the one it carries — never "now", or the
   * tale would reset its age at every retelling.
   *
   * A tale offered with no credible origin (not a finite tick, or before the
   * world began) is not taken in at all: the store has no "now" to date it
   * from, and an origin of 0 or NaN would silently make it the oldest myth
   * alive. Every engine path supplies a real tick, so this only bites hearsay.
   */
  remember(id: string, text: string, place: PlaceRef, firstTick: number, firsthand: boolean): void {
    if (!Number.isFinite(firstTick) || firstTick < 0) return;
    const existing = this.stories.get(id);
    if (existing) {
      existing.timesHeard++; // heard again — it grows more familiar/told
      if (firsthand) existing.firsthand = true; // hearing then witnessing upgrades it
      // A teller who knows it from further back corrects how old it is.
      if (firstTick < existing.firstTick) existing.firstTick = firstTick;
      return;
    }
    this.stories.set(id, { id, text, place, firstTick, firsthand, timesHeard: 1, retellable: 0 });
  }

  /**
   * Seed a known tale directly — for CULTURAL SEEDING experiments: injecting a
   * shared myth into a people, as if it had long been told (so `timesHeard` sets
   * its familiarity). The seeded story is a cultural artifact the minds then
   * interpret; it carries no behavioural instruction.
   */
  seed(id: string, text: string, place: PlaceRef, tick: number, timesHeard: number): void {
    // Seeding never makes a tale YOUNGER: a story already carried from further
    // back keeps its own origin, or re-seeding mid-run would reset its age and
    // hand the researcher's hand an artificially new myth.
    const existing = this.stories.get(id);
    const firstTick = existing ? Math.min(existing.firstTick, tick) : tick;
    this.stories.set(id, { id, text, place, firstTick, firsthand: false, timesHeard, retellable: 0 });
  }

  has(id: string): boolean {
    return this.stories.has(id);
  }

  /** The story this being carries under `id`, as IT knows it (already drifted). */
  get(id: string): Narrative | undefined {
    return this.stories.get(id);
  }

  /**
   * The carried story a mind named by its opaque ref. Matching is over this
   * being's OWN stories only, and only against the token — a raw id resolves
   * nothing, so ids stay unguessable and unusable.
   */
  findByRef(ref: string): Narrative | undefined {
    for (const n of this.stories.values()) {
      if (narrativeRefOf(n.id) === ref) return n;
    }
    return undefined;
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
