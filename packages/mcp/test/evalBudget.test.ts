import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BudgetExhaustedError, CallBudget, HARD_CALL_CEILING, PaidCallRefused } from '@yggdrasil/engine';
import type { BudgetSpec } from '@yggdrasil/engine';

/**
 * THE DURABLE HALF OF DECISION D1.
 *
 * The engine's `BudgetStoreBase` holds the arithmetic; this holds the file, the
 * lock and the ceiling. What is tested here is everything a memory store
 * cannot test:
 *
 *   - a SECOND PROCESS, with a fresh store object and no shared state but the
 *     directory, resumes the same count and queues behind the same lock;
 *   - a counter that cannot be read is never read as unspent;
 *   - the ceiling is a constant no ARGUMENT can move, and the only thing that
 *     moves it is a file this code can read and cannot write.
 *
 * `YGG_HOME` is a temp directory, so nothing here touches the real lab.
 */

let home: string;
let FileBudgetStore: typeof import('../src/budget.js').FileBudgetStore;
let budgetPath: typeof import('../src/budget.js').budgetPath;
let budgetLockPath: typeof import('../src/budget.js').budgetLockPath;
let spendLogPath: typeof import('../src/budget.js').spendLogPath;
let ceilingOverridePath: typeof import('../src/budget.js').ceilingOverridePath;
const hadHome = process.env['YGG_HOME'];

const here = dirname(fileURLToPath(import.meta.url));
const CHILD = join(here, 'fixtures', 'budget-child.ts');

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), 'ygg-budget-'));
  process.env['YGG_HOME'] = home;
  // Imported after YGG_HOME is set: the paths are read when a call is made,
  // but the import also creates the home, so order is kept explicit.
  const module = await import('../src/budget.js');
  FileBudgetStore = module.FileBudgetStore;
  budgetPath = module.budgetPath;
  budgetLockPath = module.budgetLockPath;
  spendLogPath = module.spendLogPath;
  ceilingOverridePath = module.ceilingOverridePath;
});

afterAll(() => {
  if (hadHome === undefined) delete process.env['YGG_HOME'];
  else process.env['YGG_HOME'] = hadHome;
  // Only the directory this file made, under the OS temp dir.
  rmSync(home, { recursive: true, force: true });
});

function lastSpendLine(): Record<string, unknown> {
  const lines = readFileSync(spendLogPath(), 'utf8').trim().split('\n');
  return JSON.parse(lines[lines.length - 1] ?? '{}') as Record<string, unknown>;
}

describe('the call budget survives a process', () => {
  it('resumes the count from disk and still refuses past the cap', () => {
    const first = CallBudget.open(new FileBudgetStore(), { id: 'pilot', purpose: 'pilot', runId: 'run-1', limit: 6 });
    first.spend(4);
    first.closeRun();

    // A completely separate store object — everything the second process shares
    // with the first is the directory.
    const second = CallBudget.open(new FileBudgetStore(), { id: 'pilot', purpose: 'pilot', runId: 'run-2', limit: 6 });
    expect(second.spent).toBe(4);
    expect(second.remaining).toBe(2);
    second.spend(2);
    expect(() => second.spend(1)).toThrow(BudgetExhaustedError);

    const third = CallBudget.open(new FileBudgetStore(), { id: 'pilot', purpose: 'pilot', runId: 'run-3', limit: 6 });
    expect(third.remaining).toBe(0);
    expect(() => third.spend(1)).toThrow(BudgetExhaustedError);
  });

  it('appends one spend line per run, with the model, the purpose and the ceiling in force', () => {
    const budget = CallBudget.open(new FileBudgetStore(), { id: 'logged', purpose: 'the first paid pilot', runId: 'run-x', limit: 10 });
    budget.spend(3);
    budget.recordUsage('accounts/fireworks/models/gpt-oss-120b', { promptTokens: 4000, completionTokens: 600 });
    budget.closeRun();
    expect(lastSpendLine()).toMatchObject({
      budgetId: 'logged',
      runId: 'run-x',
      purpose: 'the first paid pilot',
      modelId: 'accounts/fireworks/models/gpt-oss-120b',
      calls: 3,
      tokensIn: 4000,
      tokensOut: 600,
      usageReported: true,
      limit: 10,
      // A reader of the log can see the run was capped by the CONSTANT, not by
      // somebody's argument.
      ceiling: { limit: HARD_CALL_CEILING, source: 'constant' },
    });
  });

  /**
   * Replaces round 1's "raise the cap with an argument" test, which passed.
   * There is no argument any more: the old `ownerOverride` string is smuggled
   * back in through a cast, and the refusal is unchanged.
   */
  it('has no argument that raises the cap, and refuses one that tries', () => {
    const store = new FileBudgetStore();
    expect(() => CallBudget.open(store, { id: 'big', purpose: 'p', runId: 'r', limit: HARD_CALL_CEILING + 1 })).toThrow(PaidCallRefused);

    const smuggled = { id: 'big', purpose: 'p', runId: 'r', limit: 5000, ownerOverride: 'owner said so' } as unknown as BudgetSpec;
    expect(() => CallBudget.open(store, smuggled)).toThrow(PaidCallRefused);

    // Refused all the way down: no counter was created, so nothing persisted a
    // raised ceiling for a later open to inherit.
    expect(store.read('big')).toBeUndefined();
    expect(existsSync(budgetPath('big'))).toBe(false);
  });

  it('never reads a corrupt counter as a fresh allowance', () => {
    const store = new FileBudgetStore();
    CallBudget.open(store, { id: 'torn', purpose: 'p', runId: 'r', limit: 5 }).spend(5);
    writeFileSync(budgetPath('torn'), '{"id":"torn","limit":', 'utf8');
    expect(() => store.read('torn')).toThrow();
    expect(() => CallBudget.open(store, { id: 'torn', purpose: 'p', runId: 'r', limit: 5 })).toThrow();

    // Readable JSON, impossible counter. Same answer: a negative `spent` read
    // as zero would be an allowance handed out by a typo.
    writeFileSync(budgetPath('torn'), '{"id":"torn","limit":5,"spent":-3}', 'utf8');
    expect(() => store.read('torn')).toThrow();
  });

  it('refuses a budget id that is a path', () => {
    const store = new FileBudgetStore();
    for (const bad of ['../escape', 'a/b', '..', 'C:\\x', '.hidden', 'a\0b']) {
      expect(() => store.read(bad)).toThrow();
      // The lock is named through the same gate, so it cannot be the way out.
      expect(() => budgetLockPath(bad)).toThrow();
    }
  });
});

describe('the store is the only authority on spending', () => {
  /**
   * ROUND 1's HEADLINE BUG, as a test. Two `CallBudget`s over two separate
   * stores are two processes over one file. Old code: `spend` decremented a
   * private in-memory allowance and never re-read the store, so this loop made
   * 20 calls against a cap of 10.
   */
  it('gives two instances over one store ONE cap, not one each', () => {
    const store = new FileBudgetStore();
    const a = CallBudget.open(new FileBudgetStore(), { id: 'shared', purpose: 'p', runId: 'run-a', limit: 10 });
    const b = CallBudget.open(new FileBudgetStore(), { id: 'shared', purpose: 'p', runId: 'run-b', limit: 10 });

    let landed = 0;
    let refused = 0;
    for (let i = 0; i < 20; i += 1) {
      const who = i % 2 === 0 ? a : b;
      try {
        who.spend(1);
        landed += 1;
      } catch (err) {
        expect(err).toBeInstanceOf(BudgetExhaustedError);
        refused += 1;
      }
    }

    expect(landed).toBe(10);
    expect(refused).toBe(10);
    expect(a.spentThisRun + b.spentThisRun).toBe(10);
    expect(store.read('shared')?.spent).toBe(10);
  });

  it('cannot be re-opened into a fresh allowance once the store says it is spent', () => {
    const store = new FileBudgetStore();
    // Exactly at the cap from the test above, written by two instances.
    expect(store.read('shared')?.spent).toBe(10);

    const third = CallBudget.open(new FileBudgetStore(), { id: 'shared', purpose: 'p', runId: 'run-c', limit: 10 });
    expect(third.remaining).toBe(0);
    expect(third.spent).toBe(10);
    expect(() => third.spend(1)).toThrow(BudgetExhaustedError);
    // Re-opening did not forgive, and the failed charge did not increment.
    expect(store.read('shared')?.spent).toBe(10);
  });
});

/**
 * THE CROSS-PROCESS CLAIM, MEASURED.
 *
 * Four `tsx` child processes plus the parent, all charging one budget id whose
 * cap is 40, 140 attempts between them. The lock is `openSync(path,'wx')` —
 * O_CREAT|O_EXCL, atomic on NTFS — so exactly 40 charges may land no matter how
 * the five processes interleave.
 *
 * MEASURED on this machine (Windows 11, NTFS, Node 24.13, 4 children x 30
 * attempts + 20 parent attempts against a cap of 40). Six consecutive runs:
 *
 *   children [30,3,0,0]  + parent 7  = 40 landed, persisted 40, 1013ms
 *   children [1,0,19,0]  + parent 20 = 40 landed, persisted 40, 1007ms
 *   children [0,20,0,0]  + parent 20 = 40 landed, persisted 40, 1000ms
 *   children [0,0,11,9]  + parent 20 = 40 landed, persisted 40,  973ms
 *   children [11,0,0,9]  + parent 20 = 40 landed, persisted 40,  984ms
 *   children [26,0,0,0]  + parent 14 = 40 landed, persisted 40,  973ms
 *
 * And at 8 children x 60 attempts + 20 parent against a cap of 60 (480
 * attempts, three runs): 60, 60, 60 landed, persisted 60, ~1.5s.
 *
 * The per-process split varies wildly run to run — they race, and that is the
 * point. The SUM does not move.
 */
describe('the cap holds across real operating-system processes', () => {
  const require_ = createRequire(import.meta.url);

  /**
   * `process.execPath` + tsx's own cli.mjs, verified to run before the
   * assertions were written. Deliberately not `.bin/tsx.cmd` as the first
   * choice: Node refuses to spawn a `.cmd` without `shell: true`, and a shell
   * in the middle of a test is one more thing that can swallow an exit code.
   */
  function launcher(): { command: string; leading: string[]; shell: boolean } {
    try {
      return { command: process.execPath, leading: [require_.resolve('tsx/cli')], shell: false };
    } catch {
      /* fall through to the installed binaries */
    }
    const bin = process.platform === 'win32' ? 'tsx.cmd' : 'tsx';
    const root = join(here, '..', '..', '..');
    for (const candidate of [join(here, '..', 'node_modules', '.bin', bin), join(root, 'node_modules', '.bin', bin)]) {
      if (existsSync(candidate)) return { command: candidate, leading: [], shell: process.platform === 'win32' };
    }
    return { command: bin, leading: [], shell: process.platform === 'win32' };
  }

  function runChild(id: string, limit: number, attempts: number, goFile: string): Promise<number> {
    const { command, leading, shell } = launcher();
    return new Promise<number>((resolveWith, reject) => {
      const child = spawn(command, [...leading, CHILD, id, String(limit), String(attempts), goFile], {
        cwd: join(here, '..'),
        env: { ...process.env, YGG_HOME: home },
        stdio: ['ignore', 'pipe', 'pipe'],
        shell,
        windowsHide: true,
      });
      let out = '';
      let err = '';
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => (out += chunk));
      child.stderr.on('data', (chunk: string) => (err += chunk));
      child.on('error', reject);
      child.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`budget child exited ${String(code)}\nstdout: ${out}\nstderr: ${err}`));
          return;
        }
        const line = out.trim().split('\n').pop() ?? '';
        try {
          const parsed = JSON.parse(line) as { ok?: unknown };
          if (typeof parsed.ok !== 'number') throw new Error('no ok count');
          resolveWith(parsed.ok);
        } catch {
          reject(new Error(`budget child printed something other than one {"ok":n} line: ${JSON.stringify(out)}\nstderr: ${err}`));
        }
      });
    });
  }

  it(
    'lets exactly the cap through, whatever order five processes arrive in',
    async () => {
      const id = 'stress';
      const limit = 40;
      const children = 4;
      const attemptsEach = 30;
      const store = new FileBudgetStore();
      CallBudget.open(store, { id, purpose: 'cross-process stress', runId: 'parent', limit });

      // A starting pistol. Measured without one: the first child to boot took
      // the whole cap alone (30 + 10 + 0 + 0, parent 0) and the run measured
      // `tsx` startup rather than five processes arriving together.
      const go = join(home, 'eval', `GO-${id}`);
      const started = Date.now();
      const pending = Array.from({ length: children }, () => runChild(id, limit, attemptsEach, go));
      await new Promise((tick) => setTimeout(tick, 700));
      writeFileSync(go, '');

      // The parent spends at the same time, through instances of its own: the
      // in-process race and the cross-process race are the same race.
      const mine = [
        CallBudget.open(new FileBudgetStore(), { id, purpose: 'p', runId: 'parent-a', limit }),
        CallBudget.open(new FileBudgetStore(), { id, purpose: 'p', runId: 'parent-b', limit }),
      ];
      let parentOk = 0;
      for (let i = 0; i < 20; i += 1) {
        try {
          mine[i % mine.length]!.spend(1);
          parentOk += 1;
        } catch (err) {
          expect(err).toBeInstanceOf(BudgetExhaustedError);
        }
      }

      const fromChildren = await Promise.all(pending);
      const elapsed = Date.now() - started;

      const landed = fromChildren.reduce((sum, n) => sum + n, 0) + parentOk;
      const persisted = store.read(id)?.spent ?? -1;

      // 140 attempts were made across five processes; exactly 100 were told no.
      expect(landed).toBe(limit);
      expect(persisted).toBe(limit);
      expect(persisted).toBeLessThanOrEqual(limit);
      expect(elapsed).toBeLessThan(90_000);
    },
    90_000,
  );
});

describe('the ceiling is a file a human writes and this code only reads', () => {
  it('never creates the override file, and refuses above the constant while it is absent', () => {
    const store = new FileBudgetStore();
    const override = ceilingOverridePath();
    expect(existsSync(override)).toBe(false);

    // A full round of everything the MCP surface can do to a budget.
    const budget = CallBudget.open(store, { id: 'plain', purpose: 'p', runId: 'r', limit: 5 });
    budget.spend(2);
    budget.recordUsage('accounts/fireworks/models/gpt-oss-120b', { promptTokens: 12, completionTokens: 3 });
    budget.closeRun();
    expect(store.read('plain')?.spent).toBe(2);

    expect(existsSync(override)).toBe(false);
    expect(store.ceiling()).toEqual({ limit: HARD_CALL_CEILING, source: 'constant' });
    expect(HARD_CALL_CEILING).toBe(2000);
    expect(() => CallBudget.open(store, { id: 'over', purpose: 'p', runId: 'r', limit: HARD_CALL_CEILING + 1 })).toThrow(PaidCallRefused);
    expect(existsSync(override)).toBe(false);
  });

  it('reads the human\u2019s file, carries its words into the spend log, and throws on a broken one', () => {
    const store = new FileBudgetStore();
    const override = ceilingOverridePath();
    mkdirSync(dirname(override), { recursive: true });
    // Written HERE, by the test standing in for the human. No exported function
    // in src/budget.ts creates this file, and none deletes it.
    const contents = '{\n  "limit": 5000,\n  "reason": "pilot 2 approved 2026-09-19; 5k calls on the slow-mind model"\n}';
    writeFileSync(override, contents, 'utf8');
    try {
      const ruling = store.ceiling();
      expect(ruling).toMatchObject({ limit: 5000, source: 'override-file', path: override });
      expect(ruling.note).toBe(contents.trim());

      const raised = CallBudget.open(store, { id: 'raised', purpose: 'pilot 2', runId: 'run-r', limit: 2500 });
      expect(raised.limit).toBe(2500);
      raised.spend(1);
      raised.closeRun();
      expect(lastSpendLine()).toMatchObject({
        budgetId: 'raised',
        limit: 2500,
        ceiling: { limit: 5000, source: 'override-file' },
      });

      // Still not a blank cheque: the file raises the ceiling, it does not remove it.
      expect(() => CallBudget.open(store, { id: 'toobig', purpose: 'p', runId: 'r', limit: 5001 })).toThrow(PaidCallRefused);

      // A broken override is neither "no override" nor "unlimited" — it stops everything.
      for (const broken of ['{"limit": 5000', '[]', '{"limit": 1500, "reason": "lower"}', '{"limit": 5000, "reason": ""}', '{"limit": 500000, "reason": "more"}', '{"reason": "no limit"}']) {
        writeFileSync(override, broken, 'utf8');
        expect(() => store.ceiling()).toThrow();
        expect(() => CallBudget.open(store, { id: 'plain', purpose: 'p', runId: 'r', limit: 5 })).toThrow();
      }
    } finally {
      // The human's file, removed by the human's stand-in so later tests see the constant.
      try {
        unlinkSync(override);
      } catch {
        /* already gone */
      }
    }

    // And with the file gone, the limit it authorised does not outlive it.
    expect(store.ceiling()).toEqual({ limit: HARD_CALL_CEILING, source: 'constant' });
    expect(() => store.read('raised')).toThrow();
  });
});

describe('a lock left by a dead process does not wedge the lab', () => {
  it('breaks a stale lock and charges anyway', () => {
    const store = new FileBudgetStore();
    CallBudget.open(store, { id: 'ghosted', purpose: 'p', runId: 'r', limit: 3 });

    const lock = budgetLockPath('ghosted');
    writeFileSync(lock, JSON.stringify({ pid: 999999, host: 'a-machine-that-crashed', at: 'long ago' }), 'utf8');
    const old = new Date(Date.now() - 60_000);
    utimesSync(lock, old, old);

    const started = Date.now();
    const state = store.charge('ghosted', 1);
    const waited = Date.now() - started;

    expect(state.spent).toBe(1);
    expect(waited).toBeLessThan(2_000);
    expect(existsSync(lock)).toBe(false);
  });

  it('releases the lock even when the charge throws', () => {
    const store = new FileBudgetStore();
    CallBudget.open(store, { id: 'thrower', purpose: 'p', runId: 'r', limit: 1 });
    store.charge('thrower', 1);
    expect(() => store.charge('thrower', 1)).toThrow(BudgetExhaustedError);
    expect(existsSync(budgetLockPath('thrower'))).toBe(false);
    // The lock is genuinely free: the next charge answers immediately.
    const started = Date.now();
    expect(() => store.charge('thrower', 1)).toThrow(BudgetExhaustedError);
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});
