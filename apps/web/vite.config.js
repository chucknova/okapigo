// @ts-check
/**
 * Vite: the guest web's dev server and build tool.
 *
 *   pnpm --filter @okapigo/web dev     http://localhost:5173, instant reload while editing
 *   pnpm --filter @okapigo/web build   dist/: small, hashed files for production
 *
 * DEV PROXY: the browser talks only to :5173. Requests for API paths are passed through to
 * the API on :4000, so there's one origin and no CORS setup. (In production the API serves
 * the built files itself, so it's one origin there too.)
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API = 'http://localhost:4000';
// Paths the API answers. Everything else is the web app's own route.
// (Not /pay: since stage 12e, /pay/:token is a guest-web page; its data is /public/….)
const apiPaths = ['/public', '/api', '/payments', '/simulator', '/webhooks', '/health'];

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: Object.fromEntries(apiPaths.map((p) => [p, { target: API, changeOrigin: false }])),
  },
  build: {
    // manifest.json maps "src/main.jsx" to its hashed output file. The API reads it to put
    // the right <script> and <link> tags into its server-made pages (stage 12a plumbing).
    manifest: true,
    // Modern phones only need modern JavaScript: smaller output than older targets.
    target: 'es2022',
  },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.{js,jsx}'],
    setupFiles: ['./test/setup.js'],
    testTimeout: 20_000, // see test/setup.js
  },
});
