// @ts-check
/**
 * departures.js — keeps a schedule's DEPARTURES in line with its RULE.
 *
 * syncScheduleDepartures() is called whenever a schedule is created or changed, by the seed,
 * and (from session 6) by a daily background job that rolls the 60-day window forward.
 *
 * It's a "reconcile" function: work out what SHOULD exist, compare with what DOES exist,
 * and fix the difference. Running it twice in a row changes nothing the second time
 * ("idempotent"), so it's always safe to call.
 *
 *   should exist, doesn't        → create it
 *   exists, shouldn't, EMPTY     → delete it (nobody is affected)
 *   exists, shouldn't, HAS GUESTS→ keep it and report it: a person must decide (cancel and
 *                                  refund under the policy, session 7), never the code
 *   capacity changed             → update future departures that still use the old schedule
 *                                  capacity, unless they already have more guests than the
 *                                  new capacity (reported instead)
 *
 * Only FUTURE departures are touched. The past is history.
 */
import { expandSchedule } from '@okapigo/shared/schedule';
import { addDays, dateToString, localDate, zonedTimeToUtc } from '@okapigo/shared/time';

export const HORIZON_DAYS = 60;

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} scheduleId
 * @param {{
 *   now?: Date,                    // injectable clock, so tests can control "now"
 *   horizonDays?: number,
 *   previousCapacity?: number,     // the schedule's effective capacity BEFORE this change
 * }} [options]
 */
export async function syncScheduleDepartures(prisma, scheduleId, options = {}) {
  const now = options.now ?? new Date();
  const horizonDays = options.horizonDays ?? HORIZON_DAYS;

  return prisma.$transaction(async (tx) => {
    const schedule = await tx.schedule.findUniqueOrThrow({
      where: { id: scheduleId },
      include: { product: { include: { operator: true } } },
    });
    const { product } = schedule;
    const timeZone = product.operator.timeZone;
    const capacity = schedule.capacity ?? product.defaultCapacity;

    // 1. What SHOULD exist: the rule expanded over [today, today + horizon], future only.
    const today = localDate(now, timeZone);
    const desired = schedule.isActive
      ? expandSchedule(
          {
            startDate: dateToString(schedule.startDate),
            endDate: schedule.endDate ? dateToString(schedule.endDate) : null,
            daysOfWeek: schedule.daysOfWeek,
            times: schedule.times,
            skipDates: schedule.skipDates.map(dateToString),
          },
          {
            from: today,
            to: addDays(today, horizonDays),
            timeZone,
            durationMinutes: product.durationMinutes,
          },
        ).filter((d) => d.startsAt > now)
      : [];
    const desiredTimes = new Set(desired.map((d) => d.startsAt.getTime()));

    // 2. What DOES exist (future departures from this schedule).
    const existing = await tx.departure.findMany({
      where: { scheduleId, startsAt: { gt: now } },
    });
    const existingTimes = new Set(existing.map((d) => d.startsAt.getTime()));

    // 3. Create the missing ones. skipDuplicates: if a one-off departure already sits at
    //    exactly that time, the unique (product, startsAt) index skips it quietly.
    const toCreate = desired.filter((d) => !existingTimes.has(d.startsAt.getTime()));
    const { count: created } = await tx.departure.createMany({
      data: toCreate.map((d) => ({
        operatorId: schedule.operatorId,
        productId: schedule.productId,
        scheduleId,
        startsAt: d.startsAt,
        endsAt: d.endsAt,
        capacity,
      })),
      skipDuplicates: true,
    });

    // 4. Remove the ones that shouldn't exist, but ONLY if empty. The seat-count conditions
    //    are inside the DELETE itself, so even if a hold lands on one of these departures a
    //    split second after we read it, the delete simply skips it.
    const stale = existing.filter((d) => !desiredTimes.has(d.startsAt.getTime()));
    const { count: removed } = await tx.departure.deleteMany({
      where: { id: { in: stale.map((d) => d.id) }, seatsSold: 0, seatsHeld: 0 },
    });
    /** Departures a person needs to look at, with the reason. */
    const needsAttention = stale
      .filter((d) => d.seatsSold + d.seatsHeld > 0)
      .map((d) => ({ ...summary(d), reason: 'NO_LONGER_IN_SCHEDULE' }));

    // 5. Capacity change: update departures still on the OLD schedule capacity (so a
    //    departure whose capacity staff changed by hand keeps that change), but never below
    //    the guests already on it. The guest-count condition is in the SQL, so it's checked
    //    atomically, row by row.
    const previous = options.previousCapacity;
    if (previous !== undefined && previous !== capacity) {
      await tx.$executeRaw`
        UPDATE departures
           SET capacity = ${capacity}, updated_at = now()
         WHERE schedule_id = ${scheduleId}::uuid
           AND starts_at > ${now}
           AND capacity = ${previous}
           AND seats_sold + seats_held <= ${capacity}`;
      const tooFull = await tx.departure.findMany({
        where: { scheduleId, startsAt: { gt: now }, capacity: previous },
      });
      needsAttention.push(...tooFull.map((d) => ({ ...summary(d), reason: 'OVER_NEW_CAPACITY' })));
    }

    return { created, removed, needsAttention };
  });
}

/** @param {import('@prisma/client').Departure} d */
function summary(d) {
  return { id: d.id, startsAt: d.startsAt, seatsSold: d.seatsSold, seatsHeld: d.seatsHeld };
}

/**
 * Bookable departures for a product between two LOCAL dates (inclusive), with seats left.
 * Used by the staff API now and the public booking pages in session 10, so every channel
 * computes availability the same way (INV-02).
 *
 * Only future, non-cancelled departures count as bookable.
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ operatorId: string, productId: string, from: string, to: string, timeZone: string, now?: Date }} q
 */
export async function listAvailability(
  prisma,
  { operatorId, productId, from, to, timeZone, now = new Date() },
) {
  // Local dates → UTC instants: from 00:00 on `from` to 00:00 on the day after `to`.
  const start = zonedTimeToUtc(from, '00:00', timeZone);
  const end = zonedTimeToUtc(addDays(to, 1), '00:00', timeZone);

  const departures = await prisma.departure.findMany({
    where: {
      operatorId,
      productId,
      status: 'scheduled',
      startsAt: { gte: start > now ? start : now, lt: end },
    },
    orderBy: { startsAt: 'asc' },
  });
  return departures.map((d) => ({
    ...d,
    seatsAvailable: d.capacity - d.seatsSold - d.seatsHeld,
  }));
}
