// @ts-check
/**
 * `pnpm demo:reset`: the public demo's reset, by hand. DELETES the business with that slug
 * (DEMO_SLUG, else irin-lagos-tours) and makes it again, as a demo business with its history.
 * Your own data goes too if the slug is yours, which is why you run it, not the app.
 */
import { existsSync } from 'node:fs';
import { createPrismaClient } from '../client.js';
import { resetDemo } from './reset.js';

const rootEnv = new URL('../../../../.env', import.meta.url);
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is not set');

const prisma = createPrismaClient(databaseUrl);
try {
  const r = await resetDemo(prisma, { slug: process.env.DEMO_SLUG || undefined });
  if (r.skipped) throw new Error(r.reason); // can't happen by hand; for the type
  // A command you run, so plain console output is fine here.
  // eslint-disable-next-line no-console
  console.log(
    `Demo reset: ${r.removed ? 'the old copy removed, ' : ''}${r.past} past and ${r.upcoming} upcoming bookings, in ${r.ms} ms.`,
  );
} finally {
  await prisma.$disconnect();
}
