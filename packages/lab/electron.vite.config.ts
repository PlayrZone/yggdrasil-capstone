import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = (rel: string): string => fileURLToPath(new URL(rel, import.meta.url));

const ENGINE_INDEX = here('../engine/src/index.ts');
const REPO_ROOT = here('../..');

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/main',
      rollupOptions: { input: { index: resolve(here('.'), 'src/main/index.ts') } },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/preload',
      rollupOptions: { input: { index: resolve(here('.'), 'src/preload/index.ts') } },
    },
  },
  renderer: {
    root: resolve(here('.'), 'src/renderer'),
    plugins: [react()],
    resolve: {
      alias: {
        '@yggdrasil/engine': ENGINE_INDEX,
      },
    },
    server: { fs: { allow: [REPO_ROOT] } },
    build: {
      outDir: 'out/renderer',
      rollupOptions: { input: { index: resolve(here('.'), 'src/renderer/index.html') } },
    },
  },
});
