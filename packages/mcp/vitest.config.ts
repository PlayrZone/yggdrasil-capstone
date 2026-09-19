import { defineConfig } from 'vitest/config';

// Shared machine: cap the worker pool (default 4). `YGG_TEST_WORKERS` overrides —
// integer; empty/invalid -> 4; `0` or `max` -> vitest's own default (CI, free box).
const requested = (process.env.YGG_TEST_WORKERS ?? '').trim().toLowerCase();
const workers = requested === 'max' ? 0 : /^\d+$/.test(requested) ? Number(requested) : 4;
const workerCap = workers > 0 ? { maxWorkers: workers, minWorkers: 1 } : {};

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // These are integration tests that run thousands of real sim ticks on the
    // full world (resources + wildlife); give them room.
    testTimeout: 40000,
    ...workerCap,
  },
});
