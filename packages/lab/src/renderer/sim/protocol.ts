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

export const PROTOCOL_VERSION = 1;

/** Being state codes — the order the world view colours them in. */
export const STATE_ACTIVE = 0;
export const STATE_HUNGRY = 1;
export const STATE_SLEEPING = 2;
export const STATE_SICK = 3;

/** Kind codes ride in a Uint8; 255 is the "more kinds than fit" bucket. */
export const KIND_UNKNOWN = 255;
const MAX_KINDS = 255;

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
  who: string;
  text: string;
}

export interface StructureUpdate {
  id: number;
  x: number;
  y: number;
  kind: string;
}

// ── Frame buffers ────────────────────────────────────────────────────────────

/**
 * One frame of world state. Six buffers, transferred to the UI and transferred
 * straight back on `ack`, so the steady state is zero allocation on both sides.
 * `ids[i]`, `pos[2i]`/`pos[2i+1]`, `heading[i]` and `state[i]` describe being i.
 */
export interface FrameArrays {
  ids: Int32Array;
  pos: Float32Array;
  heading: Float32Array;
  state: Uint8Array;
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
    state: new Uint8Array(b),
    wildIds: new Int32Array(w),
    wildPos: new Float32Array(w * 2),
    wildKind: new Uint8Array(w),
  };
}

/** The buffers to hand to `postMessage`'s transfer list. */
export function frameBuffers(a: FrameArrays): ArrayBuffer[] {
  return [a.ids.buffer, a.pos.buffer, a.heading.buffer, a.state.buffer, a.wildIds.buffer, a.wildPos.buffer, a.wildKind.buffer] as ArrayBuffer[];
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
  | { name: 'analysis' }
  | { name: 'society' }
  | { name: 'culture' };

export interface QueryResults {
  detail: AgentDetail | null;
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
  | { kind: 'llm-request'; reqId: number; input: unknown; retryError?: string }
  | { kind: 'error'; message: string };
