// Vitest settings for the db package. These tests talk to the real PostgreSQL.
import { defineConfig } from 'vitest/config';
import { existsSync } from 'node:fs';

// Locally, load the repo-root .env (CI sets DATABASE_URL in the workflow instead).
const rootEnv = new URL('../../.env', import.meta.url);
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

export default defineConfig({
  test: {
    include: ['test/**/*.test.js'],
    // Removes test operators left behind by earlier failed runs (see the file for details).
    globalSetup: ['./test-support/global-setup.js'],
  },
});
