import type { World } from '../core/World.js';
import type { Entity } from '../core/Entity.js';
import type { GahallianBody } from '../body/GahallianBody.js';
import type { SimEventBus } from '../body/SimEventBus.js';
import type { PerceptionSystem } from '../body/PerceptionSystem.js';
import type { YggdrasilSystem } from '../body/YggdrasilSystem.js';
import type { AgentMind } from '../agent/AgentMind.js';
import type { CognitionLog } from '../scheduler/CognitionLog.js';
import type { ProvenanceLevel } from '../learning/ILearner.js';
import type { Needs, ObjectKind, SimEvent } from '../contract/types.js';
import type { AgentKnowledge } from '../analysis/diffusion.js';
import type { ArchetypeResult } from '../analysis/archetype.js';
import type { SocietyReport } from '../analysis/society.js';
import type { CultureReport } from '../analysis/culture.js';
import type { MythReport } from '../analysis/myth.js';
import type { SacredPlacesReport } from '../analysis/sacredPlaces.js';
import { FORAGER_CONTINENT } from './options.js';
import type { ExperimentOptions } from './options.js';
import { SimRuntime } from './Runtime.js';
import { Interventions } from './Interventions.js';
import { ForagerScenario } from './Scenario.js';
import type { BirthRecord } from './RuntimeView.js';
import * as instrument from './instrument/index.js';
import type {
  AgentDetail,
  AgentInfo,
  AnalysisSnapshot,
  BeliefBehaviorReport,
  ConsciousState,
  InstitutionsReport,
  LeadershipReport,
} from './instrument/index.js';

export { FORAGER_CONTINENT } from './options.js';
export type { ExperimentOptions, RecordingOptions } from './options.js';
export type { AgentInfo } from './instrument/index.js';

/**
 * The headless experiment host: composes the Body (world physics + bodies)
 * with the Minds (memory · learning · knowledge · consciousness) in one
 * process and advances a fixed-timestep loop. This is the unit of research —
 * every run is reproducible from its seed and recordable to the research DB.
 *
 * The sim never blocks on the LLM: reflex keeps each agent acting the moment
 * its plan runs dry, and consciousness (when a backend is supplied) resolves
 * asynchronously through the scheduler and overrides reflex when it lands.
 *
 * SINCE W1-A THIS IS A FACADE, and nothing else. The parts it composes —
 *  · `Scenario`      what world exists and who is born into it
 *  · `SimRuntime`    the world, the tick loop, the event→memory pipeline
 *  · society systems co-presence, reproduction, the telling of tales
 *  · `Interventions` the sanctioned, ledger-written ways a driver may intrude
 *  · `instrument/`   every report and observatory read, over a read-only view
 * — are described in `runner/README.md`. The public surface below is unchanged
 * from before the split, because `packages/lab`, `packages/mcp`, the bench and
 * the goldens all speak it.
 */
export class Experiment {
  private readonly rt: SimRuntime;
  private readonly interventions: Interventions;

  constructor(options: ExperimentOptions) {
    const scenario = new ForagerScenario(FORAGER_CONTINENT, options.seed, options.agentCount ?? 100);
    this.rt = new SimRuntime(options, scenario);
    this.interventions = new Interventions(this.rt);
  }

  // ─── The simulation ───────────────────────────────────────────────────────

  get seed(): string {
    return this.rt.seed;
  }

  get world(): World {
    return this.rt.world;
  }

  get bus(): SimEventBus {
    return this.rt.bus;
  }

  get perception(): PerceptionSystem {
    return this.rt.perception;
  }

  get body(): YggdrasilSystem {
    return this.rt.body;
  }

  get minds(): Map<number, AgentMind> {
    return this.rt.minds;
  }

  get agentIds(): number[] {
    return this.rt.agentIds;
  }

  /** Phase 2: which beings are CONSCIOUS (LLM-driven). Empty = pure reflex world. */
  get conscious(): Set<number> {
    return this.rt.conscious;
  }

  /** Phase 2: each conscious being's latest first-person thought (observed only). */
  get lastThought(): Map<number, string> {
    return this.rt.lastThought;
  }

  /** Kinship ledger (persisted — the event log is capped). Enables family detection. */
  get births(): BirthRecord[] {
    return this.rt.births;
  }

  /** Instrumentation level for belief evidence — see ExperimentOptions. */
  get provenanceLevel(): ProvenanceLevel {
    return this.rt.flags.provenance;
  }

  get tick(): number {
    return this.rt.tick;
  }

  get cognitionLog(): CognitionLog | null {
    return this.rt.cognitionLog;
  }

  get backendLabel(): string {
    return this.rt.backendLabel;
  }

  /** Advance the fixed-timestep loop by N ticks. */
  advance(ticks: number): void {
    this.rt.advance(ticks);
  }

  // ─── Run counters (the event log is capped; these are not) ─────────────────

  get eventCount(): number {
    return this.rt.counters.eventCount;
  }

  get eventLog(): SimEvent[] {
    return this.rt.counters.eventLog;
  }

  get birthCount(): number {
    return this.rt.counters.birthCount;
  }

  get deathsByCause(): Record<string, number> {
    return this.rt.counters.deathsByCause;
  }

  get exchangeCount(): number {
    return this.rt.counters.exchangeCount;
  }

  get conflictCount(): number {
    return this.rt.counters.conflictCount;
  }

  get sicknessCount(): number {
    return this.rt.counters.sicknessCount;
  }

  get shareCount(): number {
    return this.rt.counters.shareCount;
  }

  get seedPlantCount(): number {
    return this.rt.counters.seedPlantCount;
  }

  get sproutCount(): number {
    return this.rt.counters.sproutCount;
  }

  get buildCount(): number {
    return this.rt.counters.buildCount;
  }

  /** Phase 3 Exp 1: per-agent count of crafts COMPLETED (actor of a Crafted event). */
  get craftsByAgent(): Map<number, number> {
    return this.rt.counters.craftsByAgent;
  }

  // ─── Runtime reads ────────────────────────────────────────────────────────

  agentEntity(id: number): Entity | undefined {
    return this.rt.agentEntity(id);
  }

  agentBody(id: number): GahallianBody | undefined {
    return this.rt.agentBody(id);
  }

  aliveCount(): number {
    return this.rt.aliveCount();
  }

  nameOf(agentId: number): string {
    return this.rt.nameOf(agentId);
  }

  generationOf(id: number): number {
    return this.rt.generationOf(id);
  }

  day(): number {
    return this.rt.day();
  }

  year(): number {
    return this.rt.year();
  }

  season(): string {
    return this.rt.season();
  }

  yearsElapsed(): number {
    return this.rt.yearsElapsed();
  }

  cognitionPending(): number {
    return this.rt.cognitionPending();
  }

  settleCognition(timeoutMs = 10_000): Promise<boolean> {
    return this.rt.settleCognition(timeoutMs);
  }

  endRecording(): void {
    this.rt.endRecording();
  }

  /** Non-null once a sink write has thrown — the corpus is then incomplete. */
  get recordingFailure(): string | null {
    return this.rt.recordingFailure;
  }

  // ─── Sanctioned interventions (recorded in the scaffold ledger) ────────────

  makeConscious(id: number): boolean {
    return this.interventions.makeConscious(id);
  }

  provisionNeeds(ids: Iterable<number>, patch: Partial<Needs> & { health?: number; clearSickness?: boolean }): number {
    return this.interventions.provisionNeeds(ids, patch);
  }

  grantItems(id: number, items: Partial<Record<ObjectKind, number>>, mode: 'floor' | 'add' = 'floor'): boolean {
    return this.interventions.grantItems(id, items, mode);
  }

  relocate(id: number, x: number, y: number): boolean {
    return this.interventions.relocate(id, x, y);
  }

  authorEvent(event: SimEvent): number {
    return this.interventions.authorEvent(event);
  }

  seedMyth(text: string, opts: { id?: string; x?: number; y?: number; timesHeard?: number; toAgentIds?: number[] } = {}): void {
    this.interventions.seedMyth(text, opts);
  }

  seedRecipe(output: ObjectKind, toAgentIds: number[]): void {
    this.interventions.seedRecipe(output, toAgentIds);
  }

  giveIdea(text: string, target: number | 'all'): number {
    return this.interventions.giveIdea(text, target);
  }

  // ─── The instrument (reads a RuntimeView; never read back into the sim) ────

  agentInfos(): AgentInfo[] {
    return instrument.agentInfos(this.rt);
  }

  agentDetail(id: number): AgentDetail | null {
    return instrument.agentDetail(this.rt, id);
  }

  consciousState(id: number): ConsciousState | null {
    return instrument.consciousState(this.rt, id);
  }

  animals(): { id: number; x: number; y: number; kind: string }[] {
    return instrument.animals(this.rt);
  }

  resourceNodes(): { id: number; x: number; y: number; kind: string }[] {
    return instrument.resourceNodes(this.rt);
  }

  structures(): { id: number; x: number; y: number; kind: string; builtBy: number }[] {
    return instrument.structures(this.rt);
  }

  recentEvents(limit: number): SimEvent[] {
    return instrument.recentEvents(this.rt, limit);
  }

  recipeHolders(output: ObjectKind): number[] {
    return instrument.recipeHolders(this.rt, output);
  }

  agentKnowledge(): AgentKnowledge[] {
    return instrument.agentKnowledge(this.rt);
  }

  archetypeOf(agentId: number): ArchetypeResult | null {
    return instrument.archetypeOf(this.rt, agentId);
  }

  totalKnowledge(): number {
    return instrument.totalKnowledge(this.rt);
  }

  analysis(): AnalysisSnapshot {
    return instrument.analysis(this.rt);
  }

  society(): SocietyReport {
    return instrument.society(this.rt);
  }

  culture(): CultureReport {
    return instrument.culture(this.rt);
  }

  myth(): MythReport {
    return instrument.myth(this.rt);
  }

  sacredPlaces(): SacredPlacesReport {
    return instrument.sacredPlaces(this.rt);
  }

  leadership(): LeadershipReport {
    return instrument.leadership(this.rt);
  }

  institutions(): InstitutionsReport {
    return instrument.institutions(this.rt);
  }

  beliefBehavior(): BeliefBehaviorReport {
    return instrument.beliefBehavior(this.rt);
  }
}
