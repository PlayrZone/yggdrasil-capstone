import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * The research baseline is NOT part of `pnpm test`. Run it with
 * `pnpm --filter @yggdrasil/engine baseline`. Root is pinned to the package so
 * imports and the default output directory resolve wherever it is run from.
 */

// Shared machine: cap the worker pool (default 4). `YGG_TEST_WORKERS` overrides —
// integer; empty/invalid -> 4; `0` or `max` -> vitest's own default.
const requested = (process.env.YGG_TEST_WORKERS ?? '').trim().toLowerCase();
const workers = requested === 'max' ? 0 : /^\d+$/.test(requested) ? Number(requested) : 4;
const workerCap = workers > 0 ? { maxWorkers: workers, minWorkers: 1 } : {};

export default defineConfig({
  root: fileURLToPath(new URL('..', import.meta.url)),
  test: {
    include: ['baseline/**/*.baseline.ts'],
    environment: 'node',
    testTimeout: 1_800_000,
    fileParallelism: false,
    pool: 'forks',
    poolOptions: { forks: { execArgv: ['--max-old-space-size=3072'] } },
    ...workerCap,
  },
});
