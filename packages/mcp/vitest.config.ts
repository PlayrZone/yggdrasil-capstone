import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // These are integration tests that run thousands of real sim ticks on the
    // full world (resources + wildlife); give them room.
    testTimeout: 40000,
  },
});
