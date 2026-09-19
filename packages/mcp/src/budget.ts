import { appendFileSync, closeSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync, writeSync } from 'node:fs';
import { hostname } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { canonicalSlug, isSafeSlug, reportsDir, yggHome } from '@yggdrasil/home';
import { BudgetStoreBase, CONSTANT_CEILING, HARD_CALL_CEILING } from '@yggdrasil/engine';
import type { BudgetState, CeilingRuling, SpendLogEntry } from '@yggdrasil/engine';

/**
 * WHERE THE CAP LIVES BETWEEN PROCESSES.
 *
 * The engine emits through `IBudgetStore` and never touches a filesystem — the
 * same rule `ICognitionSink` follows — so the durable half of decision D1 is
 * here, in the package that already owns the shared home.
 *
 *   <home>/eval/budgets/<id>.json    the counter, one file per budget id
 *   <home>/eval/budgets/<id>.lock    the cross-process lock over that counter
 *   <home>/eval/ALLOW-ABOVE-CAP.json a file only a HUMAN writes (read below)
 *   <home>/reports/eval-spend.jsonl  the append-only spend log
 *
 * Four rules, each closing a failure that was measured rather than imagined:
 *
 *  1. THE COUNTER ON DISK IS THE AUTHORITY. `BudgetStoreBase` re-reads it inside
 *     the lock on every charge; this file's only job is to make "inside the
 *     lock" mean something to a SECOND OPERATING-SYSTEM PROCESS. Round 1 held
 *     the allowance in the object: cap 10, two instances → 20 calls made.
 *  2. A WRITE IS ATOMIC (temp file + rename). A counter torn in half by a crash
 *     is a cap that silently resets, which is the exact failure persistence
 *     exists to prevent.
 *  3. AN UNREADABLE COUNTER THROWS. Never zero: a corrupt file read as unspent
 *     is a fresh 2,000-call allowance handed out by a bug.
 *  4. NOTHING HERE WRITES THE OVERRIDE FILE. See `ceilingOverridePath`.
 */

export const SPEND_LOG = 'eval-spend.jsonl';

export function budgetsDir(): string {
  const dir = join(yggHome(), 'eval', 'budgets');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function spendLogPath(): string {
  return join(reportsDir(), SPEND_LOG);
}

/**
 * The one place a budget id becomes a path. Two independent gates, as in
 * `reportPath`: the id must be a plain name, and the resolved file must still
 * be a direct child of the budgets directory. The lock lives beside the counter
 * and goes through the SAME gate, because a lock path built by string
 * concatenation would be a second, unguarded way to name a file.
 */
function budgetFile(id: string, suffix: string): string {
  if (!isSafeSlug(id)) throw new Error('budget id must be a plain name (letters, digits, dot, dash, underscore)');
  const name = `${canonicalSlug(id)}${suffix}`;
  const dir = resolve(budgetsDir());
  const file = resolve(dir, name);
  const rel = relative(dir, file);
  if (rel !== name || isAbsolute(rel) || rel.startsWith('..')) {
    throw new Error('budget id escapes the budgets directory');
  }
  return file;
}

/** A budget id is a plain name, like a report slug — never a path. */
export function budgetPath(id: string): string {
  return budgetFile(id, '.json');
}

/** The lock guarding one budget id, beside its counter. */
export function budgetLockPath(id: string): string {
  return budgetFile(id, '.lock');
}

/**
 * THE ONLY THING THAT MOVES THE CEILING, AND IT IS NOT CODE.
 *
 * `HARD_CALL_CEILING` is a constant (2,000) and no argument raises it — there
 * is no `ownerOverride` parameter on any eval API or MCP tool, because a string
 * parameter is something a caller can supply, and round 1 proved that whatever
 * a caller can supply, a caller will supply.
 *
 * Raising it takes a file a HUMAN creates at this path, by hand, outside any
 * process this repo starts. NOTHING IN THIS FILE, AND NOTHING ANYWHERE IN THIS
 * REPO, MAY WRITE OR DELETE THIS PATH — there is deliberately no exported
 * function that creates it, and `ceiling()` below only ever reads. If you are
 * adding a convenience that writes it, you are removing the control.
 */
export function ceilingOverridePath(): string {
  return join(yggHome(), 'eval', 'ALLOW-ABOVE-CAP.json');
}

/** The highest number the override file is allowed to name. A raise, not a blank cheque. */
const OVERRIDE_MAX = 50_000;
/** The override file's own words, carried into the spend log — bounded so a log line stays a log line. */
const NOTE_MAX_CHARS = 500;

// ─── The cross-process lock ──────────────────────────────────────────────────

/**
 * Held by THIS process, keyed by resolved lock path. `charge` is synchronous
 * and non-recursive today, but a store operation that ever calls another under
 * the same id would deadlock against a lock it already owns, and a deadlock in
 * the spending path fails closed in the worst possible way: by hanging an MCP
 * server for ten seconds and then throwing something that looks like corruption.
 */
const HELD = new Map<string, number>();

const LOCK_TIMEOUT_MS = 10_000;
/**
 * Every operation under this lock is a read and a rename of a file under a
 * kilobyte, so a lock older than this is not slow — it is a process that died
 * between `openSync` and `unlinkSync`, and leaving it would wedge the budget
 * permanently. Stolen locks are bounded so two processes cannot sit in a steal
 * loop stealing from each other.
 */
const LOCK_STALE_MS = 15_000;
const MAX_STEALS = 3;

const SLEEP_SLOT = new Int32Array(new SharedArrayBuffer(4));

/**
 * `IBudgetStore` is synchronous on purpose — an `await` inside a
 * check-and-increment is exactly the window two overlapping tool calls slipped
 * through — so waiting for the lock cannot be a `setTimeout`. `Atomics.wait` is
 * permitted on Node's main thread and is the only way to yield the CPU without
 * yielding the event loop to a second charge.
 */
function sleepSync(ms: number): void {
  Atomics.wait(SLEEP_SLOT, 0, 0, ms);
}

function errorCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err ? String((err as { code: unknown }).code) : undefined;
}

/**
 * WHAT "THE LOCK IS TAKEN" LOOKS LIKE ON NTFS.
 *
 * Not only EEXIST. Windows deletes lazily: between another process's
 * `unlinkSync` and the last handle closing, the name is in PENDING DELETE, and
 * `CreateFile` on it answers ERROR_ACCESS_DENIED — which Node reports as EPERM,
 * or EBUSY under a scanner. Round 1 of THIS lock treated only EEXIST as
 * contention and a child died with "EPERM: operation not permitted, open
 * ...stress.lock" roughly one run in four. All three mean the same thing: wait
 * and ask again. A genuine permissions failure is not lost — it simply reports
 * as the lock timeout below, which names the file and the last code seen.
 */
const CONTENDED = new Set(['EEXIST', 'EPERM', 'EBUSY', 'EACCES']);

function isStale(lock: string): boolean {
  try {
    return Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS;
  } catch {
    // Vanished while we looked at it: not stale, just gone. Retry the create.
    return false;
  }
}

/**
 * `openSync(path, 'wx')` is O_CREAT|O_EXCL, which NTFS implements atomically:
 * exactly one of N racing processes gets the descriptor and the rest get one of
 * the `CONTENDED` codes above. The pid/host/time written inside is for a human
 * reading a wedged lab, never for logic — a pid is not unique across machines
 * and the shared home may be on a network drive.
 */
function acquireLock(lock: string): void {
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  let steals = 0;
  let backoff = 2;
  let lastCode = 'none';
  for (;;) {
    try {
      const fd = openSync(lock, 'wx');
      try {
        writeSync(fd, JSON.stringify({ pid: process.pid, host: hostname(), at: new Date().toISOString() }));
      } finally {
        closeSync(fd);
      }
      return;
    } catch (err) {
      lastCode = errorCode(err) ?? 'none';
      if (!CONTENDED.has(lastCode)) throw err;
    }
    if (steals < MAX_STEALS && isStale(lock)) {
      steals += 1;
      try {
        unlinkSync(lock);
      } catch {
        /* someone else broke it first; race the create again */
      }
      continue;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `timed out after ${LOCK_TIMEOUT_MS}ms waiting for the budget lock ${lock} (last: ${lastCode}). ` +
          `Another process is charging this budget; if none is running, that file is a leftover and may be deleted.`,
      );
    }
    sleepSync(backoff);
    backoff = Math.min(Math.ceil(backoff * 1.6), 25);
  }
}

/**
 * Releasing has the mirror-image problem: a `statSync` from a waiter can hold
 * the name long enough for one `unlinkSync` to bounce off it. A few immediate
 * retries cost microseconds; giving up costs every other process a 15-second
 * wait for the stale timer.
 */
function releaseLock(lock: string): void {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      unlinkSync(lock);
      return;
    } catch (err) {
      // ENOENT: a stale-lock steal took it while we held it. Nothing to
      // release, and nothing worth saying — this is an MCP stdio server and a
      // stray byte on stdout corrupts the protocol.
      if (errorCode(err) === 'ENOENT') return;
      sleepSync(5);
    }
  }
}

// ─── The store ───────────────────────────────────────────────────────────────

let tempSeq = 0;

export class FileBudgetStore extends BudgetStoreBase {
  /**
   * Read from the human's file where one exists, and from the constant where
   * one does not. A file that is PRESENT but unreadable throws: read as "no
   * override" it would silently lower a cap the human deliberately raised, and
   * read as "unlimited" it would spend money on the strength of a corrupt byte.
   * Neither is a reading this code is allowed to make.
   */
  ceiling(): CeilingRuling {
    const path = ceilingOverridePath();
    let raw: string;
    try {
      raw = readFileSync(path, 'utf8');
    } catch (err) {
      if (errorCode(err) === 'ENOENT') return CONSTANT_CEILING;
      throw new Error(`the cap override at ${path} exists and cannot be read (${String(err)}); refusing to guess what it says.`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(
        `the cap override at ${path} is not valid JSON. It is neither "no override" nor "unlimited" — ` +
          `fix the file or delete it. Expected {"limit": <${HARD_CALL_CEILING} < n ≤ ${OVERRIDE_MAX}>, "reason": "<why>"}.`,
      );
    }
    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error(`the cap override at ${path} must be a JSON object with a limit and a reason.`);
    }
    const { limit, reason } = parsed as { limit?: unknown; reason?: unknown };
    if (typeof limit !== 'number' || !Number.isInteger(limit)) {
      throw new Error(`the cap override at ${path} must name an integer "limit"; it says ${JSON.stringify(limit)}.`);
    }
    if (limit <= HARD_CALL_CEILING) {
      throw new Error(
        `the cap override at ${path} says limit ${limit}, which does not RAISE the standing ceiling of ${HARD_CALL_CEILING}. ` +
          `A smaller cap is asked for per budget, not written here; delete the file.`,
      );
    }
    if (limit > OVERRIDE_MAX) {
      throw new Error(`the cap override at ${path} says limit ${limit}, above the ${OVERRIDE_MAX} this file may ever authorise.`);
    }
    if (typeof reason !== 'string' || reason.trim() === '') {
      throw new Error(`the cap override at ${path} must carry a non-empty "reason"; it is copied into the spend log and the run manifest.`);
    }
    // The note is the file VERBATIM, not a re-rendering of the fields we happen
    // to read: a reader of the spend log sees what the human actually wrote.
    return { limit, source: 'override-file', path, note: raw.trim().slice(0, NOTE_MAX_CHARS) };
  }

  protected load(id: string): BudgetState | undefined {
    const file = budgetPath(id);
    let raw: string;
    try {
      raw = readFileSync(file, 'utf8');
    } catch {
      return undefined;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`budget "${id}" is unreadable at ${file}; refusing to treat it as unspent`);
    }
    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error(`budget "${id}" is unreadable at ${file}; refusing to treat it as unspent`);
    }
    const state = parsed as Partial<BudgetState>;
    // A counter that cannot be read must never be read as ZERO: that would turn
    // a corrupted file — or a negative number somebody typed in — into a fresh
    // allowance.
    if (typeof state.id !== 'string' || !isWhole(state.limit) || !isWhole(state.spent)) {
      throw new Error(`budget "${id}" is unreadable at ${file}; refusing to treat it as unspent`);
    }
    // The recorded ceiling is PROVENANCE, never permission: `open` asks
    // `ceiling()` fresh, so a state file claiming a raised ceiling cannot raise
    // one. What it does do is fail loudly when the limit on record outlives the
    // file that authorised it — a 2,500-call budget must not keep spending
    // because it was opened while the override existed.
    const recorded = isRuling(state.ceiling) ? state.ceiling : CONSTANT_CEILING;
    const inForce = this.ceiling();
    if (state.limit > inForce.limit) {
      throw new Error(
        `budget "${id}" is capped at ${state.limit} calls and the ceiling now in force is ${inForce.limit} ` +
          `(${inForce.source}). The file that authorised the higher cap is gone; restore it or open a budget within the ceiling.`,
      );
    }
    return {
      id: state.id,
      limit: state.limit,
      spent: state.spent,
      tokensIn: isWhole(state.tokensIn) ? state.tokensIn : 0,
      tokensOut: isWhole(state.tokensOut) ? state.tokensOut : 0,
      ceiling: recorded,
    };
  }

  protected save(state: BudgetState): void {
    const file = budgetPath(state.id);
    // Unique per process AND per write: two stores in one process are
    // serialised by the lock, but a leftover temp from a crash must never be
    // mistaken for the one this write is about to rename.
    const temp = `${file}.${process.pid}.${(tempSeq += 1)}.tmp`;
    writeFileSync(temp, `${JSON.stringify(state)}\n`, 'utf8');
    renameSync(temp, file);
  }

  /**
   * Exclusive across processes for the lifetime of `body`, which may throw —
   * `BudgetExhaustedError` is the EXPECTED exit from a charge, so the release
   * is in a `finally` or the first exhausted budget wedges the lab.
   */
  protected withLock<T>(id: string, body: () => T): T {
    const lock = budgetLockPath(id);
    const depth = HELD.get(lock) ?? 0;
    if (depth > 0) {
      HELD.set(lock, depth + 1);
      try {
        return body();
      } finally {
        HELD.set(lock, (HELD.get(lock) ?? 1) - 1);
      }
    }
    acquireLock(lock);
    HELD.set(lock, 1);
    try {
      return body();
    } finally {
      HELD.delete(lock);
      releaseLock(lock);
    }
  }

  appendSpend(entry: SpendLogEntry): void {
    appendFileSync(spendLogPath(), `${JSON.stringify(entry)}\n`, 'utf8');
  }
}

function isWhole(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isRuling(value: unknown): value is CeilingRuling {
  if (typeof value !== 'object' || value === null) return false;
  const ruling = value as Partial<CeilingRuling>;
  return isWhole(ruling.limit) && (ruling.source === 'constant' || ruling.source === 'override-file');
}
