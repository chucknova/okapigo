/**
 * helpers.js — building blocks shared by API tests.
 *
 * Two kinds of tests use these:
 *   - UNIT tests: fake dependencies (no database), e.g. "what if Redis is down?"
 *   - INTEGRATION tests: the real PostgreSQL, with throwaway operators per test
 */
import { randomUUID } from 'node:crypto';
import { pino } from 'pino';
import { createPrismaClient, seedDemoOperator } from '@okapigo/db';
import { createApp } from '../src/app.js';
import { createSessionService } from '../src/auth/session-service.js';

/** A logger that prints nothing, so test output only shows test results. */
export const silentLogger = pino({ level: 'silent' });

export const TEST_AUTH_SECRET = 'test-secret-that-is-at-least-32-characters-long';

// --- Fakes for unit tests -------------------------------------------------------------

/** A fake Prisma whose health query always succeeds. */
export const healthyPrisma = { $queryRaw: async () => [{ '?column?': 1 }] };
/** A fake Redis whose PING always succeeds. */
export const healthyRedis = { ping: async () => 'PONG' };
/** A fake dependency that fails, simulating "the database/Redis is down". */
export const failing = {
  $queryRaw: async () => {
    throw new Error('connection refused');
  },
  ping: async () => {
    throw new Error('connection refused');
  },
};

/**
 * An OTP sender that remembers what it "sent", so tests can read the code.
 *   sender.lastCodeFor('kemi@...') → '042917'
 */
export function createCapturingSender() {
  /** @type {Array<{ channel: string, destination: string, code: string, purpose: string }>} */
  const sent = [];
  return {
    sent,
    async send(message) {
      sent.push(message);
    },
    /** @param {string} destination */
    lastCodeFor(destination) {
      return sent.findLast((m) => m.destination === destination)?.code;
    },
  };
}

/** Builds an app with fakes for anything not provided. */
export function buildApp(overrides = {}) {
  return createApp({
    logger: silentLogger,
    prisma: healthyPrisma,
    redis: healthyRedis,
    otpSender: createCapturingSender(),
    authSecret: TEST_AUTH_SECRET,
    ...overrides,
  });
}

// --- Real-database helpers for integration tests --------------------------------------

/**
 * Creates everything an integration test file needs, and a cleanup function.
 * Usage:
 *   const ctx = createTestContext();
 *   afterAll(() => ctx.close());
 *   afterEach(() => ctx.cleanup());
 */
export function createTestContext() {
  const prisma = createPrismaClient(process.env.DATABASE_URL);
  const sender = createCapturingSender();
  const app = buildApp({ prisma, otpSender: sender });
  const sessions = createSessionService({ prisma });
  /** Slugs created by the current test; everything under them is deleted in cleanup(). */
  const slugs = [];

  return {
    prisma,
    sender,
    app,

    /** Seeds a throwaway copy of Ìrìn Lagos Tours; returns it with its staff by role. */
    async seedOperator() {
      const slug = `test-${randomUUID().slice(0, 8)}`;
      slugs.push(slug);
      const operator = await seedDemoOperator(prisma, { slug });
      const staff = await prisma.user.findMany({
        where: { operatorId: operator.id },
        include: { role: true },
        orderBy: { name: 'asc' },
      });
      return {
        operator,
        owner: staff.find((u) => u.role.key === 'owner'),
        manager: staff.find((u) => u.role.key === 'manager'),
        guides: staff.filter((u) => u.role.key === 'guide'),
      };
    },

    /** Remembers a slug to clean up (for operators created via the sign-up API). */
    track(slug) {
      slugs.push(slug);
    },

    /**
     * A signed-in token for a user, created directly (skipping the code step). Permission
     * tests use this so they test permissions, not sign-in, and stay fast.
     */
    tokenFor(userId) {
      return sessions.createSession({ userId });
    },

    async cleanup() {
      // Deleting an operator cascades to its roles, users and their sessions.
      await prisma.operator.deleteMany({ where: { slug: { in: slugs } } });
      // Codes aren't tenant data (no cascade); remove the ones sent to test addresses.
      await prisma.otpChallenge.deleteMany({
        where: { OR: slugs.map((slug) => ({ destination: { contains: slug } })) },
      });
      slugs.length = 0;
      sender.sent.length = 0;
    },

    close: () => prisma.$disconnect(),
  };
}

/** A unique, valid email for tests that need a brand-new contact. */
export function uniqueEmail(label = 'person') {
  return `${label}-${randomUUID().slice(0, 8)}@new.example`;
}
