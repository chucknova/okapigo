/**
 * Vitest "global setup": runs ONCE before a test run (not before each test).
 *
 * Tests create throwaway operators with slugs like "test-3f9a1c2b" and delete them
 * afterwards. But when a run fails or times out, Vitest can stop a test before its cleanup
 * runs, and those operators are left behind. Over time they pile up and slow down anything
 * that scans every operator (like the nightly schedule job).
 *
 * First, the tests' OWN database (okapigo_test, never your dev one: see src/testing.js) is
 * created if it's missing and brought up to date with the migrations. Then each run removes
 * test operators older than 10 minutes. The age limit means a
 * run never deletes operators that ANOTHER package's tests (running in parallel) are
 * using right now. The pattern only matches test slugs, never real data.
 */
import { createPrismaClient } from '../src/client.js';
import { assertIsolated, prepareDatabase } from '../src/testing.js';

export default async function setup() {
  // The tests' own database (the config called isolate('test')): made and migrated if needed.
  assertIsolated();
  prepareDatabase();

  const prisma = createPrismaClient(/** @type {string} */ (process.env.DATABASE_URL));
  try {
    // Webhook events belong to no business, so deleting a test operator wouldn't remove them.
    // Delete the ones whose payment belongs to a stale test operator first (stage 10c).
    await prisma.$executeRaw`
      DELETE FROM webhook_events w
       USING payments p, operators o
       WHERE p.reference = w.payload->'data'->>'reference'
         AND o.id = p.operator_id
         AND o.slug ~ '^test-[0-9a-f]{8}$'
         AND o.created_at < now() - interval '10 minutes'`;
    await prisma.$executeRaw`
      DELETE FROM operators
       WHERE slug ~ '^test-[0-9a-f]{8}$'
         AND created_at < now() - interval '10 minutes'`;
  } finally {
    await prisma.$disconnect();
  }
}
