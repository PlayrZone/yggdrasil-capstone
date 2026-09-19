import { defineConfig } from 'vitest/config';

/**
 * Main-process unit tests only. The renderer needs a browser and Electron's
 * main needs an app instance, so what is tested here is deliberately the pure
 * part of main: the IPC guards and key-at-rest handling.
 */

// Shared machine: cap the worker pool (default 4). `YGG_TEST_WORKERS` overrides —
// integer; empty/invalid -> 4; `0` or `max` -> vitest's own default (CI, free box).
const requested = (process.env.YGG_TEST_WORKERS ?? '').trim().toLowerCase();
const workers = requested === 'max' ? 0 : /^\d+$/.test(requested) ? Number(requested) : 4;
const workerCap = workers > 0 ? { maxWorkers: workers, minWorkers: 1 } : {};

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    ...workerCap,
  },
});
