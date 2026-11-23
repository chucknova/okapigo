// @ts-check
/**
 * processors.js — what each background job actually DOES.
 *
 * Kept separate from index.js (which wires up BullMQ) so tests can call these functions
 * directly, without Redis, and check their effect on the database.
 *
 * Every processor is SAFE TO RUN TWICE. BullMQ retries failed jobs, and the sweeper may
 * reach a hold at the same moment as its own expiry job. That's fine because the functions
 * underneath are idempotent: releaseHold() succeeds only once per hold, and
 * syncScheduleDepartures() creates nothing that already exists.
 */
import {
  releaseHold,
  expireDueHolds,
  extendAllSchedules,
  verifyLedger,
  processWebhookEvent,
  sweepWebhookEvents,
  reconcile,
  queueBalanceNotices,
  pushChannelUpdates,
} from '@okapigo/db';
import { resetDemo } from '@okapigo/db/reset';
import { JOBS } from '@okapigo/jobs';

/**
 * @param {{
 *   prisma: import('@prisma/client').PrismaClient,
 *   logger: import('pino').Logger,
 *   provider: import('@okapigo/payments').PaymentProvider,
 *   fetch?: typeof fetch,      tests pass a pretend OTA
 * }} deps
 * @returns {Record<string, (data: any) => Promise<unknown>>} job name → handler
 */
export function createProcessors({ prisma, logger, provider, fetch: doFetch = fetch }) {
  /**
   * Tells one OTA one notification at the address it subscribed: POST, JSON, with the headers
   * it asked for (its own way of knowing it's us), 5 seconds at most. Anything but a 2xx answer
   * is a failure (told again next run).
   * @param {any} sub  a channel subscription @param {any} notification
   */
  async function sendToChannel(sub, notification) {
    const res = await doFetch(sub.url, {
      method: 'POST',
      headers: { ...sub.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(notification),
      signal: AbortSignal.timeout(5_000),
      redirect: 'error', // never follow a redirect somewhere else
    }).catch((/** @type {any} */ err) => {
      throw new Error(
        err?.name === 'TimeoutError' ? 'no answer in 5 seconds' : 'could not reach it',
      );
    });
    if (!res.ok) throw new Error(`it answered ${res.status}`);
  }

  return {
    /** One hold's time is up: give its seats back (if nobody already did). */
    async [JOBS.expireHold]({ holdId }) {
      const released = await releaseHold(prisma, holdId, { reason: 'expired' });
      // false is normal: the guest paid or cancelled first, or the sweeper got there.
      logger.info({ holdId, released }, 'expire-hold');
      return { released };
    },

    /** Every minute: catch any expired hold whose own job was lost. */
    async [JOBS.sweepHolds]() {
      const expired = await expireDueHolds(prisma);
      if (expired > 0) logger.warn({ expired }, 'sweeper expired holds that had no job');
      return { expired };
    },

    /**
     * Every night: extend each schedule's 60-day window by the day that just passed.
     * Optional job data { operatorId } limits it to one business (tests, manual re-runs).
     * (Processors receive the job's DATA, not the job: see run() in index.js.)
     * @param {{ operatorId?: string }} [data]
     */
    async [JOBS.extendSchedules](data) {
      const result = await extendAllSchedules(prisma, { operatorId: data?.operatorId });
      logger.info({ ...result, failed: result.failed.length }, 'extend-schedules');
      if (result.failed.length > 0) {
        // Fail the job so BullMQ retries it later. Safe, because the work is idempotent:
        // schedules that already succeeded won't create anything the second time.
        throw new Error(`extend-schedules: ${result.failed.length} schedule(s) failed`);
      }
      return result;
    },

    /**
     * Every night: do the books balance? (PRD: "a nightly check that every account balances".)
     * Errors should be impossible (the database refuses unbalanced transactions), so if one
     * appears, something bypassed the rules: log it loudly and fail the job so it shows on the
     * jobs dashboard. (Alerting arrives with the error tracker, session 20.)
     */
    /** The public demo's nightly reset (19a-2): only scheduled when DEMO_RESET=on. */
    async [JOBS.resetDemo](data) {
      const result = await resetDemo(prisma, {
        slug: data?.slug || undefined,
        onlyIfDemo: true, // never a real business that shares the slug
      });
      if (result.skipped) logger.warn({ reason: result.reason }, 'demo reset skipped');
      else
        logger.info(
          { past: result.past, upcoming: result.upcoming, photos: result.photos, ms: result.ms },
          'demo reset: wiped and made again',
        );
      return result;
    },
    async [JOBS.verifyLedger]() {
      const result = await verifyLedger(prisma);
      for (const issue of result.issues) {
        logger[issue.severity === 'error' ? 'error' : 'warn'](issue, 'ledger check');
      }
      if (!result.ok) throw new Error('verify-ledger: the books do not balance');
      return { ok: true, warnings: result.issues.length };
    },

    /**
     * A payment provider event (stage 10c): verify with the provider, then settle the
     * payment, booking, seats and ledger in one transaction. Throws on failure, so BullMQ
     * retries with backoff; settling twice is impossible (payment row lock + idempotent ledger).
     */
    async [JOBS.processWebhook]({ eventId }) {
      const result = await processWebhookEvent(prisma, provider, eventId);
      const level = result.status === 'needs_review' ? 'warn' : 'info';
      logger[level]({ eventId, ...result }, 'webhook processed');
      return result;
    },

    /** Every minute: events whose job was lost or keeps failing. */
    async [JOBS.sweepWebhooks]() {
      const result = await sweepWebhookEvents(prisma, provider);
      if (result.found > 0) logger.warn(result, 'webhook sweeper found unprocessed events');
      return result;
    },

    /**
     * Every 10 minutes: ask the provider about payments and refunds that webhooks never
     * finished (stage 10e). Anything found is processed through the SAME webhook path.
     */
    async [JOBS.reconcile]() {
      const result = await reconcile(prisma, provider);
      const found = result.settled + result.failed + result.abandoned + result.refundsResolved;
      if (found > 0 || result.refundsNeverSent > 0)
        logger.warn(result, 'reconciliation found unfinished money');
      return result;
    },

    /**
     * Every morning (09:00 Lagos): balance reminders for guests (7, 3, 1 days before the due
     * date) and overdue alerts for staff. It only WRITES them to the outbox; session 14 sends.
     * @param {{ operatorId?: string }} [data]
     */
    async [JOBS.balanceReminders](data) {
      const result = await queueBalanceNotices(prisma, { operatorId: data?.operatorId });
      logger.info(result, 'balance-reminders');
      return result;
    },

    /**
     * Every 30 seconds: tell connected OTAs what changed (seats, prices) since they were last
     * told (17c). An OTA that's down is told again next time.
     * @param {{ operatorId?: string }} [data]
     */
    async [JOBS.pushChannels](data) {
      const result = await pushChannelUpdates(prisma, {
        send: sendToChannel,
        operatorId: data?.operatorId,
      });
      if (result.failed > 0) logger.warn(result, 'push-channels: an OTA didn’t take an update');
      return result;
    },
  };
}
