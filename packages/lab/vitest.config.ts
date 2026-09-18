import { defineConfig } from 'vitest/config';

/**
 * Main-process unit tests only. The renderer needs a browser and Electron's
 * main needs an app instance, so what is tested here is deliberately the pure
 * part of main: the IPC guards and key-at-rest handling.
 */
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
