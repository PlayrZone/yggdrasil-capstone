import type {
  BuildKind,
  Goal,
  Intent,
  IntentKind,
  KnowledgeRecord,
  KnowledgeStatus,
  MemoryRecord,
  MindOutput,
  Needs,
  ObjectKind,
  RelationshipRecord,
  SimEvent,
  SimEventType,
  SpeechAct,
  ThinkInput,
  ThinkTrigger,
  Utterance,
} from '../contract/types.js';

/**
 * The lossless cognition record (W0-B). The old corpus stored the parsed
 * FIELDS of a model's answer — no prompt, no completion, no model, no seed, no
 * world, and nothing about what happened next — so it could be neither replayed
 * nor re-scored, and "did the act work?" had no answer anywhere. Everything the
 * engine knew at the moment of a think now rides in one row, and a second row
 * says what the world did with it.
 *
 * Bumped whenever a stored field changes meaning: a reader must refuse a
 * version it does not know rather than silently mis-read a corpus.
 */
export const COGNITION_SCHEMA_VERSION = 2;

// ─── The think input, frozen ─────────────────────────────────────────────────

/** A memory as it stores: the retrieval embedding is a typed array JSON drops. */
export type SerializedMemoryRecord = Omit<MemoryRecord, 'embedding'> & { embedding?: number[] };

export interface SerializedThinkInput extends Omit<ThinkInput, 'relationships' | 'recalledMemories'> {
  /** A Map does not survive JSON; its entries do, in the Map's own order. */
  relationships: [number, RelationshipRecord][];
  recalledMemories: SerializedMemoryRecord[];
}

// ─── One call to a backend ───────────────────────────────────────────────────

export interface CognitionAttempt {
  /** The exact messages THIS attempt was sent (a retry carries the rejection feedback). */
  prompt: { system: string; user: string };
  /** Raw model text, exactly as it came back (empty when the call itself threw). */
  raw: string;
  /** Why this attempt was rejected — a transport error or a parse failure. */
  error?: string;
}

/**
 * Whether the act ever came back. `unanswered-at-run-end` rows exist so that
 * every prompt the engine sent is accounted for: a prompt that vanishes is a
 * prompt that was paid for and cannot be audited.
 */
export type CognitionStatus = 'answered' | 'unanswered-at-run-end';

/** What the world actually received, after the engine resolved speech. */
export interface ResolvedOutput {
  goals: Goal[];
  /** The plan as handed to the body: resolved utterances first, then intents. */
  plan: Intent[];
  utterances: Utterance[];
  name?: string;
  thought?: string;
}

/** Run-level switches in force — the A/B arms a row belongs to. */
export interface RecordedRunOptions {
  agentCount: number;
  mythBehavior: boolean;
  leadership: boolean;
  offerMaking: boolean;
  craftLearning: boolean;
  outcomeWindowTicks: number;
}

/** The sanctioned interventions a driver can make. */
export type ScaffoldKind =
  | 'needsProvisioned'
  | 'itemsGranted'
  | 'relocated'
  | 'seededMyth'
  | 'seededRecipe'
  | 'authoredEvent'
  | 'ideaGiven'
  | 'madeConscious';

/**
 * Every hand the researcher had in this being's situation when it thought.
 * 73% of the old corpus was captured with needs force-reset each round and
 * nothing in a row said so; this is that confound, written down.
 *
 * Always resolved AS OF a tick: nothing that happened after it appears here,
 * and "never" is `null`, never `0` — `0` is the strongest possible claim and
 * must never stand in for "it had not happened yet".
 */
export interface ScaffoldState {
  /** Ticks since this being's needs/health were last set from outside; null = never. */
  needsProvisionedWithinTicks: number | null;
  itemsGrantedWithinTicks: number | null;
  relocatedWithinTicks: number | null;
  /** Author-written narratives this being currently carries. */
  seededMyths: string[];
  /** Author-emitted events this being witnessed (most recent last, capped). */
  authoredEvents: { tick: number; type: SimEventType; actorId: number }[];
  /** Craft recipes handed to this being rather than learned. */
  seededRecipes: ObjectKind[];
  /** Ideas whispered in from outside the world. */
  ideasGiven: number;
  /** When this being was switched to LLM cognition; null = it never was. */
  madeConsciousAtTick: number | null;
  mythBehavior: boolean;
  leadership: boolean;
  offerMaking: boolean;
  craftLearning: boolean;
}

/**
 * One act, with every field labelled by the MOMENT it describes. Three moments
 * exist and they are hours of sim time apart: the run's constants, the instant
 * the prompt was built (the conditions the model reasoned under), and the
 * instant the answer came back. Mixing them is how a row ends up claiming an
 * intervention that had not happened yet, so each field says which it is.
 */
export interface CognitionRecordV2 {
  // ── The run (constant) ─────────────────────────────────────────────────────
  /** `<runId>:<tick>:<beingId>`, where `<tick>` is the PROMPT tick. */
  id: string;
  schemaVersion: number;
  engineVersion: string;
  runId: string;
  /** The experiment this row belongs to (the old corpus's `experiment` tag). */
  scenarioId: string;
  /** The world archetype — what a held-out-world transfer score would split on. */
  worldId: string;
  seed: string;
  options: RecordedRunOptions;
  backendLabel: string;

  // ── AT PROMPT-BUILD: the conditions the model actually reasoned under ───────
  /** The tick the prompt was built on. Everything in this block is true of it. */
  tick: number;
  simDay: number;
  beingId: number;
  /** AT PROMPT-BUILD. A being that names itself in THIS act is still unnamed here. */
  beingName: string;
  generation: number;
  ageTicks: number;
  trigger: ThinkTrigger;
  /** Everything the mind was given. `buildThinkPrompt` of this reproduces `prompt`. */
  thinkInput: SerializedThinkInput;
  /** The first attempt's messages; `attempts[i].prompt` is authoritative per attempt. */
  prompt: { system: string; user: string };
  /** The researcher's hand as of `tick`. An intervention after it is NOT here —
   *  it belongs to the outcome (`interventionsDuringThink`), which it contaminates. */
  scaffold: ScaffoldState;

  // ── AT ANSWER: what came back and what the world was given ─────────────────
  status: CognitionStatus;
  /** Every completion this call produced, in order — a retry is data, not noise. */
  attempts: CognitionAttempt[];
  modelId: string;
  parse: { valid: boolean; retried: boolean; fellBackToReflex: boolean; error?: string };
  /** Straight out of the parser (or the reflex fallback) — before speech resolution. */
  parsedOutput: MindOutput;
  /** Null when the being died mid-thought, or the act never came back at all. */
  resolvedOutput: ResolvedOutput | null;
  /** The tick the answer was applied on; null for an unanswered act. */
  appliedTick: number | null;
  /** Wall-clock round-trip of the backend call, in milliseconds. NOT reproducible
   *  across identical seeded runs — exclude it from any corpus hash. */
  latencyMs: number;
}

// ─── What happened next ──────────────────────────────────────────────────────

export type OutcomeCloseReason = 'planCompleted' | 'planReplaced' | 'windowElapsed' | 'died' | 'runEnded';

export interface IntentOutcome {
  /** Index into `resolvedOutput.plan`. */
  index: number;
  kind: IntentKind;
  objectKind?: ObjectKind;
  buildKind?: BuildKind;
  targetId?: number;
  durationTicks?: number;
  /** The body got as far as this step. */
  reached: boolean;
  /** …and moved past it without rejecting it. */
  executed: boolean;
  rejected: boolean;
  /** The body's own words for why (`not-in-inventory`, `out-of-range`, …). */
  rejectionReason?: string;
  /** What the act yielded: the events this step actually produced. */
  yielded: { tick: number; type: SimEventType; payload: Record<string, unknown> }[];
}

export interface UtteranceOutcome {
  index: number;
  speechAct: SpeechAct;
  targetId?: number;
  spoken: boolean;
  /** Whether the engine attached a payload (a mind can only pass on what it holds). */
  carriedRule: boolean;
  carriedNarrative: boolean;
  listenersInHearing: number[];
  /** Null when the utterance was addressed to everyone in earshot. */
  targetInHearing: boolean | null;
  /** Listeners whose knowledge store took the rule in on this tick. */
  testimonyIntakeBy: number[];
  /** Listeners who did not carry the tale before this utterance and do after. */
  narrativeIntakeBy: number[];
}

/** An intervention that landed while the model was still thinking. */
export interface InterventionDuringThink {
  tick: number;
  kind: ScaffoldKind;
}

/**
 * What the world did with an act. Every measured field is taken AT
 * `closedTick`, against a baseline taken just before `openedTick` — never at
 * the being's next think, which can be thousands of ticks later and would
 * credit this act with everything that happened in between.
 */
export interface CognitionOutcome {
  cognitionId: string;
  schemaVersion: number;
  runId: string;
  beingId: number;
  /** The first tick this plan could run on. The baseline was taken just before it. */
  openedTick: number;
  /** The tick the closing condition occurred on; all measurements are of it. */
  closedTick: number;
  closedReason: OutcomeCloseReason;
  /**
   * Interventions aimed at this being between its prompt and the answer being
   * applied. They cannot have shaped the act (it was already decided) but they
   * do contaminate this result.
   */
  interventionsDuringThink: InterventionDuringThink[];
  /**
   * True when the BODY changed the plan under the mind (the urgent-hunger
   * override splices an Eat in). Step attribution stops being trustworthy from
   * there, so it stops.
   */
  interrupted: boolean;
  intents: IntentOutcome[];
  utterances: UtteranceOutcome[];
  /** Need pressure change over [openedTick, closedTick] (positive = the need grew). */
  needDeltas: Partial<Needs>;
  healthDelta: number;
  knowledgeFormed: { id: number; ruleKey: string; status: KnowledgeStatus }[];
  knowledgeChanged: { id: number; ruleKey: string; from: KnowledgeStatus; to: KnowledgeStatus }[];
  /** Alive AT `closedTick`. */
  aliveAtEnd: boolean;
  goalsEmitted: number;
  /** How many of those goals the being still held at its NEXT think. Null when
   *  there was no next think (the run, or the life, ended first). */
  goalsHeldAtNextThink: number | null;
}

// ─── The run ─────────────────────────────────────────────────────────────────

export interface RunManifest {
  runId: string;
  schemaVersion: number;
  engineVersion: string;
  scenarioId: string;
  worldId: string;
  seed: string;
  modelId: string;
  backendLabel: string;
  options: RecordedRunOptions;
  openedAtMs: number;
}

export interface RunScaffoldSummary {
  needsProvisions: number;
  itemGrants: number;
  relocations: number;
  seededMyths: { id: string; text: string; agents: number; tick: number }[];
  seededRecipes: { output: ObjectKind; agents: number; tick: number }[];
  authoredEvents: { tick: number; type: SimEventType; actorId: number; witnesses: number }[];
  ideasGiven: { tick: number; text: string; reached: number }[];
  madeConscious: number;
}

/** A per-being intervention, as the ledger files it. */
export interface ScaffoldEvent {
  tick: number;
  kind: ScaffoldKind;
}

/**
 * The reconciliation. Every prompt the engine sent is one of: a written record
 * (answered or not) or a dropped one. `promptsSent === recordsWritten +
 * recordsDropped` must hold, or rows went missing silently — which is exactly
 * what happened before this existed.
 */
export interface RunCounts {
  promptsSent: number;
  recordsWritten: number;
  /** Of `recordsWritten`, those whose act never came back before the run ended. */
  unanswered: number;
  outcomesWritten: number;
  /** Rows the sink refused. Non-zero means the corpus is incomplete. */
  recordsDropped: number;
  outcomesDropped: number;
}

export interface RunSummary {
  closedAtMs: number;
  finalTick: number;
  counts: RunCounts;
  /** 'failed' the moment a sink write throws; the corpus is then incomplete. */
  status: 'ok' | 'failed';
  /** The first sink error, kept verbatim. */
  firstError?: string;
  scaffold: RunScaffoldSummary;
}

/**
 * Where records go. The engine stays pure: it emits through this and never
 * touches a filesystem. `@yggdrasil/home` supplies the JSONL implementation.
 */
export interface ICognitionSink {
  openRun(manifest: RunManifest): void;
  cognition(record: CognitionRecordV2): void;
  outcome(outcome: CognitionOutcome): void;
  closeRun(summary: RunSummary): void;
}

/** A sink that keeps nothing — the "recording off" arm of the perturbation test. */
export class NullCognitionSink implements ICognitionSink {
  openRun(): void {}
  cognition(): void {}
  outcome(): void {}
  closeRun(): void {}
}

// ─── The recorder's window onto the world ────────────────────────────────────

/**
 * The body fields the outcome tracker reads. `GahallianBody` satisfies it —
 * `plan` is opaque here because the Body types speech more loosely than the
 * Mind does, and the tracker only ever compares the array's identity (a new
 * plan is a new array) and its length (the body splicing its own act in).
 */
export interface RecordedBody {
  alive: boolean;
  name: string;
  birthTick: number;
  needs: Needs;
  health: number;
  plan: readonly unknown[];
  planStep: number;
  planDone: boolean;
}

/**
 * The read-only windows the recorder needs onto the running world. Narrow on
 * purpose: the recorder observes, it never reaches into the simulation, and
 * every method here is a getter the sim already offers its own host.
 */
export interface RecorderWorld {
  body(id: number): RecordedBody | undefined;
  knowledge(id: number): readonly KnowledgeRecord[];
  carriesNarrative(id: number, narrativeId: string): boolean;
  name(id: number): string;
  generation(id: number): number;
  witnesses(event: SimEvent): number[];
  day(tick: number): number;
}
