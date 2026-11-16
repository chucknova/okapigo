// @ts-check
/**
 * run.js — the seed entry point. Prisma runs it after `prisma migrate reset`, and you can
 * run it directly with `pnpm db:seed`.
 *
 * It expects an EMPTY database (that's what reset gives you). Running it twice fails on
 * the unique slug, on purpose: silently creating a second demo business would be worse.
 */
import { existsSync } from 'node:fs';
import { createPrismaClient } from '../client.js';
import { seedDemoOperator } from './demo-operator.js';

const rootEnv = new URL('../../../../.env', import.meta.url);
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is not set');

const prisma = createPrismaClient(databaseUrl);

try {
  const operator = await seedDemoOperator(prisma);
  const staff = await prisma.user.count({ where: { operatorId: operator.id } });
  // A CLI script, so plain console output is fine here.
  // eslint-disable-next-line no-console
  console.log(`Seeded "${operator.name}" (${operator.slug}) with ${staff} staff.`);
} finally {
  // Always close the connection, or Node keeps the process alive waiting on it.
  await prisma.$disconnect();
}
