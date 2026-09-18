import { appendFileSync, closeSync, openSync, readSync, renameSync, statSync, watch, type FSWatcher } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';
import { activityPath, yggHome } from './paths.js';

/**
 * One line of the shared activity feed. The lab tails this file so the human
 * sees, live, whatever a client (the AI engineer over MCP) is doing — runs
 * created, ticks advanced, ideas given, reports written.
 *
 * Time is carried by TWO unambiguous fields. The old single `at` meant sim tick
 * on the writer side and was read as a clock on the lab side, which is why the
 * feed had no timestamps at all:
 *   `wallMs` — when the line was written (real time, always stamped on append)
 *   `tick`   — the simulation tick it describes, when it belongs to a run
 * Legacy lines carry only `at`; `parseActivityLine` maps those onto `tick` and
 * leaves `wallMs` undefined rather than inventing a time.
 */
export interface ActivityLine {
  /** Wall-clock ms when the line was written. Absent on legacy lines. */
  wallMs?: number;
  /** Simulation tick this line describes, when it belongs to a run. */
  tick?: number;
  actor: string;
  kind: string;
  runId?: number;
  summary: string;
  data?: Record<string, unknown>;
  agents?: { id: number; x: number; y: number; state: number }[];
}

/** What a writer supplies; `wallMs` is stamped by `appendActivity`. */
export type NewActivityLine = Omit<ActivityLine, 'wallMs'>;

/** Rotate the feed past this size so a long-lived home cannot grow without bound. */
export const MAX_ACTIVITY_BYTES = 8 * 1024 * 1024;
/** Bytes per read syscall while draining the tail. */
const TAIL_CHUNK = 256 * 1024;
/** How much of the file's end `recentActivity` looks at. */
const RECENT_WINDOW = 1 << 20;
/**
 * A "line" longer than this is corrupt. Enforced INSIDE the read loop: applying
 * it after concatenating the whole unread region meant a 48 MB unterminated
 * line still cost ~100 MB of heap in a single poll before the cap was consulted.
 */
export const MAX_PENDING_CHARS = 1 << 20;

interface FileId {
  size: number;
  ino: number;
}

function statOf(path: string): FileId | null {
  try {
    const st = statSync(path);
    return { size: st.size, ino: Number(st.ino) };
  } catch {
    return null;
  }
}

/**
 * Rotate `activity.jsonl` to `activity.jsonl.1` once it passes the cap. One
 * generation is enough: the feed is live telemetry and the research record
 * lives in the DB. Best-effort — a rotation the OS refuses just means the next
 * append lands on the current file.
 */
function rotateIfLarge(path: string): void {
  try {
    const st = statOf(path);
    if (!st || st.size < MAX_ACTIVITY_BYTES) return;
    renameSync(path, `${path}.1`);
  } catch {
    /* another process rotated it, or the file is locked */
  }
}

/** Append a line to the shared feed, stamped with the wall clock. */
export function appendActivity(line: NewActivityLine, now: number = Date.now()): void {
  try {
    const path = activityPath();
    rotateIfLarge(path);
    appendFileSync(path, `${JSON.stringify({ wallMs: now, ...line })}\n`);
  } catch {
    // The feed is best-effort telemetry; never let it break a tool call.
  }
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function isAgentDot(a: unknown): a is { id: number; x: number; y: number; state: number } {
  if (typeof a !== 'object' || a === null) return false;
  const o = a as Record<string, unknown>;
  return num(o['id']) !== undefined && num(o['x']) !== undefined && num(o['y']) !== undefined && num(o['state']) !== undefined;
}

/**
 * Parse one JSONL line into a normalized ActivityLine, or null if it is not a
 * usable line. Lines come off disk written by another process, so nothing here
 * trusts the shape: a malformed line is dropped, never cast.
 */
export function parseActivityLine(raw: string): ActivityLine | null {
  if (!raw.trim()) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const actor = o['actor'];
  const kind = o['kind'];
  const summary = o['summary'];
  if (typeof actor !== 'string' || typeof kind !== 'string' || typeof summary !== 'string') return null;

  const runId = num(o['runId']);
  // Legacy: a single `at` that the only historical writer (MCP announce) filled
  // with the sim tick. Map it to `tick`; a line about no run carried a bare 0,
  // which means nothing, so drop it. `wallMs` stays undefined — unknown, not 0.
  const tick = num(o['tick']) ?? (runId !== undefined ? num(o['at']) : undefined);
  const wallMs = num(o['wallMs']);
  const data = typeof o['data'] === 'object' && o['data'] !== null && !Array.isArray(o['data']) ? (o['data'] as Record<string, unknown>) : undefined;
  const agents = Array.isArray(o['agents']) ? o['agents'].filter(isAgentDot) : undefined;

  return {
    ...(wallMs !== undefined ? { wallMs } : {}),
    ...(tick !== undefined ? { tick } : {}),
    actor,
    kind,
    ...(runId !== undefined ? { runId } : {}),
    summary,
    ...(data ? { data } : {}),
    ...(agents ? { agents } : {}),
  };
}

/** Most recent activity lines (for initial render). Reads only the file's tail. */
export function recentActivity(limit = 100): ActivityLine[] {
  const path = activityPath();
  const st = statOf(path);
  if (!st) return [];
  const want = Math.min(st.size, RECENT_WINDOW);
  const start = st.size - want;
  let fd: number | undefined;
  let text: string;
  try {
    fd = openSync(path, 'r');
    const buf = Buffer.allocUnsafe(want);
    const n = readSync(fd, buf, 0, want, start);
    text = buf.subarray(0, n).toString('utf8');
  } catch {
    return [];
  } finally {
    closeQuietly(fd);
  }
  // A mid-file start can slice a line — and a multi-byte char — in half, so
  // discard everything up to the first newline.
  if (start > 0) text = text.slice(text.indexOf('\n') + 1);
  const out: ActivityLine[] = [];
  for (const ln of text.split('\n')) {
    const parsed = parseActivityLine(ln);
    if (parsed) out.push(parsed);
  }
  return out.slice(-limit);
}

function closeQuietly(fd: number | undefined): void {
  if (fd === undefined) return;
  try {
    closeSync(fd);
  } catch {
    /* already closed */
  }
}

export interface ActivityTail {
  /** Drain synchronously — the poll and the fs.watch both call this. */
  poll(): void;
  stop(): void;
  /** Bytes read off the feed since the tail started (only the new tail is ever read). */
  readonly bytesRead: number;
  /**
   * High-water mark of the partial-line buffer, in UTF-16 code units. The seam
   * a test uses to prove the tail's memory is bounded by the cap and not by the
   * size of whatever a foreign writer appended.
   */
  readonly peakPendingChars: number;
  /** Lines discarded for exceeding MAX_PENDING_CHARS. */
  readonly droppedLines: number;
}

/**
 * Tail the activity file: read ONLY the bytes appended since the last drain,
 * and recover when the file is truncated or rotated out from under us (the old
 * watcher compared `size <= offset` and went deaf forever). Backed by a poll
 * because fs.watch misses appends on some platforms.
 */
export function tailActivity(onLines: (lines: ActivityLine[]) => void, opts: { pollMs?: number } = {}): ActivityTail {
  const path = activityPath();
  const dir = yggHome();
  const start = statOf(path);
  let offset = start?.size ?? 0;
  let ino = start?.ino ?? 0;
  // Holds a multi-byte character split across two reads.
  let decoder = new StringDecoder('utf8');
  let pending = '';
  // True while skipping the remainder of an over-long line, until the newline
  // that ends it. Without this the tail would re-buffer the same garbage.
  let resyncing = false;
  let bytesRead = 0;
  let peakPendingChars = 0;
  let droppedLines = 0;
  let watcher: FSWatcher | null = null;
  let timer: NodeJS.Timeout | null = null;

  const restart = (): void => {
    offset = 0;
    pending = '';
    resyncing = false;
    decoder = new StringDecoder('utf8');
  };

  /**
   * Consume one decoded chunk. The cap is checked BEFORE every concatenation,
   * so `pending` never exceeds MAX_PENDING_CHARS even transiently — whatever
   * a foreign writer left on disk, one poll costs one chunk plus the cap.
   */
  const absorb = (chunk: string, out: ActivityLine[]): void => {
    let text = chunk;
    if (resyncing) {
      const nl = text.indexOf('\n');
      if (nl < 0) return; // still inside the over-long line: keep nothing
      resyncing = false;
      text = text.slice(nl + 1);
    }
    let from = 0;
    for (;;) {
      const nl = text.indexOf('\n', from);
      if (nl < 0) break;
      const segment = text.slice(from, nl);
      from = nl + 1;
      if (pending.length + segment.length > MAX_PENDING_CHARS) {
        // The line is complete but too long to be one of ours; it ended here,
        // so the next line starts clean and no resync is needed.
        droppedLines++;
      } else {
        const parsed = parseActivityLine(pending + segment);
        if (parsed) out.push(parsed);
      }
      pending = '';
    }
    const rest = text.slice(from);
    if (pending.length + rest.length > MAX_PENDING_CHARS) {
      pending = '';
      resyncing = true;
      droppedLines++;
    } else {
      pending += rest;
    }
    if (pending.length > peakPendingChars) peakPendingChars = pending.length;
  };

  const drain = (): void => {
    const st = statOf(path);
    if (!st) return;
    // Truncated, or replaced by rotation: start again from the top of the file.
    if (st.size < offset || (ino !== 0 && st.ino !== 0 && st.ino !== ino)) restart();
    ino = st.ino;
    if (st.size <= offset) return;

    const lines: ActivityLine[] = [];
    let fd: number | undefined;
    try {
      fd = openSync(path, 'r');
      const buf = Buffer.allocUnsafe(TAIL_CHUNK);
      while (offset < st.size) {
        const want = Math.min(TAIL_CHUNK, st.size - offset);
        const n = readSync(fd, buf, 0, want, offset);
        if (n <= 0) break;
        offset += n;
        bytesRead += n;
        absorb(decoder.write(buf.subarray(0, n)), lines);
      }
    } catch {
      return; // transient read error; the next poll retries from the same offset
    } finally {
      closeQuietly(fd);
    }

    if (lines.length) onLines(lines);
  };

  try {
    watcher = watch(dir, (_e, file) => {
      if (file === 'activity.jsonl') drain();
    });
  } catch {
    /* dir watch unsupported */
  }
  timer = setInterval(drain, opts.pollMs ?? 1000);

  return {
    poll: drain,
    stop: () => {
      watcher?.close();
      watcher = null;
      if (timer) clearInterval(timer);
      timer = null;
    },
    get bytesRead() {
      return bytesRead;
    },
    get peakPendingChars() {
      return peakPendingChars;
    },
    get droppedLines() {
      return droppedLines;
    },
  };
}
