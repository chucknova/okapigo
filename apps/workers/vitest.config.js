// Vitest settings for the workers app.
import { defineConfig } from 'vitest/config';
import { isolate } from '@okapigo/db/testing';

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
    // Warms Prisma before each file's tests start their clocks: a process's first queries are
    // compiled, and in a full run every process compiles at once (see the file for details).
    setupFiles: ['../../packages/db/test-support/warm-up.js'],
    globalSetup: ['../../packages/db/test-support/global-setup.js'],
    // Keep test output clean: the app logger is created with level "silent" in tests.
  },
});
