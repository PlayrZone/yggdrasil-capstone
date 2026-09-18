import type {
  AgentSnapshot,
  Goal,
  KnowledgeRecord,
  KnowledgeRule,
  MemoryRecord,
  MindOutput,
  ThinkInput,
  ThinkTrigger,
  Utterance,
  WorldView,
} from '../contract/types.js';
import { MemoryStream } from '../memory/MemoryStream.js';
import type { ILearner, ProvenanceLevel } from '../learning/ILearner.js';
import { ruleKey } from '../learning/ruleKey.js';
import { ContextMiner } from '../learning/ContextMiner.js';
import { SuccessionMiner } from '../learning/SuccessionMiner.js';
import { SocialMiner } from '../learning/SocialMiner.js';
import { OutcomeMiner } from '../learning/OutcomeMiner.js';
import { CraftObservationMiner } from '../learning/CraftObservationMiner.js';
import { KnowledgeStore, copyRule } from '../knowledge/KnowledgeStore.js';
import type { RuleIntern } from '../knowledge/KnowledgeStore.js';
import { RelationshipStore } from '../relationships/RelationshipStore.js';
import { NarrativeStore } from '../narrative/NarrativeStore.js';
import type { IMind } from '../consciousness/IMind.js';
import { ReflexMind } from '../consciousness/ReflexMind.js';

export interface AgentMindOptions {
  /** Consciousness cadence in ticks; staggered per agent id. */
  thinkInterval?: number;
  /** Learning consolidation cadence in ticks; staggered per agent id. */
  consolidateInterval?: number;
  mind?: IMind;
  memoryHotCapacity?: number;
  /** When false, held stories do NOT steer movement (the A/B control). Default true. */
  mythBehavior?: boolean;
  /**
   * When true, watching another craft can teach the recipe (the apprenticeship
   * channel). The A/B control for Phase 3 Exp 1: off = a seeded maker still
   * crafts, but the skill cannot be learned by observation. Default false so
   * existing reflex worlds are unchanged.
   */
  craftLearning?: boolean;
  /**
   * How much evidence each belief keeps about itself. Instrumentation only —
   * no prompt, miner or decision reads it, and every level simulates
   * identically. Default 'compact'. See `ProvenanceLevel`.
   */
  provenance?: ProvenanceLevel;
}

/**
 * Everything subjective about one Gahallian, wired together: the memory
 * stream, the four miners, the knowledge base, the relationship scalars,
 * and a mind. The Body never sees inside this; this never mutates the
 * world. Hosts (the Y0 test harness, the Y1 desktop runner) own the
 * Body⇄AgentMind plumbing.
 *
 * AFTER DEATH this becomes a TOMBSTONE (see `entomb`). What it keeps is fixed
 * by who still reads a dead being:
 *  - `knowledge` — the diffusion analyzer clusters across the dead too; a
 *    belief whose discoverer is gone is how culture is detected at all
 *    (`analysis/diffusion.ts` originator/outlivedOriginator, `society()`,
 *    `Experiment.totalKnowledge`).
 *  - `relationships` — the lab's ties view reads any being's bonds.
 *  - `narratives`, `goals` — `Experiment.consciousState` reads any being's.
 *  - `memory.experienceCounts()` / `totalCount` — what it DID, for the
 *    archetype label `agentDetail` still shows for the dead.
 * Everything else is released, because nothing can read it again.
 */
export class AgentMind {
  readonly memory: MemoryStream;
  readonly knowledge: KnowledgeStore;
  readonly relationships = new RelationshipStore();
  readonly narratives = new NarrativeStore();
  readonly learners: ILearner[];
  goals: Goal[] = [];

  private readonly mind: IMind;
  private readonly thinkInterval: number;
  private readonly consolidateInterval: number;
  private readonly mythBehavior: boolean;

  constructor(
    readonly agentId: number,
    options: AgentMindOptions = {},
  ) {
    this.memory = new MemoryStream(options.memoryHotCapacity ?? 512);
    const provenance = options.provenance ?? 'compact';
    this.knowledge = new KnowledgeStore(provenance);
    this.learners = [
      new ContextMiner(provenance),
      new SuccessionMiner({ provenance }),
      new SocialMiner(provenance),
      new OutcomeMiner(provenance),
    ];
    if (options.craftLearning) this.learners.push(new CraftObservationMiner(provenance));
    this.mind = options.mind ?? new ReflexMind();
    this.thinkInterval = options.thinkInterval ?? 120;
    this.consolidateInterval = options.consolidateInterval ?? 300;
    this.mythBehavior = options.mythBehavior ?? true;
  }

  /**
   * Record an experience: memory write, miner counters, relationship
   * deltas, and — when the experience is hearing a share-knowledge
   * utterance — testimony intake, discounted by trust in the speaker.
   */
  observe(record: Omit<MemoryRecord, 'id'>): MemoryRecord {
    const stored = this.memory.append(record);
    for (const learner of this.learners) learner.observe(stored);
    if (stored.origin === 'experience') {
      // Scalars move on first-hand interaction only; watching others is
      // miner input (knowledge), not a relationship event.
      for (const partnerId of stored.subjects) {
        this.relationships.applyEvent(partnerId, stored.type, stored.tick);
      }
    } else if (stored.origin === 'observation' && stored.causedBy !== undefined) {
      // …with one explicit exception: watching someone DO a thing can mark you
      // about them (a killing). It marks you about the hand, never about who it
      // was done to, and the store names exactly which events qualify.
      this.relationships.applyObservedEvent(stored.causedBy, stored.type, stored.tick);
    }
    // A story retold to you — you carry it now too (shared narrative → identity).
    if (stored.utterance?.speechAct === 'share-episode' && stored.utterance.narrativeId && stored.utterance.narrativeText) {
      // The LLM share path carries no location; reflex retelling (coPresencePass)
      // carries the real place. First write wins, so this only matters when an
      // LLM hears a story it has no other source for. The age comes from the
      // teller's copy — a tale heard today may be generations old — but only
      // when that claim is a real tick; otherwise the tale is dated from the
      // moment it was heard rather than being refused by the store.
      const claimed = stored.utterance.narrativeFirstTick;
      const origin = claimed !== undefined && Number.isFinite(claimed) && claimed >= 0 ? claimed : stored.tick;
      this.narratives.remember(
        stored.utterance.narrativeId,
        stored.utterance.narrativeText,
        0,
        0,
        origin,
        false,
      );
    }
    if (stored.utterance?.speechAct === 'share-knowledge' && stored.utterance.rule && stored.toldBy) {
      const trust = (this.relationships.recordFor(stored.toldBy, stored.tick).trust ?? 50) / 100;
      this.knowledge.intakeTestimony(
        stored.utterance.rule,
        stored.utterance.ruleConfidence ?? 0.5,
        trust,
        stored.tick,
        stored.toldBy,
        stored,
      );
    }
    return stored;
  }

  shouldThink(tick: number): boolean {
    return (tick + this.agentId * 7) % this.thinkInterval === 0;
  }

  shouldConsolidate(tick: number): boolean {
    return (tick + this.agentId * 13) % this.consolidateInterval === 0;
  }

  /**
   * The being is dead. Release the two tiers only a thinking mind can use —
   * the episodic records (retrieved only by `think`) and the miners' working
   * counters (read only by `consolidate`) — leaving the tombstone above.
   *
   * `intern` collapses the tombstone's rule-derived strings onto shared
   * instances; omitted, the store is simply left as it is.
   *
   * Safe because nothing reaches a dead mind again: the tick loop skips it,
   * `PerceptionSystem.witnessesOf` returns only the living, and `injectIdea`
   * is gated on `alive`. `test/memory-bound.test.ts` holds that empirically.
   */
  entomb(intern?: RuleIntern): void {
    this.memory.release();
    this.learners.length = 0;
    // The beliefs stay, but stop each being a private copy of strings and a
    // rule object every other tombstone holding the belief already has.
    if (intern) this.knowledge.compact(intern);
  }

  /** Run every miner and fold the evidence into the knowledge base. */
  consolidate(tick: number): void {
    for (const learner of this.learners) {
      for (const report of learner.consolidate()) {
        this.knowledge.applyEvidence(report, tick);
      }
    }
    this.relationships.decay(tick);
  }

  /** Assemble the think input — shared by the reflex and LLM paths. */
  buildThinkInput(snapshot: AgentSnapshot, worldView: WorldView, trigger: ThinkTrigger): ThinkInput {
    // Belief → behaviour (Cycle 11): a being's sacred place is the oldest
    // founder/hero story it was TOLD but did not witness — a legend whose place
    // it knows only through the telling, NOT where it lives. This separates the
    // sacred from the dwelling: pilgrimage means travelling to a place you've
    // only heard of, which is the clean test of belief steering behaviour.
    // Tragedy places are likewise ones it only heard of. Selection uses intrinsic
    // story properties only (age, firsthand) — never an analysis label.
    let sacredPlace: { x: number; y: number } | undefined;
    let oldest = Infinity;
    const tragedyPlaces: { x: number; y: number }[] = [];
    if (this.mythBehavior) {
      for (const n of this.narratives.all()) {
        if (n.firsthand) continue; // a place you witnessed is not a place you make pilgrimage to
        const kind = n.id.slice(0, n.id.indexOf(':'));
        if (kind === 'home' || kind === 'slew') {
          if (n.firstTick < oldest) {
            oldest = n.firstTick;
            sacredPlace = { x: n.x, y: n.y };
          }
        } else if ((kind === 'fell' || kind === 'attack') && tragedyPlaces.length < 4) {
          tragedyPlaces.push({ x: n.x, y: n.y });
        }
      }
    }
    return {
      snapshot,
      recalledMemories: this.memory.retrieve({ tick: worldView.tick, limit: 24 }),
      knowledge: this.knowledge.held(),
      relationships: this.relationships.asMap(),
      worldView,
      goals: this.goals,
      trigger,
      ...(sacredPlace ? { sacredPlace } : {}),
      ...(tragedyPlaces.length ? { tragedyPlaces } : {}),
    };
  }

  think(snapshot: AgentSnapshot, worldView: WorldView, trigger: ThinkTrigger): MindOutput {
    const output = this.mind.think(this.buildThinkInput(snapshot, worldView, trigger));
    this.goals = output.goals;
    return { ...output, utterances: this.resolveSpeech(output.utterances) };
  }

  /**
   * Apply an externally-produced (e.g. LLM) decision back onto the agent, and
   * hand it back with its speech resolved — the host speaks the RETURNED
   * output, never the raw one.
   */
  applyOutput(output: MindOutput): MindOutput {
    this.goals = output.goals;
    return { ...output, utterances: this.resolveSpeech(output.utterances) };
  }

  /**
   * What leaves the mouth is only ever what this being holds. A mind may
   * CHOOSE what to pass on — by `ruleRef` (the knowledge id its prompt showed
   * it) or `narrativeRef` (a story it carries) — but the rule, the confidence
   * and the story's words are read out of this being's own stores here.
   * Nothing a model wrote is transmitted: an unresolvable (or invented)
   * reference simply leaves plain speech, and the utterance still goes out.
   * Every outgoing utterance is rebuilt field by field, so no payload can ride
   * along unchecked.
   */
  private resolveSpeech(utterances: Utterance[]): Utterance[] {
    return utterances.map((u) => {
      const spoken: Utterance = { speechAct: u.speechAct };
      if (u.targetId !== undefined) spoken.targetId = u.targetId;
      if (u.text !== undefined) spoken.text = u.text;
      if (u.speechAct === 'share-knowledge') {
        const record = this.heldRuleFor(u);
        if (record) {
          spoken.rule = copyRule(record.rule);
          spoken.ruleConfidence = record.confidence;
        }
      } else if (u.speechAct === 'share-episode') {
        // A mind names a story by its opaque ref; `narrativeId` is the raw-id
        // path for minds that already speak the engine's own handles (never
        // the parser, which cannot produce one).
        const story =
          u.narrativeRef !== undefined
            ? this.narratives.findByRef(u.narrativeRef)
            : u.narrativeId !== undefined
              ? this.narratives.get(u.narrativeId)
              : undefined;
        if (story) {
          spoken.narrativeId = story.id;
          spoken.narrativeText = story.text;
          spoken.narrativeFirstTick = story.firstTick;
        }
      }
      return spoken;
    });
  }

  /**
   * The held belief an utterance points at: named by id, or — for minds that
   * attach a rule directly (the reflex path, which reads its rules out of this
   * same store) — confirmed still held before it may be taught.
   */
  private heldRuleFor(u: Utterance): KnowledgeRecord | undefined {
    if (u.ruleRef !== undefined) return this.knowledge.held().find((k) => k.id === u.ruleRef);
    if (!u.rule) return undefined;
    const record = this.knowledge.get(ruleKey(u.rule));
    return record?.status === 'held' ? record : undefined;
  }

  /**
   * Inject an idea from OUTSIDE the world — the user "giving them an idea".
   * It lands as a high-salience thought memory (origin testimony, from the
   * world itself) that surfaces in the agent's next prompt; a conscious agent
   * MAY reason about it and act, or not. The engine never calls this — only
   * the user does. It carries no rule, so it is NOT folded into knowledge:
   * it is a prompt to think, not a fact to believe.
   */
  injectIdea(text: string, tick: number): void {
    this.memory.append({
      tick,
      type: 'UtteranceSpoken',
      subjects: [],
      context: { nearWater: false, night: false, inShelter: false, elevationBand: 0 },
      needDeltas: {},
      outcome: 'neutral',
      summaryText: `A thought came to you: "${text}"`,
      importance: 0.97,
      origin: 'testimony',
      toldBy: 0,
      utterance: { speechAct: 'inform', text },
    });
  }
}
