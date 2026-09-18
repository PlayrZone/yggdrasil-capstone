import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = (rel: string): string => fileURLToPath(new URL(rel, import.meta.url));

const ENGINE_INDEX = here('../engine/src/index.ts');
const REPO_ROOT = here('../..');

export default defineConfig({
  main: {
    // Bundle the engine into main (it's pure TS) so the LLM backend is
    // available without runtime workspace resolution.
    plugins: [externalizeDepsPlugin({ exclude: ['@yggdrasil/engine'] })],
    resolve: { alias: { '@yggdrasil/engine': ENGINE_INDEX } },
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
    // The sim worker is a module worker (`new Worker(url, { type: 'module' })`),
    // so its own bundle has to be ES too. This is what keeps the engine out of
    // the UI chunk: the worker build pulls it in, the page build does not.
    worker: {
      format: 'es',
      rollupOptions: { output: { entryFileNames: 'assets/[name]-[hash].js', chunkFileNames: 'assets/[name]-[hash].js' } },
    },
    build: {
      outDir: 'out/renderer',
      rollupOptions: { input: { index: resolve(here('.'), 'src/renderer/index.html') } },
    },
  },
});
