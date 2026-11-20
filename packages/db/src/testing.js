// @ts-check
/**
 * testing.js — the tests' own database and queues, apart from `pnpm dev`'s.
 *
 * Until now every test used the same database and Redis as the app you run with `pnpm dev`.
 * The dev API's every-5-seconds message pass then took the tests' messages, its worker took
 * their queued jobs, and a test's WhatsApp ticket came out with the dev server's address
 * (14c, 15a–15d). So:
 *
 *   isolate('test')   unit and integration tests (api, db, workers)
 *                       DATABASE_URL …/okapigo      → …/okapigo_test
 *                       REDIS_URL    redis://…:6379 → redis://…:6379/1   (Redis's database 1)
 *   isolate('e2e')    the browser tests (apps/web/e2e) and the API they run
 *                       …/okapigo_e2e, and Redis database 2
 *   prepareDatabase() creates that database if it's missing and applies every migration
 *                     (`prisma migrate deploy`: never drops anything)
 *
 * Your dev database is never touched by tests again, and the two kinds of tests can't touch
 * each other's. A guard refuses to run tests on a database whose name doesn't end in _test or
 * _e2e.
 */
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const ROOT_ENV = new URL('../../../.env', import.meta.url);
const DB_PACKAGE = new URL('..', import.meta.url).pathname;
const REDIS_DB = { test: '1', e2e: '2' };

/**
 * Points this process (and every process it starts) at the tests' own database and Redis.
 * Call it before anything connects: at the top of a test config.
 * @param {'test' | 'e2e'} kind
 * @returns {{ databaseUrl: string, redisUrl: string }}
 */
export function isolate(kind) {
  // The repo's .env first (it never overrides what's already set: CI sets its own values).
  if (existsSync(ROOT_ENV)) process.loadEnvFile(ROOT_ENV);
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL isn’t set: copy .env.example to .env (see the README).');
  }
  const db = new URL(process.env.DATABASE_URL);
  const name = db.pathname.slice(1);
  if (!isIsolated(name)) db.pathname = `/${name}_${kind}`;
  const redis = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
  redis.pathname = `/${REDIS_DB[kind]}`;
  process.env.DATABASE_URL = db.toString();
  process.env.REDIS_URL = redis.toString();
  return { databaseUrl: process.env.DATABASE_URL, redisUrl: process.env.REDIS_URL };
}

/** A tests' database: its name ends in _test or _e2e. @param {string} name */
const isIsolated = (name) => /_(test|e2e)$/.test(name);

/**
 * Refuses to go on unless DATABASE_URL is a tests' own database (the guard: tests delete what
 * they make, and must never do it in your dev data).
 * @param {string | undefined} url
 */
export function assertIsolated(url = process.env.DATABASE_URL) {
  const name = url ? new URL(url).pathname.slice(1) : '';
  if (!isIsolated(name)) {
    throw new Error(
      `Tests must use their own database (a name ending in _test or _e2e), not "${name}". ` +
        'Call isolate() from @okapigo/db/testing in the test config.',
    );
  }
}

/**
 * Creates the tests' database if it's missing and brings it up to date with every migration.
 * Safe to run from several test packages at once: Prisma takes a lock while it migrates, and a
 * database someone else just created is simply used.
 */
export function prepareDatabase() {
  assertIsolated();
  const run = () =>
    execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
      cwd: DB_PACKAGE,
      env: process.env,
      stdio: 'pipe',
    });
  try {
    run();
  } catch (err) {
    // Two packages creating the database at the same moment: one wins; try once more.
    if (/already exists|P1009|P1001/.test(String(/** @type {any} */ (err).stderr ?? err))) run();
    else throw err;
  }
}
