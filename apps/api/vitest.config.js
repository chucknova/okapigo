// Vitest settings for the API package.
import { defineConfig } from 'vitest/config';
import { existsSync } from 'node:fs';

// Locally, load the repo-root .env so integration tests know where Postgres/Redis are.
// In CI there is no .env file; the workflow sets DATABASE_URL/REDIS_URL directly.
const rootEnv = new URL('../../.env', import.meta.url);
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

export default defineConfig({
  test: {
    include: ['test/**/*.test.js'],
    // Removes test operators left behind by earlier failed runs (see the file for details).
    // Integration tests share ONE database with every other package's tests, which run at the
    // same time (including deliberate 40-way races). A test can briefly queue for a connection
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
