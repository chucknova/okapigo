// @ts-check
/**
 * Playwright: END-TO-END tests. A real browser (Chromium, set up as a phone) books a tour
 * through the real system:
 *
 *   built guest web ──served by──► API on :4100 ──► PostgreSQL, Redis ──► background worker
 *
 *   pnpm --filter @okapigo/web e2e     builds the web app, then runs e2e/*.spec.js
 *
 * Port 4100, not 4000, so it never collides with your `pnpm dev` API. Each run seeds a
 * throwaway copy of Ìrìn (e2e/global-setup.js) and deletes it afterwards.
 */
import { defineConfig, devices } from '@playwright/test';
import { isolate } from '@okapigo/db/testing';

// The browser tests' own database and Redis (okapigo_e2e, Redis database 2): not your dev
// ones (your `pnpm dev` used to answer the tests' WhatsApp tickets, 15c-4), and not the unit
// tests' either. Everything started from here inherits them: the API, the worker, the tests.
const services = isolate('e2e');

export const E2E_PORT = 4100;
const base = `http://localhost:${E2E_PORT}`;

export default defineConfig({
  testDir: './e2e',
  // A whole booking, including a payment webhook processed by the worker, can take a while.
  timeout: 90_000,
  expect: { timeout: 15_000 },
  // One booking at a time: the steps share one database and one seeded operator.
  workers: 1,
  reporter: [['list']],
  globalSetup: './e2e/global-setup.js',
  use: {
    baseURL: base,
    // Phone first, as the PRD says: Chromium sized and behaving like a Pixel 7.
    ...devices['Pixel 7'],
    // Locally, the Google Chrome you already have (no 190 MB download, which kept timing out
    // on a slow connection). CI downloads Playwright's own Chromium (see ci.yml).
    channel: process.env.CI ? undefined : 'chrome',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      // The real API, serving the built web app (apps/web/dist) and the share pages.
      command: 'node --env-file-if-exists=../../.env ../api/src/server.js',
      url: `${base}/health`,
      env: {
        API_PORT: String(E2E_PORT),
        API_PUBLIC_URL: base,
        WEB_PUBLIC_URL: base,
        // Always the simulator, whatever .env says: the journeys press the simulator's own Pay
        // button, and must not depend on Paystack's servers or this connection. (Real values
        // here win over the .env file.)
        PAYMENT_PROVIDER: 'simulator',
        DATABASE_URL: services.databaseUrl,
        REDIS_URL: services.redisUrl,
        // Private job queues (the worker in e2e/global-setup.js uses the same), so a `pnpm dev`
        // worker running alongside can't take these jobs.
        JOBS_PREFIX: 'okg-e2e',
        LOG_LEVEL: 'warn',
        // The guest messages' emails go to the local mailbox (Mailpit, pnpm services:up), and
        // the journeys read them there (stage 14c). Nothing leaves this machine.
        EMAIL_PROVIDER: 'mailpit',
      },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      // A stand-in for the operator's own website, on another origin (the booking widget).
      command: 'node e2e/host-server.js',
      url: 'http://localhost:4200/',
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
