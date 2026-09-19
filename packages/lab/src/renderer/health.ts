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
  /** The first few messages behind those counts, for a session log. */
  notes: string[];
}

export interface Health {
  report(): HealthReport;
  noteShaderError(text: string): void;
  noteConsoleError(text: string): void;
  noteContextLost(text: string): void;
}

/** How many messages are kept — enough to name the fault, not a log sink. */
export const HEALTH_NOTE_CAP = 8;

export function createHealth(cap = HEALTH_NOTE_CAP): Health {
  let shaderErrors = 0;
  let consoleErrors = 0;
  let webglContextLost = 0;
  const notes: string[] = [];
  const note = (text: string): void => {
    if (notes.length < cap) notes.push(text.length > 400 ? `${text.slice(0, 400)}…` : text);
  };
  return {
    report: () => ({ shaderErrors, consoleErrors, webglContextLost, notes: [...notes] }),
    noteShaderError: (text) => { shaderErrors++; note(`shader: ${text}`); },
    noteConsoleError: (text) => { consoleErrors++; note(`console: ${text}`); },
    noteContextLost: (text) => { webglContextLost++; note(`webgl: ${text}`); },
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
