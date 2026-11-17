// @ts-check
/**
 * @okapigo/jobs — background job queues (BullMQ on Redis).
 *
 * Why background jobs? Some work must happen LATER (release a hold in 15 minutes), on a
 * TIMETABLE (every minute, every night at 02:00), or must survive retries (a webhook in
 * session 9). Doing it inside an HTTP request would mean the guest waits, or the work is
 * lost if the server restarts. BullMQ stores jobs in Redis; the workers app
 * (apps/workers) picks them up and runs them.
 *
 *   API ──enqueue──► Redis (queue) ──► workers app ──► database
 *
 * This package holds what BOTH sides need: queue names, job names and how to connect. The
 * API only ever ENQUEUES (createJobClient); only apps/workers PROCESSES.
 */
import { Queue } from 'bullmq';

/** Queue names. One queue per area keeps busy work from delaying urgent work. */
export const QUEUES = /** @type {const} */ ({
  holds: 'holds', // per-hold expiry jobs, timed to the second
  maintenance: 'maintenance', // timetabled housekeeping: sweeper, schedule window
});

/** Job names within the queues. */
export const JOBS = /** @type {const} */ ({
  expireHold: 'expire-hold',
  sweepHolds: 'sweep-holds',
  extendSchedules: 'extend-schedules',
  verifyLedger: 'verify-ledger',
});

/**
 * BullMQ connection settings from a redis:// URL.
 * maxRetriesPerRequest: null is REQUIRED by BullMQ for workers: their blocking
 * "wait for the next job" commands must never time out and fail.
 * @param {string} redisUrl
 */
export function connectionFor(redisUrl) {
  return { url: redisUrl, maxRetriesPerRequest: null };
}

/**
 * What the API uses to schedule work. Small on purpose: easy to fake in tests.
 * @param {string} redisUrl
 * @param {{ prefix?: string }} [options] Redis key prefix (default "bull"). Tests use a
 *   unique one so they never share queues with a `pnpm dev` worker running alongside.
 */
export function createJobClient(redisUrl, { prefix } = {}) {
  const holds = new Queue(QUEUES.holds, { connection: connectionFor(redisUrl), prefix });

  return {
    /**
     * Schedules the job that releases a hold when its time is up.
     * The job ID is derived from the hold ID, so scheduling it twice creates ONE job.
     * One second is added so the job never fires before the hold is due (releaseHold
     * refuses an early expiry anyway, but a second job attempt would be wasted).
     * @param {string} holdId
     * @param {Date} expiresAt
     */
    async scheduleHoldExpiry(holdId, expiresAt) {
      await holds.add(
        JOBS.expireHold,
        { holdId },
        {
          jobId: `expire-${holdId}`,
          delay: Math.max(0, expiresAt.getTime() - Date.now() + 1000),
          attempts: 5,
          backoff: { type: 'exponential', delay: 1000 }, // retry after 1s, 2s, 4s…
          removeOnComplete: 1000, // keep the last 1,000 for inspection, then tidy up
          removeOnFail: 5000,
        },
      );
    },

    async close() {
      await holds.close();
    },
  };
}
