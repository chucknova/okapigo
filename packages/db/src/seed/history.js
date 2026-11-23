// @ts-check
/**
 * history.js — the demo business's past and near future (stage 19a-1; PRD "Seed data":
 * "about 150 past bookings and 20 upcoming bookings, a few of them from the mock OTA").
 *
 *   seedDemoHistory(prisma, operator, { now, feeOf })
 *
 * Run by `pnpm db:seed` / `pnpm db:reset` (and, in 19a-2, the nightly reset and each visitor's
 * copy), AFTER seedDemoOperator. Never by the tests' seedOperator(): they want a quiet business.
 *
 * WHY WRITTEN DIRECTLY, not through the booking engine: the engine (rightly) won't hold seats
 * on a trip that already happened, and stamps everything "now". So this file writes what the
 * real paths leave behind, row by row, with the times a real history would have:
 *
 *   hold (converted) → booking + travellers → "created", "held → paid" on the timeline
 *   → the payment, and the ledger: money received, Paystack's fee   (or Sojourna's sale)
 *   → seats sold on the departure → afterwards: checked in, "completed"
 *
 * using the same building blocks: the basket pricer (priceBasket), the posting rules
 * (POSTINGS + postTransaction), the refund rule (computeRefund), the reference makers.
 * The test (history.test.js) holds it to the live system's rules: the books balance, every
 * departure's seats sold equals its bookings' travellers, statuses are ones the app knows.
 *
 * DETERMINISTIC: a fixed random sequence, so every reset tells the same story, moved to
 * "now". Everyone is fictional; emails use .example; phones are made up.
 *
 * The story (decided 2026-11-23: "a few loose ends"):
 *   60 days of past departures, guided, with vans and the boat; about 150 bookings on them
 *     (website, widget, WhatsApp, the desk, Sojourna), checked in and completed; a few guest
 *     cancellations with their refunds; two no-shows; one Tarkwa Bay trip called off for the
 *     weather (everyone refunded); Sojourna paying what it owes, twice
 *   about 20 upcoming bookings, today's departures among them; Badagry deposits
 *   loose ends: a departure soon with NO GUIDE; a refund that FAILED; CASH a guide hasn't
 *     handed in; a Badagry BALANCE overdue (when one is due); a guest asking to CHANGE THE DATE;
 *     a question the AI companion passed to the team
 */
import { priceBasket, percentOf } from '@okapigo/shared/pricing';
import { OperatorPricingSchema } from '@okapigo/shared/schemas/pricing';
import { POSTINGS } from '@okapigo/shared/ledger';
import { computeRefund } from '@okapigo/shared/cancellation';
import { generateReference, referencePrefix } from '@okapigo/shared/reference';
import { generatePaymentReference } from '@okapigo/shared/payment-status';
import { SEAT_CONSUMING_STATUSES } from '@okapigo/shared/booking-status';
import { addDays, dayOfWeek, localDate, zonedTimeToUtc } from '@okapigo/shared/time';
import { randomUUID } from 'node:crypto';
import { postTransaction } from '../ledger.js';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const MIN = 60_000;
export const PAST_DAYS = 60;
export const PAST_BOOKINGS = 150;
export const UPCOMING_BOOKINGS = 20;

/** A small, fixed random sequence (mulberry32): the same story every time. @param {number} seed */
export function randomFrom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Fictional guests: Lagosians, people from elsewhere in Nigeria, and visitors.
const FIRST = [
  'Adaeze',
  'Bola',
  'Chiamaka',
  'Damilola',
  'Emeka',
  'Funmi',
  'Gbenga',
  'Ifeoma',
  'Jide',
  'Kelechi',
  'Lola',
  'Musa',
  'Ngozi',
  'Obinna',
  'Peju',
  'Rotimi',
  'Sade',
  'Tobi',
  'Uche',
  'Wale',
  'Yemi',
  'Zainab',
  'Amara',
  'Hannah',
  'Lukas',
  'Sofia',
  'James',
  'Mei',
  'Kwame',
  'Aisha',
  'Daniel',
  'Efe',
];
const LAST = [
  'Okafor',
  'Adeyemi',
  'Bello',
  'Eze',
  'Ogunleye',
  'Balogun',
  'Nwosu',
  'Abubakar',
  'Okonkwo',
  'Adewale',
  'Ibrahim',
  'Onyeka',
  'Lawal',
  'Ojo',
  'Afolabi',
  'Weber',
  'Rossi',
  'Carter',
  'Chen',
  'Mensah',
  'Danjuma',
  'Etim',
  'Akande',
  'Uzor',
];
const DIETS = ['Vegetarian', 'No pork', 'No groundnuts', 'Halal', 'Gluten-free'];

/**
 * @typedef {{ product: any, departure: any, at: Date, channel: 'web' | 'whatsapp' | 'staff' | 'ota', via?: 'widget' | null }} Plan
 */

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ id: string, slug: string, timeZone: string, pricing: unknown }} operator
 * @param {{ now?: Date, feeOf: (kobo: number) => number, seed?: number, pastBookings?: number, upcomingBookings?: number }} options
 *   feeOf: Paystack's fee on a payment (the simulator's rule, from @okapigo/payments)
 *   pastBookings / upcomingBookings: how many (tests use fewer; the demo the PRD's)
 */
export async function seedDemoHistory(
  prisma,
  operator,
  {
    now = new Date(),
    feeOf,
    seed = 19,
    pastBookings = PAST_BOOKINGS,
    upcomingBookings: upcomingCount = UPCOMING_BOOKINGS,
  },
) {
  const rand = randomFrom(seed);
  const pick = (/** @type {any[]} */ xs) => xs[Math.floor(rand() * xs.length)];
  const between = (/** @type {number} */ lo, /** @type {number} */ hi) =>
    lo + Math.floor(rand() * (hi - lo + 1));
  const tz = operator.timeZone;
  const today = localDate(now, tz);
  const pricing = OperatorPricingSchema.parse(operator.pricing ?? {});
  const prefix = referencePrefix(operator.slug);

  const products = await prisma.product.findMany({
    where: { operatorId: operator.id },
    include: {
      priceCategories: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } },
      addOns: { where: { isActive: true } },
      schedules: true,
    },
  });
  const bySlug = (/** @type {string} */ s) =>
    /** @type {any} */ (products.find((p) => p.slug.startsWith(s)));
  const staff = await prisma.user.findMany({
    where: { operatorId: operator.id },
    include: { role: true },
    orderBy: { name: 'asc' },
  });
  const manager = /** @type {any} */ (staff.find((u) => u.role.key === 'manager'));
  const owner = /** @type {any} */ (staff.find((u) => u.role.key === 'owner'));
  const guide = (/** @type {string} */ first) =>
    /** @type {any} */ (staff.find((u) => u.name.startsWith(first)));
  const resources = await prisma.resource.findMany({ where: { operatorId: operator.id } });
  const resource = (/** @type {string} */ name) =>
    /** @type {any} */ (resources.find((r) => r.name === name));
  const policy = await prisma.cancellationPolicyVersion.findFirstOrThrow({
    where: { policy: { operatorId: operator.id } },
    orderBy: { version: 'desc' },
  });
  const sojourna = await prisma.channel.findFirst({ where: { operatorId: operator.id } });

  // Who guides what, and in which vehicle: never two at once (the database checks it too).
  /** @type {Record<string, { guide: string, resource: string | null }>} */
  const CREW = {
    'lagos-island-heritage': { guide: 'Halima', resource: null },
    'lagos-street-food': { guide: 'Chinedu', resource: null },
    'lekki-nature': { guide: 'Chinedu', resource: 'Van 2' },
    'tarkwa-bay': { guide: 'Femi', resource: 'Boat' },
    'badagry-heritage': { guide: 'Kemi', resource: 'Van 1' },
  };
  const crewOf = (/** @type {any} */ p) => {
    const key = /** @type {string} */ (Object.keys(CREW).find((k) => p.slug.startsWith(k)));
    const c = CREW[key];
    return { guideId: guide(c.guide).id, resourceId: c.resource ? resource(c.resource).id : null };
  };

  // --- 1. The past 60 days of departures ---------------------------------------------------
  /** @type {any[]} */
  const pastRows = [];
  for (let d = addDays(today, -PAST_DAYS); d < today; d = addDays(d, 1)) {
    for (const p of products) {
      for (const s of p.schedules) {
        if (!s.daysOfWeek.includes(dayOfWeek(d))) continue;
        for (const time of s.times) {
          const startsAt = zonedTimeToUtc(d, time, tz);
          const crew = crewOf(p);
          const van = resources.find((r) => r.id === crew.resourceId);
          pastRows.push({
            operatorId: operator.id,
            productId: p.id,
            scheduleId: s.id,
            startsAt,
            endsAt: new Date(startsAt.getTime() + p.durationMinutes * MIN),
            capacity: Math.min(p.defaultCapacity, van?.seats ?? p.defaultCapacity),
            ...crew,
            guideAssignedById: manager.id,
            guideAssignedAt: new Date(startsAt.getTime() - 3 * DAY),
          });
        }
      }
    }
  }
  await prisma.departure.createMany({ data: pastRows });
  const past = await prisma.departure.findMany({
    where: { operatorId: operator.id, startsAt: { lt: zonedTimeToUtc(today, '00:00', tz) } },
    orderBy: { startsAt: 'asc' },
  });
  // The weather: a Tarkwa Bay trip about three weeks ago, called off.
  const tarkwa = bySlug('tarkwa-bay');
  const stormy = past.filter((d) => d.productId === tarkwa.id).at(-6) ?? null;

  // --- 2. Upcoming departures (the schedules made them): guides for the next week ----------
  const upcoming = await prisma.departure.findMany({
    where: {
      operatorId: operator.id,
      startsAt: { gt: now, lt: new Date(now.getTime() + 21 * DAY) },
    },
    orderBy: { startsAt: 'asc' },
  });
  // Loose end: the first departure after today with NO guide ("Tarkwa Bay has no guide").
  const tomorrow = zonedTimeToUtc(addDays(today, 1), '00:00', tz);
  const unguided = upcoming.find((d) => d.startsAt >= tomorrow) ?? null;
  for (const d of upcoming) {
    if (d.startsAt.getTime() > now.getTime() + 7 * DAY || d.id === unguided?.id) continue;
    const p = products.find((x) => x.id === d.productId);
    await prisma.departure.update({
      where: { id: d.id },
      data: {
        ...crewOf(p),
        guideAssignedById: manager.id,
        // Over the past few days, as a manager plans the week (not all at the moment of seeding).
        guideAssignedAt: new Date(now.getTime() - between(1, 5) * DAY - between(1, 9) * HOUR),
      },
    });
  }

  // --- 3. The bookings ------------------------------------------------------------------------
  const ledger = (/** @type {Parameters<typeof postTransaction>[1]} */ t) =>
    prisma.$transaction((tx) => postTransaction(/** @type {any} */ (tx), t));
  /** @type {Map<string, number>} seats sold per departure */
  const sold = new Map();
  /** Seats still free on a departure. @param {any} dep */
  const room = (dep) => dep.capacity - (sold.get(dep.id) ?? 0);
  /** @type {any[]} OTA bookings, for Sojourna's payments */
  const otaSales = [];
  let n = 0;

  /**
   * One booking, as the real paths leave it.
   * @param {Plan} plan
   * @param {{ status: string, travellers?: number, deposit?: boolean, cancelledAt?: Date, cancelledBy?: 'guest' | 'operator', refund?: 'processed' | 'failed', cash?: 'reported' }} story
   */
  async function book(plan, story) {
    const { product: p, departure: dep, at, channel } = plan;
    n += 1;
    const first = pick(FIRST);
    const last = pick(LAST);
    const lead = `${first} ${last}`;
    const adultCat = p.priceCategories.find((/** @type {any} */ c) => c.maxAge === null);
    const childCat = p.priceCategories.find(
      (/** @type {any} */ c) => c.maxAge !== null && c.amountKobo > 0,
    );
    const size =
      story.travellers ??
      // Friends, families and small groups.
      // At least one: a booking cancelled later needs no seat now (the callers leave room for
      // the rest).
      Math.max(1, Math.min(pick([1, 2, 2, 2, 3, 3, 4, 4, 5, 6]), room(dep)));
    /** @type {Array<{ name: string, age: number | null, categoryKey: string, dietaryNeeds: string }>} */
    const people = [];
    for (let i = 0; i < size; i++) {
      const child = i > 0 && childCat && rand() < 0.25;
      people.push({
        name: i === 0 ? lead : `${pick(FIRST)} ${last}`,
        age: child ? between(childCat.minAge, childCat.maxAge) : null,
        categoryKey: child ? childCat.key : adultCat.key,
        dietaryNeeds: p.slug.startsWith('lagos-street-food') && rand() < 0.3 ? pick(DIETS) : '',
      });
    }
    const extras =
      p.addOns.length && rand() < 0.35 ? [{ addOnId: p.addOns[0].id, quantity: 1 }] : [];
    const quote = priceBasket({
      priceCategories: p.priceCategories,
      addOns: p.addOns,
      travellers: people.map((t) => ({ categoryKey: t.categoryKey })),
      addOnSelections: extras,
      fees: pricing.fees,
      tax: pricing.tax,
    });
    const total = quote.totalKobo;
    const actor =
      channel === 'staff'
        ? { actorType: 'user', actorUserId: manager.id }
        : { actorType: 'guest', actorUserId: null };

    const hold = await prisma.hold.create({
      data: {
        operatorId: operator.id,
        departureId: dep.id,
        seats: size,
        status: 'converted',
        channel,
        travellers: people.map((t) => ({ name: t.name, ...(t.age !== null && { age: t.age }) })),
        quote,
        totalKobo: total,
        expiresAt: new Date(at.getTime() + (channel === 'whatsapp' ? 30 : 15) * MIN),
        endedAt: new Date(at.getTime() + 3 * MIN),
        createdAt: at,
      },
    });
    const booking = await prisma.booking.create({
      data: {
        operatorId: operator.id,
        reference: generateReference(prefix),
        departureId: dep.id,
        productId: p.id,
        holdId: hold.id,
        channel,
        status: 'held',
        quote,
        totalKobo: total,
        policyVersionId: policy.id,
        leadName: lead,
        leadEmail: `${first}.${last}${n}@guest.example`.toLowerCase(),
        leadPhone:
          channel === 'whatsapp' || rand() < 0.5
            ? `+23480${String(55_000_000 + n * 7919).slice(0, 8)}`
            : null,
        termsAcceptedAt: at,
        marketingConsent: rand() < 0.3,
        pickupPoint: p.pickupPoints?.length
          ? pick(/** @type {any[]} */ (p.pickupPoints))
          : undefined,
        attribution: channel === 'web' ? { via: plan.via ?? 'website' } : undefined,
        createdAt: at,
      },
    });
    await prisma.traveller.createMany({
      data: people.map((t, i) => ({
        operatorId: operator.id,
        bookingId: booking.id,
        position: i + 1,
        name: t.name,
        age: t.age,
        categoryKey: t.categoryKey,
        dietaryNeeds: t.dietaryNeeds,
        createdAt: at,
      })),
    });
    if (extras.length) {
      await prisma.bookingAddOn.createMany({
        data: extras.map((e) => ({
          bookingId: booking.id,
          addOnId: e.addOnId,
          quantity: e.quantity,
          unitKobo: p.addOns[0].priceKobo,
        })),
      });
    }
    /** @type {any[]} */
    const events = [
      { type: 'created', toStatus: 'held', ...actor, data: { channel }, createdAt: at },
    ];
    let status = 'held';
    const move = (/** @type {string} */ to, /** @type {Date} */ when, extra = {}) => {
      events.push({
        type: 'status_changed',
        fromStatus: status,
        toStatus: to,
        ...actor,
        data: {},
        createdAt: when,
        ...extra,
      });
      status = to;
    };
    let paid = 0;
    /** @type {any} */
    let lastPayment = null;
    const paidAt = new Date(at.getTime() + 2 * MIN);

    /** A Paystack payment (the simulator in the demo), and the books. @param {number} kobo @param {string} purpose @param {Date} when */
    const pay = async (kobo, purpose, when) => {
      const fee = feeOf(kobo);
      const payment = await prisma.payment.create({
        data: {
          operatorId: operator.id,
          bookingId: booking.id,
          provider: 'simulator',
          method: rand() < 0.75 ? 'card' : 'bank_transfer',
          purpose,
          amountKobo: kobo,
          status: 'succeeded',
          reference: generatePaymentReference(),
          paidAt: when,
          feeKobo: fee,
          channel: 'card',
          createdAt: new Date(when.getTime() - MIN),
        },
      });
      await ledger({
        operatorId: operator.id,
        type: 'payment_received',
        idempotencyKey: `payment-received:${payment.id}`,
        description: `Payment ${payment.reference} for ${booking.reference}`,
        lines: POSTINGS.paymentReceived(kobo),
        bookingId: booking.id,
        paymentId: payment.id,
        occurredAt: when,
      });
      if (fee > 0) {
        await ledger({
          operatorId: operator.id,
          type: 'payment_fee',
          idempotencyKey: `payment-fee:${payment.id}`,
          description: `Fee on ${payment.reference}`,
          lines: POSTINGS.paymentFee(fee),
          bookingId: booking.id,
          paymentId: payment.id,
          occurredAt: when,
        });
      }
      paid += kobo;
      lastPayment = payment;
    };

    // --- Paying ---------------------------------------------------------------------------
    if (story.cash) {
      // Booked at the desk, to pay the guide in cash on the day (16c-2).
      move('confirmed', new Date(at.getTime() + MIN));
    } else if (channel === 'ota' && sojourna) {
      const cb = await prisma.channelBooking.create({
        data: {
          operatorId: operator.id,
          channelId: sojourna.id,
          bookingId: booking.id,
          uuid: randomUUID(),
          resellerReference: `SJ-${String(10_000 + n * 37).slice(-5)}`,
          unitItems: people.map(() => ({ unitId: 'adult' })),
          commissionBasisPoints: 2000,
          confirmedAt: paidAt,
          createdAt: at,
        },
      });
      const payment = await prisma.payment.create({
        data: {
          operatorId: operator.id,
          bookingId: booking.id,
          provider: 'ota',
          method: 'ota',
          purpose: 'full',
          amountKobo: total,
          status: 'succeeded',
          reference: generatePaymentReference(),
          paidAt,
          channel: 'ota',
          createdAt: paidAt,
        },
      });
      await ledger({
        operatorId: operator.id,
        type: 'ota_sale',
        idempotencyKey: `ota-sale:${cb.id}`,
        description: `${booking.reference} sold by ${sojourna.name}`,
        lines: POSTINGS.otaSale(total, percentOf(total, 2000)),
        bookingId: booking.id,
        paymentId: payment.id,
        occurredAt: paidAt,
      });
      paid = total;
      lastPayment = payment;
      move('paid', paidAt, { actorType: 'system', actorUserId: null });
      otaSales.push({ cb, booking, owed: total - percentOf(total, 2000), at: paidAt, story });
    } else if (
      story.deposit &&
      p.depositBasisPoints &&
      // A deposit only when booked more than 7 days ahead: later bookings pay in full (11c).
      at.getTime() < dep.startsAt.getTime() - 7 * DAY
    ) {
      const deposit = percentOf(total, p.depositBasisPoints);
      await pay(deposit, 'deposit', paidAt);
      move('part_paid', paidAt);
      const balanceAt = new Date(dep.startsAt.getTime() - 8 * DAY);
      if (story.status !== 'part_paid' && balanceAt < now) {
        await pay(total - deposit, 'balance', balanceAt);
        move('paid', balanceAt);
      }
    } else {
      await pay(total, 'full', paidAt);
      move('paid', paidAt);
    }

    // --- What happened next -------------------------------------------------------------------
    /** @type {number} */
    let refundDue = 0;
    if (story.status === 'cancelled' || story.status === 'refunded') {
      const when = /** @type {Date} */ (story.cancelledAt);
      const by = story.cancelledBy ?? 'guest';
      const r = computeRefund({
        policy: /** @type {any} */ (policy),
        amountPaidKobo: paid,
        departureStartsAt: dep.startsAt,
        at: when,
        kind: 'cancel',
        initiatedBy: by,
      });
      refundDue = r.refundKobo;
      move('cancelled', when, {
        actorType: by === 'guest' ? 'guest' : 'user',
        actorUserId: by === 'guest' ? null : manager.id,
        data: {
          initiatedBy: by,
          reason:
            by === 'operator' ? 'Weather: high waves on the lagoon, the boat can’t go out.' : null,
          refundKobo: refundDue,
        },
      });
      if (refundDue > 0) {
        await ledger({
          operatorId: operator.id,
          type: 'refund_owed',
          idempotencyKey: `refund-owed:${booking.id}`,
          description: `Refund owed for ${booking.reference}`,
          lines: POSTINGS.refundOwed(refundDue),
          bookingId: booking.id,
          occurredAt: when,
        });
        const sentAt = new Date(when.getTime() + 20 * HOUR);
        const refund = await prisma.refund.create({
          data: {
            operatorId: operator.id,
            bookingId: booking.id,
            paymentId: lastPayment.id,
            provider: lastPayment.provider,
            amountKobo: refundDue,
            status: story.refund === 'failed' ? 'failed' : 'processed',
            reason:
              by === 'guest' ? 'Guest cancelled on the trip page' : 'Departure cancelled: weather',
            failureReason:
              story.refund === 'failed' ? 'The bank declined it: the card has been closed.' : null,
            processedAt: story.refund === 'failed' ? null : sentAt,
            createdAt: when,
          },
        });
        if (story.refund !== 'failed') {
          await prisma.payment.update({
            where: { id: lastPayment.id },
            data: { refundedKobo: refundDue },
          });
          if (lastPayment.provider === 'ota') {
            await ledger({
              operatorId: operator.id,
              type: 'refund_paid',
              idempotencyKey: `refund-paid:${refund.id}`,
              description: `Refunded by ${sojourna?.name ?? 'the OTA'} for ${booking.reference}`,
              lines: POSTINGS.otaRefund(refundDue, percentOf(refundDue, 2000)),
              bookingId: booking.id,
              paymentId: lastPayment.id,
              occurredAt: sentAt,
            });
          } else {
            await ledger({
              operatorId: operator.id,
              type: 'refund_paid',
              idempotencyKey: `refund-paid:${refund.id}`,
              description: `Refund paid out on ${lastPayment.reference}`,
              lines: POSTINGS.refundPaid(refundDue),
              bookingId: booking.id,
              paymentId: lastPayment.id,
              occurredAt: sentAt,
            });
          }
          move('refunded', sentAt, { actorType: 'system', actorUserId: null });
        }
      }
    } else if (story.status === 'completed' || story.status === 'no_show') {
      move(story.status, new Date(dep.endsAt.getTime() + HOUR), {
        actorType: 'system',
        actorUserId: null,
      });
    }

    if (SEAT_CONSUMING_STATUSES.includes(/** @type {any} */ (status))) {
      sold.set(dep.id, (sold.get(dep.id) ?? 0) + size);
    }
    // Checked in by the guide (completed), or not (no-show).
    if (status === 'completed' || status === 'no_show') {
      await prisma.traveller.updateMany({
        where: { bookingId: booking.id },
        data:
          status === 'no_show'
            ? { checkInStatus: 'no_show' }
            : {
                checkInStatus: rand() < 0.1 ? 'late' : 'present',
                checkedInAt: dep.startsAt,
                checkedInById: dep.guideId,
              },
      });
    }
    if (story.cash) {
      await prisma.cashReport.create({
        data: {
          operatorId: operator.id,
          bookingId: booking.id,
          reportedById: /** @type {string} */ (dep.guideId),
          amountKobo: total,
          reportedAt: new Date(dep.startsAt.getTime() + 20 * MIN),
          status: 'reported',
        },
      });
      await prisma.traveller.updateMany({
        where: { bookingId: booking.id },
        data: { checkInStatus: 'present', checkedInAt: dep.startsAt, checkedInById: dep.guideId },
      });
    }
    await prisma.booking.update({
      where: { id: booking.id },
      data: { status, amountPaidKobo: paid, refundDueKobo: refundDue },
    });
    await prisma.bookingEvent.createMany({
      data: events.map((e) => ({ operatorId: operator.id, bookingId: booking.id, ...e })),
    });
    return booking;
  }

  /** Which channel, as Ìrìn's sales split. @returns {Pick<Plan, 'channel' | 'via'>} */
  const channel = () => {
    const r = rand();
    if (r < 0.42) return { channel: 'web', via: 'website' };
    if (r < 0.52) return { channel: 'web', via: 'widget' };
    if (r < 0.76) return { channel: 'whatsapp' };
    if (r < 0.88) return { channel: 'ota' };
    return { channel: 'staff' };
  };
  /** When it was booked: a few days to three weeks before, never in the future. @param {any} dep */
  const bookedAt = (dep) => {
    const t = dep.startsAt.getTime() - (between(1, 21) * DAY + between(1, 12) * HOUR);
    // Never in the future, and mostly on earlier days: a normal day has only a few new ones.
    const latest =
      now.getTime() -
      (rand() < 0.12 ? between(1, 6) * HOUR : between(1, 6) * DAY + between(1, 10) * HOUR);
    return new Date(Math.min(t, latest));
  };
  const productOf = (/** @type {any} */ dep) => products.find((p) => p.id === dep.productId);

  // --- 3a. The past: about 150, more at weekends --------------------------------------------
  // A growing business: later weeks busier (up to twice the first), weekends busiest.
  const weighted = past.flatMap((d, i) =>
    Array(
      Math.round((dayOfWeek(localDate(d.startsAt, tz)) % 6 === 0 ? 3 : 2) * (1 + i / past.length)),
    ).fill(d),
  );
  const cancelAt = (/** @type {any} */ dep, /** @type {number} */ hoursBefore) =>
    new Date(dep.startsAt.getTime() - hoursBefore * HOUR);
  let made = 0;
  let guard = 0;
  while (made < pastBookings && guard++ < pastBookings * 20) {
    const dep = pick(weighted);
    if (dep.id === stormy?.id) continue; // its bookings come below
    if ((sold.get(dep.id) ?? 0) >= dep.capacity - 1) continue;
    const plan = { product: productOf(dep), departure: dep, at: bookedAt(dep), ...channel() };
    // Every 19th cancels (refund by the policy); two never turn up; the rest come.
    const story =
      made % 19 === 7
        ? { status: 'cancelled', cancelledAt: cancelAt(dep, pick([72, 30, 12])) }
        : made === 40 || made === 95
          ? { status: 'no_show' }
          : { status: 'completed', deposit: plan.product.depositBasisPoints != null };
    if (story.cancelledAt && story.cancelledAt <= plan.at) continue;
    await book(plan, story);
    made += 1;
  }
  // The weather: everyone on that trip refunded in full.
  if (stormy) {
    for (let i = 0; i < 3; i++) {
      await book(
        {
          product: tarkwa,
          departure: stormy,
          at: new Date(stormy.startsAt.getTime() - (5 + i) * DAY),
          channel: i === 2 ? 'whatsapp' : 'web',
          via: 'website',
        },
        {
          status: 'refunded',
          cancelledAt: new Date(stormy.startsAt.getTime() - 14 * HOUR),
          cancelledBy: 'operator',
        },
      );
    }
    await prisma.departure.update({
      where: { id: stormy.id },
      data: {
        status: 'cancelled',
        cancelReason: 'Weather: high waves on the lagoon, the boat can’t go out.',
      },
    });
  }
  // Loose end: a refund that FAILED (a guest cancelled two days ago; the bank said no).
  const recent = past.filter(
    (d) => d.startsAt > new Date(now.getTime() - 4 * DAY) && d.id !== stormy?.id,
  );
  if (recent.length) {
    const dep = recent[0];
    await book(
      {
        product: productOf(dep),
        departure: dep,
        at: new Date(dep.startsAt.getTime() - 9 * DAY),
        channel: 'web',
        via: 'website',
      },
      { status: 'refunded', cancelledAt: cancelAt(dep, 70), refund: 'failed' },
    );
    // Loose end: CASH a guide took yesterday and hasn't handed in.
    const yesterday = past
      .filter(
        (d) =>
          d.guideId &&
          d.startsAt > new Date(now.getTime() - 2 * DAY) &&
          d.id !== stormy?.id &&
          room(d) >= 2,
      )
      .at(-1);
    if (yesterday) {
      await book(
        {
          product: productOf(yesterday),
          departure: yesterday,
          at: new Date(yesterday.startsAt.getTime() - 2 * DAY),
          channel: 'staff',
        },
        { status: 'confirmed', cash: 'reported', travellers: 2 },
      );
    }
  }

  // --- 3b. Upcoming: about 20, today's departures and the next three weeks -----------------
  /** @type {any[]} */
  const upcomingBookings = [];
  const soonFirst = upcoming.flatMap((d, i) => Array(i < upcoming.length / 3 ? 3 : 1).fill(d));
  guard = 0;
  while (upcomingBookings.length < upcomingCount && guard++ < 400) {
    const dep = pick(soonFirst);
    if ((sold.get(dep.id) ?? 0) >= dep.capacity - 2) continue;
    const p = productOf(dep);
    const plan = { product: p, departure: dep, at: bookedAt(dep), ...channel() };
    const deposit = p.depositBasisPoints != null;
    // A Badagry deposit: still owing while the balance isn't due (7 days before); once it
    // was due, these guests paid it. The one overdue balance is the loose end below.
    const due = dep.startsAt.getTime() - 7 * DAY <= now.getTime();
    const story = { status: deposit && !due ? 'part_paid' : 'paid', deposit };
    upcomingBookings.push(await book(plan, story));
  }
  // The departure left without a guide has guests: that's what makes it urgent.
  if (unguided && !sold.get(unguided.id) && room(unguided) >= 2) {
    upcomingBookings.push(
      await book(
        {
          product: productOf(unguided),
          departure: unguided,
          at: new Date(now.getTime() - 2 * DAY),
          channel: 'whatsapp',
        },
        { status: 'paid', travellers: 2 },
      ),
    );
  }
  // Make sure there's a Badagry deposit waiting on its balance (a loose end when it's due).
  const badagry = bySlug('badagry-heritage');
  const nextBadagry = upcoming.find((d) => d.productId === badagry.id);
  if (
    nextBadagry &&
    room(nextBadagry) >= 2 &&
    !upcomingBookings.some((b) => b.departureId === nextBadagry.id)
  ) {
    upcomingBookings.push(
      await book(
        {
          product: badagry,
          departure: nextBadagry,
          at: new Date(
            Math.min(nextBadagry.startsAt.getTime() - 12 * DAY, now.getTime() - 2 * HOUR),
          ),
          channel: 'whatsapp',
        },
        { status: 'part_paid', deposit: true, travellers: 2 },
      ),
    );
  }

  // Loose ends in the inbox: a guest asking to change the date, and a question the
  // companion passed on.
  const asker = upcomingBookings.find((b) => b.channel !== 'ota');
  if (asker) {
    await prisma.guestRequest.create({
      data: {
        operatorId: operator.id,
        bookingId: asker.id,
        kind: 'change_date',
        message: 'My sister lands a day later. Can we move to the next day, same time?',
        createdAt: new Date(now.getTime() - 3 * HOUR),
      },
    });
  }
  const curious = upcomingBookings.find((b) => b.channel !== 'ota' && b.id !== asker?.id);
  if (curious) {
    const q = await prisma.guestRequest.create({
      data: {
        operatorId: operator.id,
        bookingId: curious.id,
        kind: 'question',
        message: 'Is there somewhere to leave a small suitcase during the tour?',
        createdAt: new Date(now.getTime() - 50 * MIN),
      },
    });
    await prisma.companionMessage.create({
      data: {
        operatorId: operator.id,
        bookingId: curious.id,
        question: q.message,
        outcome: 'handed_over',
        model: 'fake',
        guestRequestId: q.id,
        createdAt: q.createdAt,
      },
    });
  }

  // --- 4. Seats sold, as the bookings say --------------------------------------------------
  for (const [id, seats] of sold) {
    await prisma.departure.update({ where: { id }, data: { seatsSold: seats } });
  }

  // --- 5. Sojourna pays what it owes: for trips more than a week old, twice ----------------
  if (sojourna) {
    const due = otaSales
      .filter((s) => s.booking && s.story.status === 'completed')
      .sort((a, b) => a.at - b.at);
    for (const daysAgo of [32, 11]) {
      const by = new Date(now.getTime() - daysAgo * DAY);
      const batch = due.filter((s) => !s.paidOff && s.at < new Date(by.getTime() - 7 * DAY));
      if (batch.length === 0) continue;
      const amount = batch.reduce((k, s) => k + s.owed, 0);
      const receivedOn = localDate(by, tz);
      const payment = await prisma.channelPayment.create({
        data: {
          operatorId: operator.id,
          channelId: sojourna.id,
          amountKobo: amount,
          receivedOn: new Date(`${receivedOn}T00:00:00Z`),
          reference: `SJ-PAY-${receivedOn.replaceAll('-', '')}`,
          recordedById: owner.id,
          createdAt: by,
        },
      });
      await prisma.channelPaymentAllocation.createMany({
        data: batch.map((s) => ({
          paymentId: payment.id,
          channelBookingId: s.cb.id,
          amountKobo: s.owed,
        })),
      });
      await ledger({
        operatorId: operator.id,
        type: 'ota_payment',
        idempotencyKey: `ota-payment:${payment.id}`,
        description: `${sojourna.name} paid`,
        lines: POSTINGS.otaPayment(amount),
        occurredAt: by,
        createdById: owner.id,
      });
      for (const s of batch) s.paidOff = true;
    }
  }

  return {
    past: made + (stormy ? 3 : 0) + (recent.length ? 2 : 0),
    upcoming: upcomingBookings.length,
    departures: past.length,
    unguidedDepartureId: unguided?.id ?? null,
  };
}
