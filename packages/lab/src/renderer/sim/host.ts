import { Experiment, TICKS_PER_DAY } from '@yggdrasil/engine';
import type { IMindBackend, SimEvent, ThinkInput } from '@yggdrasil/engine';
import {
  allocFrameArrays,
  beingCapacity,
  frameBuffers,
  isDetached,
  KindCodec,
  resourceBuffers,
  STATE_ACTIVE,
  STATE_HUNGRY,
  STATE_SICK,
  STATE_SLEEPING,
  wildlifeCapacity,
  type FeedItem,
  type FrameArrays,
  type QueryRequest,
  type SimCommand,
  type SimMessage,
  type StructureUpdate,
} from './protocol.js';

/**
 * Wall-clock time model (unchanged from the in-thread clock it replaces): at 1×
 * one sim-day takes 2 real hours, and faster presets fast-forward from there.
 * Movement is interpolated between ticks so beings glide even when a tick is
 * several seconds long.
 */
export const REAL_SECONDS_PER_DAY_AT_1X = 2 * 3600;
export const TICKS_PER_SECOND_AT_1X = TICKS_PER_DAY / REAL_SECONDS_PER_DAY_AT_1X;

/**
 * Longest the host simulates without returning to its caller. Inside a worker
 * the *only* reason to yield is command latency, so this is the worst-case
 * delay before a click is answered — everything else is pure overhead, paid
 * once per slice. Measured over 10 s at 2400× on a 300-being world, yielding
 * between pumps as the worker does: 8 ms → 698 ticks/s, 16 ms → 796, 32 ms →
 * 798, against the 800 ticks/s that 2400× asks for. 16 reaches the asked-for
 * rate; 32 adds nothing and doubles the worst case for a click.
 *
 * Ticks that do not fit are dropped, never queued: a world that cannot keep up
 * runs slower — and says so, through `achievedMult`.
 */
const ADVANCE_BUDGET_MS = 16;
/** Ticks per uninterrupted chunk — bounds how far a single chunk can overshoot the budget. */
const TICK_CHUNK = 4;
const FRAME_INTERVAL_MS = 15;
const STATS_INTERVAL_MS = 250;
const DETAIL_INTERVAL_MS = 500;
const STRUCTURE_SCAN_MS = 500;
const FEED_CAP = 50;
/** Recycled frame buffers held back from the pool's growth. */
const POOL_MAX = 3;

export interface HostPort {
  post(message: SimMessage, transfer?: ArrayBuffer[]): void;
}

/** Per-being interpolation + heading track, updated in place (never reallocated). */
interface Track {
  x: number;
  y: number;
  px: number;
  py: number;
  heading: number;
  state: number;
  stamp: number;
}

/**
 * The renderer-side mind backend, moved into the worker. It is pure transport:
 * a conscious being's situation goes out as an `llm-request`, the UI thread
 * forwards it over the preload bridge (where the Fireworks key lives, in main),
 * and the model's raw text comes back as an `llm-result`. All
 * parsing/validation/fallback stays in the engine's LlmMind.
 */
export class ProxyMindBackend implements IMindBackend {
  private seq = 0;
  private readonly pending = new Map<number, { resolve: (text: string) => void; reject: (e: Error) => void }>();

  constructor(
    readonly modelId: string,
    private readonly port: HostPort,
  ) {}

  complete(input: ThinkInput, retryError?: string): Promise<string> {
    const reqId = ++this.seq;
    return new Promise<string>((resolve, reject) => {
      this.pending.set(reqId, { resolve, reject });
      this.port.post({ kind: 'llm-request', reqId, input, ...(retryError ? { retryError } : {}) });
    });
  }

  settle(reqId: number, text?: string, error?: string): void {
    const waiter = this.pending.get(reqId);
    if (!waiter) return; // a reply for a disposed world
    this.pending.delete(reqId);
    if (error !== undefined) waiter.reject(new Error(error));
    else waiter.resolve(text ?? '');
  }

  /** Fail everything in flight — the world they were thinking for is gone. */
  abort(): void {
    for (const waiter of this.pending.values()) waiter.reject(new Error('DISPOSED'));
    this.pending.clear();
  }
}

/** Humanize raw event types for the feed. */
function eventPhrase(type: string, payload: Record<string, unknown>): string {
  switch (type) {
    case 'GatherSucceeded': return payload['dug'] ? `dug ${payload['objectKind']}` : `gathered ${payload['objectKind'] ?? 'something'}`;
    case 'GatherFailed': return 'found nothing to gather';
    case 'AteFood': return `ate ${payload['objectKind'] ?? 'food'}`;
    case 'BecameSick': return 'fell sick';
    case 'Recovered': return 'recovered';
    case 'AgentDied': return `died (${payload['cause'] ?? 'unknown'})`;
    case 'BuiltStructure': return `built a ${payload['buildKind'] ?? 'structure'}`;
    case 'SeedDeposited': return 'planted a seed';
    case 'PlantSprouted': return 'watched a seed sprout';
    case 'GaveItem': return `shared ${payload['objectKind'] ?? 'an item'}`;
    case 'AttackedAgent': return 'attacked another';
    case 'AttackedByPredator': return `was attacked by a ${payload['predator'] ?? 'predator'}!`;
    case 'FoughtPredator': return `fought off a ${payload['predator'] ?? 'predator'}`;
    case 'KilledPredator': return `KILLED a ${payload['predator'] ?? 'predator'}!`;
    case 'Crafted': return `crafted a ${payload['made'] ?? 'tool'}`;
    case 'ChildBorn': return 'a child was born';
    case 'SleptInShelter': case 'Slept': return 'slept';
    // "IntentRejected" = a plan step the world wouldn't allow (e.g. out of range,
    // no wood) — the agent just tries something else. Normal, not an error.
    case 'IntentRejected': return `couldn't ${payload['intentKind'] ?? 'act'} (${payload['reason'] ?? '—'})`;
    default: return type.replace(/([A-Z])/g, ' $1').trim().toLowerCase();
  }
}

/**
 * Owns the Experiment and the sim clock, off the UI thread.
 *
 * Deliberately a plain class over a `HostPort` and an injected clock: the
 * worker is a ten-line shell around it, and the whole thing — command
 * handling, pacing, frame encoding, equivalence with an in-thread run — is
 * testable in Node with no Worker at all.
 */
export class SimHost {
  private exp: Experiment | null = null;
  private backend: ProxyMindBackend | null = null;
  private running = false;
  private speedMult = 1;
  private framesOn = true;
  private selectedId: number | null = null;

  private accumulator = 0;
  private lastPump = 0;
  private lastFrame = 0;
  private lastStats = 0;
  private lastDetail = 0;
  private lastStructureScan = 0;
  /** Wall time of the last advance + how long the step it produced should take. */
  private stepWall = 0;
  private stepDurationMs = 0;

  private readonly tracks = new Map<number, Track>();
  private snapshotSeq = 0;
  private readonly animalKinds = new KindCodec();
  private wildIds = new Int32Array(0);
  private wildPos = new Float32Array(0);
  private wildKind = new Uint8Array(0);
  private wildCount = 0;
  private readonly seenStructures = new Set<number>();
  private structureQueue: StructureUpdate[] = [];
  private lastEventCount = 0;
  private feedSeq = 0;
  private readonly pool: FrameArrays[] = [];

  /** True when ticks have run since the last capture — the frame owes a snapshot. */
  private stale = false;
  /** Achieved-speed window: ticks actually run since `rateWindowStart`. */
  private rateTicks = 0;
  private rateWindowStart = 0;
  private achievedMult = 0;
  private ticksDropped = 0;

  constructor(
    private readonly port: HostPort,
    private readonly now: () => number,
  ) {}

  /** The live experiment. Exposed for the equivalence test; nothing else reads it. */
  get experiment(): Experiment | null {
    return this.exp;
  }

  /**
   * Milliseconds until the host next has something to do, or -1 when it has
   * nothing at all (no world, or paused). The worker sleeps on this instead of
   * spinning: a paused or slow world must not keep a core warm.
   */
  nextWakeMs(): number {
    if (!this.exp || !this.running) return -1;
    const now = this.now();
    let wait = this.lastStats + STATS_INTERVAL_MS - now;
    if (this.framesOn) wait = Math.min(wait, this.lastFrame + FRAME_INTERVAL_MS - now);
    if (this.selectedId !== null) wait = Math.min(wait, this.lastDetail + DETAIL_INTERVAL_MS - now);
    const ticksPerMs = (TICKS_PER_SECOND_AT_1X * this.speedMult) / 1000;
    if (ticksPerMs > 0) wait = Math.min(wait, (1 - this.accumulator) / ticksPerMs);
    return Math.max(0, wait);
  }

  handle(cmd: SimCommand): void {
    try {
      this.dispatch(cmd);
    } catch (e) {
      // A throw must never leave the asker waiting: a query gets a refusal it
      // can settle on, anything else gets reported.
      const message = e instanceof Error ? e.message : String(e);
      if (cmd.kind === 'query') this.port.post({ kind: 'query-failed', reqId: cmd.reqId, message });
      else this.port.post({ kind: 'error', message });
    }
  }

  private dispatch(cmd: SimCommand): void {
    switch (cmd.kind) {
      case 'create':
        this.create(cmd.seed, cmd.population, cmd.llm);
        break;
      case 'run':
        this.running = cmd.running;
        this.lastPump = 0; // a resume must not catch up on the time it was paused
        this.accumulator = 0;
        this.resetRateWindow();
        if (!cmd.running) {
          this.emitFrame(this.now());
          this.emitStats();
        }
        break;
      case 'speed':
        this.speedMult = cmd.mult > 0 ? cmd.mult : 1;
        this.accumulator = 0;
        this.resetRateWindow();
        break;
      case 'frames':
        this.framesOn = cmd.on;
        if (cmd.on) {
          this.scanStructures(); // catch up on everything raised while nobody looked
          this.capture(this.now());
          this.emitFrame(this.now());
        }
        break;
      case 'select':
        this.selectedId = cmd.id;
        this.emitDetail();
        break;
      case 'idea':
        this.exp?.giveIdea(cmd.text, cmd.targetId);
        break;
      case 'query':
        this.answer(cmd.reqId, cmd.request);
        break;
      case 'ack':
        if (this.pool.length < POOL_MAX && !isDetached(cmd.arrays)) this.pool.push(cmd.arrays);
        break;
      case 'llm-result':
        this.backend?.settle(cmd.reqId, cmd.text, cmd.error);
        break;
      case 'dispose':
        this.dispose();
        break;
    }
  }

  /**
   * One slice of work: advance the world by however much wall time has passed
   * (bounded by the budget), then emit whatever is due.
   *
   * Reading the world is deliberately NOT part of advancing it. `agentInfos()`
   * and `animals()` allocate a fresh object per being per call, and a pump at
   * 2400× happens ~700×/s — ten times the rate anything is drawn at. So a
   * snapshot is taken only when a frame is actually going out.
   */
  pump(): void {
    const exp = this.exp;
    if (!exp || !this.running) return;
    const now = this.now();
    const dt = this.lastPump ? now - this.lastPump : 16;
    this.lastPump = now;

    this.accumulator += (dt * TICKS_PER_SECOND_AT_1X * this.speedMult) / 1000;
    const due = Math.floor(this.accumulator);
    if (due > 0) {
      this.accumulator -= due;
      const done = this.advanceTicks(due);
      this.ticksDropped += due - done;
      this.rateTicks += done;
      if (done > 0) {
        this.stale = true;
        // Only while something is drawing: the scan queues work for the next
        // frame, and with no frames coming that queue would grow for as long as
        // the world is left on another tab.
        const after = this.now();
        if (this.framesOn && after - this.lastStructureScan >= STRUCTURE_SCAN_MS) {
          this.lastStructureScan = after;
          this.scanStructures();
        }
      }
    }

    if (this.framesOn && now - this.lastFrame >= FRAME_INTERVAL_MS) {
      this.capture(now);
      this.emitFrame(now);
    }
    if (now - this.lastStats >= STATS_INTERVAL_MS) this.emitStats();
    if (this.selectedId !== null && now - this.lastDetail >= DETAIL_INTERVAL_MS) this.emitDetail();
  }

  /**
   * Read the world into the interpolation tracks, once per frame at most. The
   * span between two captures is the step the next frames interpolate across —
   * three seconds at 1×, sixteen milliseconds at 2400×.
   */
  private capture(now: number): void {
    if (!this.stale) return;
    this.stale = false;
    this.rollTracks();
    this.snapshot();
    this.stepDurationMs = Math.max(16, now - this.stepWall);
    this.stepWall = now;
  }

  private resetRateWindow(): void {
    this.rateTicks = 0;
    this.rateWindowStart = this.now();
    this.achievedMult = 0;
  }

  // ── world lifecycle ────────────────────────────────────────────────────────

  private create(seed: string, population: number, llm: { model: string } | null): void {
    this.dispose();
    this.backend = llm ? new ProxyMindBackend(llm.model, this.port) : null;
    const exp = new Experiment({ seed, agentCount: population, ...(this.backend ? { mindBackend: this.backend } : {}) });
    this.exp = exp;
    this.accumulator = 0;
    this.lastPump = 0;
    this.lastEventCount = exp.eventCount;
    this.stepWall = this.now();
    this.stepDurationMs = 0;
    this.stale = false;
    this.ticksDropped = 0;
    this.resetRateWindow();
    this.snapshot(); // a fresh world has nowhere to interpolate from: px === x

    const nodes = exp.resourceNodes();
    const kinds = new KindCodec();
    const pos = new Float32Array(nodes.length * 2);
    const kind = new Uint8Array(nodes.length);
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i]!;
      pos[i * 2] = n.x;
      pos[i * 2 + 1] = n.y;
      kind[i] = kinds.codeOf(n.kind);
    }
    const resources = { kinds: kinds.names(), count: nodes.length, pos, kind };
    this.port.post({ kind: 'world', seed, population, backend: exp.backendLabel, resources }, resourceBuffers(resources));
    this.scanStructures();
    this.emitFrame(this.now());
    this.emitStats();
  }

  private dispose(): void {
    this.backend?.abort();
    this.backend = null;
    this.exp = null;
    this.running = false;
    this.tracks.clear();
    this.seenStructures.clear();
    this.structureQueue = [];
    this.wildCount = 0;
    this.selectedId = null;
    this.pool.length = 0;
    this.stale = false;
  }

  // ── simulation ─────────────────────────────────────────────────────────────

  private advanceTicks(due: number): number {
    const exp = this.exp!;
    const started = this.now();
    let done = 0;
    while (done < due) {
      const chunk = Math.min(TICK_CHUNK, due - done);
      exp.advance(chunk);
      done += chunk;
      if (this.now() - started >= ADVANCE_BUDGET_MS) break; // the rest is dropped, not queued
    }
    return done;
  }

  /** Current positions become previous — the frames until the next advance interpolate across this step. */
  private rollTracks(): void {
    for (const t of this.tracks.values()) {
      t.px = t.x;
      t.py = t.y;
    }
  }

  /** Read tick-state into the tracks + the wildlife buffers. One pass, no allocation per being. */
  private snapshot(): void {
    const exp = this.exp!;
    const stamp = ++this.snapshotSeq;
    for (const a of exp.agentInfos()) {
      if (!a.alive) continue;
      const state = a.sick ? STATE_SICK : a.sleeping ? STATE_SLEEPING : a.hungerCritical ? STATE_HUNGRY : STATE_ACTIVE;
      const t = this.tracks.get(a.id);
      if (!t) {
        this.tracks.set(a.id, { x: a.x, y: a.y, px: a.x, py: a.y, heading: 0, state, stamp });
        continue;
      }
      // Face the direction of travel; a being that barely moved keeps its heading.
      const dx = a.x - t.x;
      const dy = a.y - t.y;
      if (dx * dx + dy * dy > 0.0004) t.heading = Math.atan2(dx, dy);
      t.x = a.x;
      t.y = a.y;
      t.state = state;
      t.stamp = stamp;
    }
    for (const [id, t] of this.tracks) if (t.stamp !== stamp) this.tracks.delete(id);

    const animals = exp.animals();
    if (this.wildIds.length < animals.length) {
      const cap = Math.max(64, Math.ceil(animals.length * 1.5));
      this.wildIds = new Int32Array(cap);
      this.wildPos = new Float32Array(cap * 2);
      this.wildKind = new Uint8Array(cap);
    }
    for (let i = 0; i < animals.length; i++) {
      const a = animals[i]!;
      this.wildIds[i] = a.id;
      this.wildPos[i * 2] = a.x;
      this.wildPos[i * 2 + 1] = a.y;
      this.wildKind[i] = this.animalKinds.codeOf(a.kind);
    }
    this.wildCount = animals.length;
  }

  private scanStructures(): void {
    const exp = this.exp;
    if (!exp) return;
    for (const s of exp.structures()) {
      if (this.seenStructures.has(s.id)) continue;
      this.seenStructures.add(s.id);
      this.structureQueue.push({ id: s.id, x: s.x, y: s.y, kind: s.kind });
    }
  }

  // ── emission ───────────────────────────────────────────────────────────────

  /** 0..1 progress from the previous tick-state toward the current one. */
  private frameProgress(now: number): number {
    if (this.stepDurationMs <= 0) return 1;
    return Math.min(1, (now - this.stepWall) / this.stepDurationMs);
  }

  private takeArrays(beings: number, wildlife: number): FrameArrays {
    for (let i = this.pool.length - 1; i >= 0; i--) {
      const a = this.pool[i]!;
      if (isDetached(a)) {
        this.pool.splice(i, 1);
        continue;
      }
      if (beingCapacity(a) >= beings && wildlifeCapacity(a) >= wildlife) {
        this.pool.splice(i, 1);
        return a;
      }
    }
    return allocFrameArrays(Math.max(64, Math.ceil(beings * 1.5)), Math.max(64, Math.ceil(wildlife * 1.5)));
  }

  private emitFrame(now: number): void {
    const exp = this.exp;
    if (!exp) return;
    this.lastFrame = now;
    const alive = this.tracks.size;
    const arrays = this.takeArrays(alive, this.wildCount);
    const t = this.frameProgress(now);
    let i = 0;
    const cap = beingCapacity(arrays);
    for (const [id, track] of this.tracks) {
      if (i >= cap) break; // impossible: the arrays were sized for this population
      arrays.ids[i] = id;
      arrays.pos[i * 2] = track.px + (track.x - track.px) * t;
      arrays.pos[i * 2 + 1] = track.py + (track.y - track.py) * t;
      arrays.heading[i] = track.heading;
      arrays.state[i] = track.state;
      i++;
    }
    const wild = Math.min(this.wildCount, wildlifeCapacity(arrays));
    arrays.wildIds.set(this.wildIds.subarray(0, wild));
    arrays.wildPos.set(this.wildPos.subarray(0, wild * 2));
    arrays.wildKind.set(this.wildKind.subarray(0, wild));

    const structures = this.structureQueue;
    this.structureQueue = [];
    this.port.post(
      {
        kind: 'frame',
        tick: exp.tick,
        day: exp.day(),
        beings: i,
        beingsAlive: alive,
        wildlife: wild,
        wildlifeTotal: this.wildCount,
        animalKinds: this.animalKinds.drain(),
        structures,
        arrays,
      },
      frameBuffers(arrays),
    );
  }

  /**
   * How fast the world is really running, as a multiple of 1×. Measured over a
   * window of at least 400 ms so one slow slice cannot make the read-out jitter;
   * a paused world reports 0.
   */
  private updateAchieved(now: number): void {
    const elapsed = now - this.rateWindowStart;
    if (!this.running) {
      this.achievedMult = 0;
      return;
    }
    if (elapsed < 400) return;
    this.achievedMult = (this.rateTicks * 1000) / elapsed / TICKS_PER_SECOND_AT_1X;
    this.rateTicks = 0;
    this.rateWindowStart = now;
  }

  private emitStats(): void {
    const exp = this.exp;
    if (!exp) return;
    this.lastStats = this.now();
    this.updateAchieved(this.lastStats);
    const produced = exp.eventCount - this.lastEventCount;
    this.lastEventCount = exp.eventCount;
    const take = Math.min(produced, FEED_CAP);
    const newFeed: FeedItem[] = take > 0 ? exp.recentEvents(take).map((e: SimEvent) => this.feedItem(exp, e)) : [];
    this.port.post({
      kind: 'stats',
      tick: exp.tick,
      day: exp.day(),
      alive: exp.aliveCount(),
      total: exp.agentIds.length,
      knowledge: exp.totalKnowledge(),
      exchanges: exp.exchangeCount,
      conflicts: exp.conflictCount,
      sickness: exp.sicknessCount,
      shares: exp.shareCount,
      seedPlants: exp.seedPlantCount,
      sprouts: exp.sproutCount,
      builds: exp.buildCount,
      backend: exp.backendLabel,
      deaths: Object.values(exp.deathsByCause).reduce((a, b) => a + b, 0),
      pending: exp.cognitionPending(),
      requestedMult: this.speedMult,
      achievedMult: Math.round(this.achievedMult * 10) / 10,
      ticksDropped: this.ticksDropped,
      newFeed,
    });
  }

  private feedItem(exp: Experiment, e: SimEvent): FeedItem {
    const seq = ++this.feedSeq;
    const day = Math.floor(e.tick / TICKS_PER_DAY) + 1;
    const utt = e.payload['utterance'] as { text?: string } | undefined;
    if (e.type === 'UtteranceSpoken' && utt?.text) {
      return { seq, day, kind: 'speech', who: exp.nameOf(e.actorId), text: utt.text };
    }
    return { seq, day, kind: 'event', who: exp.nameOf(e.actorId), text: eventPhrase(e.type, e.payload) };
  }

  private emitDetail(): void {
    const exp = this.exp;
    if (!exp) return;
    this.lastDetail = this.now();
    const id = this.selectedId;
    this.port.post({ kind: 'detail', id: id ?? -1, detail: id === null ? null : exp.agentDetail(id) });
  }

  private answer(reqId: number, request: QueryRequest): void {
    const exp = this.exp;
    if (!exp) {
      this.port.post({ kind: 'query-failed', reqId, message: 'NO_WORLD' });
      return;
    }
    switch (request.name) {
      case 'detail':
        this.port.post({ kind: 'query-result', reqId, name: 'detail', result: exp.agentDetail(request.id) });
        break;
      case 'analysis':
        this.port.post({ kind: 'query-result', reqId, name: 'analysis', result: exp.analysis() });
        break;
      case 'society':
        this.port.post({ kind: 'query-result', reqId, name: 'society', result: exp.society() });
        break;
      case 'culture':
        this.port.post({ kind: 'query-result', reqId, name: 'culture', result: { culture: exp.culture(), myth: exp.myth() } });
        break;
    }
  }
}
