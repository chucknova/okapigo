/**
 * Vitest setup file: WARMS the database layer before a file's tests start their clocks.
 *
 * Why: Prisma 7 compiles each new shape of query the first time a process uses it, and
 * caches it for that process. Seeding a demo business uses many shapes, so the FIRST seed
 * in a fresh process is several times slower than the next (measured: ~0.4–1 s cold, ~0.12 s
 * warm). In `pnpm test`, every test process starts cold AT THE SAME TIME, so their first
 * tests all compile at once, fight for the CPU, and one or two of them used to pass the
 * 20-second test limit, always a FIRST test in its file, often two at the same moment
 * (investigated after stage 12h; the note is docs/learning/test-timeouts.md).
 *
 * So before a file's tests run, this seeds one throwaway business and deletes it again,
 * inside a hook with its own generous limit. The tests' 20 s then measure the tests, not the
 * one-off warm-up. In a process that's already warm it costs about 0.15 s.
 */
import { beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createPrismaClient } from '../src/client.js';
import { seedDemoOperator } from '../src/seed/demo-operator.js';

/** Cold warm-ups under heavy load are slow; that's fine here, and expected. */
const WARM_UP_LIMIT_MS = 60_000;

beforeAll(async () => {
  const rootEnv = new URL('../../../.env', import.meta.url);
  if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
  if (!process.env.DATABASE_URL) return; // a package without a database (nothing to warm)

  const prisma = createPrismaClient(process.env.DATABASE_URL);
  // A "test-" slug like every test's, so global-setup.js clears it if a run is ever killed here.
  const slug = `test-${randomUUID().slice(0, 8)}`;
  try {
    await seedDemoOperator(prisma, { slug });
  } finally {
    await prisma.operator.deleteMany({ where: { slug } });
    await prisma.$disconnect();
  }
}, WARM_UP_LIMIT_MS);
