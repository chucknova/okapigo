// @ts-check
/**
 * Starts Sojourna: http://localhost:4400 (MOCK_OTA_PORT).
 *
 *   pnpm --filter @okapigo/mock-ota dev     the pages through Vite, changes show at once
 *   pnpm --filter @okapigo/mock-ota build   then `start`: the built pages from dist/
 *
 * Settings (the repo's .env):
 *   OKAPIGO_OCTO_URL     the supplier's OCTO address (default http://localhost:4000/octo)
 *   MOCK_OTA_API_KEY     Sojourna's key for it (default: the demo seed's octo_dev_irin-lagos-tours)
 *   MOCK_OTA_DATA        where Sojourna keeps its bookings (default data/sojourna.json)
 */
import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createApp } from './app.js';
import { createOctoClient } from './octo-client.js';
import { createStore } from './store.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const port = Number(process.env.MOCK_OTA_PORT ?? 4400);
const production = process.env.NODE_ENV === 'production';

const octo = createOctoClient({
  baseUrl: process.env.OKAPIGO_OCTO_URL ?? 'http://localhost:4000/octo',
  apiKey: process.env.MOCK_OTA_API_KEY || 'octo_dev_irin-lagos-tours',
});
const store = createStore(process.env.MOCK_OTA_DATA ?? join(root, 'data', 'sojourna.json'));

/** The pages: Vite while developing; the built files (and index.html for any page) when built. */
async function pages() {
  if (!production) {
    const { createServer } = await import('vite');
    const vite = await createServer({
      root,
      server: { middlewareMode: true },
      appType: 'spa',
    });
    return vite.middlewares;
  }
  const dist = join(root, 'dist');
  const router = express.Router();
  router.use(express.static(dist, { index: false }));
  router.use((req, res) => res.sendFile(join(dist, 'index.html')));
  return router;
}

const app = createApp({ octo, store, pages: await pages() });
app.listen(port, () => {
  process.stdout.write(`Sojourna on http://localhost:${port}\n`);
});
