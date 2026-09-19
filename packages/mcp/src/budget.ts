import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { canonicalSlug, isSafeSlug, reportsDir, yggHome } from '@yggdrasil/home';
import type { BudgetState, IBudgetStore, SpendLogEntry } from '@yggdrasil/engine';

/**
 * WHERE THE CAP LIVES BETWEEN PROCESSES.
 *
 * The engine emits through `IBudgetStore` and never touches a filesystem — the
 * same rule `ICognitionSink` follows — so the durable half of decision D1 is
 * here, in the package that already owns the shared home.
 *
 *   <home>/eval/budgets/<id>.json   the counter, one file per budget id
 *   <home>/reports/eval-spend.jsonl the append-only spend log
 *
 * A write is atomic (temp file + rename) because a budget counter torn in half
 * by a crash is a cap that silently resets, which is the exact failure the
 * persistence exists to prevent.
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

/** A budget id is a plain name, like a report slug — never a path. */
export function budgetPath(id: string): string {
  if (!isSafeSlug(id)) throw new Error('budget id must be a plain name (letters, digits, dot, dash, underscore)');
  const canonical = canonicalSlug(id);
  const dir = resolve(budgetsDir());
  const file = resolve(dir, `${canonical}.json`);
  const rel = relative(dir, file);
  if (rel !== `${canonical}.json` || isAbsolute(rel) || rel.startsWith('..')) {
    throw new Error('budget id escapes the budgets directory');
  }
  return file;
}

export class FileBudgetStore implements IBudgetStore {
  read(id: string): BudgetState | undefined {
    const file = budgetPath(id);
    let raw: string;
    try {
      raw = readFileSync(file, 'utf8');
    } catch {
      return undefined;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null) return undefined;
      const state = parsed as Partial<BudgetState>;
      // A counter that cannot be read must never be read as ZERO: that would
      // turn a corrupted file into a fresh 2,000-call allowance.
      if (typeof state.id !== 'string' || !isWhole(state.limit) || !isWhole(state.spent)) {
        throw new Error(`budget "${id}" is unreadable at ${file}; refusing to treat it as unspent`);
      }
      return {
        id: state.id,
        limit: state.limit,
        spent: state.spent,
        tokensIn: isWhole(state.tokensIn) ? state.tokensIn : 0,
        tokensOut: isWhole(state.tokensOut) ? state.tokensOut : 0,
        ...(typeof state.ownerOverride === 'string' ? { ownerOverride: state.ownerOverride } : {}),
      };
    } catch (err) {
      throw err instanceof Error ? err : new Error(String(err));
    }
  }

  write(state: BudgetState): void {
    const file = budgetPath(state.id);
    const temp = `${file}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify(state)}\n`, 'utf8');
    renameSync(temp, file);
  }

  appendSpend(entry: SpendLogEntry): void {
    appendFileSync(spendLogPath(), `${JSON.stringify(entry)}\n`, 'utf8');
  }
}

function isWhole(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}
