// @ts-check
/**
 * Before the end-to-end tests: a throwaway operator to book with, and the background
 * worker (it processes Paystack's "payment succeeded" webhook, which confirms the booking).
 * Returns the teardown: stop the worker, delete the operator.
 *
 * The slug starts with "test-", so if a run is ever killed half-way, the test suites'
 * cleanup of old "test-" operators removes the leftovers.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createPrismaClient, seedDemoOperator } from '@okapigo/db';

export default async function globalSetup() {
  const rootEnv = new URL('../../../.env', import.meta.url);
  if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

  const prisma = createPrismaClient(process.env.DATABASE_URL);
  const slug = `test-e2e-${randomUUID().slice(0, 8)}`;
  const operator = await seedDemoOperator(prisma, { slug });
  // Tests read it from here (globalSetup's environment is passed on to the test workers).
  process.env.E2E_OPERATOR_SLUG = slug;

  const worker = spawn(
    process.execPath,
    ['--env-file-if-exists=../../.env', '../workers/src/index.js'],
    {
      cwd: new URL('..', import.meta.url).pathname,
      stdio: 'ignore',
      // The simulator, like the API in playwright.config.js: .env may say paystack, and a worker
      // checking simulator payments with Paystack would never confirm them.
      env: {
        ...process.env,
        PAYMENT_PROVIDER: 'simulator',
        JOBS_PREFIX: 'okg-e2e', // the same private queues as the API in playwright.config.js
        LOG_LEVEL: 'warn',
      },
    },
  );

  return async () => {
    worker.kill('SIGTERM');
    await prisma.operator.delete({ where: { id: operator.id } }).catch(() => {});
    await prisma.$disconnect();
  };
}
