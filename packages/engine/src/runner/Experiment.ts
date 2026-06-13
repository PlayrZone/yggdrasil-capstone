import { World } from '../core/World.js';
import type { Entity } from '../core/Entity.js';
import type { GahallianBody } from '../body/GahallianBody.js';
import {
  PerceptionSystem,
  ResourceNodeSystem,
  SimEventBus,
  WorldRegularitiesSystem,
  YggdrasilSystem,
  createResourceNode,
  spawnGahallians,
  TICKS_PER_DAY,
} from '../body/index.js';
import { mulberry32, hashSeed } from '../body/prng.js';
import { AgentMind } from '../agent/AgentMind.js';
import { CognitionLog } from '../scheduler/CognitionLog.js';
import { CognitionScheduler } from '../scheduler/CognitionScheduler.js';
import { LlmMind } from '../consciousness/LlmMind.js';
import { classifyArchetype } from '../analysis/archetype.js';
import { memoryFromEvent } from '../memory/memoryFromEvent.js';
import type { AgentKnowledge } from '../analysis/diffusion.js';
import type { ArchetypeResult } from '../analysis/archetype.js';
import type { IMindBackend } from '../consciousness/IMindBackend.js';
import type { Intent, MindOutput, ResourceNodeKind, SimEvent } from '../contract/types.js';
import { WORLD, elevationBand, regionAt, riverY } from '../world/regions.js';
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
}

const EVENT_LOG_CAP = 400;

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
  readonly body = new YggdrasilSystem(this.perception);
  readonly minds = new Map<number, AgentMind>();
  readonly agentIds: number[] = [];

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

      for (const witnessId of this.perception.witnessesOf(this.world, event)) {
        const mind = this.minds.get(witnessId);
        if (!mind) continue;
        const witness = this.world.getEntity(witnessId);
        if (!witness) continue;
        const t = witness.components['Transform2D'] as { x: number; y: number };
        const context = this.perception.contextAt(this.world, t.x, t.y, event.tick);
        const memory = memoryFromEvent(event, witnessId, context);
        if (memory) mind.observe(memory);
      }
    });
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
      for (let attempts = 0; placed < count && attempts < count * 60; attempts++) {
        const x = 8 + rng() * (WORLD - 16);
        const y = 8 + rng() * (WORLD - 16);
        if (regionAt(x, y) !== region) continue;
        place(kind, x, y, stock);
        placed++;
      }
    };

    // River valley — drinking water along the line + abundant food banks (the
    // continent's breadbasket; supports a dense population).
    for (let x = 40; x <= 360; x += 15) place('river', x, riverY(x), 9999);
    scatter('berryBush', 'river', 30, 18);
    scatter('tuberPlant', 'river', 22, 18);
    scatter('clayDeposit', 'river', 6, 20);
    scatter('fiberPlant', 'river', 4, 10);

    // Coast — sea water + salt + reeds + a little shore forage.
    for (let y = 20; y < WORLD - 20; y += 22) place('waterSource', 6, y, 9999);
    scatter('saltFlat', 'coast', 6, 14);
    scatter('fiberPlant', 'coast', 6, 10);
    scatter('berryBush', 'coast', 4, 12);

    // Forests — wood-rich, decent food, and poison-plant danger.
    scatter('tree', 'forest', 26, 10);
    scatter('berryBush', 'forest', 14, 14);
    scatter('tuberPlant', 'forest', 8, 14);
    scatter('nightshadePlant', 'forest', 5, 6);
    scatter('fiberPlant', 'forest', 4, 10);

    // Mountains — resource-rich, FOOD-POOR (no food placed here on purpose).
    scatter('stoneDeposit', 'mountain', 8, 14);
    scatter('copperVein', 'mountain', 6, 10);
    scatter('ironVein', 'mountain', 5, 10);
    scatter('coalSeam', 'mountain', 5, 12);
    scatter('tinVein', 'mountain', 4, 8);
    scatter('gemVein', 'mountain', 3, 4);
    scatter('silverVein', 'mountain', 2, 4);
    scatter('goldVein', 'mountain', 1, 3);

    // Hills — stone + clay, a little wood.
    scatter('stoneDeposit', 'hills', 6, 12);
    scatter('clayDeposit', 'hills', 4, 16);
    scatter('tree', 'hills', 4, 8);

    // Plains — modest forage so the open ground isn't a death zone.
    scatter('berryBush', 'plains', 14, 10);
    scatter('tuberPlant', 'plains', 10, 10);
    scatter('fiberPlant', 'plains', 6, 8);
    scatter('mushroomPatch', 'plains', 4, 8);

    // Scatter agents across the habitable continent so independent groups can
    // form under different pressures (river vs forest vs near the mountains).
    const agents = spawnGahallians(this.world, agentCount, this.seed, {
      x: 60,
      y: 40,
      width: 235, // habitable lowlands — not born on barren peaks or in the sea
      height: 320,
    });
    for (const agent of agents) {
      this.agentIds.push(agent.id);
      this.minds.set(agent.id, new AgentMind(agent.id));
    }
  }

  /** Advance the fixed-timestep loop by N ticks. */
  advance(ticks: number): void {
    for (let i = 0; i < ticks; i++) {
      const tick = this.tick++;
      this.resources.step(this.world, tick);
      this.regularities.step(this.world, tick, this.bus);
      this.body.step(this.world, tick, this.bus);

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

  recentEvents(limit: number): SimEvent[] {
    return this.eventLog.slice(-limit);
  }

  nameOf(agentId: number): string {
    const body = this.agentBody(agentId);
    return body ? body.name : agentId === 0 ? 'world' : `#${agentId}`;
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
