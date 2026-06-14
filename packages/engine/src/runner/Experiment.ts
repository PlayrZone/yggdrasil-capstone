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
import { mutateNarrative } from '../narrative/NarrativeStore.js';
import { memoryFromEvent } from '../memory/memoryFromEvent.js';
import type { AgentKnowledge, BeliefCluster, BeliefAccuracy } from '../analysis/diffusion.js';
import type { ArchetypeResult, Archetype } from '../analysis/archetype.js';
import type { IMindBackend } from '../consciousness/IMindBackend.js';
import type { Intent, MindOutput, ResourceNodeKind, SimEvent, Traits } from '../contract/types.js';
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
  /** Cycle 10 A/B: do held stories steer movement? (pilgrimage + tragedy-avoidance) */
  private readonly mythBehavior: boolean;

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
    if (mindBackend) {
      this.cognitionLog = new CognitionLog();
      this.llm = new LlmMind(mindBackend, {
        onCognition: this.cognitionLog.push,
        // Sim ticks are the clock; latency is reported in ticks-as-ms-ish.
        now: () => this.tick,
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
      this.minds.set(agent.id, new AgentMind(agent.id, { ...mindOptions(tr), mythBehavior: this.mythBehavior }));
    }
    this.reproRng = mulberry32(hashSeed(`${this.seed}:repro`));

    // Wild animals roam the lowlands — mobile food, and a reason to range.
    this.wildlife = new WildlifeSystem(this.seed, Math.max(40, Math.round(agentCount * 0.6)));
  }

  /** Advance the fixed-timestep loop by N ticks. */
  advance(ticks: number): void {
    for (let i = 0; i < ticks; i++) {
      const tick = this.tick++;
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
        // resolves, its plan overrides whatever reflex was doing. Without an
        // LLM backend this branch is inert (pure-reflex world).
        if (this.llm && this.scheduler && mind.shouldThink(tick) && !this.scheduler.isPending(agentId)) {
          const snapshot = this.perception.snapshotFor(this.world, entity, tick);
          const view = this.perception.worldViewFor(this.world, entity, tick);
          const thinkInput = mind.buildThinkInput(snapshot, view, 'periodic');
          this.scheduler.submit(
            agentId,
            () => this.llm!.complete(thinkInput),
            (output) => {
              const live = this.agentBody(agentId);
              if (!live?.alive) return; // died while thinking
              // A conscious Gahallian may name itself, once, while still unnamed.
              if (output.name && live.name === '') live.name = output.name;
              mind.applyOutput(output);
              this.applyPlan(agentId, output);
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
    const r2 = CO_PRESENCE_RANGE * CO_PRESENCE_RANGE;
    for (let i = 0; i < live.length; i++) {
      const a = live[i]!;
      for (let j = i + 1; j < live.length; j++) {
        const b = live[j]!;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        if (dx * dx + dy * dy <= r2) {
          a.mind.relationships.coPresence(b.id, tick);
          b.mind.relationships.coPresence(a.id, tick);
          // Companions retell their stories — and a retelling can DISTORT
          // (a detail lost, a beast made greater). Drift accumulates along the
          // chain, so a memory drifts toward myth, and different tribes end up
          // telling different versions of the same event.
          if ((tick + a.id + b.id) % 3 === 0) {
            const sa = a.mind.narratives.pickToRetell(tick);
            if (sa) b.mind.narratives.remember(sa.id, mutateNarrative(sa.text, (b.id * 31 + sa.text.length) >>> 0), sa.x, sa.y, tick, false);
            const sb = b.mind.narratives.pickToRetell(tick);
            if (sb) a.mind.narratives.remember(sb.id, mutateNarrative(sb.text, (a.id * 31 + sb.text.length) >>> 0), sb.x, sb.y, tick, false);
          }
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
    const used = new Set<number>();
    for (let i = 0; i < eligible.length; i++) {
      const A = eligible[i]!;
      if (used.has(A.id)) continue;
      for (let j = i + 1; j < eligible.length; j++) {
        const B = eligible[j]!;
        if (used.has(B.id)) continue;
        if ((A.x - B.x) ** 2 + (A.y - B.y) ** 2 > REPRO_RANGE * REPRO_RANGE) continue;
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
    this.minds.set(child.id, new AgentMind(child.id, { ...mindOptions(traits), mythBehavior: this.mythBehavior }));
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
    this.world.forEach((e) => {
      const a = e.components['Animal'] as Animal | undefined;
      if (!a) return;
      const t = e.components['Transform2D'] as { x: number; y: number } | undefined;
      if (t) out.push({ id: e.id, x: t.x, y: t.y, kind: a.kind });
    });
    return out;
  }

  /** Static resource nodes (food, water, ore, …) for the world view (read once). */
  resourceNodes(): { id: number; x: number; y: number; kind: string }[] {
    const out: { id: number; x: number; y: number; kind: string }[] = [];
    this.world.forEach((e) => {
      if (e.components['Animal']) return; // animals are rendered separately
      const n = e.components['ResourceNode'] as ResourceNode | undefined;
      if (!n) return;
      const t = e.components['Transform2D'] as { x: number; y: number } | undefined;
      if (t) out.push({ id: e.id, x: t.x, y: t.y, kind: n.kind });
    });
    return out;
  }

  /** Structures the Gahallians have built (shelters, walls, containers, drops). */
  structures(): { id: number; x: number; y: number; kind: string; builtBy: number }[] {
    const out: { id: number; x: number; y: number; kind: string; builtBy: number }[] = [];
    this.world.forEach((e) => {
      const s = e.components['Structure'] as Structure | undefined;
      if (!s) return;
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
    const narratives = new Map<number, { id: string; text: string }[]>();
    const names = new Map<number, string>();
    for (const id of this.agentIds) {
      names.set(id, this.nameOf(id));
      if (!this.agentBody(id)?.alive) continue;
      const mind = this.minds.get(id);
      if (mind) narratives.set(id, mind.narratives.all().map((n) => ({ id: n.id, text: n.text })));
    }
    return analyzeMyth(narratives, tribes, names, this.tick);
  }

  /**
   * CYCLE 10 — Belief → Behavior. Do held stories steer where beings physically
   * are? For each widely-shared story we measure CONGREGATION: how many living
   * beings stand within R of the place the story remembers, divided by how many
   * a uniform spread would put there. >1 = beings gather there; <1 = they shun
   * it. A founder/hero site with congregation >1 and a tragedy site with
   * congregation <1, in the SAME run, is belief steering behaviour. The
   * mythBehavior:false control run (no pilgrimage/avoidance) is the baseline:
   * if congregation collapses to ~1 there, the effect is the belief, not the
   * terrain. Pure measurement — never read back into the sim.
   */
  beliefBehavior(): {
    founderSites: { text: string; holders: number; near: number; congregation: number }[];
    tragedySites: { text: string; holders: number; near: number; congregation: number }[];
    avgFounderCongregation: number;
    avgTragedyCongregation: number;
  } {
    const sites = new Map<string, { x: number; y: number; kind: string; text: string; holders: number }>();
    const positions: { x: number; y: number }[] = [];
    for (const id of this.agentIds) {
      if (!this.agentBody(id)?.alive) continue;
      const t = this.agentEntity(id)!.components['Transform2D'] as { x: number; y: number };
      positions.push({ x: t.x, y: t.y });
      const mind = this.minds.get(id);
      if (!mind) continue;
      for (const n of mind.narratives.all()) {
        let s = sites.get(n.id);
        if (!s) sites.set(n.id, (s = { x: n.x, y: n.y, kind: n.id.slice(0, n.id.indexOf(':')), text: n.text, holders: 0 }));
        s.holders++;
      }
    }
    const alive = positions.length || 1;
    const R = 60;
    const expected = (alive / (WORLD * WORLD)) * Math.PI * R * R; // uniform-density baseline within R
    const measure = (s: { x: number; y: number; text: string; holders: number }) => {
      let near = 0;
      for (const p of positions) if ((p.x - s.x) ** 2 + (p.y - s.y) ** 2 <= R * R) near++;
      return { text: s.text, holders: s.holders, near, congregation: Math.round((near / Math.max(0.01, expected)) * 100) / 100 };
    };
    const founderSites: { text: string; holders: number; near: number; congregation: number }[] = [];
    const tragedySites: { text: string; holders: number; near: number; congregation: number }[] = [];
    for (const s of sites.values()) {
      if (s.holders < 8) continue; // only widely-shared stories count as belief
      if (s.x === 0 && s.y === 0) continue; // location-less (LLM-retold) stories
      const m = measure(s);
      if (s.kind === 'home' || s.kind === 'slew') founderSites.push(m);
      else if (s.kind === 'fell' || s.kind === 'attack') tragedySites.push(m);
    }
    founderSites.sort((a, b) => b.congregation - a.congregation);
    tragedySites.sort((a, b) => a.congregation - b.congregation);
    const avg = (arr: { congregation: number }[]) =>
      arr.length ? Math.round((arr.reduce((x, m) => x + m.congregation, 0) / arr.length) * 100) / 100 : 0;
    return {
      founderSites: founderSites.slice(0, 12),
      tragedySites: tragedySites.slice(0, 12),
      avgFounderCongregation: avg(founderSites),
      avgTragedyCongregation: avg(tragedySites),
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
