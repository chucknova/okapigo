// @ts-check
/**
 * notifications.js — balance reminders and overdue alerts (BKG-06, stage 11d).
 *
 * queueBalanceNotices() runs once a day (workers, 09:00 Lagos). For every booking that still
 * owes money on an upcoming trip, it asks the pure rule in packages/shared/src/deposits.js
 * (balanceNotice) what the booking should have by today, and writes it to the OUTBOX
 * (the notifications table):
 *
 *   7, 3, 1 days before the due date → guest  "balance_reminder:7|3|1"   (sent in session 14)
 *   the day after the due date       → staff  "balance_overdue"          (shown at /api/alerts)
 *
 * Nothing is cancelled automatically: an overdue balance only alerts staff (decided
 * 2026-11-17).
 *
 * SAFE TO RUN ANY NUMBER OF TIMES: the unique (booking, key) index means each reminder is
 * written at most once, and the insert simply skips one that exists (ON CONFLICT DO NOTHING).
 * Running twice a day, or catching up after a day the worker was down, sends nothing twice.
 *
 * It also TIDIES UP: notices still waiting to go out are cancelled once they no longer make
 * sense (the balance was paid, the booking cancelled, the trip passed), and a new reminder
 * replaces an older one nobody sent yet, so a guest never gets "3 days left" after "1 day".
 */
import { balanceNotice } from '@okapigo/shared/deposits';
import { localDate } from '@okapigo/shared/time';

const TX_OPTIONS = { maxWait: 15_000, timeout: 15_000 };

/** Bookings whose balance can be owed: confirmed (pay later), part paid, or amended. */
export const OWING_STATUSES = ['confirmed', 'part_paid', 'amended'];
const BALANCE_KINDS = ['balance_reminder', 'balance_overdue'];

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ now?: Date, operatorId?: string }} [options]
 *   operatorId: one business only (tests, manual re-runs); the daily job walks everyone.
 * @returns {Promise<{ checked: number, reminders: number, overdue: number, cancelled: number }>}
 */
export async function queueBalanceNotices(prisma, { now = new Date(), operatorId } = {}) {
  // 1. Tidy first, so step 2 works on the current picture.
  const cancelled = await cancelStaleNotices(prisma, { now, operatorId });

  // 2. Every booking that may owe money on a trip that hasn't started. (Prisma can't compare
  //    two columns, total > paid, so that filter is applied below in JavaScript.)
  const candidates = await prisma.booking.findMany({
    where: {
      operatorId,
      status: { in: OWING_STATUSES },
      departure: { status: 'scheduled', startsAt: { gt: now } },
    },
    include: { departure: true, product: { include: { operator: true } } },
  });
  const owing = candidates.filter((b) => b.totalKobo > b.amountPaidKobo);

  let reminders = 0;
  let overdue = 0;
  for (const booking of owing) {
    const { timeZone } = booking.product.operator;
    const departureLocalDate = localDate(booking.departure.startsAt, timeZone);
    const notice = balanceNotice({
      departureLocalDate,
      bookedLocalDate: localDate(booking.createdAt, timeZone),
      todayLocalDate: localDate(now, timeZone),
    });
    if (!notice) continue;

    const balanceKobo = booking.totalKobo - booking.amountPaidKobo;
    const row =
      notice.kind === 'reminder'
        ? {
            audience: 'guest',
            kind: 'balance_reminder',
            key: `balance_reminder:${notice.daysBefore}`,
            data: { daysBefore: notice.daysBefore, balanceKobo, departureLocalDate },
          }
        : {
            audience: 'staff',
            kind: 'balance_overdue',
            key: 'balance_overdue',
            data: { balanceKobo, departureLocalDate },
          };

    const created = await prisma.$transaction(async (tx) => {
      const { count } = await tx.notification.createMany({
        data: [{ operatorId: booking.operatorId, bookingId: booking.id, ...row }],
        // ON CONFLICT DO NOTHING: this reminder was already written on an earlier run.
        skipDuplicates: true,
      });
      if (count > 0) {
        // A newer notice makes an older UNSENT reminder pointless (or wrong: "3 days left"
        // arriving after the due date). Cancel it in the same transaction.
        await tx.notification.updateMany({
          where: {
            bookingId: booking.id,
            kind: 'balance_reminder',
            status: 'pending',
            key: { not: row.key },
          },
          data: { status: 'cancelled' },
        });
      }
      return count;
    }, TX_OPTIONS);

    if (created > 0 && row.audience === 'guest') reminders += 1;
    if (created > 0 && row.audience === 'staff') overdue += 1;
  }

  return { checked: owing.length, reminders, overdue, cancelled };
}

/**
 * Cancels balance notices that are still pending but no longer make sense: the booking no
 * longer owes (paid, or the amount changed), it was cancelled or completed, or the trip has
 * started or was called off. One UPDATE … FROM joins notifications to their bookings and
 * departures. Raw SQL because the condition compares columns (total ≤ paid).
 *
 * Also used by the alerts API: an alert about a balance that was since paid disappears.
 *
 * @param {import('@prisma/client').PrismaClient | import('@prisma/client').Prisma.TransactionClient} prisma
 * @param {{ now?: Date, operatorId?: string }} [options]
 * @returns {Promise<number>} how many were cancelled
 */
export function cancelStaleNotices(prisma, { now = new Date(), operatorId } = {}) {
  return prisma.$executeRaw`
    UPDATE notifications n
       SET status = 'cancelled', updated_at = now()
      FROM bookings b
      JOIN departures d ON d.id = b.departure_id
     WHERE n.booking_id = b.id
       AND n.status = 'pending'
       AND n.kind = ANY(${BALANCE_KINDS}::text[])
       AND (${operatorId ?? null}::uuid IS NULL OR n.operator_id = ${operatorId ?? null}::uuid)
       AND (   b.total_kobo <= b.amount_paid_kobo
            OR b.status <> ALL(${OWING_STATUSES}::text[])
            OR d.status <> 'scheduled'
            OR d.starts_at <= ${now})`;
}

/**
 * Open staff alerts for one operator, oldest first, with what staff need to act on them.
 * Stale ones (balance since paid…) are cancelled first, so the list is never out of date.
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} operatorId
 */
export async function listStaffAlerts(prisma, operatorId) {
  await cancelStaleNotices(prisma, { operatorId });
  return prisma.notification.findMany({
    where: { operatorId, audience: 'staff', status: 'pending' },
    include: { booking: { include: { product: true, departure: true } } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
}

/**
 * Staff mark an alert handled. Returns false if it wasn't an open alert of this operator.
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ operatorId: string, id: string }} input
 */
export async function dismissStaffAlert(prisma, { operatorId, id }) {
  const { count } = await prisma.notification.updateMany({
    where: { id, operatorId, audience: 'staff', status: 'pending' },
    data: { status: 'dismissed' },
  });
  return count === 1;
}
