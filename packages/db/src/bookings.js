// @ts-check
/**
 * bookings.js — creating bookings and moving them through their lifecycle.
 *
 *   createBooking   hold + booking + travellers + add-ons + "created" event, ONE transaction
 *   confirmBooking  staff "pay later": convert the hold (seats held → sold), held → confirmed
 *   setBookingStatus  the simple manual moves: completed, no_show
 *   updateTraveller   fix a name, dietary needs or contact (not age: that changes the price)
 *
 * Payments (session 10) will reuse secureBookingInTx() to go held → paid / part_paid, and
 * cancellations (session 9) will use transitionBookingInTx() with the policy engine.
 */
import { generateReference, referencePrefix } from '@okapigo/shared/reference';
import { createHoldInTx } from './holds.js';
import { currentPolicyVersion } from './policies.js';
import { BookingError, transitionBookingInTx } from './booking-lifecycle.js';

const TX_OPTIONS = { maxWait: 15_000, timeout: 15_000 };

/**
 * @typedef {import('./booking-lifecycle.js').Actor} Actor
 * @typedef {{ name: string, age: number, categoryKey: string, dietaryNeeds?: string, email?: string | null, phone?: string | null }} TravellerInput
 */

/**
 * Creates a booking in status "held", together with its checkout hold.
 *
 * The hold's row lock (createHoldInTx) and the booking rows are in the SAME transaction:
 * either the seats are held AND the booking exists, or neither.
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{
 *   operatorId: string,
 *   operatorSlug: string,
 *   departureId: string,
 *   productId: string,
 *   channel: 'staff' | 'web' | 'whatsapp' | 'ota',
 *   lead: { name: string, email: string | null, phone: string | null, marketingConsent: boolean },
 *   travellers: TravellerInput[],
 *   addOns: Array<{ addOnId: string, quantity: number, unitKobo: number }>,
 *   quote: unknown,
 *   totalKobo: number,
 *   holdMinutes: number,
 *   notes?: string,
 *   pickupPointName?: string | null,   // required when the tour has pickup points
 *   actor: Actor,
 *   now?: Date,
 * }} input
 */
export async function createBooking(prisma, input) {
  const now = input.now ?? new Date();
  const prefix = referencePrefix(input.operatorSlug);

  // A random reference can (very rarely) collide with an existing one. The unique index
  // rejects it and we simply try again with a new one.
  for (let attempt = 1; ; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const hold = await createHoldInTx(tx, {
          operatorId: input.operatorId,
          departureId: input.departureId,
          seats: input.travellers.length,
          addOns: input.addOns.map(({ addOnId, quantity }) => ({ addOnId, quantity })),
          channel: input.channel,
          travellers: input.travellers.map(({ age, categoryKey }) => ({ age, categoryKey })),
          quote: input.quote,
          totalKobo: input.totalKobo,
          holdMinutes: input.holdMinutes,
          now,
        });

        // Pin the cancellation terms in force right now (BKG-26). Later policy changes
        // create new versions and never affect this booking.
        const product = await tx.product.findUniqueOrThrow({ where: { id: input.productId } });
        const pickupPoint = choosePickupPoint(product, input.pickupPointName ?? null);
        const policyVersion = product.cancellationPolicyId
          ? await currentPolicyVersion(tx, product.cancellationPolicyId)
          : null;

        const booking = await tx.booking.create({
          data: {
            operatorId: input.operatorId,
            policyVersionId: policyVersion?.id ?? null,
            reference: generateReference(prefix),
            departureId: input.departureId,
            productId: input.productId,
            holdId: hold.id,
            channel: input.channel,
            status: 'held',
            quote: /** @type {any} */ (input.quote),
            totalKobo: input.totalKobo,
            leadName: input.lead.name,
            leadEmail: input.lead.email,
            leadPhone: input.lead.phone,
            termsAcceptedAt: now,
            marketingConsent: input.lead.marketingConsent,
            notes: input.notes ?? '',
            pickupPoint: pickupPoint ?? undefined, // undefined → SQL NULL
          },
        });

        await tx.traveller.createMany({
          data: input.travellers.map((t, i) => ({
            operatorId: input.operatorId,
            bookingId: booking.id,
            position: i + 1,
            name: t.name,
            age: t.age,
            categoryKey: t.categoryKey,
            dietaryNeeds: t.dietaryNeeds ?? '',
            email: t.email ?? null,
            phone: t.phone ?? null,
          })),
        });
        if (input.addOns.length > 0) {
          await tx.bookingAddOn.createMany({
            data: input.addOns.map((a) => ({ bookingId: booking.id, ...a })),
          });
        }
        await tx.bookingEvent.create({
          data: {
            operatorId: input.operatorId,
            bookingId: booking.id,
            type: 'created',
            toStatus: 'held',
            actorType: input.actor.type,
            actorUserId: input.actor.type === 'user' ? input.actor.userId : null,
            data: { channel: input.channel, holdExpiresAt: hold.expiresAt.toISOString() },
          },
        });

        return { booking, hold };
      }, TX_OPTIONS);
    } catch (err) {
      const referenceClash =
        /** @type {any} */ (err)?.code === 'P2002' &&
        JSON.stringify(/** @type {any} */ (err).meta).includes('reference');
      if (referenceClash && attempt < 3) continue;
      throw err;
    }
  }
}

/**
 * Moves a "held" booking's seats from HELD to SOLD by converting its hold, and changes its
 * status (to confirmed now; to paid / part_paid when payments arrive in session 10).
 *
 * The hold is converted with a conditional UPDATE (… WHERE status = 'active' AND not
 * expired), so it races safely against the expiry job: exactly one of them wins. If expiry
 * won, the booking has already been cancelled and we report HOLD_EXPIRED.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {{ booking: import('@prisma/client').Booking, to: 'confirmed' | 'part_paid' | 'paid', actor: Actor, now?: Date, data?: Record<string, unknown> }} input
 */
export async function secureBookingInTx(tx, { booking, to, actor, now = new Date(), data }) {
  if (booking.status !== 'held') {
    throw new BookingError(
      'INVALID_TRANSITION',
      `Only a "held" booking can be secured; this one is "${booking.status}".`,
    );
  }

  /** @type {Array<{ departure_id: string, seats: number }>} */
  const converted = await tx.$queryRaw`
    UPDATE holds SET status = 'converted', ended_at = ${now}
     WHERE id = ${booking.holdId}::uuid AND status = 'active' AND expires_at > ${now}
 RETURNING departure_id, seats`;
  if (converted.length === 0) {
    throw new BookingError(
      'HOLD_EXPIRED',
      'The hold on these seats has expired. Start a new booking.',
    );
  }

  // Same seats, different column: held → sold. The total on the departure doesn't change,
  // so the capacity CHECK can't fail here.
  await tx.$executeRaw`
    UPDATE departures
       SET seats_held = seats_held - ${converted[0].seats},
           seats_sold = seats_sold + ${converted[0].seats},
           updated_at = now()
     WHERE id = ${converted[0].departure_id}::uuid`;

  return transitionBookingInTx(tx, { bookingId: booking.id, to, actor, data });
}

/**
 * Loads one of an operator's bookings inside a transaction, or throws NOT_FOUND.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} operatorId
 * @param {string} bookingId
 */
export async function findOwnBooking(tx, operatorId, bookingId) {
  const booking = await tx.booking.findFirst({ where: { id: bookingId, operatorId } });
  if (!booking) throw new BookingError('NOT_FOUND', 'Booking not found.');
  return booking;
}

/**
 * Staff confirm a booking without payment ("pay on the day", or a ₦0 booking).
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ operatorId: string, bookingId: string, actor: Actor, now?: Date }} input
 */
export function confirmBooking(prisma, { operatorId, bookingId, actor, now }) {
  return prisma.$transaction(async (tx) => {
    const booking = await findOwnBooking(tx, operatorId, bookingId);
    return secureBookingInTx(tx, {
      booking,
      to: 'confirmed',
      actor,
      now,
      data: { reason: 'confirmed_without_payment' },
    });
  }, TX_OPTIONS);
}

/**
 * The status changes staff may make directly. Everything else has its own flow:
 * payments (session 10), cancelling and no-shows (cancellations.js: they work out refunds).
 */
export const MANUAL_STATUSES = /** @type {const} */ (['completed']);

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ operatorId: string, bookingId: string, to: typeof MANUAL_STATUSES[number], actor: Actor }} input
 */
export async function setBookingStatus(prisma, { operatorId, bookingId, to, actor }) {
  // Guard in the FUNCTION, not just the API schema: a no-show or cancellation set here would
  // skip the refund calculation. (Session 9: a test was doing exactly that, unnoticed.)
  if (!(/** @type {readonly string[]} */ (MANUAL_STATUSES).includes(to))) {
    throw new BookingError(
      'NOT_A_MANUAL_STATUS',
      `"${to}" has its own action (it works out refunds). Use that instead.`,
    );
  }
  return prisma.$transaction(async (tx) => {
    await findOwnBooking(tx, operatorId, bookingId);
    return transitionBookingInTx(tx, { bookingId, to, actor });
  }, TX_OPTIONS);
}

/**
 * Corrects a traveller's details, recording old and new values on the timeline. Age is not
 * editable here: a different age can mean a different price (that's an amendment).
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ operatorId: string, bookingId: string, travellerId: string, changes: { name?: string, dietaryNeeds?: string, email?: string | null, phone?: string | null }, actor: Actor }} input
 */
export function updateTraveller(prisma, { operatorId, bookingId, travellerId, changes, actor }) {
  return prisma.$transaction(async (tx) => {
    await findOwnBooking(tx, operatorId, bookingId);
    const before = await tx.traveller.findFirst({ where: { id: travellerId, bookingId } });
    if (!before) throw new BookingError('NOT_FOUND', 'Traveller not found.');

    const after = await tx.traveller.update({ where: { id: travellerId }, data: changes });

    /** @type {Record<string, [unknown, unknown]>} field → [old, new] */
    const changed = {};
    for (const key of Object.keys(changes)) {
      if (before[key] !== after[key]) changed[key] = [before[key], after[key]];
    }
    await tx.bookingEvent.create({
      data: {
        operatorId,
        bookingId,
        type: 'traveller_updated',
        actorType: actor.type,
        actorUserId: actor.type === 'user' ? actor.userId : null,
        data: /** @type {any} */ ({ travellerId, changed }),
      },
    });
    return after;
  }, TX_OPTIONS);
}

/**
 * The pickup point a booking will store: a COPY of the product's { name, address }.
 *
 * Rules (decided 2026-11-17): a tour with pickup points needs one chosen; a tour without
 * them can't take one. Checked here, inside createBooking's transaction, so every channel
 * (staff, web, WhatsApp, OTA) follows them. Throwing rolls back the hold created just before.
 *
 * @param {import('@prisma/client').Product} product
 * @param {string | null} name  as chosen by the guest (matched exactly)
 * @returns {{ name: string, address: string } | null}
 */
function choosePickupPoint(product, name) {
  const points = /** @type {Array<{ name: string, address: string }>} */ (product.pickupPoints);
  if (points.length === 0) {
    if (name) {
      throw new BookingError('UNKNOWN_PICKUP_POINT', "This tour doesn't offer pickup.");
    }
    return null;
  }
  if (!name) {
    throw new BookingError('PICKUP_POINT_REQUIRED', 'Choose where we should pick you up.', {
      pickupPoints: points.map((p) => p.name),
    });
  }
  const point = points.find((p) => p.name === name);
  if (!point) {
    throw new BookingError(
      'UNKNOWN_PICKUP_POINT',
      `"${name}" isn't a pickup point for this tour.`,
      {
        pickupPoints: points.map((p) => p.name),
      },
    );
  }
  return { name: point.name, address: point.address };
}
