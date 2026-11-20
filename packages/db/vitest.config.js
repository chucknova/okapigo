// Vitest settings for the db package. These tests talk to the real PostgreSQL.
import { defineConfig } from 'vitest/config';
import { isolate } from './src/testing.js';

// The tests' own database and Redis (okapigo_test, Redis database 1), never your dev ones:
// `pnpm dev` running alongside used to take the tests' messages and jobs. Reads the repo's
// .env first; in CI the workflow's values are used (see packages/db/src/testing.js).
isolate('test');

export default defineConfig({
  test: {
    include: ['test/**/*.test.js'],
    // Removes test operators left behind by earlier failed runs (see the file for details).
    // Integration tests share ONE test database with every other package's tests, which run at
    // the same time (including deliberate 40-way races). A test can briefly queue for a connection
    // or a row lock, so allow 20 s instead of the default 5 s. A single seed takes ~0.1–0.4 s
    // on its own (measured in session 8), so this hides no real slowness.
    testTimeout: 20_000,
    // At most half the CPU cores run test files at once, like the API package (see
    // apps/api/vitest.config.js for the measurements). Both packages test against the same
    // Postgres at the same time during `pnpm test`.
    maxWorkers: '50%',
    // Warms Prisma before each file's tests start their clocks: a process's first queries are
    // compiled, and in a full run every process compiles at once (see the file for details).
    setupFiles: ['./test-support/warm-up.js'],
    globalSetup: ['./test-support/global-setup.js'],
  },
});
