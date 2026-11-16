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
export async function createHold(prisma, input) {
  const now = input.now ?? new Date();
  const addOns = input.addOns ?? [];

  return prisma.$transaction(async (tx) => {
    // 1. LOCK the departure row. Concurrent holds for this departure wait here.
    //    ($queryRaw because Prisma's query builder has no "FOR UPDATE". The ${…} values are
    //    sent as parameters, never pasted into the SQL, so this is safe from SQL injection.)
    /** @type {Array<{ id: string, product_id: string, capacity: number, seats_sold: number, seats_held: number, status: string, starts_at: Date }>} */
    const rows = await tx.$queryRaw`
      SELECT id, product_id, capacity, seats_sold, seats_held, status, starts_at
        FROM departures
       WHERE id = ${input.departureId}::uuid AND operator_id = ${input.operatorId}::uuid
         FOR UPDATE`;
    const departure = rows[0];
    if (!departure) throw new HoldError('DEPARTURE_NOT_FOUND', 'Departure not found.');
    if (departure.status !== 'scheduled') {
      throw new HoldError('DEPARTURE_CANCELLED', 'This departure has been cancelled.');
    }
    if (departure.starts_at <= now) {
      throw new HoldError('DEPARTURE_STARTED', 'This departure has already started.');
    }

    // 2. CHECK seats, reading the numbers AFTER getting the lock, so they're current.
    const available = departure.capacity - departure.seats_sold - departure.seats_held;
    if (available < input.seats) {
      throw new HoldError(
        'SOLD_OUT',
        available === 0 ? 'This departure is full.' : `Only ${available} seats left.`,
        { seatsAvailable: available },
      );
    }

    // 3. CHECK add-on stock: stock per departure minus what active holds already claim.
    //    (Bookings will add their own claims in session 8.)
    if (addOns.length > 0) {
      const ids = addOns.map((a) => a.addOnId);
      const known = await tx.addOn.findMany({
        where: { id: { in: ids }, productId: departure.product_id, isActive: true },
      });
      if (known.length !== ids.length) {
        throw new HoldError('UNKNOWN_ADD_ON', 'That add-on is not available for this tour.');
      }
      /** @type {Array<{ add_on_id: string, used: bigint }>} */
      const usage = await tx.$queryRaw`
        SELECT ha.add_on_id, SUM(ha.quantity) AS used
          FROM hold_add_ons ha
          JOIN holds h ON h.id = ha.hold_id
         WHERE h.departure_id = ${input.departureId}::uuid AND h.status = 'active'
         GROUP BY ha.add_on_id`;
      // SUM() returns a BigInt from PostgreSQL; Number() is safe at these sizes.
      const used = new Map(usage.map((u) => [u.add_on_id, Number(u.used)]));
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
    // 5. COMMIT happens when this function returns, and the lock is released.
  }, TX_OPTIONS);
}

/**
 * Ends an active hold and gives its seats back, exactly once.
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} holdId
 * @param {{ reason: 'released' | 'expired', now?: Date }} options
 *   'expired' only succeeds if the hold really has passed its expiry time, so a job that
 *   fires a little early can't cut a guest's checkout short.
 * @returns {Promise<boolean>} true if THIS call released it; false if it was already ended
 */
export async function releaseHold(prisma, holdId, { reason, now = new Date() }) {
  return prisma.$transaction(async (tx) => {
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
    return true;
  }, TX_OPTIONS);
}

/**
 * The SWEEPER: expires every active hold whose time is up. Runs every minute as a safety net
 * in case an individual expiry job was lost (e.g. Redis restarted without saving).
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ now?: Date, limit?: number }} [options]
 * @returns {Promise<number>} how many holds this run expired
 */
export async function expireDueHolds(prisma, { now = new Date(), limit = 500 } = {}) {
  const due = await prisma.hold.findMany({
    where: { status: 'active', expiresAt: { lte: now } },
    select: { id: true },
    take: limit,
  });
  let expired = 0;
  for (const { id } of due) {
    if (await releaseHold(prisma, id, { reason: 'expired', now })) expired += 1;
  }
  return expired;
}
