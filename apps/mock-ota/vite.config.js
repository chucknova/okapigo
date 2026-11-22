// @ts-check
/**
 * Vite: Sojourna's pages (17d). In development the server (server/main.js) runs Vite inside
 * itself, so pages and API share one origin, :4400. `build` writes dist/, which the server
 * serves when NODE_ENV is production.
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: { target: 'es2022' },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.{js,jsx}'],
    testTimeout: 20_000,
  },
});
