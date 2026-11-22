// @ts-check
/**
 * Before the end-to-end tests: a throwaway operator to book with, the background worker (it
 * processes Paystack's "payment succeeded" webhook, which confirms the booking), and Sojourna,
 * the pretend travel website (journey 3, 17d-2), with this operator's OCTO key. Returns the
 * teardown: stop them, delete the operator.
 *
 * The slug starts with "test-", so if a run is ever killed half-way, the test suites'
 * cleanup of old "test-" operators removes the leftovers.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createPrismaClient, seedDemoOperator } from '@okapigo/db';
import { assertIsolated } from '@okapigo/db/testing';

/** Where Sojourna runs during the browser tests. */
const SOJOURNA_PORT = 4500;

export default async function globalSetup() {
  const rootEnv = new URL('../../../.env', import.meta.url);
  if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

  // The browser tests' own database (playwright.config.js called isolate('e2e'); made and
  // migrated by e2e/prepare-database.js before the API started). Never your dev data.
  assertIsolated();
  const prisma = createPrismaClient(process.env.DATABASE_URL);
  const slug = `test-e2e-${randomUUID().slice(0, 8)}`;
  const operator = await seedDemoOperator(prisma, { slug });
  // The booking widget may appear on the stand-in host site (e2e/host-server.js), and only there.
  await prisma.operator.update({
    where: { id: operator.id },
    data: { embedDomains: ['localhost:4200'] },
  });
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

  // Sojourna (journey 3): started here, not as a web server, because its key belongs to the
  // operator just made (`octo_dev_<slug>`). Its own bookings in a throwaway folder.
  const sojournaData = mkdtempSync(join(tmpdir(), 'sojourna-e2e-'));
  const sojourna = spawn(process.execPath, ['../mock-ota/server/main.js'], {
    cwd: new URL('..', import.meta.url).pathname,
    stdio: 'ignore',
    env: {
      ...process.env,
      NODE_ENV: 'production', // the built pages (dist/)
      MOCK_OTA_PORT: String(SOJOURNA_PORT),
      MOCK_OTA_PUBLIC_URL: `http://localhost:${SOJOURNA_PORT}`,
      OKAPIGO_OCTO_URL: 'http://localhost:4100/octo',
      MOCK_OTA_API_KEY: `octo_dev_${slug}`,
      MOCK_OTA_DATA: join(sojournaData, 'sojourna.json'),
    },
  });
  for (let i = 0; ; i++) {
    const up = await fetch(`http://localhost:${SOJOURNA_PORT}/api/supplier`)
      .then((r) => r.ok)
      .catch(() => false);
    if (up) break;
    if (i >= 60) throw new Error('Sojourna didn’t start (apps/mock-ota): is it built?');
    await new Promise((r) => setTimeout(r, 500));
  }
  process.env.SOJOURNA_URL = `http://localhost:${SOJOURNA_PORT}`;

  return async () => {
    worker.kill('SIGTERM');
    sojourna.kill('SIGTERM');
    rmSync(sojournaData, { recursive: true, force: true });
    // E2E_KEEP=1 keeps the business and its bookings, to look into a failure afterwards
    // (the unit tests' clean-up never touches "test-e2e-…" slugs).
    if (process.env.E2E_KEEP) {
      process.stdout.write(`\nE2E_KEEP: kept operator ${slug}\n`);
    } else {
      await prisma.operator.delete({ where: { id: operator.id } }).catch(() => {});
    }
    await prisma.$disconnect();
  };
}
