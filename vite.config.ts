import { env } from 'node:process';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages serves project sites from https://<user>.github.io/<repo>/, so
// every asset URL has to carry that prefix. In Actions the repository name is in
// the environment; locally the app is served from the root. The one exception is
// a user/org site (<user>.github.io), which is served from the root too.
const repoName = env.GITHUB_REPOSITORY?.split('/')[1];
const isUserSite = repoName?.endsWith('.github.io') ?? false;
const base = env.GITHUB_ACTIONS && repoName && !isUserSite ? `/${repoName}/` : '/';

export default defineConfig({
  base,
  plugins: [react()],
  worker: {
    format: 'es',
  },
  // transformers.js ships its own wasm assets and breaks if pre-bundled, so it
  // is excluded. web-llm must NOT be excluded: its package entry is a raw ESM
  // bundle with bare imports, which the dev server cannot serve unbundled.
  optimizeDeps: {
    exclude: ['@huggingface/transformers'],
  },
  build: {
    target: 'esnext',
    chunkSizeWarningLimit: 1500,
  },
  server: {
    port: 5173,
  },
});
