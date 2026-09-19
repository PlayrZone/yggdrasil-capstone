import { describe, expect, it } from 'vitest';
import { SimClient, type SimFault, type WorkerLike } from '../src/renderer/sim/client.js';
import { allocFrameArrays, PROTOCOL_VERSION, type SimCommand, type SimMessage, type StatsMessage } from '../src/renderer/sim/protocol.js';

/** A worker that never runs anything — the test decides what it says and when it dies. */
class FakeWorker implements WorkerLike {
  readonly sent: SimCommand[] = [];
  terminated = 0;
  onmessage: ((event: { data: SimMessage }) => void) | null = null;
  onerror: ((event: { message?: string }) => void) | null = null;
  onmessageerror: ((event: unknown) => void) | null = null;

  postMessage(message: unknown): void {
    this.sent.push(message as SimCommand);
  }

  terminate(): void {
    this.terminated++;
  }

  deliver(message: SimMessage): void {
    this.onmessage?.({ data: message });
  }

  kinds(): string[] {
    return this.sent.map((c) => c.kind);
  }
}

function stats(day: number): StatsMessage {
  return {
    kind: 'stats', tick: day * 2400, day, alive: 10, total: 10, knowledge: 0, exchanges: 0, conflicts: 0,
    sickness: 0, shares: 0, seedPlants: 0, sprouts: 0, builds: 0, backend: 'reflex', deaths: 0, pending: 0,
    requestedMult: 2400, achievedMult: 2400, ticksDropped: 0, newFeed: [],
  };
}

function harness(wedgeMs = 5000): {
  client: SimClient;
  workers: FakeWorker[];
  worker: () => FakeWorker;
  clock: { advance: (ms: number) => void };
  faults: (SimFault | null)[];
} {
  const workers: FakeWorker[] = [];
  let t = 10_000;
  const client = new SimClient({
    spawn: () => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    },
    now: () => t,
    wedgeMs,
    watchdog: false,
  });
  const faults: (SimFault | null)[] = [];
  client.onFault((f) => faults.push(f));
  return { client, workers, worker: () => workers[workers.length - 1]!, clock: { advance: (ms) => { t += ms; } }, faults };
}

describe('SimClient — the sim cannot die quietly', () => {
  it('faults when the worker throws, and says what happened', () => {
    const { client, worker, faults } = harness();
    worker().onerror?.({ message: 'boom' });
    expect(client.currentFault?.reason).toContain('boom');
    expect(faults).toHaveLength(1);
  });

  it('faults when a message cannot be read', () => {
    const { client, worker } = harness();
    worker().onmessageerror?.({});
    expect(client.currentFault?.reason).toMatch(/could not read/);
  });

  it('faults on a protocol-version mismatch instead of reporting into the void', () => {
    const { client, worker } = harness();
    worker().deliver({ kind: 'ready', version: PROTOCOL_VERSION + 1 });
    expect(client.currentFault?.reason).toContain(`v${PROTOCOL_VERSION + 1}`);
  });

  it('accepts a matching version silently', () => {
    const { client, worker } = harness();
    worker().deliver({ kind: 'ready', version: PROTOCOL_VERSION });
    expect(client.currentFault).toBeNull();
  });

  it('rejects every pending request the moment it faults — no stuck in-flight latch', async () => {
    const { client, worker } = harness();
    const a = client.query({ name: 'analysis' });
    const b = client.query({ name: 'society' });
    worker().onerror?.({ message: 'boom' });
    await expect(a).rejects.toThrow(/boom/);
    await expect(b).rejects.toThrow(/boom/);
  });

  it('refuses new queries while faulted rather than leaving them hanging', async () => {
    const { client, worker } = harness();
    worker().onerror?.({ message: 'boom' });
    await expect(client.query({ name: 'analysis' })).rejects.toThrow(/boom/);
  });

  it('remembers the day the world froze at', () => {
    const { client, worker } = harness();
    worker().deliver(stats(7));
    worker().onerror?.({ message: 'boom' });
    expect(client.currentFault?.day).toBe(7);
  });
});

describe('SimClient — the wedged worker (no event at all)', () => {
  it('detects silence while the sim is supposed to be running', () => {
    const { client, worker, clock } = harness(5000);
    client.setRunning(true);
    worker().deliver(stats(3));
    clock.advance(3000);
    client.checkHealth();
    expect(client.currentFault).toBeNull(); // still within the grace period

    clock.advance(4000);
    client.checkHealth();
    expect(client.currentFault?.reason).toMatch(/stopped responding/);
    expect(client.currentFault?.day).toBe(3);
  });

  it('never fires while the sim is paused — silence is correct then', () => {
    const { client, clock } = harness(5000);
    client.setRunning(false);
    clock.advance(60_000);
    client.checkHealth();
    expect(client.currentFault).toBeNull();
  });

  it('never fires while frames and stats keep arriving', () => {
    const { client, worker, clock } = harness(5000);
    client.setRunning(true);
    for (let i = 0; i < 20; i++) {
      clock.advance(3000);
      worker().deliver(stats(i + 1));
      client.checkHealth();
    }
    expect(client.currentFault).toBeNull();
  });

  it('stops talking to a dead worker', () => {
    const { client, worker, clock } = harness(1000);
    client.setRunning(true);
    clock.advance(5000);
    client.checkHealth();
    const after = worker().sent.length;
    client.setSpeed(600);
    client.select(4);
    expect(worker().sent.length).toBe(after);
  });
});

describe('SimClient — restart', () => {
  it('throws away the dead worker, spawns a fresh one and clears the fault', () => {
    const { client, workers, worker, faults } = harness();
    worker().onerror?.({ message: 'boom' });
    expect(client.currentFault).not.toBeNull();

    client.restart();
    expect(workers).toHaveLength(2);
    expect(workers[0]!.terminated).toBe(1);
    expect(client.currentFault).toBeNull();
    expect(faults.at(-1)).toBeNull();

    // A fresh worker is told the speed and frame state it never heard, then the
    // world it is there to build.
    expect(worker().kinds()).toEqual(['speed', 'frames']);
    client.createWorld('genesis-01', 40, null);
    client.setRunning(true);
    expect(worker().kinds()).toEqual(['speed', 'frames', 'create', 'run']);
  });

  it('gives the fresh worker a clean grace period', () => {
    const { client, worker, clock } = harness(1000);
    client.setRunning(true);
    clock.advance(5000);
    client.checkHealth();
    client.restart();
    client.setRunning(true);
    client.checkHealth();
    expect(client.currentFault).toBeNull();
    worker().deliver(stats(1));
    expect(client.currentFault).toBeNull();
  });
});

describe('SimClient — normal traffic', () => {
  it('acks every frame so the worker pool never starves, even with no listener', () => {
    const { client, worker } = harness();
    client.createWorld('s', 10, null);
    worker().deliver({
      kind: 'frame', tick: 10, day: 1, beings: 0, beingsAlive: 0, wildlife: 0, wildlifeTotal: 0,
      animalKinds: [], structures: [], names: [], deaths: [], speech: [], daylight: 1, arrays: allocFrameArrays(4, 4),
    });
    expect(worker().kinds()).toEqual(['create', 'ack']);
    expect(client.currentFault).toBeNull();
  });

  it('settles a query by request id', async () => {
    const { client, worker } = harness();
    const pending = client.query({ name: 'society' });
    const sent = worker().sent.at(-1);
    const reqId = sent && sent.kind === 'query' ? sent.reqId : -1;
    worker().deliver({ kind: 'query-result', reqId, name: 'society', result: { influence: [] } as never });
    await expect(pending).resolves.toEqual({ influence: [] });
  });

  it('settles a refused query by request id', async () => {
    const { client, worker } = harness();
    const pending = client.query({ name: 'culture' });
    worker().deliver({ kind: 'query-failed', reqId: 1, message: 'NO_WORLD' });
    await expect(pending).rejects.toThrow('NO_WORLD');
  });
});

describe('SimClient — a new world gets a new worker', () => {
  it('keeps the first world on the worker it was born on', () => {
    const { client, workers, worker } = harness();
    client.createWorld('a', 10, null);
    expect(workers).toHaveLength(1);
    expect(worker().kinds()).toEqual(['create']);
  });

  /**
   * The whole point of the recycle: a worker that has grown a heap to hold a
   * few hundred minds does not give that memory back when the Experiment is
   * dropped. Terminating it does.
   */
  it('terminates the old worker and builds the second world on a fresh one', () => {
    const { client, workers } = harness();
    client.createWorld('a', 10, null);
    client.createWorld('b', 10, null);
    expect(workers).toHaveLength(2);
    expect(workers[0]!.terminated).toBe(1);
    const created = workers[1]!.sent.find((c) => c.kind === 'create');
    expect(created).toMatchObject({ kind: 'create', seed: 'b' });
  });

  it('tells the fresh worker the speed and frame state it was never told', () => {
    const { client, workers } = harness();
    client.setSpeed(600);
    client.setFrames(false);
    client.createWorld('a', 10, null);
    client.createWorld('b', 10, null);
    expect(workers[1]!.sent[0]).toEqual({ kind: 'speed', mult: 600 });
    expect(workers[1]!.sent[1]).toEqual({ kind: 'frames', on: false });
  });

  it('rejects anything still waiting on the world that is being replaced', async () => {
    const { client } = harness();
    client.createWorld('a', 10, null);
    const pending = client.query({ name: 'society' });
    client.createWorld('b', 10, null);
    await expect(pending).rejects.toThrow('NEW_WORLD');
  });

  it('does not recycle after a restart has already handed over a fresh worker', () => {
    const { client, workers } = harness();
    client.createWorld('a', 10, null);
    client.restart();
    client.createWorld('b', 10, null);
    expect(workers).toHaveLength(2);
  });
});
