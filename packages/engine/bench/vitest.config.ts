import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Benchmarks are NOT part of `pnpm test` (whose config only collects
 * `test/**\/*.test.ts`). Run them with `pnpm --filter @yggdrasil/engine bench`.
 * The root is pinned to the package so the bench files' imports resolve
 * wherever the command is run from.
 */

// Shared machine: cap the worker pool (default 4). `YGG_TEST_WORKERS` overrides —
// integer; empty/invalid -> 4; `0` or `max` -> vitest's own default (CI, free box).
// `fileParallelism: false` below already pins benches to one worker; the cap is
// kept so the file stays polite if that ever changes.
const requested = (process.env.YGG_TEST_WORKERS ?? '').trim().toLowerCase();
const workers = requested === 'max' ? 0 : /^\d+$/.test(requested) ? Number(requested) : 4;
const workerCap = workers > 0 ? { maxWorkers: workers, minWorkers: 1 } : {};

export default defineConfig({
  root: fileURLToPath(new URL('..', import.meta.url)),
  test: {
    include: ['bench/**/*.bench.ts'],
    environment: 'node',
    testTimeout: 600_000,
    fileParallelism: false,
    // A bench that measures memory must not be able to eat the machine, and the
    // heap benchmark needs a real GC it can call. Both belong to the worker, so
    // they are set here rather than left to whoever types the command.
    pool: 'forks',
    poolOptions: { forks: { execArgv: ['--max-old-space-size=3072', '--expose-gc'] } },
    ...workerCap,
  },
});
