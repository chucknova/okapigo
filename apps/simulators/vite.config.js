// @ts-check
/**
 * Vite: the WhatsApp simulator's dev server and build (stage 13c-2).
 *
 *   pnpm --filter @okapigo/simulators dev     http://localhost:5174/simulator/whatsapp/
 *   pnpm --filter @okapigo/simulators build   dist/, which the API serves at /simulator/whatsapp/
 *
 * The app lives UNDER /simulator/whatsapp/ (base), next to the simulator's API routes. In
 * development, the API's paths are passed through to :4000, so there's one origin and no CORS.
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API = 'http://localhost:4000';

export default defineConfig({
  base: '/simulator/whatsapp/',
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      // The simulator's API: a guest's message, and reading or resetting a chat.
      '^/simulator/whatsapp/(conversations/|[a-z0-9-]+/messages)': { target: API },
      // The operator's name for the header.
      '/public': { target: API },
    },
  },
  build: { target: 'es2022' },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.{js,jsx}'],
    testTimeout: 20_000,
  },
});
