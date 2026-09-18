import { SimHost } from './host.js';
import { PROTOCOL_VERSION, type SimCommand, type SimMessage } from './protocol.js';

/**
 * The sim worker: a shell around SimHost. Everything worth testing lives in the
 * host, which is a plain class; this file is the only part that needs a real
 * Worker to run.
 */

// The renderer typechecks against lib.dom, which types `self` as a Window. The
// worker globals we use are a three-method subset; declaring it structurally is
// cheaper (and safer) than pulling lib.webworker into the whole renderer.
interface WorkerScope {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: 'message', handler: (event: MessageEvent<SimCommand>) => void): void;
}
const scope = globalThis as unknown as WorkerScope;

const host = new SimHost(
  { post: (message, transfer) => scope.postMessage(message, transfer ?? []) },
  () => performance.now(),
);

/**
 * The pump loop.
 *
 * Short waits self-post over a MessageChannel rather than `setTimeout(0)`:
 * nested timeouts are clamped to 4 ms, which would cost a third of the sim's
 * budget. Longer waits use a real timer, so a paused world — or a 1× world
 * whose next tick is three seconds away — costs nothing at all instead of
 * spinning a core. Commands land on the same task queue and cancel any pending
 * sleep, so a click is never left waiting behind a timer.
 */
const IMMEDIATE_MS = 2;
const loop = new MessageChannel();
let posted = false;
let timer = 0;

function wake(): void {
  if (posted || timer !== 0) return;
  const wait = host.nextWakeMs();
  if (wait < 0) return; // nothing to do until a command arrives
  if (wait <= IMMEDIATE_MS) {
    posted = true;
    loop.port2.postMessage(0);
  } else {
    // @types/node is in this project's graph, so setTimeout is typed as Node's.
    timer = setTimeout(onTimer, wait) as unknown as number;
  }
}

function onTimer(): void {
  timer = 0;
  host.pump();
  wake();
}

loop.port1.onmessage = (): void => {
  posted = false;
  host.pump();
  wake();
};

scope.addEventListener('message', (event) => {
  host.handle(event.data);
  if (timer !== 0) {
    clearTimeout(timer); // the command may have made work due sooner
    timer = 0;
  }
  wake();
});

const ready: SimMessage = { kind: 'ready', version: PROTOCOL_VERSION };
scope.postMessage(ready);
