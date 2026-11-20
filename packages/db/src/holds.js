// @ts-check
/**
 * holds.js — checkout holds (INV-23) and the guarantee of NO DOUBLE-SELLING (INV-02).
 *
 * THE PROBLEM. Two guests look at the Street Food Crawl: 1 seat left. Both press "Book" in
 * the same millisecond. Naive code:
 *     read seats left (1) … read seats left (1) … both say "ok" … both take the seat. Oversold.
 * The two requests interleave between READING and WRITING.
 *
 * THE FIX: a ROW LOCK. createHold() starts a transaction and runs
 *     SELECT … FROM departures WHERE id = $1 FOR UPDATE
 * The first request gets the lock on that ONE departure row. The second request's SELECT
 * waits until the first transaction commits, and then reads the UPDATED seat count, so it
 * sees 0 seats and is refused. Other departures aren't affected; only buyers of the same
 * departure queue up, for a few milliseconds.
 *
 * TWO LAYERS OF SAFETY:
 *   1. the lock: correct behaviour, a clean "SOLD_OUT" for the loser
 *   2. the CHECK constraint (session 5): seats_sold + seats_held <= capacity. Even if a bug
 *      skipped the lock, the database would refuse to oversell (with an error, not quietly)
 * Add-on stock has no CHECK (it's summed across holds), so the lock is what protects it;
 * the concurrency test for add-ons proves it.
 *
 * RELEASING is "exactly once": releaseHold() flips status with
 *     UPDATE holds SET status = … WHERE id = $1 AND status = 'active'
 * Only one caller can win that update (the expiry job, the sweeper, a guest cancelling), so
 * seats are given back once, never twice.
 */

import { SEAT_CONSUMING_STATUSES } from '@okapigo/shared/booking-status';
import { transitionBookingInTx } from './booking-lifecycle.js';
import { seatsOf } from './seats.js';

/** A hold that can't be placed, with a machine-readable code (the API sends 409/404). */
export class HoldError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {Record<string, unknown>} [details]
   */
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

/** Transaction limits: under a burst, requests may queue for the lock or a connection. */
const TX_OPTIONS = { maxWait: 15_000, timeout: 15_000 };

/**
 * Places a hold. Everything inside runs in ONE transaction while holding the lock.
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{
 *   operatorId: string,
 *   departureId: string,
 *   seats: number,
 *   addOns?: Array<{ addOnId: string, quantity: number }>,
 *   channel: 'staff' | 'web' | 'whatsapp' | 'ota',
 *   travellers: unknown,          // stored as entered
 *   quote: unknown,               // the price snapshot
 *   totalKobo: number,
 *   holdMinutes: number,
 *   now?: Date,
 * }} input
 */
export function createHold(prisma, input) {
  return prisma.$transaction((tx) => createHoldInTx(tx, input), TX_OPTIONS);
}

/**
 * The same as createHold, but inside a transaction the CALLER started, so a booking and its
 * hold are created together, all-or-nothing (see bookings.js). The lock is held until the
 * caller's transaction commits.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {Parameters<typeof createHold>[1]} input
 */
export async function createHoldInTx(tx, input) {
  const now = input.now ?? new Date();
  const addOns = input.addOns ?? [];
  {
    // 1. LOCK the departure row. Concurrent holds for this departure wait here.
    //    ($queryRaw because Prisma's query builder has no "FOR UPDATE". The ${…} values are
    //    sent as parameters, never pasted into the SQL, so this is safe from SQL injection.)
    //    With its van or boat's seats (16b, decided: "sales stop at the van's seat count").
    //    Assigning a vehicle locks this same row, so the two can't cross.
    /** @type {Array<{ id: string, product_id: string, capacity: number, seats_sold: number, seats_held: number, status: string, starts_at: Date, resource_seats: number | null }>} */
    const rows = await tx.$queryRaw`
      SELECT d.id, d.product_id, d.capacity, d.seats_sold, d.seats_held, d.status, d.starts_at,
             r.seats AS resource_seats
        FROM departures d
        LEFT JOIN resources r ON r.id = d.resource_id
       WHERE d.id = ${input.departureId}::uuid AND d.operator_id = ${input.operatorId}::uuid
         FOR UPDATE OF d`;
    const departure = rows[0];
    if (!departure) throw new HoldError('DEPARTURE_NOT_FOUND', 'Departure not found.');
    if (departure.status !== 'scheduled') {
      throw new HoldError('DEPARTURE_CANCELLED', 'This departure has been cancelled.');
    }
    if (departure.starts_at <= now) {
      throw new HoldError('DEPARTURE_STARTED', 'This departure has already started.');
    }

    // 2. CHECK seats, reading the numbers AFTER getting the lock, so they're current.
    const available =
      seatsOf({
        capacity: departure.capacity,
        resource: departure.resource_seats === null ? null : { seats: departure.resource_seats },
      }) -
      departure.seats_sold -
      departure.seats_held;
    if (available < input.seats) {
      throw new HoldError(
        'SOLD_OUT',
        available === 0 ? 'This departure is full.' : `Only ${available} seats left.`,
        { seatsAvailable: available },
      );
    }

    // 3. CHECK add-on stock: stock per departure minus what is already claimed, by
    //    ACTIVE HOLDS plus bookings whose seats are SOLD. (A booking still in "held" is
    //    counted through its hold, so it isn't counted twice.)
    if (addOns.length > 0) {
      const ids = addOns.map((a) => a.addOnId);
      const known = await tx.addOn.findMany({
        where: { id: { in: ids }, productId: departure.product_id, isActive: true },
      });
      if (known.length !== ids.length) {
        throw new HoldError('UNKNOWN_ADD_ON', 'That add-on is not available for this tour.');
      }
      const used = await addOnUsage(tx, input.departureId);
      for (const want of addOns) {
        const addOn = /** @type {import('@prisma/client').AddOn} */ (
          known.find((k) => k.id === want.addOnId)
        );
        if (addOn.stockPerDeparture === null) continue; // unlimited
        const left = addOn.stockPerDeparture - (used.get(addOn.id) ?? 0);
        if (want.quantity > left) {
          throw new HoldError('ADD_ON_SOLD_OUT', `Only ${left} "${addOn.name}" left.`, {
            addOnId: addOn.id,
            left,
          });
        }
      }
    }

    // 4. CLAIM: count the seats as held and record the hold. Still inside the lock.
    await tx.$executeRaw`
      UPDATE departures SET seats_held = seats_held + ${input.seats}, updated_at = now()
       WHERE id = ${input.departureId}::uuid`;

    return tx.hold.create({
      data: {
        operatorId: input.operatorId,
        departureId: input.departureId,
        seats: input.seats,
        channel: input.channel,
        travellers: /** @type {any} */ (input.travellers),
        quote: /** @type {any} */ (input.quote),
        totalKobo: input.totalKobo,
        expiresAt: new Date(now.getTime() + input.holdMinutes * 60_000),
        addOns: { create: addOns },
      },
      include: { addOns: true },
    });
    // 5. COMMIT happens when the surrounding transaction ends, releasing the lock.
  }
}

/**
 * Ends an active hold and gives its seats back, exactly once.
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} holdId
 * @param {{ reason: 'released' | 'expired', now?: Date, actor?: import('./booking-lifecycle.js').Actor }} options
 *   'expired' only succeeds if the hold really has passed its expiry time, so a job that
 *   fires a little early can't cut a guest's checkout short.
 * If the hold belongs to a booking that is still "held" (never paid or confirmed), that
 * booking is cancelled in the SAME transaction, with a timeline event. Seats and booking
 * can never disagree.
 *
 * @returns {Promise<boolean>} true if THIS call released it; false if it was already ended
 */
export function releaseHold(prisma, holdId, options) {
  return prisma.$transaction((tx) => releaseHoldInTx(tx, holdId, options), TX_OPTIONS);
}

/**
 * releaseHold inside the caller's transaction (used when cancelling a booking or a whole
 * departure, so everything commits together).
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} holdId
 * @param {{ reason: 'released' | 'expired', now?: Date, actor?: import('./booking-lifecycle.js').Actor, bookingEventData?: Record<string, unknown> }} options
 *   actor / bookingEventData: who released it and why, recorded on the booking's timeline
 *   (defaults: the system, reason "hold_expired" / "hold_released").
 */
export async function releaseHoldInTx(
  tx,
  holdId,
  { reason, now = new Date(), actor, bookingEventData },
) {
  /** @type {Array<{ departure_id: string, seats: number }>} */
  const ended =
    reason === 'expired'
      ? await tx.$queryRaw`
          UPDATE holds SET status = 'expired', ended_at = ${now}
           WHERE id = ${holdId}::uuid AND status = 'active' AND expires_at <= ${now}
       RETURNING departure_id, seats`
      : await tx.$queryRaw`
          UPDATE holds SET status = 'released', ended_at = ${now}
           WHERE id = ${holdId}::uuid AND status = 'active'
       RETURNING departure_id, seats`;
  if (ended.length === 0) return false; // already ended (or not due): nothing to give back

  await tx.$executeRaw`
    UPDATE departures SET seats_held = seats_held - ${ended[0].seats}, updated_at = now()
     WHERE id = ${ended[0].departure_id}::uuid`;

  const booking = await tx.booking.findUnique({ where: { holdId } });
  if (booking?.status === 'held') {
    await transitionBookingInTx(tx, {
      bookingId: booking.id,
      to: 'cancelled',
      actor: actor ?? { type: 'system' },
      data: bookingEventData ?? { reason: reason === 'expired' ? 'hold_expired' : 'hold_released' },
    });
  }
  return true;
}

/**
 * The SWEEPER: expires every active hold whose time is up. Runs every minute as a safety net
 * in case an individual expiry job was lost (e.g. Redis restarted without saving).
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ now?: Date, limit?: number, operatorId?: string }} [options]
 *   operatorId: only sweep one operator. The real job sweeps everyone; TESTS pass their own
 *   operator so they never reach into another test's holds running in parallel (an
 *   unscoped sweep in one test was stealing another test's hold: a flaky failure).
 * @returns {Promise<number>} how many holds this run expired
 */
export async function expireDueHolds(prisma, { now = new Date(), limit = 500, operatorId } = {}) {
  const due = await prisma.hold.findMany({
    where: { status: 'active', expiresAt: { lte: now }, operatorId },
    select: { id: true },
    take: limit,
  });
  let expired = 0;
  for (const { id } of due) {
    if (await releaseHold(prisma, id, { reason: 'expired', now })) expired += 1;
  }
  return expired;
}

/**
 * How many of each add-on are already claimed on a departure: by ACTIVE HOLDS plus bookings
 * whose seats are SOLD. (A booking still in "held" is counted through its hold, so it isn't
 * counted twice.) Used by createHold (under the departure lock, so the numbers are exact) and
 * by the public quote (no lock: a display figure, "4 left tonight").
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} departureId
 * @returns {Promise<Map<string, number>>}  addOnId → quantity claimed
 */
export async function addOnUsage(tx, departureId) {
  /** @type {Array<{ add_on_id: string, used: bigint }>} */
  const usage = await tx.$queryRaw`
    SELECT add_on_id, SUM(quantity) AS used FROM (
      SELECT ha.add_on_id, ha.quantity
        FROM hold_add_ons ha JOIN holds h ON h.id = ha.hold_id
       WHERE h.departure_id = ${departureId}::uuid AND h.status = 'active'
      UNION ALL
      SELECT ba.add_on_id, ba.quantity
        FROM booking_add_ons ba JOIN bookings b ON b.id = ba.booking_id
       WHERE b.departure_id = ${departureId}::uuid
         AND b.status = ANY(${[...SEAT_CONSUMING_STATUSES]}::text[])
    ) claims
    GROUP BY add_on_id`;
  // SUM() returns a BigInt from PostgreSQL; Number() is safe at these sizes.
  return new Map(usage.map((u) => [u.add_on_id, Number(u.used)]));
}
