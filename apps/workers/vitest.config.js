// Vitest settings for the workers app.
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
    // Warms Prisma before each file's tests start their clocks: a process's first queries are
    // compiled, and in a full run every process compiles at once (see the file for details).
    setupFiles: ['../../packages/db/test-support/warm-up.js'],
    globalSetup: ['../../packages/db/test-support/global-setup.js'],
    // Keep test output clean: the app logger is created with level "silent" in tests.
  },
});
