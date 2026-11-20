// @ts-check
/**
 * traveller-change.js — "Change travellers" at the bookings desk (stage 16c-3; designs:
 * Booking actions, "Travellers · Yemi Ojo").
 *
 * One function, two uses: a PREVIEW (what the sheet shows as you press − and +: the new total,
 * the extra to pay or the refund the policy allows, whether the seats fit) and the SAVE, which
 * works the same plan out again under lock and then writes it. So what the office confirmed is
 * what happens.
 *
 * The rules (decided 2026-11-20):
 *   - An added traveller pays the price from WHEN IT WAS BOOKED (the booking's quote). A
 *     category the booking never had (the first child) has no booked price: today's price.
 *   - Only a booking that's on (confirmed, part paid, paid, amended), before the trip starts.
 *   - The lead stays; nobody already checked in is removed; at least one adult stays.
 *   - Children and infants need an age that fits their category.
 *   - More travellers must fit the seats (the van's, once one is assigned).
 *   - Fewer: what's now paid beyond the new total goes back as the POLICY allows, and the
 *     office confirms that amount before it's saved. More: the extra is owed, and the desk sends
 *     a link for it.
 *
 * Names are fixed any time, free, elsewhere (PATCH /bookings/:id/travellers/:id, BKG-25).
 */
import { priceBasket, PricingError } from '@okapigo/shared/pricing';
import { computeRefund } from '@okapigo/shared/cancellation';
import { formatNaira } from '@okapigo/shared/money';
import { POSTINGS } from '@okapigo/shared/ledger';
import { BookingError, transitionBookingInTx } from './booking-lifecycle.js';
import { postTransaction } from './ledger.js';
import { seatsOf } from './seats.js';
import { policyWords } from './desk.js';

const LIVE = ['confirmed', 'part_paid', 'paid', 'amended'];
const TX = { maxWait: 15_000, timeout: 15_000 };

/**
 * @typedef {{ categoryKey: string, name?: string, age?: number | null }} NewTraveller
 * @typedef {{ remove?: string[], add?: NewTraveller[] }} Change
 */

/**
 * Works out what a change would do, from a booking read inside the caller's transaction.
 * Throws for a change that can't be made at all; reports seats that don't fit (the sheet
 * says so) and leaves refusing them to the save.
 * @param {any} b  the booking, with travellers, product (priceCategories), departure (resource), policyVersion
 * @param {Change} change @param {Date} now
 */
export function planTravellerChange(b, { remove = [], add = [] }, now) {
  if (!LIVE.includes(b.status)) {
    throw new BookingError(
      'CANNOT_CHANGE',
      b.status === 'held' ? 'This booking isn’t booked yet.' : 'This booking can’t be changed now.',
    );
  }
  if (b.departure.startsAt <= now)
    throw new BookingError('TRIP_STARTED', 'The trip has started: travellers can’t change now.');
  const quote = /** @type {any} */ (b.quote);
  if ((quote.discountKobo ?? 0) > 0 || (quote.feesKobo ?? 0) > 0) {
    throw new BookingError(
      'CANNOT_REPRICE',
      'This booking had a promo code or a fee, so its price can’t be worked out again here.',
    );
  }

  // Who goes.
  const removing = [...new Set(remove)].map((id) => {
    const t = b.travellers.find((/** @type {any} */ x) => x.id === id);
    if (!t) throw new BookingError('NOT_FOUND', 'That traveller isn’t on this booking.');
    if (t.position === 1)
      throw new BookingError('LEAD_STAYS', 'The lead traveller can’t be removed.');
    if (t.checkInStatus !== 'pending')
      throw new BookingError('CHECKED_IN', `${t.name || 'That traveller'} is already checked in.`);
    return t;
  });

  // The categories, each at its booked price (or today's, if the booking never had it).
  const booked = new Map(
    (quote.lines ?? [])
      .filter((/** @type {any} */ l) => l.type === 'ticket')
      .map((/** @type {any} */ l) => [l.categoryKey, l.unitKobo]),
  );
  const categories = b.product.priceCategories
    .filter((/** @type {any} */ c) => c.isActive || booked.has(c.key))
    .sort((/** @type {any} */ x, /** @type {any} */ y) => y.minAge - x.minAge)
    .map((/** @type {any} */ c) => ({
      id: c.id,
      key: c.key,
      name: c.name,
      minAge: c.minAge,
      maxAge: c.maxAge,
      amountKobo: booked.get(c.key) ?? c.amountKobo,
      booked: booked.has(c.key),
    }));

  // Who comes.
  const adding = add.map((t) => {
    const cat = categories.find((/** @type {any} */ c) => c.key === t.categoryKey);
    if (!cat)
      throw new BookingError('UNKNOWN_CATEGORY', 'That kind of traveller isn’t sold on this tour.');
    const age = t.age ?? null;
    if (cat.maxAge !== null && age === null)
      throw new BookingError('AGE_NEEDED', `Give the age of each ${cat.name.toLowerCase()}.`);
    if (age !== null && (age < cat.minAge || (cat.maxAge !== null && age > cat.maxAge))) {
      throw new BookingError(
        'AGE_OUTSIDE_CATEGORY',
        `${cat.name} is ${cat.minAge}${cat.maxAge === null ? '+' : `–${cat.maxAge}`}; ${t.name?.trim() || 'this traveller'} is ${age}.`,
      );
    }
    return { categoryKey: cat.key, name: (t.name ?? '').trim().slice(0, 200), age };
  });

  const staying = b.travellers.filter((/** @type {any} */ t) => !removing.includes(t));
  const after = [
    ...staying.map((/** @type {any} */ t) => t.categoryKey),
    ...adding.map((t) => t.categoryKey),
  ];
  const adultKeys = categories.filter((c) => c.maxAge === null).map((c) => c.key);
  if (!after.some((k) => adultKeys.includes(k)))
    throw new BookingError('ADULT_NEEDED', 'At least one adult must stay on the booking.');

  // The new price: the same quote, worked out again with the new travellers.
  let priced;
  try {
    priced = priceBasket({
      priceCategories: categories,
      addOns: (quote.lines ?? [])
        .filter((/** @type {any} */ l) => l.type === 'addOn')
        .map((/** @type {any} */ l) => ({ id: l.addOnId, name: l.label, priceKobo: l.unitKobo })),
      addOnSelections: (quote.lines ?? [])
        .filter((/** @type {any} */ l) => l.type === 'addOn')
        .map((/** @type {any} */ l) => ({ addOnId: l.addOnId, quantity: l.quantity })),
      travellers: after.map((categoryKey) => ({ categoryKey })),
      tax: quote.tax
        ? {
            name: quote.tax.name,
            basisPoints: quote.tax.basisPoints,
            inclusive: quote.tax.inclusive,
          }
        : null,
    });
  } catch (err) {
    if (err instanceof PricingError) throw new BookingError(err.code, err.message);
    throw err;
  }

  // Seats: the change must fit what the departure can sell.
  const seats = seatsOf(b.departure);
  const delta = adding.length - removing.length;
  const usedAfter = b.departure.seatsSold + b.departure.seatsHeld + delta;
  const fits = delta <= 0 || usedAfter <= seats;
  const where = b.departure.resource ? ` in ${b.departure.resource.name}` : '';

  // The money.
  const newTotal = priced.totalKobo;
  const paid = b.amountPaidKobo;
  const overpaid = Math.max(0, paid - newTotal - b.refundDueKobo);
  /** @type {null | { overpaidKobo: number, policyKobo: number, policyText: string }} */
  let refund = null;
  if (overpaid > 0) {
    const v = b.policyVersion;
    const q = computeRefund({
      policy: v
        ? {
            rules: v.rules,
            noShowRefundBasisPoints: v.noShowRefundBasisPoints,
            depositRefundable: true,
          }
        : { rules: [], noShowRefundBasisPoints: 0, depositRefundable: true },
      amountPaidKobo: overpaid,
      departureStartsAt: b.departure.startsAt,
      at: now,
      kind: 'cancel',
      initiatedBy: 'guest',
    });
    refund = {
      overpaidKobo: overpaid,
      policyKobo: q.refundKobo,
      policyText: `${formatNaira(q.refundKobo)} of ${formatNaira(overpaid)} (${policyWords(q, v?.rules ?? [])})`,
    };
  }

  return {
    categories: categories.map((c) => ({
      key: c.key,
      name: c.name,
      priceKobo: c.amountKobo,
      booked: c.booked,
      minAge: c.minAge,
      maxAge: c.maxAge,
      count: after.filter((k) => k === c.key).length,
    })),
    removing: removing.map((/** @type {any} */ t) => t.id),
    adding,
    quote: priced,
    oldTotalKobo: b.totalKobo,
    newTotalKobo: newTotal,
    extraKobo: Math.max(0, newTotal - b.totalKobo),
    owedAfterKobo: Math.max(0, newTotal - paid),
    refund,
    seats: {
      fits,
      delta,
      text: fits
        ? `fits (${usedAfter} of ${seats}${where})`
        : `doesn’t fit: ${usedAfter} of ${seats}${where}. Move to another date, or take fewer.`,
    },
    changed: removing.length > 0 || adding.length > 0,
  };
}

const INCLUDE = /** @type {const} */ ({
  travellers: { orderBy: { position: 'asc' } },
  product: { include: { priceCategories: true } },
  departure: { include: { resource: true } },
  policyVersion: true,
});

/**
 * The preview: nothing written.
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ operatorId: string, bookingId: string, change: Change, now?: Date }} p
 */
export async function previewTravellerChange(
  prisma,
  { operatorId, bookingId, change, now = new Date() },
) {
  const b = await prisma.booking.findFirst({
    where: { id: bookingId, operatorId },
    include: INCLUDE,
  });
  if (!b) throw new BookingError('NOT_FOUND', 'Booking not found.');
  return planTravellerChange(b, change, now);
}

/**
 * The save. `refundKobo`: the refund the office saw and confirmed (it must still be the
 * policy's amount, or nothing is saved: REFUND_CHANGED).
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ operatorId: string, bookingId: string, change: Change, userId: string, refundKobo?: number, now?: Date }} p
 */
export function saveTravellerChange(
  prisma,
  { operatorId, bookingId, change, userId, refundKobo, now = new Date() },
) {
  return prisma.$transaction(async (tx) => {
    /** @type {Array<{ id: string }>} */
    const locked = await tx.$queryRaw`
      SELECT id FROM bookings WHERE id = ${bookingId}::uuid AND operator_id = ${operatorId}::uuid FOR UPDATE`;
    if (locked.length === 0) throw new BookingError('NOT_FOUND', 'Booking not found.');
    const pre = await tx.booking.findUniqueOrThrow({ where: { id: bookingId } });
    // The departure too: seats are counted against everyone else's bookings and holds.
    await tx.$queryRaw`SELECT id FROM departures WHERE id = ${pre.departureId}::uuid FOR UPDATE`;
    const b = await tx.booking.findUniqueOrThrow({ where: { id: bookingId }, include: INCLUDE });
    const plan = planTravellerChange(b, change, now);
    if (!plan.changed) throw new BookingError('NO_CHANGE', 'Nothing was changed.');
    if (!plan.seats.fits) throw new BookingError('SEATS', `The seats ${plan.seats.text}`);
    const refund = plan.refund?.policyKobo ?? 0;
    if ((refundKobo ?? 0) !== refund) {
      throw new BookingError(
        'REFUND_CHANGED',
        `The refund is now ${formatNaira(refund)}. Check it and confirm again.`,
        { refundKobo: refund },
      );
    }

    // The travellers.
    if (plan.removing.length)
      await tx.traveller.deleteMany({ where: { id: { in: plan.removing } } });
    let position = Math.max(0, ...b.travellers.map((t) => t.position));
    const firstNew = position + 1;
    for (const t of plan.adding) {
      position += 1;
      await tx.traveller.create({
        data: {
          operatorId,
          bookingId,
          position,
          name: t.name,
          age: t.age,
          categoryKey: t.categoryKey,
        },
      });
    }
    // The seats.
    if (plan.seats.delta !== 0) {
      await tx.departure.update({
        where: { id: b.departureId },
        data: { seatsSold: { increment: plan.seats.delta } },
      });
    }
    // The price, and what goes back.
    await tx.booking.update({
      where: { id: bookingId },
      data: {
        quote: { .../** @type {any} */ (b.quote), ...plan.quote },
        totalKobo: plan.newTotalKobo,
        ...(refund > 0 && { refundDueKobo: { increment: refund } }),
      },
    });
    if (refund > 0) {
      await postTransaction(tx, {
        operatorId,
        type: 'refund_owed',
        idempotencyKey: `refund-owed:travellers:${bookingId}:${now.getTime()}`,
        description: `Refund owed for ${b.reference}: fewer travellers`,
        lines: POSTINGS.refundOwed(refund),
        bookingId,
        createdById: userId,
      });
    }
    // The status follows the money: owing after being paid → amended; nothing owed → paid.
    const owes = plan.owedAfterKobo > 0;
    const to =
      b.status === 'paid' && owes
        ? 'amended'
        : !owes && b.amountPaidKobo > 0 && b.status !== 'paid'
          ? 'paid'
          : null;
    if (to) {
      await transitionBookingInTx(tx, {
        bookingId,
        to,
        actor: { type: 'user', userId },
        data: { reason: 'travellers_changed' },
      });
    }
    await tx.bookingEvent.create({
      data: {
        operatorId,
        bookingId,
        type: 'travellers_changed',
        actorType: 'user',
        actorUserId: userId,
        data: {
          added: plan.adding.map((t, i) => t.name || `Guest ${firstNew + i}`),
          removed: b.travellers
            .filter((t) => plan.removing.includes(t.id))
            .map((t) => t.name || `Guest ${t.position}`),
          fromKobo: plan.oldTotalKobo,
          toKobo: plan.newTotalKobo,
          refundKobo: refund,
        },
      },
    });
    return plan;
  }, TX);
}
