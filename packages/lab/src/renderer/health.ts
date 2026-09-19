/**
 * Whether this renderer is actually WELL — the one read-out that has to be zero
 * before any other number in this view means anything.
 *
 * For four rounds a shipped shader failed to compile on every boot. No test saw
 * it, no session saw it, and no reviewer saw it, because the three ways a
 * WebGL renderer goes wrong are all silent to the ways a page is usually
 * watched: three catches a shader compile failure and writes it to
 * `console.error`, which `pageerror` does not raise; a lost context stops the
 * picture without throwing; and a `console.error` from anywhere else is a
 * fault nobody is subscribed to.
 *
 * So all three are counted, in one place, and `window.__ygg.health()` reports
 * the counts with the first few messages. A session that measures anything
 * while these are non-zero is measuring a broken instrument.
 *
 * Nothing here touches three or the DOM: the console tap is handed whatever
 * object owns `error`, so it is testable in node, and the caller wires the
 * WebGL half.
 */

export interface HealthReport {
  /** Programs three could not compile or link since this view was built. */
  shaderErrors: number;
  /** `console.error` calls from anywhere in the renderer, including three's. */
  consoleErrors: number;
  /** How many times the WebGL context has been lost. */
  webglContextLost: number;
  /**
   * Uncaught errors and rejected promises raised by the PAGE.
   *
   * A reviewer's blind spot, and he named it: a renderer `window.onerror` is not
   * a `console.error`, so a live `ResizeObserver loop completed with undelivered
   * notifications` left every count at zero. Counted here so "health is zero"
   * means all four ways this view can be broken, not three of them.
   */
  windowErrors: number;
  /**
   * Instanced meshes in the scene that three is allowed to frustum-cull and
   * whose bounds nobody refreshes.
   *
   * This is the round-five defect, made countable. `this.windows` was created
   * with `count = 0`, three cached an EMPTY bounding sphere on its first frustum
   * test and never recomputed it after `setMatrixAt`, and every hut was dark at
   * midnight for the life of the view — with `shaderErrors`, `consoleErrors` and
   * `webglContextLost` all zero, because the program linked perfectly and drew
   * nothing. A non-zero count here names the mesh in `notes`.
   */
  cullRisks: number;
  /** The first few messages behind those counts, for a session log. */
  notes: string[];
}

export interface Health {
  report(): HealthReport;
  noteShaderError(text: string): void;
  noteConsoleError(text: string): void;
  noteContextLost(text: string): void;
  noteWindowError(text: string): void;
  /** Replace the culling read-out — it is a state of the scene, not an event. */
  setCullRisks(names: readonly string[]): void;
}

/** How many messages are kept — enough to name the fault, not a log sink. */
export const HEALTH_NOTE_CAP = 8;

export function createHealth(cap = HEALTH_NOTE_CAP): Health {
  let shaderErrors = 0;
  let consoleErrors = 0;
  let webglContextLost = 0;
  let windowErrors = 0;
  let culled: string[] = [];
  const notes: string[] = [];
  const note = (text: string): void => {
    if (notes.length < cap) notes.push(text.length > 400 ? `${text.slice(0, 400)}…` : text);
  };
  return {
    report: () => ({
      shaderErrors,
      consoleErrors,
      webglContextLost,
      windowErrors,
      cullRisks: culled.length,
      notes: [...notes, ...culled.map((n) => `cull: ${n} may be culled on a stale bounding sphere`)],
    }),
    noteShaderError: (text) => { shaderErrors++; note(`shader: ${text}`); },
    noteConsoleError: (text) => { consoleErrors++; note(`console: ${text}`); },
    noteContextLost: (text) => { webglContextLost++; note(`webgl: ${text}`); },
    noteWindowError: (text) => { windowErrors++; note(`window: ${text}`); },
    setCullRisks: (names) => { culled = [...names]; },
  };
}

/**
 * The console tap, as ONE wrapper with a set of listeners.
 *
 * React mounts this view twice in development and a second wrapper around the
 * first would survive the first one being removed — a tap that leaks a layer
 * per mount and then reports for a world that no longer exists. So the wrapper
 * is installed once, listeners come and go under it, and the original is
 * restored when the last one leaves.
 */
const listeners = new Set<(text: string) => void>();
let original: ((...args: unknown[]) => void) | null = null;

interface ErrorSink { error(...args: unknown[]): void }

export function onConsoleError(sink: ErrorSink, listener: (text: string) => void): () => void {
  if (original === null) {
    // The function ITSELF, not a bound copy: restoring has to leave the sink
    // holding exactly what it was holding, or a second tap on a "restored"
    // console wraps a wrapper.
    const prior = sink.error as (...args: unknown[]) => void;
    original = prior;
    sink.error = (...args: unknown[]): void => {
      const text = args.map((a) => (a instanceof Error ? a.message : String(a))).join(' ');
      for (const fn of [...listeners]) fn(text);
      prior.apply(sink, args);
    };
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && original !== null) {
      sink.error = original as ErrorSink['error'];
      original = null;
    }
  };
}

/**
 * The page's own faults: an uncaught error and a rejected promise nobody
 * handled.
 *
 * Separate from the console tap because they arrive by a different door and one
 * does not imply the other. Typed against the bare `EventTarget` shape so this
 * stays testable in node.
 */
export interface EventSource {
  addEventListener(type: string, fn: (e: unknown) => void): void;
  removeEventListener(type: string, fn: (e: unknown) => void): void;
}

export function onWindowError(source: EventSource, listener: (text: string) => void): () => void {
  const onError = (e: unknown): void => {
    const ev = e as { message?: unknown; error?: unknown } | null;
    listener(String(ev?.message ?? ev?.error ?? e));
  };
  const onReject = (e: unknown): void => {
    const ev = e as { reason?: unknown } | null;
    const reason = ev?.reason;
    listener(`unhandled rejection: ${reason instanceof Error ? reason.message : String(reason ?? e)}`);
  };
  source.addEventListener('error', onError);
  source.addEventListener('unhandledrejection', onReject);
  return () => {
    source.removeEventListener('error', onError);
    source.removeEventListener('unhandledrejection', onReject);
  };
}
