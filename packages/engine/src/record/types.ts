import type {
  AgentSnapshot,
  Goal,
  KnowledgeRecord,
  KnowledgeStatus,
  MemoryRecord,
  ObservedAgent,
  ObservedResource,
  ObservedStructure,
  RelationshipRecord,
  SimEvent,
  SpeechAct,
  ThinkInput,
  ThinkTrigger,
  Utterance,
  WorldView,
} from '../contract/types.js';
import type { WireIntent, WireOutput } from '../contract/wire.js';
import type { ActionId, EventId, KindId } from '../contract/ids.js';
import type { Needs, ObjectKind } from '../worlds/forager/types.js';
import type { ProvenanceLevel } from '../learning/ILearner.js';

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
export const COGNITION_SCHEMA_VERSION = 3;

// ─── The think input, frozen ─────────────────────────────────────────────────

/**
 * A RECORD AS IT STORES. The mind's opaque `place` is written back as the
 * fields this world writes a place with, where they have always been — `x`,`y`
 * on the forager plane — so a v3 row recorded before W1-B4 and after it are the
 * same bytes. WHICH fields those are is the world's, so a reader that wants
 * them back asks the same `SpaceOps` the writer used
 * (`deserializeThinkInput(row, world)`); the index signature is the honest type
 * for a shape only a world can name.
 */
export type Written<T> = Omit<T, 'place'> & Record<string, unknown>;

/** A memory as it stores: the retrieval embedding is a typed array JSON drops. */
export type SerializedMemoryRecord = Written<Omit<MemoryRecord, 'embedding'>> & { embedding?: number[] };

/**
 * Knowledge as a row stores it. `provenance` is dropped: no prompt reads it
 * (`buildThinkPrompt` renders id, confidence, evidenceCount, statement, origin
 * and status), and six evidence snapshots per belief made a populated row
 * nearly twice its size for bytes the model never saw. `sourceMemoryIds` stays
 * — it is one line, and it is what a row's evidence is keyed by.
 */
export type SerializedKnowledgeRecord = Omit<KnowledgeRecord, 'provenance'>;

/** The JSON-invalid number a stored `0` stands in for. */
export type NonFiniteToken = 'NaN' | 'Infinity' | '-Infinity' | '-0';

/**
 * One number that reached `buildThinkPrompt` but has no JSON form, and where it
 * sat. `path` is the frozen input's own syntax — `$.snapshot.needs.hunger`,
 * `$.knowledge[0].confidence`. Every key in a ThinkInput comes from a closed
 * engine enum or a fixed field name, so none can contain `.`, `[` or `]` and
 * the path is unambiguous; `deserializeThinkInput` refuses a path that does not
 * resolve onto a stored `0` rather than writing into the wrong field.
 */
export interface NonFiniteSubstitution {
  path: string;
  value: NonFiniteToken;
}

export interface SerializedThinkInput
  extends Omit<
    ThinkInput,
    'relationships' | 'recalledMemories' | 'knowledge' | 'snapshot' | 'worldView'
  > {
  /** A Map does not survive JSON; its entries do, in the Map's own order. */
  relationships: [number, RelationshipRecord][];
  recalledMemories: SerializedMemoryRecord[];
  knowledge: SerializedKnowledgeRecord[];
  /** Places written back as this world's own fields — see `Written`. */
  snapshot: Written<AgentSnapshot>;
  worldView: Omit<WorldView, 'agents' | 'resources' | 'structures'> & {
    agents: Written<ObservedAgent>[];
    resources: Written<ObservedResource>[];
    structures: Written<ObservedStructure>[];
  };
  /**
   * The numbers the prompt was rendered from that JSON cannot hold. Each stores
   * as `0` — so the row stays valid JSON that any reader can parse — with the
   * token it stands for here, and `deserializeThinkInput` puts it back before
   * the prompt is rebuilt. Without this a prompt SENT as "hunger NaN, rest 20"
   * replayed as "hunger 0, rest 20": a row that did not reproduce the call it
   * was paid for.
   *
   * Entries also mark the row lossy in MEANING for anything reading the stored
   * numbers straight off disk — a need-regime bucketer sees the placeholder `0`
   * and calls an act taken at hunger NaN 'satisfied'. Replay does not: it reads
   * this. Absent (the normal case) means every number was finite.
   */
  nonFinite?: NonFiniteSubstitution[];
}

// ─── One call to a backend ───────────────────────────────────────────────────

/**
 * How one attempt's messages differ from the record's base `prompt`. Attempts
 * of a call share a ~4 KB prompt, and storing a full copy each made a retried
 * row carry it twice; only the difference is stored now. `attemptPrompt`
 * rebuilds the exact bytes — nothing reads this by hand.
 */
export type AttemptPromptDelta =
  /** Same system turn; this text was appended to the base user turn (a retry). */
  | { userSuffix: string }
  /** No shared prefix — the whole thing, verbatim. */
  | { full: { system: string; user: string } };

export interface CognitionAttempt {
  /** Absent when this attempt was sent exactly the record's base `prompt`. */
  promptDelta?: AttemptPromptDelta;
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

/**
 * What the world actually received, after the engine resolved speech. Its plan
 * is in the WIRE form — the world's own argument fields, which is what the body
 * was handed and therefore what a row has to say it was handed (W1-B4).
 */
export interface ResolvedOutput {
  goals: Goal[];
  /** The plan as handed to the body: resolved utterances first, then intents. */
  plan: WireIntent[];
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
  /**
   * How much evidence each belief kept while this run was recorded. It changes
   * what a belief can be traced back to — and therefore what any later reading
   * of this corpus can ask of it — so a row states the level rather than
   * leaving a reader to guess which instrument produced it.
   */
  provenance: ProvenanceLevel;
}

/**
 * What a HOST hands the recorder. `provenance` is optional here and required on
 * the stored row: the recorder fills the default in one place, so a caller that
 * predates the option still records a level rather than a hole.
 */
export type RecordedRunOptionsInput = Omit<RecordedRunOptions, 'provenance'> & { provenance?: ProvenanceLevel };

/** What the recorder assumes when a host does not say. Matches `ProvenanceSample`'s own default. */
export const DEFAULT_RECORDED_PROVENANCE: ProvenanceLevel = 'compact';

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
  authoredEvents: { tick: number; type: EventId; actorId: number }[];
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
  /** Straight out of the parser (or the reflex fallback) — before speech
   *  resolution, and written in the world's own argument fields like the plan
   *  below it, so a row reads as the model wrote it. */
  parsedOutput: WireOutput;
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
  /** The world's own name for the act (`ActionBinding.id`), as decided. */
  kind: ActionId;
  objectKind?: KindId;
  buildKind?: KindId;
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
  yielded: { tick: number; type: EventId; payload: Record<string, unknown> }[];
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
  /**
   * Speech observation stopped before every planned utterance resolved, so on
   * the unresolved ones `spoken: false` means UNKNOWN, not "not spoken". An
   * interrupted window stops watching the bus; without this flag the two cases
   * were indistinguishable and a "never spoke" rate silently counted both.
   */
  speechTrackingStopped: boolean;
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
  authoredEvents: { tick: number; type: EventId; actorId: number; witnesses: number }[];
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
