import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Benchmarks are NOT part of `pnpm test` (whose config only collects
 * `test/**\/*.test.ts`). Run them with `pnpm --filter @yggdrasil/engine bench`.
 * The root is pinned to the package so the bench files' imports resolve
 * wherever the command is run from.
 */
export default defineConfig({
  root: fileURLToPath(new URL('..', import.meta.url)),
  test: {
    include: ['bench/**/*.bench.ts'],
    environment: 'node',
    testTimeout: 600_000,
    fileParallelism: false,
  },
});
