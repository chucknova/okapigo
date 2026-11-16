/**
 * Vitest "global setup": runs ONCE before a test run (not before each test).
 *
 * Tests create throwaway operators with slugs like "test-3f9a1c2b" and delete them
 * afterwards. But when a run fails or times out, Vitest can stop a test before its cleanup
 * runs, and those operators are left behind. Over time they pile up and slow down anything
 * that scans every operator (like the nightly schedule job).
 *
 * So each run first removes test operators older than 10 minutes. The age limit means a
 * run never deletes operators that ANOTHER package's tests (running in parallel) are
 * using right now. The pattern only matches test slugs, never real data.
 */
import { existsSync } from 'node:fs';
import { createPrismaClient } from '../src/client.js';

export default async function setup() {
  const rootEnv = new URL('../../../.env', import.meta.url);
  if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

  const prisma = createPrismaClient(/** @type {string} */ (process.env.DATABASE_URL));
  try {
    await prisma.$executeRaw`
      DELETE FROM operators
       WHERE slug ~ '^test-[0-9a-f]{8}$'
         AND created_at < now() - interval '10 minutes'`;
  } finally {
    await prisma.$disconnect();
  }
}
