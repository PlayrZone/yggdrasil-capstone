import type { World } from '../core/World.js';
import type { PerceptionSystem } from '../body/PerceptionSystem.js';
import type { GahallianBody } from '../body/GahallianBody.js';
import type { AgentMind } from '../agent/AgentMind.js';
import type { WorldAdapter } from '../contract/adapter.js';
import type { KnowledgeRecord } from '../contract/types.js';
import { CognitionRecorder } from '../record/CognitionRecorder.js';
import type { ScaffoldLedger } from '../record/ScaffoldLedger.js';
import type { RecordedBody, RecorderWorld } from '../record/types.js';
import { DEFAULT_OUTCOME_WINDOW } from './options.js';
import type { RecordingOptions, RunFlags } from './options.js';

/** What the recorder needs to look at, all of it already public on the runtime. */
export interface RecorderHost {
  readonly seed: string;
  readonly adapter: WorldAdapter;
  readonly world: World;
  readonly perception: PerceptionSystem;
  readonly minds: ReadonlyMap<number, AgentMind>;
  readonly scaffold: ScaffoldLedger;
  readonly backendLabel: string;
  agentBody(id: number): GahallianBody | undefined;
  nameOf(id: number): string;
  generationOf(id: number): number;
}

/**
 * The read-only windows the recorder observes through. Every one of these is
 * a getter the host already offers — nothing here can reach into the sim.
 */
export function recorderWorld(host: RecorderHost): RecorderWorld {
  return {
    body: (id): RecordedBody | undefined => host.agentBody(id),
    knowledge: (id): readonly KnowledgeRecord[] => host.minds.get(id)?.knowledge.all() ?? [],
    carriesNarrative: (id, narrativeId): boolean => host.minds.get(id)?.narratives.has(narrativeId) ?? false,
    name: (id): string => host.nameOf(id),
    generation: (id): number => host.generationOf(id),
    witnesses: (event): number[] => host.perception.witnessesOf(host.world, event),
    day: (tick): number => Math.floor(tick / host.adapter.time.ticksPerDay) + 1,
  };
}

export interface RecorderSpec {
  readonly recording: RecordingOptions | undefined;
  readonly worldId: string;
  readonly flags: RunFlags;
  readonly agentCount: number;
  readonly modelId: string;
}

/** The lossless cognition record, or null when the host asked for none — in
 *  which case no recording code runs at all. */
export function createRecorder(host: RecorderHost, spec: RecorderSpec): CognitionRecorder | null {
  const recording = spec.recording;
  if (!recording) return null;
  return new CognitionRecorder({
    sink: recording.sink,
    runId: recording.runId,
    scenarioId: recording.scenarioId ?? 'default',
    worldId: recording.worldId ?? spec.worldId,
    seed: host.seed,
    modelId: spec.modelId,
    backendLabel: host.backendLabel,
    options: {
      agentCount: spec.agentCount,
      mythBehavior: spec.flags.mythBehavior,
      leadership: spec.flags.leadership,
      offerMaking: spec.flags.offerMaking,
      craftLearning: spec.flags.craftLearning,
      outcomeWindowTicks: recording.outcomeWindowTicks ?? DEFAULT_OUTCOME_WINDOW,
      // Two runs at different provenance levels are not the same experiment.
      // The recorder defaults this when a host omits it, which meant every
      // manifest claimed the default however the run was actually made.
      provenance: spec.flags.provenance,
    },
    scaffold: host.scaffold,
    world: recorderWorld(host),
    nowMs: recording.nowMs ?? (() => Date.now()),
    ...(recording.onFailure ? { onFailure: recording.onFailure } : {}),
  });
}
