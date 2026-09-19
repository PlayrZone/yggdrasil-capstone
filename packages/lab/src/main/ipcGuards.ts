/**
 * Guards for the IPC surface. `llm:complete` is the sharp edge: it takes
 * renderer-supplied objects and forwards them to a paid endpoint with the API
 * key attached, so a compromised or buggy renderer could previously spend money
 * at whatever rate and payload size it liked. Everything here is pure so it can
 * be tested without Electron.
 *
 * The call carries two halves. The PROMPT is the one that gets billed — the
 * engine composes it once, retry feedback already appended to `prompt.user`,
 * and a transport backend sends those bytes and nothing else. The INPUT is the
 * situation behind it, for backends that reason rather than transport; nothing
 * downstream may rebuild a prompt from it. So both are bounded, but the prompt
 * is bounded tightly and exactly, because it is the thing that costs money.
 */

export type Check = { ok: true } | { ok: false; reason: string };

const OK: Check = { ok: true };
const fail = (reason: string): Check => ({ ok: false, reason });

const TRIGGERS = new Set(['periodic', 'planCompleted', 'planFailed', 'wasAttacked', 'witnessedDeath', 'conversation', 'needCritical']);

/**
 * Structural bounds on a ThinkInput. Generous — a 150-being world at 2400× must
 * pass — but finite in every dimension a renderer controls.
 */
export const THINK_LIMITS = {
  /** Estimated serialized size of the whole payload. */
  bytes: 512 * 1024,
  /** Object-graph depth; also the recursion bound of the estimator. */
  depth: 24,
  memories: 512,
  knowledge: 1024,
  goals: 64,
  /** Per observed-entity array in the world view. */
  observed: 8192,
  relationships: 16384,
  stories: 512,
  kin: 512,
  social: 1024,
  tragedyPlaces: 64,
  string: 16384,
} as const;

/**
 * Bounds on the composed prompt, in UTF-8 BYTES — the unit a provider bills in.
 * `system` is a fixed preamble and `user` is the situation plus, on a retry,
 * the appended rejection reason; a real one runs a few kilobytes, so 64 KiB a
 * field leaves room for an unusually storied mind and still refuses a payload
 * built to run up a bill.
 */
export const PROMPT_LIMITS = {
  field: 64 * 1024,
  total: 128 * 1024,
} as const;

/**
 * A genuinely plain object — prototype `Object.prototype` or null. The loose
 * `typeof v === 'object' && !Array.isArray(v)` this replaces accepted a
 * `Uint8Array`: `Object.entries` on one materialises a `[string, number]` pair
 * per element, so a renderer could turn a 64e6-element view into an
 * out-of-memory kill of the main process before any budget check could fire.
 */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null) return false;
  const proto = Object.getPrototypeOf(v) as unknown;
  return proto === Object.prototype || proto === null;
}

const hasOwn = Object.prototype.hasOwnProperty;

function finite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function bounded(v: unknown, max: number): v is string {
  return typeof v === 'string' && v.length <= max;
}

function boundedArray(v: unknown, max: number, what: string): Check {
  if (!Array.isArray(v)) return fail(`${what} must be an array`);
  if (v.length > max) return fail(`${what} exceeds ${max}`);
  return OK;
}

/**
 * Approximate serialized size, short-circuiting the moment the budget is blown
 * so a hostile payload costs us O(budget), not O(payload). Walks Maps (which
 * survive structured clone but vanish from JSON.stringify) and refuses cycles.
 */
export interface SizeEstimate {
  bytes: number;
  over: boolean;
  cyclic: boolean;
  /** A value whose type has no place in a ThinkInput (TypedArray, Date, class instance…). */
  exotic: boolean;
}

/**
 * Approximate serialized size in UTF-8 BYTES, short-circuiting the moment the
 * budget is blown so a hostile payload costs us O(budget), not O(payload).
 *
 * Only the shapes a ThinkInput is made of are walked: plain objects, real
 * arrays and Map (which survives structured clone and carries `relationships`
 * but vanishes from JSON.stringify). Anything else — TypedArray, ArrayBuffer,
 * DataView, Set, Date, RegExp, Error, a class instance — is flagged `exotic`
 * and the walk stops there, in O(1), BEFORE any per-element work.
 */
export function estimateBytes(value: unknown, budget: number, maxDepth: number): SizeEstimate {
  let bytes = 0;
  let cyclic = false;
  let exotic = false;
  // Ancestors of the node being walked — shared (diamond) references are legal
  // and common in a world snapshot; only a node containing itself is a cycle.
  const path = new Set<object>();
  const done = (): boolean => bytes > budget || cyclic || exotic;

  const walk = (v: unknown, depth: number): void => {
    if (done()) return;
    if (depth > maxDepth) {
      bytes = budget + 1;
      return;
    }
    switch (typeof v) {
      case 'string':
        // Real UTF-8 length: counting UTF-16 units under-counts astral text 2×,
        // which would quietly double the effective cap.
        bytes += Buffer.byteLength(v, 'utf8') + 2;
        return;
      case 'number':
      case 'boolean':
        bytes += 8;
        return;
      case 'undefined':
        return;
      case 'object':
        break;
      default:
        exotic = true; // bigint / symbol / function
        return;
    }
    if (v === null) {
      bytes += 4;
      return;
    }
    const obj = v as object;
    if (path.has(obj)) {
      cyclic = true;
      return;
    }
    path.add(obj);
    if (Array.isArray(v)) {
      bytes += 2 + v.length;
      for (const item of v) {
        if (done()) break;
        walk(item, depth + 1);
      }
    } else if (v instanceof Map) {
      bytes += 2 + v.size * 2;
      for (const [k, item] of v) {
        if (done()) break;
        walk(k, depth + 1);
        walk(item, depth + 1);
      }
    } else if (isPlainObject(v)) {
      bytes += 2;
      // `for…in` with an own-check, not Object.keys/entries: no key array is
      // materialised up front, so an object with a million keys blows the
      // budget a few hundred keys in instead of paying for all of them.
      for (const k in v) {
        if (done()) break;
        if (!hasOwn.call(v, k)) continue;
        bytes += Buffer.byteLength(k, 'utf8') + 4;
        walk(v[k], depth + 1);
      }
    } else {
      exotic = true;
    }
    path.delete(obj);
  };

  walk(value, 0);
  return { bytes, over: bytes > budget, cyclic, exotic };
}

/** Structurally the engine's `ThinkPrompt`, restated so this file imports nothing. */
export interface ThinkPromptShape {
  system: string;
  user: string;
}

export type PromptCheck = { ok: true; prompt: ThinkPromptShape } | { ok: false; reason: string };

/**
 * Validate the composed prompt — the billed half of the call.
 *
 * Unlike a ThinkInput, this has no forward-compatible shape to preserve: the
 * engine's contract says a transport backend sends exactly `{system, user}`, so
 * anything else is either a bug or an attempt to smuggle extra billable text
 * past a field cap. Hence exact keys, not merely required ones.
 *
 * Returns a FRESH object on success, and that copy is what gets forwarded: it
 * pins the two strings at the instant they were measured, so nothing clever on
 * the caller's object — an accessor, a hidden property — can change what is
 * sent after it was approved.
 */
export function validateThinkPrompt(prompt: unknown): PromptCheck {
  if (!isPlainObject(prompt)) return { ok: false, reason: 'prompt must be a plain object' };
  // Key-by-key with an own-check rather than Object.keys: an object carrying a
  // million strangers is refused at the first one, without materialising a key
  // array. It also catches a JSON-parsed `__proto__`, which is an own key here.
  for (const k in prompt) {
    if (!hasOwn.call(prompt, k)) continue;
    if (k !== 'system' && k !== 'user') return { ok: false, reason: `unexpected key ${JSON.stringify(k.slice(0, 64))}` };
  }
  const fields: string[] = [];
  let total = 0;
  for (const k of ['system', 'user'] as const) {
    if (!hasOwn.call(prompt, k)) return { ok: false, reason: `${k} is missing` };
    const v = prompt[k];
    if (typeof v !== 'string') return { ok: false, reason: `${k} must be a string` };
    if (v.length === 0) return { ok: false, reason: `${k} must not be empty` };
    // A UTF-8 encoding is never shorter than the string's UTF-16 length, so an
    // over-long field is refused before it is measured.
    if (v.length > PROMPT_LIMITS.field || Buffer.byteLength(v, 'utf8') > PROMPT_LIMITS.field) {
      return { ok: false, reason: `${k} exceeds ${PROMPT_LIMITS.field} bytes` };
    }
    total += Buffer.byteLength(v, 'utf8');
    fields.push(v);
  }
  if (total > PROMPT_LIMITS.total) return { ok: false, reason: `prompt exceeds ${PROMPT_LIMITS.total} bytes` };
  return { ok: true, prompt: { system: fields[0]!, user: fields[1]! } };
}

/**
 * Validate what the renderer claims is a ThinkInput. Known fields are checked
 * by shape; unknown ones are tolerated (the engine's prompt builder only reads
 * known fields) but still counted against the size budget, so an unknown key
 * cannot be used to smuggle megabytes past the cap.
 */
export function validateThinkInput(input: unknown): Check {
  if (!isPlainObject(input)) return fail('input must be an object');

  const snapshot = input['snapshot'];
  if (!isPlainObject(snapshot)) return fail('snapshot must be an object');
  if (!finite(snapshot['id'])) return fail('snapshot.id must be a finite number');
  if (!bounded(snapshot['name'], THINK_LIMITS.string)) return fail('snapshot.name must be a bounded string');
  if (!isPlainObject(snapshot['traits'])) return fail('snapshot.traits must be an object');
  if (!isPlainObject(snapshot['needs'])) return fail('snapshot.needs must be an object');
  if (!isPlainObject(snapshot['inventory'])) return fail('snapshot.inventory must be an object');
  for (const k of ['health', 'x', 'y'] as const) {
    if (!finite(snapshot[k])) return fail(`snapshot.${k} must be a finite number`);
  }

  const worldView = input['worldView'];
  if (!isPlainObject(worldView)) return fail('worldView must be an object');
  if (!finite(worldView['tick'])) return fail('worldView.tick must be a finite number');
  if (!bounded(worldView['season'], 64)) return fail('worldView.season must be a short string');
  for (const k of ['agents', 'resources', 'structures'] as const) {
    const c = boundedArray(worldView[k], THINK_LIMITS.observed, `worldView.${k}`);
    if (!c.ok) return c;
  }

  for (const [key, max] of [
    ['recalledMemories', THINK_LIMITS.memories],
    ['knowledge', THINK_LIMITS.knowledge],
    ['goals', THINK_LIMITS.goals],
  ] as const) {
    const c = boundedArray(input[key], max, key);
    if (!c.ok) return c;
  }

  const trigger = input['trigger'];
  if (typeof trigger !== 'string' || !TRIGGERS.has(trigger)) return fail('trigger is not a known ThinkTrigger');

  const rel = input['relationships'];
  if (rel !== undefined) {
    if (!(rel instanceof Map)) return fail('relationships must be a Map');
    if (rel.size > THINK_LIMITS.relationships) return fail('relationships exceeds the cap');
  }

  for (const [key, max] of [
    ['tragedyPlaces', THINK_LIMITS.tragedyPlaces],
    ['stories', THINK_LIMITS.stories],
    ['kin', THINK_LIMITS.kin],
    ['social', THINK_LIMITS.social],
  ] as const) {
    if (input[key] === undefined) continue;
    const c = boundedArray(input[key], max, key);
    if (!c.ok) return c;
  }
  if (input['mostTold'] !== undefined && !bounded(input['mostTold'], THINK_LIMITS.string)) return fail('mostTold must be a bounded string');
  if (input['offerMaking'] !== undefined && typeof input['offerMaking'] !== 'boolean') return fail('offerMaking must be a boolean');
  if (input['sacredPlace'] !== undefined) {
    const p = input['sacredPlace'];
    if (!isPlainObject(p) || typeof p['x'] !== 'number' || typeof p['y'] !== 'number') return fail('sacredPlace must be {x,y}');
  }

  const size = estimateBytes(input, THINK_LIMITS.bytes, THINK_LIMITS.depth);
  if (size.exotic) return fail('input contains a value that is not plain JSON data');
  if (size.cyclic) return fail('input contains a cycle');
  if (size.over) return fail(`input exceeds ${THINK_LIMITS.bytes} bytes`);
  return OK;
}

/**
 * A sliding-window circuit breaker on paid calls. Not a throttle — the window
 * sits far above what a live world needs — but a bound on what a runaway
 * renderer can spend before someone notices.
 */
export class RateLimiter {
  private readonly hits: number[] = [];

  constructor(
    readonly max: number,
    readonly windowMs: number,
  ) {}

  tryTake(now: number = Date.now()): boolean {
    const cutoff = now - this.windowMs;
    let drop = 0;
    while (drop < this.hits.length && this.hits[drop]! <= cutoff) drop++;
    if (drop > 0) this.hits.splice(0, drop);
    if (this.hits.length >= this.max) return false;
    this.hits.push(now);
    return true;
  }
}

function envInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}

/** Overridable so a long unattended research run can raise its own ceiling. */
export function llmRateLimiter(): RateLimiter {
  return new RateLimiter(envInt('YGG_LLM_MAX_PER_WINDOW', 600, 1, 100_000), envInt('YGG_LLM_RATE_WINDOW_MS', 60_000, 1_000, 3_600_000));
}

export type LlmGate =
  | { ok: true; prompt: ThinkPromptShape }
  | { ok: false; code: 'RATE_LIMITED' | 'BAD_THINK_PROMPT' | 'BAD_THINK_INPUT'; reason: string };

/**
 * The whole `llm:complete` gate, in the order that matters.
 *
 * The token is taken FIRST. Validation is bounded but not free, and a limiter
 * placed after it bounds only the paid call, leaving the validator itself as an
 * unmetered target — which is exactly how a flood of junk payloads used to
 * reach it. A rejected call still costs a token, deliberately.
 *
 * Then the PROMPT, before the input: the prompt is what gets sent and billed,
 * and the input is only along for the ride. A legacy caller passing the old
 * `(input, retryError)` pair therefore fails here, cleanly — a ThinkInput is
 * not `{system, user}` — instead of being forwarded as if it were a prompt.
 */
export function guardLlmComplete(rate: RateLimiter, prompt: unknown, input: unknown, now?: number): LlmGate {
  if (!rate.tryTake(now)) return { ok: false, code: 'RATE_LIMITED', reason: 'rate limit exceeded' };
  const promptCheck = validateThinkPrompt(prompt);
  if (!promptCheck.ok) return { ok: false, code: 'BAD_THINK_PROMPT', reason: promptCheck.reason };
  const check = validateThinkInput(input);
  if (!check.ok) return { ok: false, code: 'BAD_THINK_INPUT', reason: check.reason };
  return { ok: true, prompt: promptCheck.prompt };
}
