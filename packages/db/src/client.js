// @ts-check
/**
 * client.js — creates a Prisma client: the object every app uses to query the database.
 *
 *   const prisma = createPrismaClient(process.env.DATABASE_URL);
 *   const staff = await prisma.user.findMany({ where: { operatorId } });
 *
 * Prisma 7 talks to PostgreSQL through a "driver adapter". Here it's @prisma/adapter-pg, which
 * uses the same `pg` driver as our health check. That gives us normal Node networking,
 * which works on every host the PRD lists (Render, Railway, Fly, Neon).
 *
 * Why a factory function instead of one shared `prisma` instance?
 * Same reason as createApp() in session 1: whoever starts the app decides which database
 * it talks to. Tests can point it at a test database; the server at the real one.
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

/**
 * @param {string} databaseUrl e.g. postgresql://okapigo:okapigo@localhost:5432/okapigo
 */
export function createPrismaClient(databaseUrl) {
  const adapter = new PrismaPg({ connectionString: databaseUrl });
  return new PrismaClient({ adapter });
}
