// @ts-check
/**
 * Vite: the operator app's dev server and build (session 15).
 *
 *   pnpm --filter @okapigo/operator dev     http://localhost:5175/app/
 *   pnpm --filter @okapigo/operator build   dist/, which the API serves at /app/
 *
 * The app lives UNDER /app/ (base), on the API's own origin, so its sign-in token and
 * requests need no CORS. In development, the API's paths are passed through to :4000.
 *
 * The OFFLINE part: the build also writes precache.json, the list of every file the app is
 * made of. The service worker (public/sw.js) saves them all when it installs, so the app
 * opens with no signal at all.
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API = 'http://localhost:4000';

/** Lists the built files for the service worker to save (see public/sw.js). */
const precacheList = () => ({
  name: 'okapigo-precache-list',
  apply: /** @type {const} */ ('build'),
  /** @param {any} _ @param {Record<string, any>} bundle */
  generateBundle(_, bundle) {
    const files = Object.keys(bundle).filter((f) => !f.endsWith('.map'));
    // public/ files aren't in the bundle: list the ones the app needs offline too.
    const extra = ['manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png'];
    // @ts-ignore: Rollup's plugin context
    this.emitFile({
      type: 'asset',
      fileName: 'precache.json',
      source: JSON.stringify({ files: ['./', ...files, ...extra] }, null, 2),
    });
  },
});

export default defineConfig({
  base: '/app/',
  plugins: [react(), precacheList()],
  server: {
    port: 5175,
    strictPort: true,
    proxy: Object.fromEntries(['/api', '/auth', '/public'].map((p) => [p, { target: API }])),
  },
  build: { target: 'es2022' },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.{js,jsx}'],
    setupFiles: ['./test/setup.js'],
    testTimeout: 20_000,
  },
});
