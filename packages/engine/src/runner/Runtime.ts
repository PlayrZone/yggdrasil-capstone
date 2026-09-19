import { World } from '../core/World.js';
import type { Entity } from '../core/Entity.js';
import type { GahallianBody } from '../body/GahallianBody.js';
import type { Intent as BodyIntent } from '../body/contract.js';
import {
  PerceptionSystem,
  ResourceNodeSystem,
  SimEventBus,
  WorldRegularitiesSystem,
  WildlifeSystem,
  YggdrasilSystem,
} from '../body/index.js';
import { ActivityRegions, TiledEntities } from '../world/activity.js';
import type { BodyScale, WorldGeography } from '../world/geography.js';
import { AgentMind } from '../agent/AgentMind.js';
import { CognitionLog } from '../scheduler/CognitionLog.js';
import { CognitionScheduler } from '../scheduler/CognitionScheduler.js';
import { LlmMind } from '../consciousness/LlmMind.js';
import { RuleIntern } from '../knowledge/KnowledgeStore.js';
import type { CognitionRecorder } from '../record/CognitionRecorder.js';
import { ScaffoldLedger } from '../record/ScaffoldLedger.js';
import { traitCurveValue } from '../contract/adapter.js';
import type { CognitionDefaults, WorldAdapter } from '../contract/adapter.js';
import type { Intent, MindOutput, SimEvent, Traits } from '../contract/types.js';
import { generationOf } from './kinship.js';
import { runFlagsFrom } from './options.js';
import type { ExperimentOptions, RunFlags } from './options.js';
import { installEventPipeline } from './EventPipeline.js';
import { createRecorder } from './recording.js';
import { RunCounters } from './RunCounters.js';
import type { BirthRecord, ObservedEntity, RuntimeView } from './RuntimeView.js';
import type { Scenario } from './Scenario.js';
import { SettledWorld } from './settled.js';
import type { WildlifeRules } from '../body/WildlifeSystem.js';
import { enrichCulture } from './promptCulture.js';
import { CoPresenceSystem } from './society/CoPresence.js';
import { ReproductionSystem } from './society/Reproduction.js';
import type { NarrativeAuthor, SocietyHost, SocietySystem } from './society/SocietySystem.js';

/** Cognition parameters from a being's temperament (inherited by kids) — the
 *  world declares the curves, the host reads them. */
function mindOptions(d: CognitionDefaults, tr: Traits): { thinkInterval: number; consolidateInterval: number; memoryHotCapacity: number } {
  return {
    thinkInterval: traitCurveValue(d.thinkInterval, tr),
    consolidateInterval: traitCurveValue(d.consolidateInterval, tr),
    memoryHotCapacity: traitCurveValue(d.memoryHotCapacity, tr),
  };
}

/**
 * THE SIMULATION ITSELF, and nothing else.
 *
 * It owns the world, the body systems, the event bus, the mind registry, the
 * fixed-timestep loop and its per-tick order, the event→memory pipeline, and
 * the scheduling glue that lets a slow mind land asynchronously. It does not
 * build worlds (a `Scenario` does), does not measure anything (the instrument
 * does, through `RuntimeView`), and does not intervene (`Interventions` does).
 *
 * Nothing here may import `analysis/` or `instrument/` —
 * `test/runner-layering.test.ts` fails the build if it ever does. That
 * direction is the whole point: a measurement that cannot be read back cannot
 * become the mechanism.
 */
export class SimRuntime implements RuntimeView, SocietyHost {
  readonly seed: string;
  /** What kind of place this is, as data — read by every mind it creates, by
   *  the event pipeline, by the recorder and by the clock. Never mutated. */
  readonly adapter: WorldAdapter;
  /** The ground this run happens on — read by the body and the instrument,
   *  never by a mind. */
  readonly geography: WorldGeography;
  /** How far a metre is here. */
  readonly scale: BodyScale;
  readonly world = new World();
  readonly bus = new SimEventBus();
  readonly perception: PerceptionSystem;
  readonly body: YggdrasilSystem;
  readonly minds = new Map<number, AgentMind>();
  readonly agentIds: number[] = [];
  /** Phase 2: which beings are CONSCIOUS (LLM-driven). Empty = pure reflex world. */
  readonly conscious = new Set<number>();
  /** Phase 2: each conscious being's latest first-person thought (observed only). */
  readonly lastThought = new Map<number, string>();
  /** Kinship ledger (persisted — the event log is capped). Enables family detection. */
  readonly births: BirthRecord[] = [];
  readonly counters = new RunCounters();
  readonly flags: RunFlags;
  /** Every sanctioned intervention a driver makes, written down. Always on:
   *  it is bookkeeping beside the sim, never inside it. */
  readonly scaffold = new ScaffoldLedger();
  readonly cognitionLog: CognitionLog | null;
  readonly backendLabel: string;

  tick = 0;

  /** Nodes and animals as an instrument should see them — see `settled.ts`. */
  readonly settled: SettledWorld;

  /** Which tiles of the world are live this tick — see `world/activity.ts`. */
  private readonly tiles: ActivityRegions;
  private readonly resources: ResourceNodeSystem;
  private readonly regularities = new WorldRegularitiesSystem();
  private readonly wildlife: WildlifeRules;
  private readonly society: readonly SocietySystem[];
  private readonly narrator: NarrativeAuthor;
  // Optional LLM consciousness. When absent, agents run pure reflex.
  private readonly llm: LlmMind | null;
  private readonly scheduler: CognitionScheduler | null;
  /** Shared rule strings for the dead — see RuleIntern. Dies with the run. */
  private readonly tombstoneRules = new RuleIntern();
  private readonly recorder: CognitionRecorder | null;
  /** Set by `endRecording`: the run is closed and nothing more may act. */
  private recordingEnded = false;

  constructor(options: ExperimentOptions, scenario: Scenario) {
    const { seed, agentCount = 100, mindBackend } = options;
    this.seed = seed;
    this.adapter = scenario.adapter;
    this.geography = scenario.geography;
    this.scale = scenario.scale;
    this.flags = runFlagsFrom(options);
    const recording = options.recording;
    const activity = scenario.activity;
    this.tiles = Number.isFinite(activity.radius)
      ? ActivityRegions.within(this.geography.span, activity.tileSize, activity.radius)
      : ActivityRegions.everywhere(this.geography.span, activity.tileSize);
    this.settled = new SettledWorld(this.tiles, this);
    // Subscribed BEFORE the scenario furnishes the world, so it sees every
    // node the world is built with, not only the ones that sprout later.
    this.resources = new ResourceNodeSystem(
      this.tiles,
      new TiledEntities(this.world, this.tiles, ResourceNodeSystem.REGROWABLE),
    );
    // Terrain elevation feeds the `highland` context feature so mountains read
    // differently from the river valley (ore-in-highlands becomes discoverable).
    this.perception = new PerceptionSystem(scenario.terrain, this.scale);
    this.body = new YggdrasilSystem(this.perception, this.geography, this.scale);
    this.narrator = scenario.narrator(this);
    if (mindBackend) {
      this.cognitionLog = new CognitionLog();
      const log = this.cognitionLog;
      this.llm = new LlmMind(mindBackend, {
        // What carries a being when the model fails is THIS world's reflex
        // policy, named rather than defaulted (W1-B1 verifier, backlog 2).
        world: this.adapter,
        onCognition: (record) => {
          log.push(record);
          this.recorder?.attempt(record);
        },
        // The conditions of the act are frozen here, not when the answer lands:
        // while the model thinks, the miners rewrite the knowledge the prompt
        // quoted and a driver may provision the being. A record must hold what
        // the model was shown, and nothing that happened after.
        onPromptBuilt: (input, prompt) => this.recorder?.freezeInput(input, prompt),
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

    const built = scenario.build(this.world, this.tiles);
    this.wildlife = built.wildlife;
    // Cognition VARIES by personality, so no two minds are equal: the curious
    // think and act more often, the curious+ambitious learn faster and remember
    // more. Nothing assigns a role — but these differences let some become
    // knowledge-rich innovators/teachers while others stay foragers. Children
    // INHERIT these tendencies (blended from parents), so cognitive lineages
    // can form.
    for (const agent of built.founders) {
      this.admit(agent.id, (agent.components['GahallianBody'] as GahallianBody).traits);
    }
    // Order is the cadence: co-presence before reproduction, every tick that
    // divides their intervals. Both are locked by the goldens.
    this.society = [
      new CoPresenceSystem(this),
      new ReproductionSystem(this, scenario.demography, seed, this.geography, this.scale),
    ];

    this.recorder = createRecorder(this, {
      recording,
      worldId: scenario.worldId,
      flags: this.flags,
      agentCount,
      modelId: mindBackend?.modelId ?? 'reflex',
    });
    installEventPipeline(this, {
      world: this.adapter,
      narrator: this.narrator,
      leadership: this.flags.leadership,
      tombstoneRules: this.tombstoneRules,
      recorder: this.recorder,
    });
  }

  /** Advance the fixed-timestep loop by N ticks. */
  advance(ticks: number): void {
    for (let i = 0; i < ticks; i++) {
      const tick = this.tick++;
      // Positions written from outside the body (a host relocating a being
      // between ticks) are re-homed here, before anything queries the world.
      // The tick schedules the periodic audit of the static set.
      this.world.spatial.reconcile(tick);
      // Which ground is live this tick. Read by everything below it, so it is
      // computed from where the beings ARE before anything else moves.
      this.tiles.update(this.world, tick);
      this.resources.step(this.world, tick);
      this.wildlife.step(this.world, tick, this.bus);
      this.regularities.step(this.world, tick, this.bus);
      this.body.step(this.world, tick, this.bus);
      // Sampled HERE, not at the end of the tick: reflex takes a finished plan
      // away the moment it is done, so a step later the outcome tracker would
      // see every completed plan as a replaced one.
      this.recorder?.tick(tick);
      for (const system of this.society) {
        if (tick % system.intervalTicks === 0 && tick > 0) system.step(tick);
      }

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
          const thinkInput = enrichCulture(this, mind.buildThinkInput(snapshot, view, 'periodic'), agentId, mind, this.flags.offerMaking);
          this.scheduler.submit(
            agentId,
            () => this.llm!.complete(thinkInput),
            (output) => {
              // Once the recording has been closed nothing may still act: a
              // think applied after the last row is a world change with no
              // record anywhere, which is the one thing this item exists to
              // make impossible. Hosts drain with `settleCognition` first.
              if (this.recordingEnded) return;
              const live = this.agentBody(agentId);
              let resolved: MindOutput | null = null;
              let applied: readonly Intent[] | null = null;
              if (live?.alive) {
                // A conscious Gahallian may name itself, once, while still unnamed.
                if (output.name && live.name === '') live.name = output.name;
                // Its thought is OBSERVED ONLY — surfaced, never read back into state.
                if (output.thought) this.lastThought.set(agentId, output.thought);
                // What it SAYS is resolved against its own stores first, so a
                // conscious being can teach and retell — but only what it holds.
                resolved = mind.applyOutput(output);
                applied = this.applyPlan(agentId, resolved);
              }
              // Recorded either way: a think that never reached the world is
              // still a think the model was paid for and can be scored on.
              this.recorder?.complete({
                beingId: agentId,
                parsed: output,
                appliedPlan: applied,
                resolved,
                tick: this.tick,
              });
            },
          );
        }
      }
    }
  }

  /** Hand a decision to the body; returns the plan array the body now owns. */
  private applyPlan(agentId: number, output: MindOutput): Intent[] | null {
    const body = this.agentBody(agentId);
    if (!body) return null;
    const plan: Intent[] = [
      ...output.utterances.map((utterance) => ({ kind: 'Speak' as const, utterance })),
      ...output.plan,
    ];
    // THE OUTBOUND EDGE, named in one place. A plan leaves a mind carrying
    // opaque kind ids; the body executes this world's own narrow kinds and
    // validates every intent against physics regardless. Nothing checks the
    // crossing yet — B3 binds a plan's actions through the adapter and this
    // cast becomes a real gate — so it is one documented narrowing here rather
    // than a body that has to widen to meet it.
    this.body.setPlan(body, plan as BodyIntent[]);
    return plan;
  }

  // ─── Roster ───────────────────────────────────────────────────────────────

  /** Put a newly created being on the roster and give it a mind. */
  admit(agentId: number, traits: Traits): void {
    this.agentIds.push(agentId);
    this.minds.set(
      agentId,
      new AgentMind(agentId, this.adapter, {
        ...mindOptions(this.adapter.cognitionDefaults, traits),
        mythBehavior: this.flags.mythBehavior,
        craftLearning: this.flags.craftLearning,
        provenance: this.flags.provenance,
      }),
    );
  }

  recordBirth(birth: BirthRecord): void {
    this.counters.birthCount++;
    this.births.push(birth);
  }

  // ─── Reads (the runtime's own; the instrument sees these through RuntimeView) ──

  agentEntity(id: number): Entity | undefined {
    return this.world.getEntity(id);
  }

  agentBody(id: number): GahallianBody | undefined {
    return this.agentEntity(id)?.components['GahallianBody'] as GahallianBody | undefined;
  }

  positionOf(id: number): { x: number; y: number } | undefined {
    return this.agentEntity(id)?.components['Transform2D'] as { x: number; y: number } | undefined;
  }

  each(component: string, visit: (entity: ObservedEntity) => void): void {
    this.world.spatial.each(component, visit);
  }

  get eventLog(): readonly SimEvent[] {
    return this.counters.eventLog;
  }

  aliveCount(): number {
    let alive = 0;
    for (const id of this.agentIds) {
      const body = this.agentBody(id);
      if (body?.alive) alive++;
    }
    return alive;
  }

  nameOf(agentId: number): string {
    const body = this.agentBody(agentId);
    if (!body) return agentId === 0 ? 'world' : `#${agentId}`;
    return body.name && body.name.length ? body.name : `Gahallian #${agentId}`;
  }

  generationOf(id: number): number {
    return generationOf(this.births, id);
  }

  day(): number {
    return Math.floor(this.tick / this.adapter.time.ticksPerDay) + 1;
  }

  /** Year of the sim, 1-based — the unit cultural phenomena actually live at. */
  year(): number {
    return Math.floor(this.tick / this.adapter.time.ticksPerYear) + 1;
  }

  /** Current season name (winter is the real challenge). */
  season(): string {
    return this.adapter.time.seasonAt(this.tick);
  }

  /** Fractional years elapsed — for year-scale checkpoints and reporting. */
  yearsElapsed(): number {
    return this.tick / this.adapter.time.ticksPerYear;
  }

  // ─── Cognition lifecycle ──────────────────────────────────────────────────

  cognitionPending(): number {
    return this.scheduler?.activeCount ?? 0;
  }

  /**
   * Wait for the thinks already in flight to land, so a run can be closed with
   * nothing outstanding. Bounded: a wedged backend must not hang a host.
   */
  async settleCognition(timeoutMs = 10_000): Promise<boolean> {
    if (!this.scheduler) return true;
    const deadline = Date.now() + timeoutMs;
    while (this.cognitionPending() > 0 && Date.now() < deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, 1));
    }
    return this.cognitionPending() === 0;
  }

  /**
   * Close the recording: anything still in flight is written as an explicitly
   * unanswered row, open outcome windows resolve, and the manifest gets counts
   * that reconcile. From here no further think may reach the world, so drain
   * with `settleCognition` first if the results still matter. Safe to call
   * twice; a run without recording ignores it entirely.
   */
  endRecording(): void {
    if (!this.recorder) return;
    this.recordingEnded = true;
    this.recorder.end();
  }

  /** Non-null once a sink write has thrown — the corpus is then incomplete. */
  get recordingFailure(): string | null {
    return this.recorder?.failureReason ?? null;
  }
}
