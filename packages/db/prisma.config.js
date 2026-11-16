// @ts-check
/**
 * prisma.config.js — settings for the Prisma CLI (migrate, generate, seed, studio).
 *
 * Prisma 7 moved these out of schema.prisma and stopped auto-loading `.env`, so we load the
 * repo-root .env ourselves. In CI there's no .env file; the workflow sets DATABASE_URL.
 */
import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

const rootEnv = new URL('../../.env', import.meta.url);
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    // What `prisma db seed` and `prisma migrate reset` run to fill an empty database.
    seed: 'node src/seed/run.js',
  },
  datasource: {
    // Read directly (not with Prisma's env() helper, which throws when it's missing).
    // `prisma generate` runs on every `pnpm install` and only reads the schema, so it must
    // work on a fresh clone with no .env yet. Commands that do connect (migrate, seed)
    // still fail with a clear error if DATABASE_URL isn't set.
    url: process.env.DATABASE_URL,
  },
});
