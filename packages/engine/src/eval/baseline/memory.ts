import type { WorldAdapter } from '../../contract/adapter.js';
import type { ThinkInput } from '../../contract/types.js';

/**
 * A GENERATIVE-AGENTS MEMORY — RETRIEVAL AND REFLECTION, NOT A WINDOW.
 *
 * Round 1's version admitted each episode ONCE, ever, into a twelve-line FIFO
 * that its own templated perception line refilled every think, and "reflected"
 * by keeping the four most FREQUENT lines — which the template always won. Park
 * et al.'s two mechanisms were both absent, so arm B was not a thinned baseline
 * but a removed one, and a win against it would have measured nothing. Both are
 * here now:
 *
 *   RETRIEVAL  every think scores the whole log by recency × importance ×
 *              relevance against the CURRENT situation and returns the top K.
 *              An old memory that fits what is happening now beats a recent one
 *              that does not — the thing a window can never do.
 *   REFLECTION a periodic summary over the TOP-SCORED observations, so what the
 *              agent "has been going through" is what mattered, not what was
 *              said most often.
 *
 * WHAT THIS FILE MAY READ IS THE EXPERIMENT. Arm B is the control, and a control
 * is worth exactly what it does not have. The absence is enforced here, by the
 * fields this file touches, rather than by a promise in a prompt:
 *
 *   read:  `snapshot` (needs, inventory, name), `worldView` (perception),
 *          `recalledMemories` (episodes), `goals`.
 *   never: `knowledge`, `stories`, `mostTold`, `social`, `kin`, `sacredPlace`,
 *          `tragedyPlaces` — the mined beliefs, the narrative store, the felt
 *          relationships and the places a story pulls a being toward. Those are
 *          Yggdrasil's, they are the independent variable, and
 *          `FIELDS_ARM_B_NEVER_READS` is walked by a test that asserts none of
 *          their contents reach the composed prompt.
 */

/** The fields a test walks to prove the control is still a control. */
export const FIELDS_ARM_B_NEVER_READS: readonly string[] = [
  'knowledge',
  'stories',
  'mostTold',
  'social',
  'kin',
  'sacredPlace',
  'tragedyPlaces',
];

/** One thing this agent noticed, filed at the think it noticed it. */
export interface BaselineObservation {
  readonly text: string;
  /** The think index it was observed at — the clock recency decays over. */
  readonly at: number;
  /** The world tick that think happened on, for anyone reading the log. */
  readonly tick: number;
  /** 0..1. An episode's own salience; a templated line sits at the floor. */
  readonly importance: number;
}

/** An observation with the three factors that ranked it, kept for inspection. */
export interface ScoredObservation extends BaselineObservation {
  readonly recency: number;
  readonly relevance: number;
  readonly score: number;
}

export interface RetrievalWeights {
  readonly recency: number;
  readonly importance: number;
  readonly relevance: number;
}

/**
 * Park et al. leave the three coefficients at 1 and so do we. The alternative —
 * tuning them until arm B looks the way we expect — would make the control a
 * thing we authored rather than a thing off the shelf.
 */
export const DEFAULT_RETRIEVAL_WEIGHTS: RetrievalWeights = Object.freeze({
  recency: 1,
  importance: 1,
  relevance: 1,
});

/**
 * Recency halves every this-many THINKS. Arm A's episodic store halves every
 * 2,000 ticks (`memory/MemoryStream.ts`) and a being in this world thinks about
 * every 105 ticks (`eval/README.md`'s pilot arithmetic), so 2000/105 ≈ 19. The
 * number is here, in thinks, because that is the clock arm B has; pinning it to
 * arm A's rate of LIVED time is what stops one arm being handed a longer memory
 * than the other by accident.
 */
export const RECENCY_HALF_LIFE_THINKS = 19;

/**
 * What a templated line is worth. The lowest salience this world declares for
 * anything that happens is 0.1 (`SawAgent`), so the agent's own framing sits at
 * the floor of what the world calls worth remembering — never above an episode
 * it actually lived.
 */
export const BOILERPLATE_IMPORTANCE = 0.1;

/** Retrieval's default K — arm A shows the top 8 of the 24 it retrieves. */
export const DEFAULT_RETRIEVE_K = 8;

/** The log bound. Generous on purpose: retrieval needs something to retrieve from. */
export const DEFAULT_LOG_SIZE = 200;

export interface BaselineMemoryOptions {
  /** Observations kept before the least-recently-seen is dropped. Default 200. */
  logSize?: number;
  /** How many observations retrieval returns. Default 8. */
  retrieveK?: number;
  /** Refresh the reflection every N thinks. Default 8. */
  summaryEvery?: number;
  /** Observations the local reflection keeps. Default 4. */
  summaryKeep?: number;
  /** Observations a model summariser is shown. Default 12. */
  summarySourceSize?: number;
  /** Thinks over which recency halves. Default 19. */
  recencyHalfLife?: number;
  /** The three coefficients. Default 1 / 1 / 1. */
  weights?: Partial<RetrievalWeights>;
}

interface LoggedObservation {
  text: string;
  at: number;
  tick: number;
  readonly importance: number;
  readonly tokens: ReadonlySet<string>;
  /** Insertion order. The last tie-break, so ranking never depends on sort stability. */
  readonly seq: number;
  /** A templated line describes NOW and is refreshed; an episode is filed once and ages. */
  readonly present: boolean;
}

export class BaselineMemory {
  private readonly log: LoggedObservation[] = [];
  private readonly filedEpisodes = new Set<number>();
  private summaryText = '';
  private thinks = 0;
  private summarizedAt = -1;
  private lastObservedTick: number | undefined;
  private seq = 0;

  private readonly logSize: number;
  private readonly retrieveK: number;
  private readonly summaryEvery: number;
  private readonly summaryKeep: number;
  private readonly summarySourceSize: number;
  private readonly halfLife: number;
  private readonly weights: RetrievalWeights;

  constructor(options: BaselineMemoryOptions = {}) {
    this.logSize = options.logSize ?? DEFAULT_LOG_SIZE;
    this.retrieveK = options.retrieveK ?? DEFAULT_RETRIEVE_K;
    this.summaryEvery = options.summaryEvery ?? 8;
    this.summaryKeep = options.summaryKeep ?? 4;
    this.summarySourceSize = options.summarySourceSize ?? 12;
    this.halfLife = options.recencyHalfLife ?? RECENCY_HALF_LIFE_THINKS;
    this.weights = { ...DEFAULT_RETRIEVAL_WEIGHTS, ...options.weights };
  }

  get thinkCount(): number {
    return this.thinks;
  }

  /**
   * Fold this moment into the log. Returns false when the moment has already
   * been folded in.
   *
   * ONE MOMENT PER TICK, because `LlmMind` retries a rejected reply by calling
   * the backend a SECOND time with the same situation. Round 1 observed per
   * call, so every retry wrote arm B's memory twice and advanced its retrieval
   * clock twice — a rejection changed what the agent remembered. A retry is the
   * same moment; the being did not live it again.
   */
  observe(input: ThinkInput, world: WorldAdapter): boolean {
    const tick = input.worldView.tick;
    if (this.lastObservedTick === tick) return false;
    this.lastObservedTick = tick;
    this.thinks++;
    for (const line of observationLines(input, world, this.filedEpisodes)) {
      this.file(line, tick);
    }
    this.evict();
    return true;
  }

  /** The log, oldest entry first. Arm-private; for tests and for a run manifest. */
  observations(): readonly BaselineObservation[] {
    return this.log.map((o) => ({ text: o.text, at: o.at, tick: o.tick, importance: o.importance }));
  }

  /**
   * The top K observations for THIS situation — the whole point of the file.
   * Pure: retrieval never writes, so a caller may score the same log against a
   * hypothetical situation without changing what the agent remembers.
   */
  retrieve(input: ThinkInput, world: WorldAdapter, k = this.retrieveK): readonly ScoredObservation[] {
    return this.rank(situationQuery(input, world)).slice(0, Math.max(0, k));
  }

  summary(): string {
    return this.summaryText;
  }

  /** Is it time to reflect? True at most once per cadence. */
  shouldSummarize(): boolean {
    return this.thinks - this.summarizedAt >= this.summaryEvery;
  }

  setSummary(text: string): void {
    this.summaryText = text.trim();
    this.summarizedAt = this.thinks;
  }

  /**
   * Reflection without a model: the observations that MATTERED, by the same
   * score retrieval uses. Round 1 ranked by how often a line had been written,
   * which is a ranking of the template rather than of the life. Deterministic,
   * so a mock arm B is as reproducible as arm A.
   */
  summarizeLocally(input: ThinkInput, world: WorldAdapter): void {
    const kept = this.rank(situationQuery(input, world)).slice(0, this.summaryKeep);
    this.setSummary(kept.map((o) => o.text).join('; '));
  }

  /** What a model summariser is asked to compress — the same ranking, deeper. */
  summarySource(input: ThinkInput, world: WorldAdapter): readonly string[] {
    return this.rank(situationQuery(input, world))
      .slice(0, this.summarySourceSize)
      .map((o) => o.text);
  }

  /**
   * Recency, importance and relevance — Park's three factors, combined as the
   * weighted SUM that paper uses.
   *
   * A sum rather than arm A's product because relevance here is token overlap,
   * which is legitimately 0 for most of the log: multiplied, a single 0 would
   * erase an important memory entirely and leave the ranking to decide ties
   * between zeros. Every factor is already in [0,1], so nothing is normalised
   * and no candidate's score depends on which other candidates were scored.
   *
   * Ties break by recency, then by insertion order — never by sort stability.
   */
  private rank(query: string): ScoredObservation[] {
    const wanted = contentTokens(query);
    const scored = this.log.map((o) => {
      const recency = Math.pow(0.5, Math.max(0, this.thinks - o.at) / this.halfLife);
      const relevance = jaccard(wanted, o.tokens);
      return {
        text: o.text,
        at: o.at,
        tick: o.tick,
        importance: o.importance,
        recency,
        relevance,
        score:
          this.weights.recency * recency +
          this.weights.importance * o.importance +
          this.weights.relevance * relevance,
        seq: o.seq,
      };
    });
    scored.sort((a, b) => b.score - a.score || b.at - a.at || a.seq - b.seq);
    return scored.map((s) => ({
      text: s.text,
      at: s.at,
      tick: s.tick,
      importance: s.importance,
      recency: s.recency,
      relevance: s.relevance,
      score: s.score,
    }));
  }

  /**
   * A templated line ("I see 1 berryBush") is the same observation, true again:
   * it is refreshed where it stands. Filing a hundred copies would push every
   * episode out of a bounded log and hand retrieval four copies of one
   * sentence, which is round 1's failure with extra steps. An EPISODE is a
   * thing that happened once — it is filed once, at the think it surfaced, and
   * it ages from there even though the retrieval that surfaced it keeps
   * offering it back.
   */
  private file(line: ObservationLine, tick: number): void {
    if (line.present) {
      const existing = this.log.find((o) => o.present && o.text === line.text);
      if (existing) {
        existing.at = this.thinks;
        existing.tick = tick;
        return;
      }
    }
    this.log.push({
      text: line.text,
      at: this.thinks,
      tick: line.tick ?? tick,
      importance: clamp01(line.importance),
      tokens: contentTokens(line.text),
      seq: this.seq++,
      present: line.present,
    });
  }

  /** Least recently observed goes first, so a line that is still true survives. */
  private evict(): void {
    while (this.log.length > this.logSize) {
      let worst = 0;
      for (let i = 1; i < this.log.length; i++) {
        const candidate = this.log[i];
        const incumbent = this.log[worst];
        if (!candidate || !incumbent) continue;
        if (candidate.at < incumbent.at || (candidate.at === incumbent.at && candidate.seq < incumbent.seq)) {
          worst = i;
        }
      }
      this.log.splice(worst, 1);
    }
  }
}

/**
 * WHAT IS HAPPENING NOW, as the words retrieval matches against: what it
 * perceives, what presses it, what it carries, what it is trying to do. Those
 * four and nothing else — every other field of a `ThinkInput` is either
 * Yggdrasil's (and forbidden here) or bookkeeping.
 */
export function situationQuery(input: ThinkInput, world: WorldAdapter): string {
  const parts: string[] = [];
  for (const resource of input.worldView.resources) parts.push(resource.kind);
  for (const structure of input.worldView.structures) parts.push(structure.kind);
  for (const drive of world.drives) {
    if ((input.snapshot.needs[drive.id] ?? 0) >= drive.pressingAt) parts.push(drive.id);
  }
  for (const [kind, count] of Object.entries(input.snapshot.inventory)) {
    if ((count ?? 0) > 0) parts.push(kind);
  }
  for (const goal of input.goals) parts.push(goal.description);
  return parts.join(' ');
}

interface ObservationLine {
  text: string;
  importance: number;
  /** True for a line that describes the present rather than something that happened. */
  present: boolean;
  /** An episode's own tick, which is not the tick it was recalled on. */
  tick?: number;
}

/**
 * One moment, as raw lines. Episodes come from `recalledMemories` with the
 * engine's own deterministic salience; the perception and drive lines are the
 * agent's framing of NOW and are worth the floor.
 */
function observationLines(input: ThinkInput, world: WorldAdapter, filed: Set<number>): ObservationLine[] {
  const lines: ObservationLine[] = [];
  for (const memory of input.recalledMemories) {
    if (filed.has(memory.id)) continue;
    filed.add(memory.id);
    lines.push({ text: memory.summaryText, importance: memory.importance, present: false, tick: memory.tick });
  }
  const sights: string[] = [];
  const counts = new Map<string, number>();
  for (const r of input.worldView.resources) counts.set(r.kind, (counts.get(r.kind) ?? 0) + 1);
  for (const s of input.worldView.structures) counts.set(s.kind, (counts.get(s.kind) ?? 0) + 1);
  for (const [kind, n] of counts) sights.push(`${n} ${kind}`);
  if (input.worldView.agents.length > 0) sights.push(`${input.worldView.agents.length} other people`);
  lines.push({
    text: sights.length > 0 ? `I see ${sights.join(', ')}.` : 'I see nothing of note.',
    importance: BOILERPLATE_IMPORTANCE,
    present: true,
  });
  const pressing = world.drives
    .filter((d) => (input.snapshot.needs[d.id] ?? 0) >= d.pressingAt)
    .map((d) => d.id);
  if (pressing.length > 0) {
    lines.push({ text: `I feel ${pressing.join(' and ')}.`, importance: BOILERPLATE_IMPORTANCE, present: true });
  }
  return lines;
}

// ─── Relevance ───────────────────────────────────────────────────────────────

/**
 * Words that carry no situation. Framing verbs ("see", "feel") and counting
 * words are deliberately in here: they appear in every templated line, so
 * keeping them would make every observation equally relevant to everything and
 * relevance would stop discriminating — the failure mode that lets a parrot
 * score well on a stem-overlap measure.
 */
const STOPWORDS = new Set<string>([
  'a', 'about', 'all', 'am', 'an', 'and', 'any', 'are', 'as', 'at', 'away',
  'be', 'been', 'both', 'but', 'by', 'came', 'can', 'could', 'did', 'do',
  'doe', 'down', 'each', 'else', 'feel', 'felt', 'few', 'for', 'found', 'from',
  'go', 'goe', 'got', 'ha', 'had', 'have', 'he', 'her', 'here', 'him', 'hi',
  'how', 'i', 'if', 'in', 'into', 'is', 'it', 'just', 'know', 'like', 'made',
  'make', 'man', 'many', 'me', 'more', 'most', 'much', 'my', 'near', 'nearby',
  'no', 'none', 'not', 'note', 'noth', 'nothing', 'now', 'of', 'on', 'one',
  'only', 'or', 'other', 'our', 'out', 'over', 'own', 'people', 'person', 'saw',
  'say', 'see', 'seen', 'she', 'should', 'so', 'some', 'someone', 'still',
  'such', 'than', 'that', 'the', 'their', 'them', 'then', 'there', 'these',
  'they', 'thi', 'thing', 'this', 'those', 'to', 'too', 'two', 'up', 'us',
  'very', 'wa', 'was', 'we', 'were', 'what', 'when', 'where', 'which', 'while',
  'who', 'will', 'with', 'would', 'you', 'your',
]);

/**
 * Enough stemming that a plural and its singular are the same token and no
 * more. A real stemmer is a dependency and a source of surprises; every rule
 * here is Porter's step 1a plus the English -es plural, and each one is pinned
 * by a test — `stones`/`stone` and `bushes`/`bush` must not fall apart, because
 * this world's kinds are exactly those words.
 */
function stem(word: string): string {
  if (word.length <= 3) return word;
  if (word.endsWith('ing') && word.length > 5) return word.slice(0, -3);
  if (word.endsWith('ed') && word.length > 4) return word.slice(0, -2);
  if (word.endsWith('sses')) return word.slice(0, -2);
  if (word.endsWith('ies') && word.length > 4) return `${word.slice(0, -3)}y`;
  if (word.endsWith('ss')) return word;
  if (/(?:s|x|z|ch|sh)es$/.test(word)) return word.slice(0, -2);
  if (word.endsWith('s')) return word.slice(0, -1);
  return word;
}

/**
 * A bag of stemmed content words. Kind ids in this engine are camelCase
 * compounds (`berryBush`), so they are split: a being that carries `berry` and
 * stands in front of a `berryBush` has a real overlap, and a token match that
 * could not see it would call the two unrelated.
 */
function contentTokens(text: string): ReadonlySet<string> {
  const out = new Set<string>();
  const split = text.replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2');
  for (const raw of split.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length === 0 || /^\d+$/.test(raw) || STOPWORDS.has(raw)) continue;
    const token = stem(raw);
    if (token.length === 0 || STOPWORDS.has(token)) continue;
    out.add(token);
  }
  return out;
}

function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared++;
  return shared / (a.size + b.size - shared);
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}
