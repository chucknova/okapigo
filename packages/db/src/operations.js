// @ts-check
/**
 * operations.js — running tour days (OPS-01, OPS-07, OPS-08; stage 15a). The operator app's
 * screens (flow brief 07) and, in 15b, its offline outbox both come through these, so the
 * rules are the same online and offline.
 *
 *   resources            vans and the boat: a name and its seats (no drivers: decided)
 *   assignDeparture()    a guide, a van/boat and a note for a departure; never double-booked
 *   manifest()           everything the guide's manifest shows (O3)
 *   checkIn()            by ticket code or traveller: present / late / back to pending
 *   noShow()             a booking that didn't come: the policy's no-show rule, after the start
 *   nameTraveller()      a name typed at check-in for a traveller booked without one
 */
import { formatNaira } from '@okapigo/shared/money';
import { localDate, localTime } from '@okapigo/shared/time';
import { formatAt } from '@okapigo/shared/tour-facts';
import { BookingError } from './booking-lifecycle.js';
import { bookingIdFromTicketCode } from './guest-links.js';
import { markNoShowInTx } from './cancellations.js';

const TX = { maxWait: 15_000, timeout: 15_000 };
/** Bookings that belong on a manifest: sold, and the ones cancelled or no-show (struck through). */
const ON_MANIFEST = [
  'confirmed',
  'part_paid',
  'paid',
  'amended',
  'completed',
  'no_show',
  'cancelled',
  'refunded',
];
/** Bookings whose guests may be checked in. */
const CAN_CHECK_IN = ['confirmed', 'part_paid', 'paid', 'amended', 'completed'];

/** "Sat 5 Dec, 09:00" in the business's time zone. @param {Date} at @param {string} tz */
const when = (at, tz) => formatAt(at.getTime(), tz);

// --- Resources ---------------------------------------------------------------------------------

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ operatorId: string, kind: 'van' | 'boat', name: string, seats: number }} r
 */
export async function createResource(prisma, { operatorId, kind, name, seats }) {
  try {
    return await prisma.resource.create({ data: { operatorId, kind, name: name.trim(), seats } });
  } catch (err) {
    if (/** @type {any} */ (err).code === 'P2002') {
      throw new BookingError('NAME_TAKEN', `There's already a resource called "${name.trim()}".`);
    }
    throw err;
  }
}

// --- Assignment ----------------------------------------------------------------------------------

/**
 * Sets a departure's guide, van/boat and note (each optional; null clears it). Refuses a guide
 * or resource already on a departure whose time overlaps, saying where they are. A van too
 * small for the guests booked is allowed, with a warning (the manager may know better).
 *
 * The database has the same rule (an exclusion constraint): if two managers race, the second
 * is refused there, and gets the same answer.
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ operatorId: string, departureId: string, guideId?: string | null, resourceId?: string | null, notes?: string }} a
 * @returns {Promise<{ departure: any, warnings: string[] }>}
 */
export async function assignDeparture(
  prisma,
  { operatorId, departureId, guideId, resourceId, notes },
) {
  try {
    return await prisma.$transaction(async (tx) => {
      const [d] = /** @type {any[]} */ (
        await tx.$queryRaw`SELECT id FROM departures WHERE id = ${departureId}::uuid AND operator_id = ${operatorId}::uuid FOR UPDATE`
      );
      if (!d) throw new BookingError('NOT_FOUND', 'Departure not found.');
      const departure = await tx.departure.findUniqueOrThrow({
        where: { id: departureId },
        include: { product: { include: { operator: true } } },
      });
      if (departure.status !== 'scheduled') {
        throw new BookingError('DEPARTURE_CANCELLED', 'This departure is cancelled.');
      }
      const tz = departure.product.operator.timeZone;
      /** @param {object} who */
      const clash = (who) =>
        tx.departure.findFirst({
          where: {
            ...who,
            id: { not: departureId },
            status: 'scheduled',
            startsAt: { lt: departure.endsAt },
            endsAt: { gt: departure.startsAt },
          },
          include: { product: true },
        });

      if (guideId) {
        const guide = await tx.user.findFirst({
          where: { id: guideId, operatorId, isActive: true },
        });
        if (!guide) throw new BookingError('NOT_FOUND', 'That member of staff wasn’t found.');
        const busy = await clash({ guideId });
        if (busy) {
          throw new BookingError(
            'GUIDE_BUSY',
            `${guide.name} is on the ${busy.product.title} until ${localTime(busy.endsAt, tz)}${localDate(busy.endsAt, tz) !== localDate(departure.startsAt, tz) ? ` on ${when(busy.endsAt, tz).split(',')[0]}` : ''}.`,
            { departureId: busy.id, startsAt: busy.startsAt, endsAt: busy.endsAt },
          );
        }
      }
      /** @type {string[]} */
      const warnings = [];
      if (resourceId) {
        const resource = await tx.resource.findFirst({
          where: { id: resourceId, operatorId, isActive: true },
        });
        if (!resource) throw new BookingError('NOT_FOUND', 'That van or boat wasn’t found.');
        // Only the tour's kind of vehicle (16b, decided: "Boat · not for road trips").
        const need = departure.product.transport;
        const short = departure.product.shortTitle || departure.product.title;
        if (need === 'on_foot' || resource.kind !== need) {
          throw new BookingError(
            'WRONG_TRANSPORT',
            need === 'on_foot'
              ? `The ${short} is on foot: it needs no van or boat.`
              : `${resource.name} is a ${resource.kind}: the ${short} goes by ${need}.`,
          );
        }
        // Too small for who's booked: refused (16b, decided: the design shows it can't be chosen).
        const guests = departure.seatsSold + departure.seatsHeld;
        if (resource.seats < guests) {
          throw new BookingError(
            'RESOURCE_TOO_SMALL',
            `${resource.name} has ${resource.seats} seats; ${guests} are booked. Choose a bigger one, or move ${guests - resource.seats} ${guests - resource.seats === 1 ? 'guest' : 'guests'} to another date first.`,
            { seats: resource.seats, booked: guests },
          );
        }
        const busy = await clash({ resourceId });
        if (busy) {
          throw new BookingError(
            'RESOURCE_BUSY',
            `${resource.name} is on the ${busy.product.title} until ${localTime(busy.endsAt, tz)}.`,
            { departureId: busy.id, startsAt: busy.startsAt, endsAt: busy.endsAt },
          );
        }
      }
      const updated = await tx.departure.update({
        where: { id: departureId },
        data: {
          ...(guideId !== undefined && { guideId }),
          ...(resourceId !== undefined && { resourceId }),
          ...(notes !== undefined && { notes: notes.trim() }),
        },
        include: { guide: true, resource: true },
      });
      return { departure: updated, warnings };
    }, TX);
  } catch (err) {
    // The exclusion constraint caught a race the check above couldn't see (23P01).
    if (
      /exclusion constraint|23P01|not_double_booked/.test(String(/** @type {any} */ (err)?.message))
    ) {
      throw new BookingError(
        'ASSIGNED_ELSEWHERE',
        'Assigned to another departure at the same time just now. Refresh and try again.',
      );
    }
    throw err;
  }
}

// --- The manifest ------------------------------------------------------------------------------

/**
 * Everything the guide's manifest shows (flow brief 07, screen O3): the departure, its guide
 * and van/boat, the counts, and every booking with its travellers, extras, pickup and money.
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ operatorId: string, departureId: string }} q
 */
export async function manifest(prisma, { operatorId, departureId }) {
  const d = await prisma.departure.findFirst({
    where: { id: departureId, operatorId },
    include: {
      product: { include: { operator: true, priceCategories: true } },
      guide: true,
      resource: true,
      bookings: {
        where: { status: { in: ON_MANIFEST } },
        orderBy: { createdAt: 'asc' },
        include: {
          travellers: { orderBy: { position: 'asc' } },
          addOns: { include: { addOn: true } },
          policyVersion: true,
          // Cash a guide reported, not yet confirmed by the office (15c-4).
          cashReports: { where: { status: { in: ['reported', 'possible_double'] } } },
          events: {
            where: { toStatus: { in: ['cancelled', 'no_show'] } },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      },
    },
  });
  if (!d) throw new BookingError('NOT_FOUND', 'Departure not found.');
  const tz = d.product.operator.timeZone;
  const cats = new Map(d.product.priceCategories.map((c) => [c.key, c]));
  const counts = { travellers: 0, pending: 0, present: 0, late: 0, noShow: 0 };

  // Office notes marked "show on the guide's manifest" (the bookings desk, 16c), oldest first.
  const noteEvents = await prisma.bookingEvent.findMany({
    where: { bookingId: { in: d.bookings.map((b) => b.id) }, type: 'note' },
    orderBy: { createdAt: 'asc' },
  });
  /** @type {Map<string, string[]>} */
  const notesOf = new Map();
  for (const e of noteEvents) {
    const data = /** @type {any} */ (e.data);
    if (!data?.onManifest) continue;
    notesOf.set(e.bookingId, [...(notesOf.get(e.bookingId) ?? []), data.text]);
  }

  const bookings = d.bookings.map((b) => {
    const active = CAN_CHECK_IN.includes(b.status);
    const owedKobo = Math.max(0, b.totalKobo - b.amountPaidKobo);
    const travellers = b.travellers.map((t) => {
      if (active || b.status === 'no_show') {
        counts.travellers++;
        if (t.checkInStatus === 'no_show') counts.noShow++;
        else if (t.checkInStatus === 'present') counts.present++;
        else if (t.checkInStatus === 'late') counts.late++;
        else counts.pending++;
      }
      const cat = cats.get(t.categoryKey);
      return {
        id: t.id,
        position: t.position,
        name: t.name,
        // Booked without a name (WhatsApp names only the lead: decided 2026-11-18).
        displayName: t.name || `Guest ${t.position} of ${b.leadName}’s booking`,
        category: { key: t.categoryKey, name: cat?.name ?? t.categoryKey },
        age: t.age,
        dietaryNeeds: t.dietaryNeeds,
        checkInStatus: t.checkInStatus,
        checkedInAt: t.checkedInAt,
      };
    });
    return {
      id: b.id,
      reference: b.reference,
      status: b.status,
      channel: b.channel,
      lead: { name: b.leadName, phone: b.leadPhone, email: b.leadEmail },
      pickupPoint: b.pickupPoint,
      addOns: b.addOns.map((a) => ({ name: a.addOn.name, quantity: a.quantity })),
      money: {
        totalKobo: b.totalKobo,
        paidKobo: b.amountPaidKobo,
        owedKobo,
        // "₦45,500 still to pay" (decided 2026-11-19: shown, and check-in asks first).
        label: owedKobo > 0 ? `${formatNaira(owedKobo)} still to pay` : 'Paid',
      },
      // What a no-show gets back under the policy this booking was sold with (0 at Ìrìn): the
      // guide's "Mark no-show?" says so (designs: O3 states). Null when sold without one.
      noShowRefundPercent: b.policyVersion ? b.policyVersion.noShowRefundBasisPoints / 100 : null,
      cashReportedKobo: b.cashReports.reduce((n, c) => n + c.amountKobo, 0),
      // "Halal lunch for Yemi and Tobi. Confirmed with the kitchen." (never shown to guests)
      notes: notesOf.get(b.id) ?? [],
      // A cancelled booking stays, struck through: "cancelled yesterday".
      endedAt: active ? null : (b.events[0]?.createdAt ?? null),
      travellers,
    };
  });

  return {
    // For the printed manifest's header ("ÌRÌN LAGOS TOURS · MANIFEST", "Printed …").
    business: { name: d.product.operator.name, timeZone: tz },
    departure: {
      id: d.id,
      status: d.status,
      startsAt: d.startsAt,
      endsAt: d.endsAt,
      localDate: localDate(d.startsAt, tz),
      localTime: localTime(d.startsAt, tz),
      capacity: d.capacity,
      seatsSold: d.seatsSold,
      seatsHeld: d.seatsHeld,
      notes: d.notes,
    },
    tour: {
      slug: d.product.slug,
      title: d.product.title,
      shortTitle: d.product.shortTitle,
      meetingPoint: d.product.meetingPoint,
      durationMinutes: d.product.durationMinutes,
      // The van's stops, in order, each with its time (Lekki: 07:15 · 07:30 · 07:45). The
      // manifest of a pickup tour is grouped by them (designs: Manifest with pickup points).
      pickupPoints: d.product.pickupPoints,
    },
    guide: d.guide ? { id: d.guide.id, name: d.guide.name } : null,
    resource: d.resource
      ? { id: d.resource.id, kind: d.resource.kind, name: d.resource.name, seats: d.resource.seats }
      : null,
    counts,
    bookings,
  };
}

// --- Check-in ----------------------------------------------------------------------------------

/**
 * Checks a booking's travellers in (OPS-08): by the ticket's code (the QR) or by the booking
 * (searched by name), all of them or some. Safe to repeat: a second scan says when they were
 * checked in, and changes nothing (the offline outbox may send it twice, 15b).
 *
 * Refused, with why: a ticket for another departure, a cancelled booking, a no-show already
 * marked, and money still owed unless `confirmOwed` (decided 2026-11-19: "Check in anyway?").
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{
 *   operatorId: string, departureId: string, secret: string,
 *   code?: string, bookingId?: string, travellerIds?: string[],
 *   status: 'present' | 'late' | 'no_show' | 'pending', confirmOwed?: boolean,
 *   seen?: Record<string, string>,
 *   userId: string, now?: Date,
 * }} c
 *
 * `seen` (the offline outbox, 15b): each traveller's state as the PHONE saw it when the guide
 * tapped. If someone else has changed a traveller since (to anything but this change), the
 * change isn't applied: CHANGED_FIRST, and theirs stands. Without `seen`, the last tap wins.
 */
export async function checkIn(
  prisma,
  {
    operatorId,
    departureId,
    secret,
    code,
    bookingId,
    travellerIds,
    status,
    confirmOwed = false,
    seen,
    userId,
    now = new Date(),
  },
) {
  const id = code ? bookingIdFromTicketCode(secret, code) : bookingId;
  if (!id)
    throw new BookingError(
      'NOT_OUR_TICKET',
      'This isn’t one of our tickets, or it didn’t scan clearly.',
    );
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM bookings WHERE id = ${id}::uuid FOR UPDATE`;
    const b = await tx.booking.findFirst({
      where: { id, operatorId },
      include: {
        travellers: { orderBy: { position: 'asc' } },
        departure: { include: { product: { include: { operator: true } } } },
      },
    });
    if (!b) throw new BookingError('NOT_OUR_TICKET', 'This isn’t one of our tickets.');
    const tz = b.departure.product.operator.timeZone;
    if (b.departureId !== departureId) {
      throw new BookingError(
        'OTHER_DEPARTURE',
        `This ticket is for ${when(b.departure.startsAt, tz)}.`,
        {
          departureId: b.departureId,
          tour: b.departure.product.title,
          startsAt: b.departure.startsAt,
        },
      );
    }
    if (b.status === 'cancelled' || b.status === 'refunded') {
      throw new BookingError('BOOKING_CANCELLED', 'This booking was cancelled: don’t check it in.');
    }
    if (b.status === 'no_show') {
      throw new BookingError(
        'NO_SHOW_MARKED',
        'This booking was marked a no-show. Ask the manager to change it.',
      );
    }
    if (!CAN_CHECK_IN.includes(b.status)) {
      throw new BookingError(
        'NOT_BOOKED',
        'This booking isn’t confirmed (it may still be in checkout).',
      );
    }
    // Late and a traveller's no-show unlock at the start time (designs: O3 states). A
    // traveller's no-show is just "not here" for one person (the others came); the whole
    // booking not coming is noShow() below, where the policy applies.
    if ((status === 'late' || status === 'no_show') && b.departure.startsAt > now) {
      throw new BookingError(
        'NOT_STARTED',
        `${status === 'late' ? 'Late' : 'No-show'} can only be marked from ${localTime(b.departure.startsAt, tz)}.`,
      );
    }
    const owedKobo = b.totalKobo - b.amountPaidKobo;
    if (owedKobo > 0 && (status === 'present' || status === 'late') && !confirmOwed) {
      throw new BookingError(
        'BALANCE_OWED',
        `They still owe ${formatNaira(owedKobo)}. Check in anyway?`,
        { owedKobo },
      );
    }

    const chosen = travellerIds?.length
      ? b.travellers.filter((t) => travellerIds.includes(t.id))
      : b.travellers;
    if (travellerIds?.length && chosen.length !== travellerIds.length) {
      throw new BookingError('NOT_FOUND', 'One of those travellers isn’t on this booking.');
    }
    const changedFirst = seen
      ? chosen.find(
          (t) =>
            seen[t.id] !== undefined &&
            t.checkInStatus !== seen[t.id] &&
            t.checkInStatus !== status,
        )
      : undefined;
    if (changedFirst) {
      throw new BookingError('CHANGED_FIRST', 'Someone else changed this traveller first.', {
        travellerId: changedFirst.id,
        status: changedFirst.checkInStatus,
        at: changedFirst.checkedInAt,
        byId: changedFirst.checkedInById,
      });
    }
    const already = chosen.filter((t) => t.checkInStatus === status);
    for (const t of chosen) {
      if (t.checkInStatus === status) continue; // the same again: nothing to change
      await tx.traveller.update({
        where: { id: t.id },
        data:
          status === 'pending'
            ? { checkInStatus: 'pending', checkedInAt: null, checkedInById: null }
            : { checkInStatus: status, checkedInAt: now, checkedInById: userId },
      });
    }
    if (already.length < chosen.length) {
      await tx.bookingEvent.create({
        data: {
          operatorId,
          bookingId: b.id,
          type: 'checked_in',
          actorType: 'user',
          actorUserId: userId,
          data: {
            status,
            travellerIds: chosen.filter((t) => t.checkInStatus !== status).map((t) => t.id),
          },
        },
      });
    }
    const after = await tx.traveller.findMany({
      where: { bookingId: b.id },
      orderBy: { position: 'asc' },
    });
    return {
      booking: {
        id: b.id,
        reference: b.reference,
        leadName: b.leadName,
        owedKobo: Math.max(0, owedKobo),
      },
      // "Already checked in at 08:52": every chosen traveller was already in this state.
      already: already.length === chosen.length ? (already[0]?.checkedInAt ?? null) : null,
      travellers: after.map((t) => ({
        id: t.id,
        name: t.name,
        checkInStatus: t.checkInStatus,
        checkedInAt: t.checkedInAt,
      })),
    };
  }, TX);
}

/**
 * A booking that didn't come (decided 2026-11-19: the guide may mark it, offline too). Only
 * once the departure has started (`now`: for the outbox, when the guide tapped). The policy's
 * no-show rule applies (session 9); its travellers are marked no-show on the manifest.
 * Marking it twice changes nothing. Refused if any of them was checked in (15b: a second
 * guide may have, while this phone was offline), or the booking was cancelled.
 *
 * One transaction, holding the booking's row lock like check-in, so a check-in and a no-show
 * of the same booking can't both happen.
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ operatorId: string, departureId: string, bookingId: string, userId: string, now?: Date }} n
 */
export async function noShow(
  prisma,
  { operatorId, departureId, bookingId, userId, now = new Date() },
) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM bookings WHERE id = ${bookingId}::uuid FOR UPDATE`;
    const b = await tx.booking.findFirst({
      where: { id: bookingId, operatorId, departureId },
      include: { departure: true, travellers: { orderBy: { position: 'asc' } } },
    });
    if (!b) throw new BookingError('NOT_FOUND', 'That booking isn’t on this departure.');
    if (b.status === 'no_show') return { already: true };
    if (b.status === 'cancelled' || b.status === 'refunded') {
      throw new BookingError('BOOKING_CANCELLED', 'This booking was cancelled.');
    }
    if (b.departure.startsAt > now) {
      throw new BookingError(
        'NOT_STARTED',
        'A no-show can only be marked once the tour has started.',
      );
    }
    const arrived = b.travellers.find(
      (t) => t.checkInStatus === 'present' || t.checkInStatus === 'late',
    );
    if (arrived) {
      throw new BookingError('CHECKED_IN', 'Someone on this booking was checked in.', {
        travellerId: arrived.id,
        status: arrived.checkInStatus,
        at: arrived.checkedInAt,
        byId: arrived.checkedInById,
      });
    }
    await markNoShowInTx(tx, { operatorId, bookingId, actor: { type: 'user', userId }, now });
    await tx.traveller.updateMany({
      where: { bookingId, checkInStatus: 'pending' },
      data: { checkInStatus: 'no_show', checkedInAt: now, checkedInById: userId },
    });
    return { already: false };
  }, TX);
}

/**
 * A name typed at check-in for a traveller booked without one (decided 2026-11-19: optional).
 * @param {import('@prisma/client').PrismaClient} prisma
 * `seen` (the outbox, 15b): the name the phone saw. If the office typed a different one
 * meanwhile, theirs stands (CHANGED_FIRST).
 * @param {{ operatorId: string, travellerId: string, name: string, seen?: string }} n
 */
export async function nameTraveller(prisma, { operatorId, travellerId, name, seen }) {
  const clean = name.trim().replace(/\s+/g, ' ');
  if (clean.length < 2 || clean.length > 80) {
    throw new BookingError('VALIDATION_ERROR', 'A name of 2 to 80 characters, please.');
  }
  const t = await prisma.traveller.findFirst({ where: { id: travellerId, operatorId } });
  if (!t) throw new BookingError('NOT_FOUND', 'Traveller not found.');
  if (seen !== undefined && t.name !== seen && t.name !== clean) {
    throw new BookingError('CHANGED_FIRST', 'Someone else named this traveller first.', {
      travellerId: t.id,
      name: t.name,
    });
  }
  return prisma.traveller.update({ where: { id: travellerId }, data: { name: clean } });
}
