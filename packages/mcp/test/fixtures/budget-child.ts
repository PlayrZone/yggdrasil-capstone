import { existsSync } from 'node:fs';
import { BudgetExhaustedError, CallBudget } from '@yggdrasil/engine';
import { FileBudgetStore } from '../../src/budget.js';

/**
 * A SECOND OPERATING-SYSTEM PROCESS, spending the same budget.
 *
 * Not a `.test.ts`, so vitest never collects it: it is launched by
 * `evalBudget.test.ts` with `tsx`, and it shares with its parent exactly what a
 * real second MCP server would — `YGG_HOME` and nothing else. No in-memory
 * state, no module instance, no lock object. If the lock in `src/budget.ts` is
 * a fiction, this is what proves it: the successes across every process must
 * still add up to the cap.
 *
 *   argv: <budget id> <limit> <attempts> [go-file]
 *   stdout: exactly one line — {"ok":<charges that landed>}
 *
 * The optional go-file is a starting pistol. Without it the first child to
 * finish booting takes the whole cap before the rest exist, and the test would
 * measure process STARTUP rather than contention.
 */

const [, , id, limitArg, attemptsArg, goFile] = process.argv;
if (!id || !limitArg || !attemptsArg) {
  process.stderr.write('usage: budget-child.ts <budget-id> <limit> <attempts> [go-file]\n');
  process.exit(2);
}
if (!process.env['YGG_HOME']) {
  // Refuse rather than fall back: a child that quietly used the real lab home
  // would write a counter into ~/.yggdrasil-lab and the test would still pass.
  process.stderr.write('budget-child.ts refuses to run without YGG_HOME\n');
  process.exit(2);
}

const limit = Number(limitArg);
const attempts = Number(attemptsArg);

const budget = CallBudget.open(new FileBudgetStore(), {
  id,
  purpose: 'cross-process stress',
  runId: `child-${process.pid}`,
  limit,
});

if (goFile) {
  const slot = new Int32Array(new SharedArrayBuffer(4));
  const deadline = Date.now() + 30_000;
  while (!existsSync(goFile) && Date.now() < deadline) Atomics.wait(slot, 0, 0, 2);
}

let ok = 0;
for (let i = 0; i < attempts; i += 1) {
  try {
    budget.spend(1);
    ok += 1;
  } catch (err) {
    // An exhausted cap is the expected answer here, and the child keeps asking:
    // the contention AFTER the cap is reached is where a store that re-reads
    // only sometimes would leak the extra call.
    if (!(err instanceof BudgetExhaustedError)) throw err;
  }
}

process.stdout.write(`${JSON.stringify({ ok })}\n`);
