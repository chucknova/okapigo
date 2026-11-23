// @ts-check
/**
 * reset.js — the public demo's nightly reset (stage 19a-2; PRD "Hosting and demo operations":
 * "a scheduled job wipes the demo operator and reseeds it, moving all schedules forward so
 * dates are always current").
 *
 *   resetDemo(prisma, { slug, now })   the business with this slug: deleted (everything under
 *                                      it goes with it), then made again as a DEMO business
 *                                      with its history (seed/history.js), dated from `now`
 *
 * Who runs it:
 *   - the workers app, every night at 04:00 Lagos time, ONLY when DEMO_RESET=on (the deployed
 *     demo). Off by default, so it can never wipe your own development data.
 *   - `pnpm demo:reset`, by hand (it wipes that business: yours to run)
 *
 * The new copy is a DEMO business (isDemo): its messages never leave (send.js), so the
 * made-up guests' numbers can never reach a real person.
 */
import { simulatedFeeKobo } from '@okapigo/payments';
import { seedDemoOperator, DEFAULT_SLUG } from './demo-operator.js';
import { seedDemoHistory } from './history.js';

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ slug?: string, now?: Date, onlyIfDemo?: boolean, size?: { pastBookings?: number, upcomingBookings?: number } }} [options]
 *   size: a smaller history (tests); the demo gets the PRD's
 *   onlyIfDemo: the nightly job's safety: never touch a business that isn't a demo one (a
 *   real business that happens to have this slug). `pnpm demo:reset`, run by you, may.
 * @returns {Promise<{ skipped: true, reason: string } | ({ skipped: false, operatorId: string, removed: number, ms: number } & Awaited<ReturnType<typeof seedDemoHistory>>)>}
 */
export async function resetDemo(
  prisma,
  { slug = DEFAULT_SLUG, now = new Date(), onlyIfDemo = false, size = {} } = {},
) {
  const started = Date.now();
  const existing = await prisma.operator.findUnique({ where: { slug } });
  if (onlyIfDemo && existing && !existing.isDemo) {
    return { skipped: true, reason: `"${slug}" is not a demo business: left alone.` };
  }
  // Everything belongs to the business, and goes with it (the schema's cascades).
  const { count: removed } = await prisma.operator.deleteMany({ where: { slug } });
  const operator = await seedDemoOperator(prisma, { slug, now, demo: true });
  const history = await seedDemoHistory(prisma, operator, {
    now,
    feeOf: simulatedFeeKobo,
    ...size,
  });
  return { skipped: false, operatorId: operator.id, removed, ...history, ms: Date.now() - started };
}
