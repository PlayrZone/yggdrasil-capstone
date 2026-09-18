import { World } from '../core/World.js';
import type { Entity } from '../core/Entity.js';
import type { GahallianBody } from '../body/GahallianBody.js';
import type { Structure } from '../body/PerceptionSystem.js';
import {
  PerceptionSystem,
  ResourceNodeSystem,
  SimEventBus,
  WorldRegularitiesSystem,
  WildlifeSystem,
  YggdrasilSystem,
  CRAFT_RECIPES,
  createResourceNode,
  createGahallianBody,
  spawnGahallians,
  TICKS_PER_DAY,
  TICKS_PER_SEASON,
  TICKS_PER_YEAR,
  seasonAt,
} from '../body/index.js';
import type { Animal } from '../body/index.js';
import type { ResourceNode } from '../body/index.js';
import { mulberry32, hashSeed } from '../body/prng.js';
import { AgentMind } from '../agent/AgentMind.js';
import { CognitionLog } from '../scheduler/CognitionLog.js';
import { CognitionScheduler } from '../scheduler/CognitionScheduler.js';
import { LlmMind } from '../consciousness/LlmMind.js';
import { classifyArchetype } from '../analysis/archetype.js';
import { analyzeDiffusion, analyzeBeliefAccuracy } from '../analysis/diffusion.js';
import { analyzeSociety } from '../analysis/society.js';
import type { SocietyReport } from '../analysis/society.js';
import { analyzeCulture } from '../analysis/culture.js';
import type { CultureReport } from '../analysis/culture.js';
import { analyzeMyth } from '../analysis/myth.js';
import type { MythReport } from '../analysis/myth.js';
import { analyzeSacredPlaces } from '../analysis/sacredPlaces.js';
import type { SacredPlacesReport } from '../analysis/sacredPlaces.js';
import { mutateNarrative } from '../narrative/NarrativeStore.js';
import { memoryFromEvent } from '../memory/memoryFromEvent.js';
import type { AgentKnowledge, BeliefCluster, BeliefAccuracy } from '../analysis/diffusion.js';
import type { ArchetypeResult, Archetype } from '../analysis/archetype.js';
import type { IMindBackend } from '../consciousness/IMindBackend.js';
import type { Intent, MindOutput, ObjectKind, ResourceNodeKind, SimEvent, Traits, ThinkInput, KnownStory, KinTie, KnownPerson, RelationshipRecord } from '../contract/types.js';
import { WORLD, elevationBand, regionAt, riverY, tributaryY, LAKE_CENTERS, isDeepWater, clampToWorld } from '../world/regions.js';
import type { Region } from '../world/regions.js';

export interface AgentInfo {
  id: number;
  name: string;
  alive: boolean;
  x: number;
  y: number;
  sleeping: boolean;
  sick: boolean;
  hungerCritical: boolean;
}

export interface ExperimentOptions {
  seed: string;
  agentCount?: number;
  mindBackend?: IMindBackend;
  /** A/B control for Cycle 10: when false, held stories don't steer movement. Default true. */
  mythBehavior?: boolean;
  /** A/B control for Cycle 13: when false, respect doesn't grow from witnessed
   * competence, so no prestige hierarchy can form. Default true. */
  leadership?: boolean;
  /** Phase 2 Exp 10: when false, the consciousness prompt does NOT offer "try
   * making" — so a seeded culture, not an engine incentive, must steer making.
   * Default true. */
  offerMaking?: boolean;
  /** Phase 3 Exp 1: when true, a being can LEARN a craft-recipe by watching it
   * done enough times (the apprenticeship channel). Off (default) = a seeded
   * maker still crafts, but the skill cannot spread by observation — the A/B
   * control isolating whether technological inheritance happens. */
  craftLearning?: boolean;
  /** Wall-clock source for cognition latency, supplied by the host. Purely
   * observational — nothing in the sim reads it, so it cannot affect
   * determinism. Tests inject a fake; omitted = the real clock. */
  now?: () => number;
}

const EVENT_LOG_CAP = 400;

// ── Generations ──────────────────────────────────────────────────────────────
const ADULT_AGE = TICKS_PER_SEASON; // ~4 days to mature
const REPRO_COOLDOWN = TICKS_PER_SEASON; // a season between births
const REPRO_INTERVAL = 300; // how often the population is checked for births
const REPRO_RANGE = 14; // two adults must be this close
const MAX_POP = 320; // population ceiling (perf + a carrying capacity)
const CO_PRESENCE_INTERVAL = 150; // how often time-spent-together builds bonds
const CO_PRESENCE_RANGE = 13; // how close counts as "together"

/**
 * Render a relationship as a FELT phrase a being would use — never a role label
 * ("mentor"/"leader"). Returns the most salient feeling + its strength (for
 * ranking which people to surface), or null for a neutral acquaintance.
 */
function relationshipFeeling(r: RelationshipRecord): { feeling: string; salience: number } | null {
  const cand: { feeling: string; salience: number }[] = [];
  if (r.fear >= 40) cand.push({ feeling: 'you are afraid of them', salience: r.fear });
  if (r.trust >= 58) cand.push({ feeling: r.trust >= 70 ? 'you trust them deeply' : 'you trust them', salience: r.trust - 50 });
  if (r.friendship >= 58) cand.push({ feeling: r.friendship >= 70 ? 'you are very close to them' : 'you are friendly with them', salience: r.friendship - 50 });
  if (r.respect >= 60) cand.push({ feeling: 'you look up to them', salience: r.respect - 50 });
  if (r.interactionCount >= 10) cand.push({ feeling: 'you have spent much time together', salience: Math.min(20, r.interactionCount) });
  if (cand.length === 0) return null;
  cand.sort((a, b) => b.salience - a.salience);
  return cand[0]!;
}

/** Gini coefficient of a non-negative distribution (0 = equal, →1 = concentrated). */
function giniOf(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  const sum = s.reduce((a, b) => a + b, 0);
  if (sum === 0) return 0;
  let cum = 0;
  for (let i = 0; i < n; i++) cum += (i + 1) * s[i]!;
  return (2 * cum) / (n * sum) - (n + 1) / n;
}

/** Cognition parameters derived from a being's personality (inherited by kids). */
function mindOptions(tr: Traits): { thinkInterval: number; consolidateInterval: number; memoryHotCapacity: number } {
  return {
    thinkInterval: Math.round(180 - tr.curiosity * 1.1), // 70 (curious) … 180 (incurious)
    consolidateInterval: Math.round(420 - (tr.curiosity * 0.6 + tr.ambition * 0.4) * 2.2),
    memoryHotCapacity: Math.round(256 + ((tr.curiosity + tr.ambition) / 2) * 5),
  };
}

/**
 * The headless experiment host: composes the Body (world physics + bodies)
 * with the Minds (memory · learning · knowledge · consciousness) in one
 * process and advances a fixed-timestep loop. This is the unit of research —
 * every run is reproducible from its seed and recordable to the research DB.
 *
 * The sim never blocks on the LLM: reflex keeps each agent acting the moment
 * its plan runs dry, and consciousness (when a backend is supplied) resolves
 * asynchronously through the scheduler and overrides reflex when it lands.
 */
export class Experiment {
  readonly seed: string;
  readonly world = new World();
  readonly bus = new SimEventBus();
  // Terrain elevation feeds the `highland` context feature so mountains read
  // differently from the river valley (ore-in-highlands becomes discoverable).
  readonly perception = new PerceptionSystem({ elevationBand });
  private readonly resources = new ResourceNodeSystem();
  private readonly regularities = new WorldRegularitiesSystem();
  private wildlife!: WildlifeSystem;
  private reproRng!: () => number;
  birthCount = 0;
  /** Kinship ledger (persisted — the event log is capped). Enables family detection. */
  readonly births: { child: number; parents: [number, number]; tick: number }[] = [];
  readonly body = new YggdrasilSystem(this.perception);
  readonly minds = new Map<number, AgentMind>();
  readonly agentIds: number[] = [];
  /** Phase 2: which beings are CONSCIOUS (LLM-driven). Empty = pure reflex world. */
  readonly conscious = new Set<number>();
  /** Phase 2: each conscious being's latest first-person thought (observed only). */
  readonly lastThought = new Map<number, string>();
  /** Cycle 10 A/B: do held stories steer movement? (pilgrimage + tragedy-avoidance) */
  private readonly mythBehavior: boolean;
  /** Cycle 13 A/B: does respect grow from witnessed competence? (prestige) */
  private readonly leadershipOn: boolean;
  /** Exp 10: does the prompt offer "try making"? When false, only culture can steer it. */
  private readonly offerMaking: boolean;
  /** Phase 3 Exp 1 A/B: can a craft-recipe be learned by watching it done? */
  private readonly craftLearning: boolean;
  /** Phase 3 Exp 1: per-agent count of crafts COMPLETED (actor of a Crafted event). */
  readonly craftsByAgent = new Map<number, number>();

  tick = 0;
  eventCount = 0;
  readonly eventLog: SimEvent[] = [];

  // Cumulative metrics (the event log is capped; these are not).
  readonly deathsByCause: Record<string, number> = {};
  exchangeCount = 0;
  conflictCount = 0;
  sicknessCount = 0;
  shareCount = 0;
  seedPlantCount = 0;
  sproutCount = 0;
  buildCount = 0;

  // Optional LLM consciousness. When absent, agents run pure reflex.
  private readonly llm: LlmMind | null;
  private readonly scheduler: CognitionScheduler | null;
  readonly cognitionLog: CognitionLog | null;
  readonly backendLabel: string;

  constructor(options: ExperimentOptions) {
    const { seed, agentCount = 100, mindBackend } = options;
    this.seed = seed;
    this.mythBehavior = options.mythBehavior ?? true;
    this.leadershipOn = options.leadership ?? true;
    this.offerMaking = options.offerMaking ?? true;
    this.craftLearning = options.craftLearning ?? false;
    if (mindBackend) {
      this.cognitionLog = new CognitionLog();
      this.llm = new LlmMind(mindBackend, {
        onCognition: this.cognitionLog.push,
        // Latency measures the MODEL, so it is wall-clock (LlmMind's default
        // when the host supplies none). Sim time is not a stopwatch; the tick
        // a thought belongs to rides in CognitionRecord.tick.
        ...(options.now ? { now: options.now } : {}),
      });
      this.scheduler = new CognitionScheduler({ maxConcurrent: 8 });
      this.backendLabel = mindBackend.modelId;
    } else {
      this.cognitionLog = null;
      this.llm = null;
      this.scheduler = null;
      this.backendLabel = 'reflex';
    }
    this.buildWorld(agentCount);

    this.bus.on((event) => {
      this.eventCount++;
      this.eventLog.push(event);
      if (this.eventLog.length > EVENT_LOG_CAP) this.eventLog.shift();
      this.tallyEvent(event);

      const story = this.storyFor(event);
      for (const witnessId of this.perception.witnessesOf(this.world, event)) {
        const mind = this.minds.get(witnessId);
        if (!mind) continue;
        const witness = this.world.getEntity(witnessId);
        if (!witness) continue;
        const t = witness.components['Transform2D'] as { x: number; y: number };
        const context = this.perception.contextAt(this.world, t.x, t.y, event.tick);
        const memory = memoryFromEvent(event, witnessId, context);
        if (memory) mind.observe(memory);
        // A memorable event becomes a STORY the witness carries.
        if (story) mind.narratives.remember(story.id, story.text, story.x, story.y, event.tick, true);
        // PRESTIGE (Cycle 13): seeing a being do something competent — slay a
        // predator, raise a shelter — earns it respect. Nothing assigns a leader;
        // respect simply accrues to the visibly capable, and (via the social pull)
        // others come to orbit them. Respect decays, so prestige must be re-earned.
        if (this.leadershipOn && witnessId !== event.actorId) {
          if (event.type === 'KilledPredator') mind.relationships.gainRespect(event.actorId, 5, event.tick);
          else if (event.type === 'BuiltStructure' && event.payload['buildKind'] === 'shelter') mind.relationships.gainRespect(event.actorId, 3, event.tick);
        }
      }
      if (story) this.minds.get(event.actorId)?.narratives.remember(story.id, story.text, story.x, story.y, event.tick, true);
    });
  }

  /**
   * Turn a memorable event into a STORY (or null). Only dramatic, relatively
   * rare events become narratives — a slaying, a violent death, the raising of
   * a home — the things a people would actually retell. Keyed so every witness
   * of the same event remembers the same story.
   */
  private storyFor(event: SimEvent): { id: string; text: string; x: number; y: number } | null {
    const bucket = Math.floor(event.tick / 300);
    const region = regionAt(event.x, event.y);
    const who = this.nameOf(event.actorId);
    const at = { x: event.x, y: event.y };
    switch (event.type) {
      case 'KilledPredator':
        return { id: `slew:${event.actorId}:${bucket}`, text: `${who} slew a ${event.payload['predator'] ?? 'beast'} in the ${region}`, ...at };
      case 'AgentDied': {
        const cause = String(event.payload['cause'] ?? '');
        if (cause !== 'violence') return null; // only a dramatic death is a story
        return { id: `fell:${event.actorId}:${bucket}`, text: `${who} fell to violence in the ${region}`, ...at };
      }
      case 'BuiltStructure':
        if (event.payload['buildKind'] !== 'shelter') return null;
        return { id: `home:${event.actorId}:${bucket}`, text: `${who} raised a home in the ${region}`, ...at };
      case 'AttackedAgent': {
        const victim = this.nameOf(event.targetIds[0] ?? 0);
        return { id: `attack:${event.actorId}:${bucket}`, text: `${who} attacked ${victim} in the ${region}`, ...at };
      }
      default:
        return null;
    }
  }

  private tallyEvent(event: SimEvent): void {
    switch (event.type) {
      case 'AgentDied': {
        const cause = (event.payload['cause'] as string | undefined) ?? 'unknown';
        this.deathsByCause[cause] = (this.deathsByCause[cause] ?? 0) + 1;
        break;
      }
      case 'GaveItem':
        this.exchangeCount++;
        break;
      case 'AttackedAgent':
        this.conflictCount++;
        break;
      case 'BecameSick':
        this.sicknessCount++;
        break;
      case 'SeedDeposited':
        this.seedPlantCount++;
        break;
      case 'PlantSprouted':
        this.sproutCount++;
        break;
      case 'BuiltStructure':
        this.buildCount++;
        break;
      case 'Crafted':
        this.craftsByAgent.set(event.actorId, (this.craftsByAgent.get(event.actorId) ?? 0) + 1);
        break;
      case 'UtteranceSpoken': {
        const u = event.payload['utterance'] as { speechAct?: string } | undefined;
        if (u?.speechAct === 'share-knowledge') this.shareCount++;
        break;
      }
      default:
        break;
    }
  }

  /**
   * A deliberately UNEQUAL continent (yggdrasil_world_design.md). Resources
   * are keyed to geography: a food-rich river valley, ore-rich/food-poor
   * mountains, wood-rich forests with poison-plant danger, a salt coast,
   * sparse plains. The inequality is the point — it's what can drive trade,
   * migration, competition, and exploration. Nothing is labelled or social.
   */
  private buildWorld(agentCount: number): void {
    const rng = mulberry32(hashSeed(`${this.seed}:world`));
    const place = (kind: ResourceNodeKind, x: number, y: number, stock: number): void => {
      this.world.createEntity({ Transform2D: { x, y }, ResourceNode: createResourceNode(kind, stock) });
    };
    // Rejection-sample `count` nodes of `kind` inside a given region.
    const scatter = (kind: ResourceNodeKind, region: Region, count: number, stock: number): void => {
      let placed = 0;
      for (let attempts = 0; placed < count && attempts < count * 90; attempts++) {
        const x = 8 + rng() * (WORLD - 16);
        const y = 8 + rng() * (WORLD - 16);
        if (regionAt(x, y) !== region) continue;
        place(kind, x, y, stock);
        placed++;
      }
    };

    // Great river + tributary — drinking water along the lines + abundant food
    // banks (the continent's breadbasket; supports dense populations).
    for (let x = WORLD * 0.06; x <= WORLD * 0.84; x += 30) place('river', x, riverY(x), 9999);
    for (let x = WORLD * 0.36; x <= WORLD * 0.82; x += 34) place('river', x, tributaryY(x), 9999);
    scatter('berryBush', 'river', 150, 18);
    scatter('tuberPlant', 'river', 120, 18);
    scatter('clayDeposit', 'river', 36, 20);
    scatter('fiberPlant', 'river', 26, 10);

    // Lakes — freshwater drawn from the SHORE (the centre is impassable water),
    // plus fertile shores.
    for (const [cx, cy, r] of LAKE_CENTERS) {
      place('waterSource', cx + r + 10, cy, 9999);
      place('waterSource', cx - r - 10, cy, 9999);
      place('waterSource', cx, cy + r + 10, 9999);
      place('waterSource', cx, cy - r - 10, 9999);
    }
    scatter('berryBush', 'lake', 34, 16);
    scatter('tuberPlant', 'lake', 26, 16);
    scatter('fiberPlant', 'lake', 22, 10);

    // Wetlands — reeds (fiber), clay, tubers, standing water.
    scatter('waterSource', 'wetland', 18, 9999);
    scatter('fiberPlant', 'wetland', 56, 12);
    scatter('clayDeposit', 'wetland', 34, 18);
    scatter('tuberPlant', 'wetland', 30, 12);

    // Coast — sea water reachable from the beach (not out in the deep) + salt.
    for (let y = 20; y < WORLD - 20; y += 40) place('waterSource', WORLD * 0.05, y, 9999);
    scatter('saltFlat', 'coast', 30, 14);
    scatter('fiberPlant', 'coast', 26, 10);
    scatter('berryBush', 'coast', 18, 12);

    // Forests — wood-rich, decent food, and poison-plant danger.
    scatter('tree', 'forest', 240, 10);
    scatter('berryBush', 'forest', 90, 14);
    scatter('tuberPlant', 'forest', 56, 14);
    scatter('nightshadePlant', 'forest', 36, 6);
    scatter('mushroomPatch', 'forest', 28, 8);
    scatter('fiberPlant', 'forest', 28, 10);

    // Mountains — resource-rich, FOOD-POOR (no food placed here on purpose).
    scatter('stoneDeposit', 'mountain', 60, 14);
    scatter('copperVein', 'mountain', 42, 10);
    scatter('ironVein', 'mountain', 34, 10);
    scatter('coalSeam', 'mountain', 34, 12);
    scatter('tinVein', 'mountain', 26, 8);
    scatter('gemVein', 'mountain', 18, 4);
    scatter('silverVein', 'mountain', 14, 4);
    scatter('goldVein', 'mountain', 7, 3);

    // Hills — stone + clay, a little wood.
    scatter('stoneDeposit', 'hills', 46, 12);
    scatter('clayDeposit', 'hills', 28, 16);
    scatter('tree', 'hills', 28, 8);

    // Plains — modest forage so the open ground isn't a death zone.
    scatter('berryBush', 'plains', 100, 10);
    scatter('tuberPlant', 'plains', 70, 10);
    scatter('fiberPlant', 'plains', 46, 8);
    scatter('mushroomPatch', 'plains', 28, 8);

    // Spawn in a generous CENTRAL band — dense enough that groups meet and
    // knowledge spreads, with the whole continent around them to migrate into.
    const agents = spawnGahallians(
      this.world,
      agentCount,
      this.seed,
      { x: WORLD * 0.14, y: WORLD * 0.2, width: WORLD * 0.5, height: WORLD * 0.6 },
      -ADULT_AGE, // the founders are already adults (able to reproduce)
      isDeepWater, // never born in the sea or a lake
    );
    // Cognition VARIES by personality, so no two minds are equal: the curious
    // think and act more often, the curious+ambitious learn faster and remember
    // more. Nothing assigns a role — but these differences let some become
    // knowledge-rich innovators/teachers while others stay foragers. Children
    // INHERIT these tendencies (blended from parents), so cognitive lineages
    // can form.
    for (const agent of agents) {
      this.agentIds.push(agent.id);
      const tr = (agent.components['GahallianBody'] as GahallianBody).traits;
      this.minds.set(
        agent.id,
        new AgentMind(agent.id, { ...mindOptions(tr), mythBehavior: this.mythBehavior, craftLearning: this.craftLearning }),
      );
    }
    this.reproRng = mulberry32(hashSeed(`${this.seed}:repro`));

    // Wild animals roam the lowlands — mobile food, and a reason to range.
    this.wildlife = new WildlifeSystem(this.seed, Math.max(40, Math.round(agentCount * 0.6)));
  }

  /** Advance the fixed-timestep loop by N ticks. */
  advance(ticks: number): void {
    for (let i = 0; i < ticks; i++) {
      const tick = this.tick++;
      // Positions written from outside the body (a host relocating a being
      // between ticks) are re-homed here, before anything queries the world.
      this.world.spatial.reconcile();
      this.resources.step(this.world, tick);
      this.wildlife.step(this.world, tick, this.bus);
      this.regularities.step(this.world, tick, this.bus);
      this.body.step(this.world, tick, this.bus);
      if (tick % CO_PRESENCE_INTERVAL === 0 && tick > 0) this.coPresencePass(tick);
      if (tick % REPRO_INTERVAL === 0 && tick > 0) this.reproduce(tick);

      for (const [agentId, mind] of this.minds) {
        const entity = this.world.getEntity(agentId);
        const body = entity?.components['GahallianBody'] as GahallianBody | undefined;
        if (!entity || !body?.alive) continue;

        if (mind.shouldConsolidate(tick)) mind.consolidate(tick);

        // Reflex keeps the agent acting the moment its plan runs dry —
        // it never waits on the (slow, async) LLM.
        if (body.planDone) {
          const snapshot = this.perception.snapshotFor(this.world, entity, tick);
          const view = this.perception.worldViewFor(this.world, entity, tick);
          this.applyPlan(agentId, mind.think(snapshot, view, 'planCompleted'));
        }

        // On the think cadence, consult consciousness asynchronously; when it
        // resolves, its plan overrides whatever reflex was doing. Phase 2: only
        // CONSCIOUS beings (born into the existing culture) consult the LLM —
        // the rest of the civilization runs on reflex. Without an LLM backend or
        // an empty conscious set this branch is inert (pure-reflex world).
        if (this.llm && this.scheduler && this.conscious.has(agentId) && mind.shouldThink(tick) && !this.scheduler.isPending(agentId)) {
          const snapshot = this.perception.snapshotFor(this.world, entity, tick);
          const view = this.perception.worldViewFor(this.world, entity, tick);
          const thinkInput = this.enrichCulture(mind.buildThinkInput(snapshot, view, 'periodic'), agentId, mind);
          this.scheduler.submit(
            agentId,
            () => this.llm!.complete(thinkInput),
            (output) => {
              const live = this.agentBody(agentId);
              if (!live?.alive) return; // died while thinking
              // A conscious Gahallian may name itself, once, while still unnamed.
              if (output.name && live.name === '') live.name = output.name;
              // Its thought is OBSERVED ONLY — surfaced, never read back into state.
              if (output.thought) this.lastThought.set(agentId, output.thought);
              // What it SAYS is resolved against its own stores first, so a
              // conscious being can teach and retell — but only what it holds.
              this.applyPlan(agentId, mind.applyOutput(output));
            },
          );
        }
      }
    }
  }

  private applyPlan(agentId: number, output: MindOutput): void {
    const body = this.agentBody(agentId);
    if (!body) return;
    const plan: Intent[] = [
      ...output.utterances.map((utterance) => ({ kind: 'Speak' as const, utterance })),
      ...output.plan,
    ];
    this.body.setPlan(body, plan);
  }

  /**
   * Generations: well-fed adults who are together may have a child — born
   * unnamed, age 0, with traits BLENDED from its parents (+ mutation) and a
   * mind whose cognition is derived from those inherited traits, so lineages of
   * the curious or the cautious can form. Nothing assigns family; birth is
   * simply possible when conditions are met. Born among knowledgeable elders, a
   * child learns by observation + testimony (existing channels) — the vertical
   * transmission civilization needs.
   */
  /** Bonds form from time spent together — preferred individuals, then clusters. */
  private coPresencePass(tick: number): void {
    const live: { id: number; mind: AgentMind; x: number; y: number }[] = [];
    for (const id of this.agentIds) {
      const mind = this.minds.get(id);
      if (!mind || !this.agentBody(id)?.alive) continue;
      const t = this.agentEntity(id)!.components['Transform2D'] as { x: number; y: number };
      live.push({ id, mind, x: t.x, y: t.y });
    }
    // `live` is ascending by id (agentIds is), so taking each being's living
    // neighbours ascending and keeping only the ones after it visits exactly
    // the pairs — in exactly the order — the old O(n²) double loop did.
    const byId = new Map(live.map((l) => [l.id, l]));
    for (const a of live) {
      for (const near of this.world.spatial.within('GahallianBody', a.x, a.y, CO_PRESENCE_RANGE)) {
        if (near.id <= a.id) continue;
        const b = byId.get(near.id);
        if (!b) continue;
        a.mind.relationships.coPresence(b.id, tick);
        b.mind.relationships.coPresence(a.id, tick);
        // Companions retell their stories — and a retelling can DISTORT
        // (a detail lost, a beast made greater). Drift accumulates along the
        // chain, so a memory drifts toward myth, and different tribes end up
        // telling different versions of the same event.
        // The retelling carries the story's own age (sa.firstTick), not the
        // hour it was told — an old tale stays old in a new mouth.
        if ((tick + a.id + b.id) % 3 === 0) {
          const sa = a.mind.narratives.pickToRetell(tick);
          if (sa) b.mind.narratives.remember(sa.id, mutateNarrative(sa.text, (b.id * 31 + sa.text.length) >>> 0), sa.x, sa.y, sa.firstTick, false);
          const sb = b.mind.narratives.pickToRetell(tick);
          if (sb) a.mind.narratives.remember(sb.id, mutateNarrative(sb.text, (a.id * 31 + sb.text.length) >>> 0), sb.x, sb.y, sb.firstTick, false);
        }
      }
    }
  }

  private reproduce(tick: number): void {
    if (this.aliveCount() >= MAX_POP) return;
    const eligible: { id: number; body: GahallianBody; x: number; y: number }[] = [];
    for (const id of this.agentIds) {
      const body = this.agentBody(id);
      if (!body?.alive) continue;
      if (tick - body.birthTick < ADULT_AGE) continue; // must be an adult
      if (tick < body.reproCooldownUntil) continue; // not too soon after a birth
      if (body.needs.hunger > 45 || body.health < 65) continue; // well-fed + healthy
      const t = this.agentEntity(id)!.components['Transform2D'] as { x: number; y: number };
      eligible.push({ id, body, x: t.x, y: t.y });
    }
    // Same pairing as the old O(n²) double loop: each candidate against the
    // eligible ones after it, ascending by id — so the reproduction RNG is
    // consumed in the same order, for the same pairs.
    const eligibleById = new Map(eligible.map((e) => [e.id, e]));
    const used = new Set<number>();
    for (const A of eligible) {
      if (used.has(A.id)) continue;
      for (const near of this.world.spatial.within('GahallianBody', A.x, A.y, REPRO_RANGE)) {
        if (near.id <= A.id) continue;
        const B = eligibleById.get(near.id);
        if (!B || used.has(B.id)) continue;
        if (this.reproRng() > 0.5) continue; // togetherness doesn't always make a child
        this.bearChild(A, B, tick);
        used.add(A.id);
        used.add(B.id);
        if (this.aliveCount() >= MAX_POP) return;
        break;
      }
    }
  }

  private bearChild(
    a: { id: number; body: GahallianBody; x: number; y: number },
    b: { id: number; body: GahallianBody; x: number; y: number },
    tick: number,
  ): void {
    const blend = (k: keyof Traits): number => {
      const base = (a.body.traits[k] + b.body.traits[k]) / 2;
      return Math.max(0, Math.min(100, Math.round(base + (this.reproRng() - 0.5) * 16))); // ±8 mutation
    };
    const traits: Traits = {
      curiosity: blend('curiosity'),
      aggression: blend('aggression'),
      compassion: blend('compassion'),
      ambition: blend('ambition'),
      loyalty: blend('loyalty'),
      riskTolerance: blend('riskTolerance'),
    };
    const pos = { x: (a.x + b.x) / 2 + (this.reproRng() - 0.5) * 6, y: (a.y + b.y) / 2 + (this.reproRng() - 0.5) * 6 };
    clampToWorld(pos);
    if (isDeepWater(pos.x, pos.y)) {
      pos.x = a.x;
      pos.y = a.y;
    }
    const child = this.world.createEntity({
      Transform2D: { x: pos.x, y: pos.y },
      GahallianBody: createGahallianBody('', traits, tick), // unnamed, age 0
    });
    this.agentIds.push(child.id);
    this.minds.set(
      child.id,
      new AgentMind(child.id, { ...mindOptions(traits), mythBehavior: this.mythBehavior, craftLearning: this.craftLearning }),
    );
    this.birthCount++;
    this.births.push({ child: child.id, parents: [a.id, b.id], tick });
    a.body.reproCooldownUntil = tick + REPRO_COOLDOWN;
    b.body.reproCooldownUntil = tick + REPRO_COOLDOWN;
    this.bus.emit({ tick, type: 'ChildBorn', actorId: child.id, targetIds: [a.id, b.id], x: pos.x, y: pos.y, payload: { parents: [a.id, b.id] } });
  }

  cognitionPending(): number {
    return this.scheduler?.activeCount ?? 0;
  }

  agentEntity(id: number): Entity | undefined {
    return this.world.getEntity(id);
  }

  agentBody(id: number): GahallianBody | undefined {
    return this.agentEntity(id)?.components['GahallianBody'] as GahallianBody | undefined;
  }

  /** Lightweight per-frame info for a viewport's instance sync. */
  agentInfos(): AgentInfo[] {
    const infos: AgentInfo[] = [];
    for (const id of this.agentIds) {
      const entity = this.world.getEntity(id);
      if (!entity) continue;
      const body = entity.components['GahallianBody'] as GahallianBody;
      const t = entity.components['Transform2D'] as { x: number; y: number };
      infos.push({
        id,
        name: body.name,
        alive: body.alive,
        x: t.x,
        y: t.y,
        sleeping: body.sleepingUntil > this.tick,
        sick: body.sickUntil > this.tick,
        hungerCritical: body.needs.hunger >= 85,
      });
    }
    return infos;
  }

  aliveCount(): number {
    let alive = 0;
    for (const id of this.agentIds) {
      const body = this.agentBody(id);
      if (body?.alive) alive++;
    }
    return alive;
  }

  day(): number {
    return Math.floor(this.tick / TICKS_PER_DAY) + 1;
  }

  /** Year of the sim, 1-based — the unit cultural phenomena actually live at. */
  year(): number {
    return Math.floor(this.tick / TICKS_PER_YEAR) + 1;
  }

  /** Current season name (winter is the real challenge). */
  season(): string {
    return seasonAt(this.tick);
  }

  /** Fractional years elapsed — for year-scale checkpoints and reporting. */
  yearsElapsed(): number {
    return this.tick / TICKS_PER_YEAR;
  }

  recentEvents(limit: number): SimEvent[] {
    return this.eventLog.slice(-limit);
  }

  nameOf(agentId: number): string {
    const body = this.agentBody(agentId);
    if (!body) return agentId === 0 ? 'world' : `#${agentId}`;
    return body.name && body.name.length ? body.name : `Gahallian #${agentId}`;
  }

  /** Wild animals currently roaming (moving — read every frame). */
  animals(): { id: number; x: number; y: number; kind: string }[] {
    const out: { id: number; x: number; y: number; kind: string }[] = [];
    this.world.spatial.each('Animal', (e) => {
      const a = e.components['Animal'] as Animal;
      const t = e.components['Transform2D'] as { x: number; y: number } | undefined;
      if (t) out.push({ id: e.id, x: t.x, y: t.y, kind: a.kind });
    });
    return out;
  }

  /** Static resource nodes (food, water, ore, …) for the world view (read once). */
  resourceNodes(): { id: number; x: number; y: number; kind: string }[] {
    const out: { id: number; x: number; y: number; kind: string }[] = [];
    this.world.spatial.each('ResourceNode', (e) => {
      if (e.components['Animal']) return; // animals are rendered separately
      const n = e.components['ResourceNode'] as ResourceNode;
      const t = e.components['Transform2D'] as { x: number; y: number } | undefined;
      if (t) out.push({ id: e.id, x: t.x, y: t.y, kind: n.kind });
    });
    return out;
  }

  /** Structures the Gahallians have built (shelters, walls, containers, drops). */
  structures(): { id: number; x: number; y: number; kind: string; builtBy: number }[] {
    const out: { id: number; x: number; y: number; kind: string; builtBy: number }[] = [];
    this.world.spatial.each('Structure', (e) => {
      const s = e.components['Structure'] as Structure;
      const t = e.components['Transform2D'] as { x: number; y: number } | undefined;
      if (t) out.push({ id: e.id, x: t.x, y: t.y, kind: s.kind, builtBy: s.builtBy });
    });
    return out;
  }

  /** Full inspector view of one agent (click-to-select in the lab). */
  agentDetail(id: number): {
    id: number;
    name: string;
    alive: boolean;
    x: number;
    y: number;
    region: Region;
    archetype: Archetype | null;
    needs: Record<string, number>;
    traits: Record<string, number>;
    inventory: Record<string, number>;
    knowledge: { statement: string; confidence: number; status: string }[];
  } | null {
    const entity = this.world.getEntity(id);
    const body = entity?.components['GahallianBody'] as GahallianBody | undefined;
    if (!entity || !body) return null;
    const t = entity.components['Transform2D'] as { x: number; y: number };
    const mind = this.minds.get(id);
    const arche = this.archetypeOf(id);
    return {
      id,
      name: this.nameOf(id),
      alive: body.alive,
      x: t.x,
      y: t.y,
      region: regionAt(t.x, t.y),
      archetype: arche && arche.sampleSize > 0 ? arche.archetype : null,
      needs: { ...body.needs } as Record<string, number>,
      traits: { ...body.traits } as Record<string, number>,
      inventory: { ...body.inventory } as Record<string, number>,
      knowledge: mind
        ? mind.knowledge.held().slice(0, 30).map((k) => ({ statement: k.statement, confidence: k.confidence, status: k.status }))
        : [],
    };
  }

  /**
   * The INFLUENCE / social-structure read-out: detects possible mentors,
   * innovators, families, tribes, and resource-holders from who taught whom,
   * whose discoveries spread, who is bonded to whom, and who descends from
   * whom. Pure analysis — never read back into the sim.
   */
  society(): SocietyReport {
    const alive = this.agentIds.filter((id) => this.agentBody(id)?.alive).map((id) => ({ id, name: this.nameOf(id) }));
    const teaching: { teacher: number; student: number }[] = [];
    const bonds: { a: number; b: number }[] = [];
    const trust: { holder: number; toward: number }[] = [];
    const seenBond = new Set<string>();
    for (const a of alive) {
      const mind = this.minds.get(a.id);
      if (!mind) continue;
      for (const k of mind.knowledge.all()) {
        if (k.origin === 'testimony' && k.testimonyFrom != null) teaching.push({ teacher: k.testimonyFrom, student: a.id });
      }
      for (const [pid, r] of mind.relationships.asMap()) {
        if (r.friendship > 62 && r.interactionCount >= 8) {
          const key = a.id < pid ? `${a.id}-${pid}` : `${pid}-${a.id}`;
          if (!seenBond.has(key)) {
            seenBond.add(key);
            bonds.push({ a: a.id, b: pid });
          }
        }
        if (r.trust > 62 && r.interactionCount >= 8) trust.push({ holder: a.id, toward: pid });
      }
    }
    const origination = analyzeDiffusion(this.agentKnowledge())
      .filter((c) => c.originatorId != null)
      .map((c) => ({ originator: c.originatorId!, reach: c.livingHolders }));
    const kin: { parent: number; child: number }[] = [];
    for (const b of this.births) {
      kin.push({ parent: b.parents[0], child: b.child });
      kin.push({ parent: b.parents[1], child: b.child });
    }
    const caches = this.structures().filter((s) => s.kind === 'container').map((s) => ({ owner: s.builtBy }));
    const specialists: { id: number; archetype: string; dominance: number }[] = [];
    const knowledge: { id: number; count: number }[] = [];
    for (const a of alive) {
      const r = this.archetypeOf(a.id);
      if (r && r.sampleSize > 0) specialists.push({ id: a.id, archetype: r.archetype, dominance: r.dominance });
      knowledge.push({ id: a.id, count: this.minds.get(a.id)?.knowledge.held().length ?? 0 });
    }
    return analyzeSociety({ alive, teaching, origination, bonds, kin, caches, specialists, trust, knowledge });
  }

  /**
   * CULTURE: what each tribe believes (not how much) — shared beliefs, how far
   * tribes diverge, and the superstition test (competing false beliefs). Pure
   * analysis; never read back.
   */
  culture(): CultureReport {
    const tribes = this.society().tribes;
    const beliefs = new Map<number, { key: string; statement: string; rule: import('../contract/types.js').KnowledgeRule }[]>();
    const narratives = new Map<number, { id: string; text: string }[]>();
    for (const id of this.agentIds) {
      if (!this.agentBody(id)?.alive) continue;
      const mind = this.minds.get(id);
      if (!mind) continue;
      beliefs.set(id, mind.knowledge.held().map((k) => ({ key: k.ruleKey, statement: k.statement, rule: k.rule })));
      narratives.set(id, mind.narratives.all().map((n) => ({ id: n.id, text: n.text })));
    }
    return analyzeCulture(tribes, beliefs, narratives);
  }

  /**
   * MYTH FORMATION: how stories distort as they spread — how many versions a
   * story has fractured into, which beings became heroes or villains in the
   * retelling, and whether tribes now tell the same event differently. Analysis.
   */
  myth(): MythReport {
    const tribes = this.society().tribes;
    const narratives = new Map<number, { id: string; text: string; firstTick: number }[]>();
    const names = new Map<number, string>();
    for (const id of this.agentIds) {
      names.set(id, this.nameOf(id));
      if (!this.agentBody(id)?.alive) continue;
      const mind = this.minds.get(id);
      // firstTick rides along: a story's age is its own record, not its id.
      if (mind) narratives.set(id, mind.narratives.all().map((n) => ({ id: n.id, text: n.text, firstTick: n.firstTick })));
    }
    return analyzeMyth(narratives, tribes, names, this.tick);
  }

  /**
   * CYCLE 12 — Sacred places. Where do many distinct widely-held stories cluster
   * at one LOCATION, making it multivalent (a founding AND a slaying AND a death
   * at one spot)? Aggregates each story's living-holder count + place, then finds
   * spatial clusters of ≥2 distinct stories. Analysis only — never read back.
   */
  sacredPlaces(): SacredPlacesReport {
    const sites = new Map<string, { x: number; y: number; kind: string; text: string; holders: number }>();
    for (const id of this.agentIds) {
      if (!this.agentBody(id)?.alive) continue;
      const mind = this.minds.get(id);
      if (!mind) continue;
      for (const n of mind.narratives.all()) {
        let s = sites.get(n.id);
        if (!s) sites.set(n.id, (s = { x: n.x, y: n.y, kind: n.id.slice(0, n.id.indexOf(':')), text: n.text, holders: 0 }));
        s.holders++;
      }
    }
    return analyzeSacredPlaces([...sites.values()]);
  }

  /**
   * CYCLE 13 — Leadership. Nobody is assigned a role. But if respect accrues to
   * the visibly competent and beings are drawn to the respected, a few should end
   * up with many "followers" — beings whose strongest social pull points at them.
   * For each living being we find the individual it is most drawn to (latent, by
   * relationship — friendship/trust/respect/fear, ignoring sight), tally inbound
   * followers, and measure how CONCENTRATED followership is (a flat distribution =
   * no leaders; a skewed one = emergent leaders). Analysis only — never read back.
   */
  leadership(): {
    leaders: { name: string; followers: number }[];
    maxFollowers: number;
    leaderCount: number;
    gini: number;
    followerShareTop: number;
  } {
    const aliveIds = this.agentIds.filter((id) => this.agentBody(id)?.alive);
    const aliveSet = new Set(aliveIds);
    const followers = new Map<number, number>();
    for (const i of aliveIds) {
      const mind = this.minds.get(i);
      if (!mind) continue;
      let best = 0; // require a positive pull
      let bestId = -1;
      for (const [pid, r] of mind.relationships.asMap()) {
        if (pid === i || !aliveSet.has(pid)) continue;
        const aff = r.friendship - 50 + (r.trust - 50) * 0.5 - r.fear + (r.respect - 50) * 0.6;
        if (aff > best) {
          best = aff;
          bestId = pid;
        }
      }
      if (bestId >= 0) followers.set(bestId, (followers.get(bestId) ?? 0) + 1);
    }
    const list = [...followers.entries()]
      .map(([id, f]) => ({ name: this.nameOf(id), followers: f }))
      .sort((a, b) => b.followers - a.followers);
    const counts = aliveIds.map((id) => followers.get(id) ?? 0);
    const totalLinks = counts.reduce((a, b) => a + b, 0) || 1;
    const maxFollowers = list.length ? list[0]!.followers : 0;
    return {
      leaders: list.slice(0, 8),
      maxFollowers,
      leaderCount: list.filter((l) => l.followers >= 5).length,
      gini: Math.round(giniOf(counts) * 1000) / 1000,
      followerShareTop: Math.round((maxFollowers / totalLinks) * 1000) / 1000,
    };
  }

  /**
   * CYCLE 14 — Institutions. A snapshot of the candidate institutions right now:
   * the principal sacred site, the oldest surviving myth, the top leader, and the
   * count of knowledge lineages — plus how many generations have elapsed. Sampling
   * this over a run (and seeing which of these PERSIST as individuals turn over) is
   * how we tell an institution (a pattern that outlives its founders) from a
   * transient. Composes existing analyzers; analysis only, never read back.
   */
  institutions(): {
    generations: number;
    topSacredSite: { x: number; y: number; distinctStories: number; multivalent: boolean; maxGrandeur: number } | null;
    oldestMyth: { ageTicks: number; holders: number; text: string } | null;
    topLeader: { name: string; followers: number } | null;
    knowledgeLineages: number;
  } {
    const sp = this.sacredPlaces();
    const m = this.myth();
    const ld = this.leadership();
    const soc = this.society();
    return {
      generations: Math.round((this.tick / TICKS_PER_SEASON) * 10) / 10,
      topSacredSite: sp.richest
        ? { x: sp.richest.x, y: sp.richest.y, distinctStories: sp.richest.distinctStories, multivalent: sp.richest.multivalent, maxGrandeur: sp.richest.maxGrandeur }
        : null,
      oldestMyth: m.oldestSurviving
        ? { ageTicks: m.oldestSurviving.ageTicks, holders: m.oldestSurviving.holders, text: m.oldestSurviving.text }
        : null,
      topLeader: ld.leaders[0] ?? null,
      knowledgeLineages: soc.knowledgeLineages,
    };
  }

  // ─── Phase 2: consciousness ───────────────────────────────────────────────

  /** Mark a living being CONSCIOUS — from now it reasons via the LLM, born into
   * the culture that already exists around it. The rest stay reflex. */
  makeConscious(id: number): boolean {
    if (!this.minds.has(id) || !this.agentBody(id)?.alive) return false;
    this.conscious.add(id);
    return true;
  }

  /** The kin a being knows it has — parents and children, by name. */
  private kinOf(agentId: number): KinTie[] {
    const kin: KinTie[] = [];
    for (const b of this.births) {
      if (b.child === agentId) for (const p of b.parents) kin.push({ name: this.nameOf(p), relation: 'parent' });
      if (b.parents.includes(agentId)) kin.push({ name: this.nameOf(b.child), relation: 'child' });
    }
    return kin;
  }

  /**
   * Assemble the CULTURE a conscious being knows: the stories it carries, the
   * family it knows it has, and the people it knows (rendered as FEELING, never
   * a role label). Names are resolved here because only the host holds them.
   * Doctrine: only what a Gahallian could reasonably know — no analysis labels,
   * no hidden world facts.
   */
  private enrichCulture(input: ThinkInput, agentId: number, mind: AgentMind): ThinkInput {
    // Stories ordered by how often the being has HEARD each (intrinsic salience) —
    // so the tale its people tell most leads, instead of being buried in the list.
    const held = [...mind.narratives.all()].sort((a, b) => b.timesHeard - a.timesHeard);
    // The id rides along so a being can name WHICH tale it is retelling.
    const stories: KnownStory[] = held.map((n) => ({ id: n.id, text: n.text, firsthand: n.firsthand }));
    const top = held[0];
    const mostTold = top && top.timesHeard >= 2 ? top.text : undefined; // a tale actually retold
    const scored: { person: KnownPerson; salience: number }[] = [];
    for (const [pid, r] of mind.relationships.asMap()) {
      if (!this.agentBody(pid)?.alive) continue;
      const felt = relationshipFeeling(r);
      if (felt) scored.push({ person: { name: this.nameOf(pid), feeling: felt.feeling }, salience: felt.salience });
    }
    scored.sort((a, b) => b.salience - a.salience);
    return {
      ...input,
      stories,
      ...(mostTold ? { mostTold } : {}),
      kin: this.kinOf(agentId),
      social: scored.slice(0, 8).map((s) => s.person),
      offerMaking: this.offerMaking,
    };
  }

  /**
   * CULTURAL SEEDING (Exp 10): inject one shared myth into a people, as if long
   * told. `timesHeard` sets its familiarity (high → it becomes the tale told
   * most). It is a STORY the minds then interpret — no behavioural instruction,
   * no role, no incentive. The experiment of whether culture can steer curiosity.
   */
  seedMyth(text: string, opts: { id?: string; x?: number; y?: number; timesHeard?: number; toAgentIds?: number[] } = {}): void {
    const id = opts.id ?? 'seed:myth';
    const x = opts.x ?? WORLD / 2;
    const y = opts.y ?? WORLD / 2;
    const timesHeard = opts.timesHeard ?? 6;
    const ids = opts.toAgentIds ?? this.agentIds;
    for (const aid of ids) {
      const mind = this.minds.get(aid);
      if (mind) mind.narratives.seed(id, text, x, y, this.tick, timesHeard);
    }
  }

  /**
   * Phase 3 Exp 1 setup: give a being the SKILL of a craft — as if it had
   * discovered (or long ago been taught) the recipe. It now holds the
   * craft-recipe as firm knowledge and will practise it; whether the skill
   * then SPREADS by observation is the experiment, not this seeding. The
   * recipe's materials come from the engine's one source of truth (CRAFT_RECIPES),
   * so a seeded maker makes exactly what anyone could discover.
   */
  seedRecipe(output: ObjectKind, toAgentIds: number[]): void {
    const recipe = CRAFT_RECIPES.find((r) => r.output === output);
    if (!recipe) throw new Error(`no recipe makes ${output}`);
    for (const aid of toAgentIds) {
      const mind = this.minds.get(aid);
      if (!mind) continue;
      mind.knowledge.applyEvidence(
        {
          rule: { kind: 'craft-recipe', output, inputs: recipe.inputs },
          confidence: 0.95,
          evidenceCount: 6, // > HELD_MIN_EVIDENCE, so it is held from the start
          contradictionCount: 0,
          sourceMemoryIds: [],
        },
        this.tick,
      );
    }
  }

  /** Living beings who HOLD a craft-recipe for `output` (learned it, may or may
   *  not have crafted yet) — the apprenticeship's reach, distinct from makers. */
  recipeHolders(output: ObjectKind): number[] {
    const key = `craft:${output}`;
    const holders: number[] = [];
    for (const id of this.agentIds) {
      if (!this.agentBody(id)?.alive) continue;
      const rec = this.minds.get(id)?.knowledge.get(key);
      if (rec && rec.status === 'held') holders.push(id);
    }
    return holders;
  }

  /**
   * Which generation a being belongs to: founders are 1, a child is one past
   * its eldest-known parent. Computed from the births ledger — the only record
   * of lineage. Used to measure how a skill propagates DOWN the generations.
   */
  generationOf(id: number): number {
    const parentOf = new Map<number, [number, number]>();
    for (const b of this.births) parentOf.set(b.child, b.parents);
    const cache = new Map<number, number>();
    const depth = (a: number, guard: number): number => {
      if (cache.has(a)) return cache.get(a)!;
      const parents = parentOf.get(a);
      if (!parents || guard > 100) {
        cache.set(a, 1);
        return 1;
      }
      const g = 1 + Math.max(depth(parents[0], guard + 1), depth(parents[1], guard + 1));
      cache.set(a, g);
      return g;
    };
    return depth(id, 0);
  }

  /**
   * A conscious being's inner state, for the observatory: what it is thinking,
   * the goals it pursues, the stories that shaped it, and the family it knows.
   * Answers "what does this being believe, why, and what shaped it" — all from
   * what the being itself holds, nothing engine-only.
   */
  consciousState(id: number): {
    name: string;
    conscious: boolean;
    thought: string | null;
    goals: string[];
    stories: KnownStory[];
    kin: KinTie[];
    knowledge: string[];
  } | null {
    const mind = this.minds.get(id);
    if (!mind) return null;
    return {
      name: this.nameOf(id),
      conscious: this.conscious.has(id),
      thought: this.lastThought.get(id) ?? null,
      goals: mind.goals.map((g) => g.description),
      stories: mind.narratives.all().map((n) => ({ text: n.text, firsthand: n.firsthand })),
      kin: this.kinOf(id),
      knowledge: mind.knowledge.held().slice(0, 12).map((k) => k.statement),
    };
  }

  /**
   * CYCLE 10/11 — Belief → Behavior. Do held stories steer where beings are?
   *
   * Two measures, both seed-paired against a mythBehavior:false control:
   *  - CONGREGATION: living beings within R of a story's place ÷ a uniform-spread
   *    baseline. Inflated by general clustering, so only treatment−control is
   *    trustworthy. (Cycle 10 showed this ≈ confounded with habitat.)
   *  - FRACTION-NEAR (Cycle 11, the clean one): of the beings who CARRY a story,
   *    what fraction are physically within R of its place. Conditioning on
   *    holding the belief removes the habitat confound — if pilgrimage works,
   *    holders of a legend converge on its (often distant) site, so fractionNear
   *    rises in treatment vs control. Pure measurement — never read back.
   */
  beliefBehavior(): {
    founderSites: { text: string; holders: number; near: number; holdersNear: number; fractionNear: number; congregation: number }[];
    tragedySites: { text: string; holders: number; near: number; holdersNear: number; fractionNear: number; congregation: number }[];
    avgFounderCongregation: number;
    avgTragedyCongregation: number;
    avgFounderFractionNear: number;
    avgTragedyFractionNear: number;
  } {
    type Site = { x: number; y: number; kind: string; text: string; holderPos: { x: number; y: number }[] };
    const sites = new Map<string, Site>();
    const positions: { x: number; y: number }[] = [];
    for (const id of this.agentIds) {
      if (!this.agentBody(id)?.alive) continue;
      const t = this.agentEntity(id)!.components['Transform2D'] as { x: number; y: number };
      const pos = { x: t.x, y: t.y };
      positions.push(pos);
      const mind = this.minds.get(id);
      if (!mind) continue;
      for (const n of mind.narratives.all()) {
        let s = sites.get(n.id);
        if (!s) sites.set(n.id, (s = { x: n.x, y: n.y, kind: n.id.slice(0, n.id.indexOf(':')), text: n.text, holderPos: [] }));
        s.holderPos.push(pos);
      }
    }
    const alive = positions.length || 1;
    const R = 60;
    const R2 = R * R;
    const expected = (alive / (WORLD * WORLD)) * Math.PI * R2; // uniform-density baseline within R
    const measure = (s: Site) => {
      let near = 0;
      for (const p of positions) if ((p.x - s.x) ** 2 + (p.y - s.y) ** 2 <= R2) near++;
      let holdersNear = 0;
      for (const p of s.holderPos) if ((p.x - s.x) ** 2 + (p.y - s.y) ** 2 <= R2) holdersNear++;
      const holders = s.holderPos.length;
      return {
        text: s.text,
        holders,
        near,
        holdersNear,
        fractionNear: Math.round((holdersNear / Math.max(1, holders)) * 1000) / 1000,
        congregation: Math.round((near / Math.max(0.01, expected)) * 100) / 100,
      };
    };
    const founderSites: ReturnType<typeof measure>[] = [];
    const tragedySites: ReturnType<typeof measure>[] = [];
    for (const s of sites.values()) {
      if (s.holderPos.length < 8) continue; // only widely-shared stories count as belief
      if (s.x === 0 && s.y === 0) continue; // location-less (LLM-retold) stories
      const m = measure(s);
      if (s.kind === 'home' || s.kind === 'slew') founderSites.push(m);
      else if (s.kind === 'fell' || s.kind === 'attack') tragedySites.push(m);
    }
    founderSites.sort((a, b) => b.fractionNear - a.fractionNear || b.holders - a.holders);
    tragedySites.sort((a, b) => a.fractionNear - b.fractionNear || b.holders - a.holders);
    const avg = (arr: { congregation: number }[]) =>
      arr.length ? Math.round((arr.reduce((x, m) => x + m.congregation, 0) / arr.length) * 100) / 100 : 0;
    const avgFrac = (arr: { fractionNear: number }[]) =>
      arr.length ? Math.round((arr.reduce((x, m) => x + m.fractionNear, 0) / arr.length) * 1000) / 1000 : 0;
    return {
      founderSites: founderSites.slice(0, 12),
      tragedySites: tragedySites.slice(0, 12),
      avgFounderCongregation: avg(founderSites),
      avgTragedyCongregation: avg(tragedySites),
      avgFounderFractionNear: avgFrac(founderSites),
      avgTragedyFractionNear: avgFrac(tragedySites),
    };
  }

  /** Per-agent held+forming knowledge for the diffusion analyzer. */
  agentKnowledge(): AgentKnowledge[] {
    const out: AgentKnowledge[] = [];
    for (const id of this.agentIds) {
      const mind = this.minds.get(id);
      if (!mind) continue;
      out.push({ agentId: id, alive: this.agentBody(id)?.alive ?? false, knowledge: mind.knowledge.all() });
    }
    return out;
  }

  /** Behavior-derived archetype label (analysis-side; never read back). */
  archetypeOf(agentId: number): ArchetypeResult | null {
    const mind = this.minds.get(agentId);
    return mind ? classifyArchetype(mind.memory.all()) : null;
  }

  /**
   * A complete analysis snapshot for the observatory: how knowledge has spread
   * across the population (diffusion clusters, incl. culture — beliefs that
   * outlived their discoverer) and the behavioral-archetype distribution. All
   * post-hoc labelling; nothing here is read back into the simulation.
   */
  analysis(): {
    diffusion: BeliefCluster[];
    accuracy: BeliefAccuracy;
    archetypes: { archetype: Archetype; count: number }[];
    cultureCount: number;
  } {
    const diffusion = analyzeDiffusion(this.agentKnowledge());
    const accuracy = analyzeBeliefAccuracy(diffusion);
    const counts = new Map<Archetype, number>();
    for (const id of this.agentIds) {
      if (!this.agentBody(id)?.alive) continue;
      const r = this.archetypeOf(id);
      if (r && r.sampleSize > 0) counts.set(r.archetype, (counts.get(r.archetype) ?? 0) + 1);
    }
    const archetypes = [...counts.entries()].map(([archetype, count]) => ({ archetype, count })).sort((a, b) => b.count - a.count);
    return { diffusion, accuracy, archetypes, cultureCount: diffusion.filter((c) => c.outlivedOriginator).length };
  }

  totalKnowledge(): number {
    let total = 0;
    for (const mind of this.minds.values()) total += mind.knowledge.held().length;
    return total;
  }

  /**
   * The user gives the Gahallians an idea (never the engine). Lands as a
   * high-salience thought in the target (or every living agent for 'all').
   * Returns how many received it. The doctrine holds: the world seeds nothing;
   * only the human outside may whisper a thought in.
   */
  giveIdea(text: string, target: number | 'all'): number {
    const clean = text.trim().slice(0, 200);
    if (!clean) return 0;
    const ids = target === 'all' ? this.agentIds : [target];
    let n = 0;
    for (const id of ids) {
      const mind = this.minds.get(id);
      if (mind && this.agentBody(id)?.alive) {
        mind.injectIdea(clean, this.tick);
        n++;
      }
    }
    return n;
  }
}
