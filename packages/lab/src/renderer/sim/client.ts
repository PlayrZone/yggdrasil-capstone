import {
  frameBuffers,
  PROTOCOL_VERSION,
  type FrameMessage,
  type QueryRequest,
  type QueryResults,
  type SimCommand,
  type SimMessage,
  type StatsMessage,
  type WorldMessage,
  type AgentDetail,
} from './protocol.js';

type Listener<T> = (value: T) => void;
type Unsubscribe = () => void;

function emit<T>(set: Set<Listener<T>>, value: T): void {
  for (const listener of set) listener(value);
}

/** The slice of `Worker` this client uses — so a test can supply a fake one. */
export interface WorkerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((event: { data: SimMessage }) => void) | null;
  onerror: ((event: { message?: string }) => void) | null;
  onmessageerror: ((event: unknown) => void) | null;
}

/** Why the simulation is no longer running, and where it got to. */
export interface SimFault {
  reason: string;
  /** The last day the UI saw. A frozen world is honest about when it froze. */
  day: number;
}

export interface SimClientOptions {
  /** How a worker is made. Injected by tests; defaults to the real sim worker. */
  spawn?: () => WorkerLike;
  now?: () => number;
  /** Silence, while the sim is meant to be running, that counts as death. */
  wedgeMs?: number;
  /** The internal watchdog timer. Tests drive `checkHealth()` by hand instead. */
  watchdog?: boolean;
}

const DEFAULT_WEDGE_MS = 5000;
const WATCHDOG_INTERVAL_MS = 1000;

function spawnSimWorker(): WorkerLike {
  return new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'yggdrasil-sim' }) as unknown as WorkerLike;
}

/**
 * The UI thread's handle on the sim worker.
 *
 * It imports the protocol and nothing else — no engine, no sim — so the
 * simulation cannot creep back onto this thread by an innocent import. Frame
 * buffers are handed to the listeners and then transferred straight back to the
 * worker for reuse, so a listener must read what it needs synchronously.
 *
 * It also watches the worker for death. A worker that throws, that is sent a
 * message it cannot read, that calls `close()` on itself, or that simply wedges
 * mid-tick all look the same from here: the frames stop. So the client tracks
 * when it last heard anything and, past `wedgeMs` of silence while the sim is
 * supposed to be running, declares a fault — every pending request rejects and
 * the UI is told, rather than animating a corpse.
 */
export class SimClient {
  private worker: WorkerLike;
  private readonly spawn: () => WorkerLike;
  private readonly now: () => number;
  private readonly wedgeMs: number;
  private watchdogTimer = 0;

  private reqSeq = 0;
  private readonly pending = new Map<number, { resolve: (value: never) => void; reject: (e: Error) => void }>();
  private readonly frameListeners = new Set<Listener<FrameMessage>>();
  private readonly statsListeners = new Set<Listener<StatsMessage>>();
  private readonly detailListeners = new Set<Listener<AgentDetail | null>>();
  private readonly worldListeners = new Set<Listener<WorldMessage>>();
  private readonly faultListeners = new Set<Listener<SimFault | null>>();

  private fault: SimFault | null = null;
  private lastDay = 0;
  private lastHeard = 0;
  private expectRunning = false;
  private disposed = false;

  constructor(options: SimClientOptions = {}) {
    this.spawn = options.spawn ?? spawnSimWorker;
    this.now = options.now ?? (() => Date.now());
    this.wedgeMs = options.wedgeMs ?? DEFAULT_WEDGE_MS;
    this.worker = this.attach(this.spawn());
    if (options.watchdog !== false) {
      this.watchdogTimer = setInterval(() => this.checkHealth(), WATCHDOG_INTERVAL_MS) as unknown as number;
    }
  }

  private attach(worker: WorkerLike): WorkerLike {
    worker.onmessage = (event): void => this.receive(event.data);
    worker.onerror = (event): void => this.fail(`the simulation worker crashed${event.message ? `: ${event.message}` : ''}`);
    worker.onmessageerror = (): void => this.fail('the simulation sent a message the interface could not read');
    this.lastHeard = this.now();
    return worker;
  }

  onFrame(listener: Listener<FrameMessage>): Unsubscribe {
    this.frameListeners.add(listener);
    return () => this.frameListeners.delete(listener);
  }

  onStats(listener: Listener<StatsMessage>): Unsubscribe {
    this.statsListeners.add(listener);
    return () => this.statsListeners.delete(listener);
  }

  onDetail(listener: Listener<AgentDetail | null>): Unsubscribe {
    this.detailListeners.add(listener);
    return () => this.detailListeners.delete(listener);
  }

  onWorld(listener: Listener<WorldMessage>): Unsubscribe {
    this.worldListeners.add(listener);
    return () => this.worldListeners.delete(listener);
  }

  /** Fires with a fault when the sim dies, and with null when a restart clears it. */
  onFault(listener: Listener<SimFault | null>): Unsubscribe {
    this.faultListeners.add(listener);
    if (this.fault) listener(this.fault);
    return () => this.faultListeners.delete(listener);
  }

  get currentFault(): SimFault | null {
    return this.fault;
  }

  createWorld(seed: string, population: number, llm: { model: string } | null): void {
    this.post({ kind: 'create', seed, population, llm });
  }

  setRunning(running: boolean): void {
    this.expectRunning = running;
    this.lastHeard = this.now(); // a resumed world gets the full grace period
    this.post({ kind: 'run', running });
  }

  setSpeed(mult: number): void {
    this.post({ kind: 'speed', mult });
  }

  /** Stop paying for frames nobody is drawing (the world tab is hidden). */
  setFrames(on: boolean): void {
    this.post({ kind: 'frames', on });
  }

  select(id: number | null): void {
    this.post({ kind: 'select', id });
  }

  giveIdea(text: string, targetId: number): void {
    this.post({ kind: 'idea', text, targetId });
  }

  query<R extends QueryRequest>(request: R): Promise<QueryResults[R['name']]> {
    if (this.fault) return Promise.reject(new Error(this.fault.reason));
    const reqId = ++this.reqSeq;
    return new Promise<QueryResults[R['name']]>((resolve, reject) => {
      this.pending.set(reqId, { resolve: resolve as (value: never) => void, reject });
      this.post({ kind: 'query', reqId, request });
    });
  }

  /**
   * Throw away the dead worker and start a fresh one. The caller creates the
   * world again — this only restores the channel.
   */
  restart(): void {
    if (this.disposed) return;
    try {
      this.worker.terminate();
    } catch {
      // a worker that already died has nothing to terminate
    }
    this.rejectPending('RESTARTED');
    this.expectRunning = false;
    this.fault = null;
    this.worker = this.attach(this.spawn());
    emit(this.faultListeners, null);
  }

  /**
   * Has the sim gone quiet? Called by the watchdog once a second; a test calls
   * it directly with a clock it controls.
   */
  checkHealth(): void {
    if (this.fault || this.disposed || !this.expectRunning) return;
    const silence = this.now() - this.lastHeard;
    if (silence > this.wedgeMs) this.fail(`the simulation stopped responding (${Math.round(silence / 1000)}s without an update)`);
  }

  dispose(): void {
    this.disposed = true;
    if (this.watchdogTimer !== 0) clearInterval(this.watchdogTimer);
    this.post({ kind: 'dispose' });
    this.worker.terminate();
    this.rejectPending('DISPOSED');
  }

  private post(command: SimCommand, transfer?: Transferable[]): void {
    if (this.fault || this.disposed) return; // nothing is listening on the other end
    this.worker.postMessage(command, transfer ?? []);
  }

  /** No answer is ever coming; a caller waiting on one would poll no further. */
  private rejectPending(message: string): void {
    const waiting = [...this.pending.values()];
    this.pending.clear();
    for (const waiter of waiting) waiter.reject(new Error(message));
  }

  private fail(reason: string): void {
    if (this.fault || this.disposed) return;
    this.fault = { reason, day: this.lastDay };
    this.expectRunning = false;
    this.rejectPending(reason);
    emit(this.faultListeners, this.fault);
  }

  private receive(message: SimMessage): void {
    this.lastHeard = this.now();
    switch (message.kind) {
      case 'frame':
        this.lastDay = message.day;
        emit(this.frameListeners, message);
        // Always acked, even with nothing listening: the worker's buffer pool
        // refills from these, and a swallowed frame would starve it.
        this.post({ kind: 'ack', arrays: message.arrays }, frameBuffers(message.arrays));
        break;
      case 'stats':
        this.lastDay = message.day;
        emit(this.statsListeners, message);
        break;
      case 'detail':
        emit(this.detailListeners, message.detail);
        break;
      case 'world':
        emit(this.worldListeners, message);
        break;
      case 'query-result': {
        const waiter = this.pending.get(message.reqId);
        if (waiter) {
          this.pending.delete(message.reqId);
          (waiter.resolve as (value: unknown) => void)(message.result);
        }
        break;
      }
      case 'query-failed': {
        const waiter = this.pending.get(message.reqId);
        if (waiter) {
          this.pending.delete(message.reqId);
          waiter.reject(new Error(message.message));
        }
        break;
      }
      case 'llm-request':
        this.forwardThink(message.reqId, message.input, message.retryError);
        break;
      case 'ready':
        if (message.version !== PROTOCOL_VERSION) {
          this.fail(`the simulation speaks protocol v${message.version}, this interface speaks v${PROTOCOL_VERSION}`);
        }
        break;
      case 'error':
        this.fail(`the simulation reported: ${message.message}`);
        break;
    }
  }

  /**
   * The LLM bridge proxy. A worker has no `window.lab`, so a conscious being's
   * think request comes here, crosses the existing preload IPC (rate-limited
   * and schema-checked in main, where the key lives), and the raw text goes
   * back to the worker. Nothing about the key moves.
   */
  private forwardThink(reqId: number, input: unknown, retryError?: string): void {
    const lab = window.lab;
    const call = lab ? lab.llmComplete(input, retryError) : Promise.reject(new Error('NO_BRIDGE'));
    void call.then(
      (text) => this.post({ kind: 'llm-result', reqId, text }),
      (error: unknown) => this.post({ kind: 'llm-result', reqId, error: error instanceof Error ? error.message : String(error) }),
    );
  }
}
