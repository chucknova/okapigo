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
    // Keep test output clean: the app logger is created with level "silent" in tests.
  },
});
