// Vitest settings for the API package.
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
    // At most half the CPU cores run test files at once. Measured in stage 11b on an 8-core
    // laptop (API suite alone): the default (cores − 1 = 7 files at once) took 59 s with a
    // slowest test of 7.7 s; 4 at once took 40 s with a slowest test of 4.1 s. Too many files
    // starting together starve Postgres (in Docker, on the same machine) and each other,
    // and in a full run beside the other packages a first test sometimes passed 20 s.
    // A percentage scales down on CI's smaller machines too.
    maxWorkers: '50%',
    // Warms Prisma before each file's tests start their clocks: a process's first queries are
    // compiled, and in a full run every process compiles at once (see the file for details).
    setupFiles: ['../../packages/db/test-support/warm-up.js'],
    globalSetup: ['../../packages/db/test-support/global-setup.js'],
    // Keep test output clean: the app logger is created with level "silent" in tests.
  },
});
