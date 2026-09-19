/**
 * The UI ⇄ sim-worker wire protocol.
 *
 * Pure data and buffer bookkeeping: no DOM, no Worker, no engine *value*
 * import (types only, erased at build time). Both sides and the Node tests
 * share this one definition of the wire.
 *
 * Versioned because the UI bundle and the worker bundle are separate chunks
 * that could, in a bad build, be paired at different ages: the worker announces
 * its version and the client refuses anything else, loudly.
 *
 * Shape of the traffic:
 *  - per-frame world state travels as transferable typed arrays, recycled by
 *    the UI (see `ack`) so a running world allocates nothing per frame;
 *  - things that only change occasionally (structures, resource nodes, the
 *    animal-kind table) travel as change sets, never as full re-sends;
 *  - everything expensive (agent detail, analysis, society, culture) is
 *    request/response by `reqId`, computed in the worker, asked for only when
 *    something is actually looking at it.
 *
 * Not on this wire: reports and the shared activity feed. Those are files in
 * the lab home and reach the renderer over the preload IPC bridge; the sim
 * worker never sees them.
 */

import type { Experiment } from '@yggdrasil/engine';
import type {
  Archetype,
  BeliefAccuracy,
  BeliefCluster,
  CultureReport,
  MythReport,
  SocietyReport,
} from '@yggdrasil/engine';

export const PROTOCOL_VERSION = 3;

/**
 * What a being is DOING — the activity axis. Drawn as a shape (a glyph over the
 * head plus how the body moves), never as a hue, so it survives colour-blind
 * viewing and a greyscale print.
 *
 * `IDLE` and `WALKING` deliberately carry no glyph: they are the resting state
 * of the world, and a world where every being wears a badge is unreadable.
 */
export const ACT_IDLE = 0;
export const ACT_WALKING = 1;
export const ACT_RESTING = 2;
export const ACT_EATING = 3;
export const ACT_DRINKING = 4;
/** Gathering, digging, crafting, building, storing — making and taking. */
export const ACT_WORKING = 5;
/** Fleeing or fighting: the being is in danger or causing it. */
export const ACT_DANGER = 6;
/** Speaking, giving, following — acts aimed at another being. */
export const ACT_SOCIAL = 7;
export const ACT_COUNT = 8;

/**
 * How a being IS — the condition axis, a bitfield. Carried by hue *and* by a
 * glyph, so hue is never the only channel. Never red-vs-green.
 */
export const COND_SICK = 1;
export const COND_STARVING = 2;
/** Violence landed on this being recently. */
export const COND_HURT = 4;

/** Life stage — drawn as body form and height. Thresholds mirror the engine's own maturity rule. */
export const STAGE_CHILD = 0;
export const STAGE_ADULT = 1;
export const STAGE_ELDER = 2;

/** Kind codes ride in a Uint8; 255 is the "more kinds than fit" bucket. */
export const KIND_UNKNOWN = 255;
const MAX_KINDS = 255;

/**
 * What a being is TRYING to do — the engine's own plan step, by code.
 *
 * The activity lane says what it is doing this instant; this says what that is
 * *for*. A being walking to a berry bush and a being walking home read the same
 * in any picture and are answers to different questions, and "what is its
 * goal?" is one of the first things anyone asks of an agent-based model.
 *
 * The order is the wire; append only. `GOAL_NONE` is a being with no plan left
 * — the one honest answer when the engine has none, and never a guess.
 */
export const GOAL_WORDS: readonly string[] = [
  'move to', 'gather', 'dig', 'eat', 'drink', 'sleep', 'build', 'store',
  'take from store', 'give', 'attack', 'craft', 'speak', 'follow', 'flee', 'idle',
];
export const GOAL_NONE = 255;

export function goalWord(code: number): string | null {
  return GOAL_WORDS[code] ?? null;
}

/** The inspector's view of one being — the engine's own shape, not a copy. */
export type AgentDetail = NonNullable<ReturnType<Experiment['agentDetail']>>;

export interface AnalysisSnapshot {
  diffusion: BeliefCluster[];
  accuracy: BeliefAccuracy;
  archetypes: { archetype: Archetype; count: number }[];
  cultureCount: number;
}

export interface FeedItem {
  /**
   * Monotonic id for the line. The feed is a sliding window, so React needs a
   * key that belongs to the line rather than to its position — an index key
   * makes every update rewrite every row (and, on this markup, eventually
   * corrupts the DOM: see LiveFeed).
   */
  seq: number;
  /** Sim day the line happened on — resolved here so the UI needs no tick maths. */
  day: number;
  kind: 'speech' | 'event';
  /** The engine's own name field for the actor — an id wearing a word, usually. */
  who: string;
  /**
   * The actor's id, so the renderer can call this being exactly what the world
   * view calls it. Round one printed the engine's `Gahallian #1972` in the feed
   * beside a world that said Ashiden, and the two were the same being.
   */
  whoId: number;
  text: string;
}

export interface StructureUpdate {
  id: number;
  x: number;
  y: number;
  kind: string;
  /** The being that raised it — so a structure can be shown as someone's. */
  builtBy: number;
}

/**
 * A being's own name, sent once when it is first seen and again if it changes.
 * `name` is the engine's raw field: empty means the being has not named itself,
 * and the lab gives it a designation rather than showing an id.
 */
export interface NameUpdate {
  id: number;
  name: string;
}

/** A being died here. The view leaves a mark that fades. */
export interface DeathMark {
  id: number;
  x: number;
  y: number;
}

/** Someone said something. `to` is where the nearest listener stood, if any. */
export interface SpeechEvent {
  id: number;
  x: number;
  y: number;
  to: { x: number; y: number } | null;
}

/** Who a being is related to and who it is bonded to — asked for, never streamed. */
export interface TiesReport {
  id: number;
  /** Parents, children and siblings, by id. */
  kin: number[];
  /** The beings it trusts or is closest to, strongest first. */
  bonded: number[];
}

// ── Frame buffers ────────────────────────────────────────────────────────────

/**
 * One frame of world state. Fourteen buffers, transferred to the UI and
 * transferred straight back on `ack`, so the steady state is zero allocation on
 * both sides. `ids[i]`, `pos[2i]`/`pos[2i+1]`, `heading[i]`, `act[i]`,
 * `cond[i]`, `stage[i]`, `hunger[i]`, `rest[i]`, `goal[i]`, `planAt[i]` and
 * `planOf[i]` describe being i.
 *
 * The needs and the goal ride here rather than being asked for per being
 * because the roster shows them for everyone at once: three hundred `detail`
 * queries at 4 Hz would be twelve hundred round trips a second to say what
 * four hundred bytes of typed array already says.
 */
export interface FrameArrays {
  ids: Int32Array;
  pos: Float32Array;
  heading: Float32Array;
  act: Uint8Array;
  cond: Uint8Array;
  stage: Uint8Array;
  /** Need pressure in [0, 100]: 0 satisfied, 100 desperate. The engine's own sense. */
  hunger: Uint8Array;
  rest: Uint8Array;
  /** The current plan step's intent, by `GOAL_WORDS` code, or `GOAL_NONE`. */
  goal: Uint8Array;
  /** Which step of the plan it is on, 1-based; 0 while there is no plan. */
  planAt: Uint8Array;
  /** How many steps the plan has, clamped to 255. */
  planOf: Uint8Array;
  wildIds: Int32Array;
  wildPos: Float32Array;
  wildKind: Uint8Array;
}

export function allocFrameArrays(beings: number, wildlife: number): FrameArrays {
  const b = Math.max(1, beings);
  const w = Math.max(1, wildlife);
  return {
    ids: new Int32Array(b),
    pos: new Float32Array(b * 2),
    heading: new Float32Array(b),
    act: new Uint8Array(b),
    cond: new Uint8Array(b),
    stage: new Uint8Array(b),
    hunger: new Uint8Array(b),
    rest: new Uint8Array(b),
    goal: new Uint8Array(b).fill(GOAL_NONE),
    planAt: new Uint8Array(b),
    planOf: new Uint8Array(b),
    wildIds: new Int32Array(w),
    wildPos: new Float32Array(w * 2),
    wildKind: new Uint8Array(w),
  };
}

/** The buffers to hand to `postMessage`'s transfer list. */
export function frameBuffers(a: FrameArrays): ArrayBuffer[] {
  return [
    a.ids.buffer, a.pos.buffer, a.heading.buffer, a.act.buffer, a.cond.buffer, a.stage.buffer,
    a.hunger.buffer, a.rest.buffer, a.goal.buffer, a.planAt.buffer, a.planOf.buffer,
    a.wildIds.buffer, a.wildPos.buffer, a.wildKind.buffer,
  ] as ArrayBuffer[];
}

export function beingCapacity(a: FrameArrays): number {
  return a.ids.length;
}

export function wildlifeCapacity(a: FrameArrays): number {
  return a.wildIds.length;
}

/** True once the buffers have been transferred away (every view is detached). */
export function isDetached(a: FrameArrays): boolean {
  return a.ids.length === 0 || a.wildIds.length === 0;
}

// ── Kind tables ──────────────────────────────────────────────────────────────

/**
 * Turns kind names ("berryBush", "wolf") into Uint8 codes, and reports the
 * names it has newly assigned so the other side can extend its own table. The
 * UI never learns a kind twice and the wire never carries a repeated string.
 */
export class KindCodec {
  private readonly codes = new Map<string, number>();
  private pending: string[] = [];

  codeOf(name: string): number {
    const known = this.codes.get(name);
    if (known !== undefined) return known;
    if (this.codes.size >= MAX_KINDS) return KIND_UNKNOWN;
    const code = this.codes.size;
    this.codes.set(name, code);
    this.pending.push(name);
    return code;
  }

  /** Names assigned since the last drain, in code order. */
  drain(): string[] {
    if (this.pending.length === 0) return [];
    const out = this.pending;
    this.pending = [];
    return out;
  }

  /** Every name assigned so far, in code order. */
  names(): string[] {
    return [...this.codes.keys()];
  }

  get size(): number {
    return this.codes.size;
  }
}

// ── UI → worker ──────────────────────────────────────────────────────────────

export type QueryRequest =
  | { name: 'detail'; id: number }
  | { name: 'ties'; id: number }
  | { name: 'analysis' }
  | { name: 'society' }
  | { name: 'culture' };

export interface QueryResults {
  detail: AgentDetail | null;
  ties: TiesReport;
  analysis: AnalysisSnapshot;
  society: SocietyReport;
  culture: { culture: CultureReport; myth: MythReport };
}

export type SimCommand =
  /** Build a new world. `llm` non-null routes conscious minds back over the bridge. */
  | { kind: 'create'; seed: string; population: number; llm: { model: string } | null }
  | { kind: 'run'; running: boolean }
  | { kind: 'speed'; mult: number }
  /** Frames are only worth sending while something is drawing them. */
  | { kind: 'frames'; on: boolean }
  | { kind: 'select'; id: number | null }
  | { kind: 'idea'; text: string; targetId: number }
  | { kind: 'query'; reqId: number; request: QueryRequest }
  /** Frame rendered — the buffers come home for reuse. */
  | { kind: 'ack'; arrays: FrameArrays }
  | { kind: 'llm-result'; reqId: number; text?: string; error?: string }
  | { kind: 'dispose' };

// ── worker → UI ──────────────────────────────────────────────────────────────

export interface ResourcePayload {
  kinds: string[];
  count: number;
  pos: Float32Array;
  kind: Uint8Array;
}

export function resourceBuffers(r: ResourcePayload): ArrayBuffer[] {
  return [r.pos.buffer, r.kind.buffer] as ArrayBuffer[];
}

export interface WorldMessage {
  kind: 'world';
  seed: string;
  population: number;
  backend: string;
  resources: ResourcePayload;
}

export interface FrameMessage {
  kind: 'frame';
  tick: number;
  day: number;
  /** Beings written into the arrays. */
  beings: number;
  /** Beings alive in the sim. Greater than `beings` means something was dropped. */
  beingsAlive: number;
  /** Animals written into the arrays. */
  wildlife: number;
  /** Animals alive in the sim. Greater than `wildlife` means something was dropped. */
  wildlifeTotal: number;
  /** Animal-kind names newly assigned since the last frame; append to the table. */
  animalKinds: string[];
  /** Structures raised since the last frame. */
  structures: StructureUpdate[];
  /** Names first seen or changed since the last frame. */
  names: NameUpdate[];
  /** Beings that died since the last frame. */
  deaths: DeathMark[];
  /** Utterances since the last frame. */
  speech: SpeechEvent[];
  /**
   * 1 in full daylight, 0 in the dark of night. Full day covers exactly the
   * engine's own day (`isNight` is false); the dusk and dawn crossfades live
   * inside the engine's night, so the view never shows light the sim denies.
   */
  daylight: number;
  arrays: FrameArrays;
}

export interface StatsMessage {
  kind: 'stats';
  tick: number;
  day: number;
  alive: number;
  total: number;
  knowledge: number;
  exchanges: number;
  conflicts: number;
  sickness: number;
  shares: number;
  seedPlants: number;
  sprouts: number;
  builds: number;
  backend: string;
  deaths: number;
  pending: number;
  /** The speed preset the user asked for. */
  requestedMult: number;
  /**
   * The speed the sim is actually managing, measured over the last window. A
   * saturated CPU cannot run 2400× with 800 beings, and the label must not
   * claim otherwise.
   */
  achievedMult: number;
  /** Ticks the sim fell behind on and abandoned (never queued). Cumulative. */
  ticksDropped: number;
  /** Events since the last stats message, oldest first. */
  newFeed: FeedItem[];
}

export type SimMessage =
  | { kind: 'ready'; version: number }
  | WorldMessage
  | FrameMessage
  | StatsMessage
  | { kind: 'detail'; id: number; detail: AgentDetail | null }
  | { [K in keyof QueryResults]: { kind: 'query-result'; reqId: number; name: K; result: QueryResults[K] } }[keyof QueryResults]
  /** A query that can never be answered — the asker must not wait forever. */
  | { kind: 'query-failed'; reqId: number; message: string }
  /**
   * A conscious being needs a model. `prompt` is the exact message set the
   * engine composed (retry feedback already folded in); `input` is the
   * situation behind it, for a bridge that reasons rather than transports.
   */
  | { kind: 'llm-request'; reqId: number; prompt: unknown; input: unknown }
  | { kind: 'error'; message: string };
