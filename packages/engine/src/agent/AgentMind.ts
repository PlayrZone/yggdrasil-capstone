import type {
  AgentSnapshot,
  Goal,
  MemoryRecord,
  MindOutput,
  ThinkInput,
  ThinkTrigger,
  WorldView,
} from '../contract/types.js';
import { MemoryStream } from '../memory/MemoryStream.js';
import type { ILearner } from '../learning/ILearner.js';
import { ContextMiner } from '../learning/ContextMiner.js';
import { SuccessionMiner } from '../learning/SuccessionMiner.js';
import { SocialMiner } from '../learning/SocialMiner.js';
import { OutcomeMiner } from '../learning/OutcomeMiner.js';
import { KnowledgeStore } from '../knowledge/KnowledgeStore.js';
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
}

/**
 * Everything subjective about one Gahallian, wired together: the memory
 * stream, the four miners, the knowledge base, the relationship scalars,
 * and a mind. The Body never sees inside this; this never mutates the
 * world. Hosts (the Y0 test harness, the Y1 desktop runner) own the
 * Body⇄AgentMind plumbing.
 */
export class AgentMind {
  readonly memory: MemoryStream;
  readonly knowledge = new KnowledgeStore();
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
    this.learners = [new ContextMiner(), new SuccessionMiner(), new SocialMiner(), new OutcomeMiner()];
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
    }
    // A story retold to you — you carry it now too (shared narrative → identity).
    if (stored.utterance?.speechAct === 'share-episode' && stored.utterance.narrativeId && stored.utterance.narrativeText) {
      // The LLM share path carries no location; reflex retelling (coPresencePass)
      // carries the real place. First write wins, so this only matters when an
      // LLM hears a story it has no other source for.
      this.narratives.remember(stored.utterance.narrativeId, stored.utterance.narrativeText, 0, 0, stored.tick, false);
    }
    if (stored.utterance?.speechAct === 'share-knowledge' && stored.utterance.rule && stored.toldBy) {
      const trust = (this.relationships.recordFor(stored.toldBy, stored.tick).trust ?? 50) / 100;
      this.knowledge.intakeTestimony(
        stored.utterance.rule,
        stored.utterance.ruleConfidence ?? 0.5,
        trust,
        stored.tick,
        stored.toldBy,
        stored.id,
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
    // Belief → behaviour: the place of the being's oldest founder/hero story is
    // a place it is drawn to; the places of tragedies it shuns.
    let sacredPlace: { x: number; y: number } | undefined;
    let oldest = Infinity;
    const tragedyPlaces: { x: number; y: number }[] = [];
    if (this.mythBehavior) {
      for (const n of this.narratives.all()) {
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
    return output;
  }

  /** Apply an externally-produced (e.g. LLM) decision back onto the agent. */
  applyOutput(output: MindOutput): void {
    this.goals = output.goals;
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
