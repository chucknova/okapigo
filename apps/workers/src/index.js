// @ts-check
/**
 * The workers app: runs background jobs. Start it with `pnpm dev` (Turborepo starts it next
 * to the API) or `pnpm --filter @okapigo/workers dev`.
 *
 * It does three things:
 *   1. registers the TIMETABLED jobs (idempotently: restarting doesn't create duplicates)
 *        sweep-holds       every 60 seconds
 *        extend-schedules  every night at 02:00 Lagos time
 *        verify-ledger     every night at 03:00 Lagos time
 *        sweep-webhooks    every 60 seconds
 *        reconcile         every 10 minutes (payments and refunds webhooks missed)
 *   2. starts a BullMQ Worker per queue that runs jobs as they become due
 *   3. shuts down gracefully, finishing the current job before exiting
 *
 * Several copies of this app can run at once (for scale or redundancy). BullMQ makes
 * sure each job is processed by only one of them.
 */
import { Queue, Worker } from 'bullmq';
import { pino } from 'pino';
import { Redis } from 'ioredis';
import { createPrismaClient } from '@okapigo/db';
import { QUEUES, JOBS, connectionFor } from '@okapigo/jobs';
import { createPaymentProvider, redisStore } from '@okapigo/payments';
import { createProcessors } from './processors.js';

const { DATABASE_URL, REDIS_URL, NODE_ENV = 'development', LOG_LEVEL = 'info' } = process.env;
if (!DATABASE_URL || !REDIS_URL) throw new Error('DATABASE_URL and REDIS_URL must be set');

const logger = pino({
  level: LOG_LEVEL,
  ...(NODE_ENV === 'development' && {
    transport: {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:HH:MM:ss' },
    },
  }),
}).child({ app: 'workers' });

const prisma = createPrismaClient(DATABASE_URL);
const connection = connectionFor(REDIS_URL);

// The payment provider, to re-check webhooks with (stage 10c). Same settings as the API.
// A live Paystack key is refused here too: createPaystackProvider throws LiveKeyError.
const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: 1 });
const provider = createPaymentProvider({
  provider: process.env.PAYMENT_PROVIDER === 'paystack' ? 'paystack' : 'simulator',
  paystackSecretKey: process.env.PAYSTACK_SECRET_KEY || undefined,
  baseUrl: process.env.API_PUBLIC_URL ?? 'http://localhost:4000',
  // The simulator's "transactions" live in Redis, shared with the API process.
  simulatorStore: redisStore(redis),
  simulatorSecret: process.env.SIMULATOR_WEBHOOK_SECRET || undefined,
});
const processors = createProcessors({ prisma, logger, provider });

// --- 1. Timetabled jobs -----------------------------------------------------------------
// upsertJobScheduler = "create, or update if it already exists". Safe on every start.
const maintenance = new Queue(QUEUES.maintenance, { connection });
await maintenance.upsertJobScheduler(
  JOBS.sweepHolds,
  { every: 60_000 },
  { name: JOBS.sweepHolds, opts: { removeOnComplete: 100, removeOnFail: 1000 } },
);
await maintenance.upsertJobScheduler(
  JOBS.extendSchedules,
  // A cron pattern: minute 0, hour 2, every day. tz makes "02:00" mean 02:00 in Lagos.
  { pattern: '0 2 * * *', tz: 'Africa/Lagos' },
  { name: JOBS.extendSchedules, opts: { removeOnComplete: 30, removeOnFail: 100 } },
);
await maintenance.upsertJobScheduler(
  JOBS.verifyLedger,
  { pattern: '0 3 * * *', tz: 'Africa/Lagos' }, // 03:00, after the 02:00 schedule roll
  { name: JOBS.verifyLedger, opts: { removeOnComplete: 30, removeOnFail: 100 } },
);
await maintenance.upsertJobScheduler(
  JOBS.sweepWebhooks,
  { every: 60_000 },
  { name: JOBS.sweepWebhooks, opts: { removeOnComplete: 100, removeOnFail: 1000 } },
);
await maintenance.upsertJobScheduler(
  JOBS.reconcile,
  { every: 10 * 60_000 },
  { name: JOBS.reconcile, opts: { removeOnComplete: 100, removeOnFail: 1000 } },
);
await maintenance.close();

// --- 2. Workers -----------------------------------------------------------------------
/** @type {import('bullmq').Processor} */
async function run(job) {
  const handler = processors[job.name];
  if (!handler) throw new Error(`No processor for job "${job.name}"`);
  return handler(job.data);
}

const workers = [QUEUES.holds, QUEUES.maintenance, QUEUES.webhooks].map((queue) => {
  const worker = new Worker(queue, run, { connection, concurrency: 5 });
  worker.on('failed', (job, err) =>
    logger.error(
      { queue, job: job?.name, jobId: job?.id, attempt: job?.attemptsMade, err: err.message },
      'job failed',
    ),
  );
  return worker;
});
logger.info({ provider: provider.name }, 'workers running: holds, maintenance, webhooks');

// --- 3. Graceful shutdown -------------------------------------------------------------
/** @param {string} signal */
async function shutdown(signal) {
  logger.info({ signal }, 'shutting down workers');
  // close() waits for jobs in progress to finish, so none is cut off halfway.
  await Promise.allSettled(workers.map((w) => w.close()));
  await prisma.$disconnect();
  await redis.quit();
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
