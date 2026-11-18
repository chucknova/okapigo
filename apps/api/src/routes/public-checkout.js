// @ts-check
/**
 * The PUBLIC checkout (BKG-02, INV-23): a guest prices a basket, holds seats and creates a
 * booking, all without an account. Stage 11b.
 *
 *   POST /public/:operatorSlug/tours/:tourSlug/quote   live price (+ seats and stock left)
 *   POST /public/:operatorSlug/bookings                 hold seats + create the booking
 *   GET  /public/bookings/:token                        the guest's booking (review screen)
 *   POST /public/bookings/:token/release                give the seats back (guest went back
 *                                                       to change something, or left)
 *   POST /public/bookings/:token/pay                    pay in full, a deposit, or the balance
 *                                                       → Paystack's checkout URL (stage 11c)
 *
 * The SAME engine as staff bookings: quoteForBooking() (pricing + booking rules such as
 * "children need an adult") and createBooking() (row lock, seats, add-on stock, pickup
 * point, policy version). Only the edges differ:
 *   - channel "web" and actor "guest" on the timeline
 *   - the guest proves which booking is theirs with a SIGNED link token (guest-links.js),
 *     not a sign-in
 *   - rate limits per IP address (middleware/rate-limit.js)
 *   - a guest-only view of the booking: no staff notes, no timeline, no internal ids
 *
 * Paying: the guest picks an OPTION ("full", "deposit", "balance"), never an amount. The
 * server works out the amount from the same rules that listed the options, so a tampered
 * request can't pay ₦1 and call it a deposit.
 */
import { Router } from 'express';
import { z } from 'zod';
import {
  createBooking,
  releaseHold,
  addOnUsage,
  guestToken,
  bookingIdFromGuestToken,
  ticketCode,
  guestCancelBooking,
  requestBookingRefund,
  createGuestRequest,
  PAYABLE_STATUSES,
  checkPayment,
} from '@okapigo/db';
import { findCategoryForAge } from '@okapigo/shared/catalogue';
import { localDate, localTime } from '@okapigo/shared/time';
import { depositOffer, balanceDueDate } from '@okapigo/shared/deposits';
import { PublicQuoteRequestSchema } from '@okapigo/shared/schemas/pricing';
import { PublicCreateBookingSchema } from '@okapigo/shared/schemas/bookings';
import { validate } from '../middleware/validate.js';
import { HttpError } from '../middleware/errors.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { toHttp } from './bookings.js';
import { startPaymentForHttp } from './payments.js';
import { qrPath } from '../lib/qr.js';

const Slug = z
  .string()
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const TokenParams = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{44}$/) });
// Cancel yourself (stage 12f-2): the refund the guest was SHOWN, so it can't change unseen.
const GuestCancelSchema = z.object({ expectRefundKobo: z.number().int().min(0) });
// Ask the operator (stage 12f-2).
const GuestRequestSchema = z.object({
  kind: z.enum(['change_date', 'cancel', 'other']),
  message: z.string().trim().min(1, 'Write a short message.').max(1000),
});

const PayBodySchema = z.object({
  option: z.enum(['full', 'deposit', 'balance']),
  // "any": the guest chooses card or bank transfer on Paystack's page.
  method: z.enum(['card', 'bank_transfer', 'any']).default('any'),
});

/**
 * @typedef {{ type: 'full', amountKobo: number }
 *   | { type: 'deposit', amountKobo: number, balanceKobo: number, balanceDueDate: string }
 *   | { type: 'balance', amountKobo: number }} PaymentOption
 */

/**
 * What the guest can pay right now. Shown on the review screen AND used to check "Pay", so
 * the screen can only offer what the server will accept.
 *   held, hold still on  → full, plus a deposit if the tour allows one (deposits.js)
 *   confirmed / part_paid / amended with money owed → the balance
 *   anything else (paid, cancelled, hold expired…) → nothing
 * @param {any} b  booking with product.operator, departure, hold
 * @param {Date} now
 * @returns {PaymentOption[]}
 */
function paymentOptions(b, now) {
  const balanceKobo = b.totalKobo - b.amountPaidKobo;
  if (balanceKobo <= 0 || !PAYABLE_STATUSES.includes(b.status)) return [];
  if (b.status !== 'held') return [{ type: 'balance', amountKobo: balanceKobo }];
  if (b.hold.status !== 'active' || b.hold.expiresAt <= now) return [];

  const { timeZone } = b.product.operator;
  const deposit = depositOffer({
    totalKobo: b.totalKobo,
    amountPaidKobo: b.amountPaidKobo,
    depositBasisPoints: b.product.depositBasisPoints,
    departureLocalDate: localDate(b.departure.startsAt, timeZone),
    todayLocalDate: localDate(now, timeZone),
  });
  /** @type {PaymentOption[]} */
  const options = [{ type: 'full', amountKobo: balanceKobo }];
  if (deposit) {
    options.push({
      type: 'deposit',
      amountKobo: deposit.depositKobo,
      balanceKobo: deposit.balanceKobo,
      balanceDueDate: deposit.balanceDueDate,
    });
  }
  return options;
}

/**
 * Per-IP limits. Generous on purpose: one public IP is often many real people (see
 * rate-limit.js). Tests pass smaller numbers to see the limit in action.
 */
export const DEFAULT_PUBLIC_LIMITS = {
  // Every tap on a − / + counter asks for a price.
  quote: { limit: 120, windowSeconds: 60 },
  // Each one holds seats for 15 minutes. 30 per 10 minutes is plenty for real checkouts
  // (and for a busy shared IP), and far too few to keep a whole tour held.
  booking: { limit: 30, windowSeconds: 600 },
  // Reading or releasing your own booking.
  guest: { limit: 120, windowSeconds: 60 },
};

/**
 * The booking as its guest may see it. A whitelist like every serializer, and narrower than
 * the staff one: the guest link could be forwarded, so nothing internal goes out.
 * @param {any} b  booking with product.operator, departure, travellers, addOns.addOn, hold, policyVersion
 * @param {{ secret: string, now?: Date }} opts  secret: AUTH_SECRET, to sign the ticket code
 */
function guestView(b, { secret, now = new Date() }) {
  const { timeZone } = b.product.operator;
  const balanceKobo = b.totalKobo - b.amountPaidKobo;
  const cancelEvent = b.events?.[0] ?? null; // the latest "→ cancelled" (GUEST_INCLUDE)
  return {
    reference: b.reference,
    status: b.status,
    operator: {
      slug: b.product.operator.slug,
      name: b.product.operator.name,
      timeZone: b.product.operator.timeZone,
      // "Call" and "WhatsApp" on the trip hub (stage 12f); null hides the button.
      phone: b.product.operator.phone ?? null,
      whatsapp: b.product.operator.whatsapp ?? null,
      // The look (stage 12g): trip pages are private, so the style arrives with the data.
      websiteStyle: b.product.operator.websiteStyle,
      websiteMode: b.product.operator.websiteMode,
    },
    tour: {
      slug: b.product.slug,
      title: b.product.title,
      durationMinutes: b.product.durationMinutes,
      meetingPoint: b.product.meetingPoint,
      whatToBring: b.product.whatToBring,
      // The route, in order (names only: the descriptions are for the tour page).
      stops: (b.product.stops ?? []).map((/** @type {{ name: string }} */ s) => s.name),
      arriveMinutesEarly: b.product.arriveMinutesEarly ?? null,
    },
    departure: {
      startsAt: b.departure.startsAt,
      endsAt: b.departure.endsAt, // "after the trip" begins here (trip-hub.js)
      localDate: localDate(b.departure.startsAt, timeZone),
      localTime: localTime(b.departure.startsAt, timeZone),
    },
    pickupPoint: b.pickupPoint ?? null,
    lead: { name: b.leadName, email: b.leadEmail, phone: b.leadPhone },
    travellers: b.travellers.map((t) => ({
      name: t.name,
      age: t.age,
      categoryKey: t.categoryKey,
      dietaryNeeds: t.dietaryNeeds,
    })),
    addOns: b.addOns.map((a) => ({
      name: a.addOn.name,
      quantity: a.quantity,
      unitKobo: a.unitKobo,
    })),
    quote: b.quote, // the price snapshot: lines, VAT, total (what the guest agreed to pay)
    totalKobo: b.totalKobo,
    amountPaidKobo: b.amountPaidKobo,
    // The deposit actually paid: a policy that keeps deposits keeps this (trip-hub.js).
    depositPaidKobo: (b.payments ?? [])
      .filter((/** @type {any} */ p) => p.purpose === 'deposit' && p.status === 'succeeded')
      .reduce((/** @type {number} */ sum, /** @type {any} */ p) => sum + p.amountKobo, 0),
    balanceKobo,
    // Part paid (e.g. a deposit): the rest is due 7 days before the trip (deposits.js).
    balanceDueDate:
      b.amountPaidKobo > 0 && balanceKobo > 0
        ? balanceDueDate(localDate(b.departure.startsAt, timeZone))
        : null,
    // What "Pay" can do now: [] when nothing can be paid.
    paymentOptions: paymentOptions(b, now),
    // The countdown on the review screen. Only meaningful while the booking is "held".
    holdExpiresAt: b.status === 'held' ? b.hold.expiresAt : null,
    // The payment attempts, so "Confirming your payment…" can follow one (stage 12e). Only
    // what the guest needs: no provider ids, no fees, no failure details from the bank.
    payments: (b.payments ?? []).map((p) => ({
      reference: p.reference,
      status: p.status,
      purpose: p.purpose,
      amountKobo: p.amountKobo,
      paidAt: p.paidAt,
    })),
    cancellationPolicy: b.policyVersion
      ? {
          rules: b.policyVersion.rules,
          noShowRefundBasisPoints: b.policyVersion.noShowRefundBasisPoints,
          depositRefundable: b.policyVersion.depositRefundable,
        }
      : null,
    // THE TICKET (trip hub, stage 12f): a signed code for the guide's scanner, never the
    // guest link, plus its QR drawing so the saved copy works offline. Only while there's a
    // trip to go on: a cancelled booking has no ticket.
    ticket: TICKET_STATUSES.includes(b.status) ? ticketFor(secret, b.id) : null,
    // Who cancelled, and why (staff's reason is shown to the guest, quoted).
    cancellation: cancelEvent
      ? {
          at: cancelEvent.createdAt,
          by: cancelEvent.data?.initiatedBy === 'guest' ? 'guest' : 'operator',
          reason:
            cancelEvent.data?.initiatedBy === 'guest' ? null : (cancelEvent.data?.reason ?? null),
          refundKobo: b.refundDueKobo,
        }
      : null,
    // "Your request was sent on Tue 1 Dec" (stage 12f-2): the guest's open requests, newest
    // first. Staff's notes stay on the staff side.
    openRequests: (b.guestRequests ?? []).map((/** @type {any} */ r) => ({
      kind: r.kind,
      message: r.message,
      createdAt: r.createdAt,
    })),
    // Money confirmed back with the guest ("Refunded ₦62,500 on Thu 26 Nov").
    refunds: (b.refunds ?? [])
      .filter((/** @type {any} */ r) => r.status === 'processed' && r.processedAt)
      .map((/** @type {any} */ r) => ({ amountKobo: r.amountKobo, processedAt: r.processedAt })),
  };
}

/**
 * @param {string} secret
 * @param {string} bookingId
 */
function ticketFor(secret, bookingId) {
  const code = ticketCode(secret, bookingId);
  return { code, qr: qrPath(code) };
}

/** Booking statuses that have a trip to go on, so a ticket. */
const TICKET_STATUSES = ['confirmed', 'part_paid', 'paid', 'amended', 'completed'];

const GUEST_INCLUDE = {
  product: { include: { operator: true } },
  departure: true,
  travellers: { orderBy: { position: /** @type {const} */ ('asc') } },
  addOns: { include: { addOn: true } },
  hold: true,
  policyVersion: true,
  // Newest first: the confirmation page follows the latest attempt (stage 12e).
  payments: {
    orderBy: [{ createdAt: /** @type {const} */ ('desc') }, { id: /** @type {const} */ ('desc') }],
  },
  // The trip hub's cancelled banners (stage 12f): the latest cancellation, and refunds.
  events: {
    where: { toStatus: 'cancelled' },
    orderBy: { createdAt: /** @type {const} */ ('desc') },
    take: 1,
  },
  refunds: true,
  guestRequests: {
    where: { status: 'open' },
    orderBy: { createdAt: /** @type {const} */ ('desc') },
  },
};

/**
 * @param {{
 *   prisma: import('@prisma/client').PrismaClient,
 *   quotes: ReturnType<typeof import('../pricing/quote-service.js').createQuoteService>,
 *   jobs: { scheduleHoldExpiry: (holdId: string, expiresAt: Date) => Promise<void> },
 *   authSecret: string,
 *   rateLimitStore: import('../middleware/rate-limit.js').RateLimitStore,
 *   limits?: typeof DEFAULT_PUBLIC_LIMITS,
 *   provider: import('@okapigo/payments').PaymentProvider,
 *   apiPublicUrl: string,
 *   webPublicUrl: string,   // where guests come back to after paying (the guest web)
 * }} deps
 */
export function publicCheckoutRouter({
  prisma,
  quotes,
  jobs,
  authSecret,
  rateLimitStore,
  limits = DEFAULT_PUBLIC_LIMITS,
  provider,
  apiPublicUrl,
  webPublicUrl = apiPublicUrl,
}) {
  const router = Router();
  const limiter = (/** @type {keyof typeof DEFAULT_PUBLIC_LIMITS} */ name) =>
    rateLimit({ store: rateLimitStore, name: `public-${name}`, ...limits[name] });

  /** @param {string} slug */
  async function findOperator(slug) {
    const parsed = Slug.safeParse(slug);
    const operator = parsed.success
      ? await prisma.operator.findUnique({ where: { slug: parsed.data } })
      : null;
    if (!operator) throw new HttpError(404, 'NOT_FOUND', 'Not found.');
    return operator;
  }

  /**
   * The booking behind a guest token, or 404. A forged or mangled token gets exactly the
   * same answer as a real token for a deleted booking: nothing to learn by guessing.
   * @param {string} token
   */
  async function findGuestBooking(token) {
    const id = bookingIdFromGuestToken(authSecret, token);
    const booking = id
      ? await prisma.booking.findUnique({ where: { id }, include: GUEST_INCLUDE })
      : null;
    if (!booking) throw new HttpError(404, 'NOT_FOUND', 'Booking not found.');
    return booking;
  }

  // --- Live price (checkout screen 2) ----------------------------------------------------

  router.post(
    '/public/:operatorSlug/tours/:tourSlug/quote',
    limiter('quote'),
    validate({ body: PublicQuoteRequestSchema }),
    async (req, res) => {
      const operator = await findOperator(req.params.operatorSlug);
      const tour = await prisma.product.findFirst({
        where: { operatorId: operator.id, slug: req.params.tourSlug, status: 'published' },
        include: { addOns: { where: { isActive: true } } },
      });
      if (!tour) throw new HttpError(404, 'NOT_FOUND', 'Tour not found.');

      // quote(), not quoteForBooking(): a child-only basket still gets a price, plus a
      // `blocker` saying why it can't be booked yet. The guest may be adding the adult next.
      const { quote, blocker } = await quotes.quote({
        operatorId: operator.id,
        productId: tour.id,
        travellers: req.body.travellers,
        addOns: req.body.addOns,
      });

      // With a date chosen: what's left on it, so the screen can cap the counters. These
      // are DISPLAY figures read without a lock; the hold re-checks under the lock.
      let availability = null;
      if (req.body.departureId) {
        const departure = await prisma.departure.findFirst({
          where: { id: req.body.departureId, productId: tour.id, status: 'scheduled' },
        });
        if (!departure) throw new HttpError(404, 'NOT_FOUND', 'Departure not found.');
        const used = await addOnUsage(prisma, departure.id);
        availability = {
          seatsAvailable: Math.max(
            0,
            departure.capacity - departure.seatsSold - departure.seatsHeld,
          ),
          addOns: tour.addOns.map((a) => ({
            id: a.id,
            // null = unlimited
            left:
              a.stockPerDeparture === null
                ? null
                : Math.max(0, a.stockPerDeparture - (used.get(a.id) ?? 0)),
          })),
        };
      }

      res.set('Cache-Control', 'no-store').json({ quote, blocker, availability });
    },
  );

  // --- Hold seats and create the booking (checkout screen 3 → 4) --------------------------

  router.post(
    '/public/:operatorSlug/bookings',
    limiter('booking'),
    validate({ body: PublicCreateBookingSchema }),
    async (req, res) => {
      const operator = await findOperator(req.params.operatorSlug);
      const { departureId, lead, travellers, addOns, pickupPoint } = req.body;

      // The departure must belong to THIS operator and to a PUBLISHED tour. (A guest can't
      // book a draft tour by guessing a departure id.)
      const departure = await prisma.departure.findFirst({
        where: { id: departureId, operatorId: operator.id, product: { status: 'published' } },
      });
      if (!departure) throw new HttpError(404, 'NOT_FOUND', 'Departure not found.');

      // 1. Price it, and apply the booking rules (no children without an adult…).
      const { quote, priceCategories } = await quotes.quoteForBooking({
        operatorId: operator.id,
        productId: departure.productId,
        travellers: travellers.map((t) => ({ age: t.age })),
        addOns,
      });

      // 2. Each traveller's AGE decides their price. If the guest also told us which counter
      //    they came from, they must agree, or the guest would pay a different price than
      //    the one they saw on screen 2.
      const withCategories = travellers.map((t, i) => {
        const charged = /** @type {import('@prisma/client').PriceCategory} */ (
          findCategoryForAge(priceCategories, t.age)
        );
        if (t.categoryKey && t.categoryKey !== charged.key) {
          const chosen = priceCategories.find((c) => c.key === t.categoryKey);
          throw new HttpError(
            400,
            'AGE_CATEGORY_MISMATCH',
            // The design's wording: "Child: ages 3–12. For age 13, go back and choose Adult."
            chosen
              ? `${plainName(chosen)}: ages ${ageRange(chosen)}. For age ${t.age}, go back and choose ${plainName(charged)}.`
              : `For age ${t.age}, go back and choose ${plainName(charged)}.`,
            { traveller: i, categoryKey: charged.key },
          );
        }
        return { ...t, categoryKey: charged.key };
      });
      const addOnLines = quote.lines.filter((l) => l.type === 'addOn');

      // 3. Hold + booking, all or nothing (row lock inside).
      let created;
      try {
        created = await createBooking(prisma, {
          operatorId: operator.id,
          operatorSlug: operator.slug,
          departureId,
          productId: departure.productId,
          channel: 'web',
          attribution: req.body.attribution,
          lead: {
            name: lead.name,
            email: lead.email ?? null,
            phone: lead.phone ?? null,
            marketingConsent: lead.marketingConsent,
          },
          travellers: withCategories,
          addOns: addOnLines.map((l) => ({
            addOnId: l.addOnId,
            quantity: l.quantity,
            unitKobo: l.unitKobo,
          })),
          quote,
          totalKobo: quote.totalKobo,
          holdMinutes: operator.holdMinutes,
          pickupPointName: pickupPoint ?? null,
          actor: { type: 'guest' },
        });
      } catch (err) {
        throw toHttp(err);
      }

      try {
        await jobs.scheduleHoldExpiry(created.hold.id, created.hold.expiresAt);
      } catch (err) {
        req.log.warn(
          { err, holdId: created.hold.id },
          'could not schedule hold expiry; sweeper will handle it',
        );
      }

      const booking = await prisma.booking.findUniqueOrThrow({
        where: { id: created.booking.id },
        include: GUEST_INCLUDE,
      });
      // The token is the guest's key to this booking: the browser keeps it for the review
      // and pay screens, and every message we send carries a link with it.
      res.status(201).json({
        token: guestToken(authSecret, booking.id),
        booking: guestView(booking, { secret: authSecret }),
      });
    },
  );

  // --- The guest's own booking --------------------------------------------------------------

  router.get(
    '/public/bookings/:token',
    limiter('guest'),
    validate({ params: TokenParams }),
    async (req, res) => {
      const booking = await findGuestBooking(req.params.token);
      // Private to whoever holds the link: never stored by shared caches.
      res
        .set('Cache-Control', 'private, no-store')
        .json({ booking: guestView(booking, { secret: authSecret }) });
    },
  );

  router.post(
    '/public/bookings/:token/release',
    limiter('guest'),
    validate({ params: TokenParams }),
    async (req, res) => {
      const booking = await findGuestBooking(req.params.token);
      if (booking.status !== 'held') {
        // Paid or confirmed bookings are cancelled through the cancellation policy (the trip
        // hub, session 12), never by "releasing".
        throw new HttpError(409, 'NOT_HELD', `This booking is ${booking.status}, not held.`);
      }
      // Releasing the hold also cancels the still-held booking, in one transaction.
      const released = await releaseHold(prisma, booking.holdId, {
        reason: 'released',
        actor: { type: 'guest' },
      });
      if (!released) throw new HttpError(409, 'NOT_HELD', 'These seats were already released.');
      res.status(204).end();
    },
  );

  // --- Cancel yourself (trip hub, journey 4, stage 12f-2) ----------------------------------

  router.post(
    '/public/bookings/:token/cancel',
    limiter('guest'),
    validate({ params: TokenParams, body: GuestCancelSchema }),
    async (req, res) => {
      const booking = await findGuestBooking(req.params.token);
      let refund;
      try {
        refund = await guestCancelBooking(prisma, {
          bookingId: booking.id,
          expectRefundKobo: req.body.expectRefundKobo,
        });
      } catch (err) {
        throw toHttp(err);
      }
      // "Your refund is on its way": ask the provider now. If it refuses (or is down), the
      // refund stays OWED on the booking, where staff see it and can send it again (10e).
      let refundStarted = false;
      if (refund.refundKobo > 0) {
        try {
          await requestBookingRefund(prisma, provider, {
            operatorId: booking.operatorId,
            bookingId: booking.id,
            reason: 'Guest cancelled on the trip page',
            actor: { type: 'guest' },
          });
          refundStarted = true;
        } catch (err) {
          req.log.error({ err, bookingId: booking.id }, 'guest refund could not be started');
        }
      }
      const fresh = await findGuestBooking(req.params.token);
      res.json({
        refundKobo: refund.refundKobo,
        refundStarted,
        booking: guestView(fresh, { secret: authSecret }),
      });
    },
  );

  // --- Ask the operator (trip hub, stage 12f-2) ---------------------------------------------

  router.post(
    '/public/bookings/:token/requests',
    limiter('guest'),
    validate({ params: TokenParams, body: GuestRequestSchema }),
    async (req, res) => {
      const booking = await findGuestBooking(req.params.token);
      try {
        await createGuestRequest(prisma, {
          bookingId: booking.id,
          kind: req.body.kind,
          message: req.body.message,
        });
      } catch (err) {
        throw toHttp(err);
      }
      const fresh = await findGuestBooking(req.params.token);
      res.status(201).json({ booking: guestView(fresh, { secret: authSecret }) });
    },
  );

  // --- Pay: in full, a deposit, or the balance (checkout screen 4, trip hub) ----------------

  router.post(
    '/public/bookings/:token/pay',
    limiter('guest'),
    validate({ params: TokenParams, body: PayBodySchema }),
    async (req, res) => {
      const booking = await findGuestBooking(req.params.token);
      const option = paymentOptions(booking, new Date()).find((o) => o.type === req.body.option);
      if (!option) {
        const why =
          req.body.option === 'deposit'
            ? "A deposit isn't available for this booking. Please pay in full."
            : "This booking can't take that payment now.";
        throw new HttpError(409, 'OPTION_NOT_AVAILABLE', why, {
          options: paymentOptions(booking, new Date()).map((o) => o.type),
        });
      }

      // The AMOUNT comes from the option the server worked out, never from the request.
      const { payment, reused } = await startPaymentForHttp(prisma, provider, {
        operatorId: booking.operatorId,
        bookingId: booking.id,
        method: req.body.method,
        amountKobo: option.amountKobo,
        // Back to the guest web's "Confirming your payment…" page for THIS booking (12e).
        // Paystack adds ?reference=…&trxref=… to it.
        callbackUrl: `${webPublicUrl}/trip/${req.params.token}/confirm`,
        actor: { type: 'guest' },
      });

      // The browser goes to authorizationUrl (Paystack's page); Paystack sends the guest
      // back to the callback page, and the webhook (stage 10c) is what confirms the money.
      res.status(reused ? 200 : 201).json({
        payment: {
          reference: payment.reference,
          amountKobo: payment.amountKobo,
          purpose: payment.purpose,
          authorizationUrl: payment.authorizationUrl,
        },
        reused,
      });
    },
  );

  // --- "Is my payment through yet?" (the confirming page, stage 12e) ----------------------

  router.post(
    '/public/bookings/:token/payments/:reference/check',
    limiter('guest'),
    validate({
      params: TokenParams.extend({ reference: z.string().regex(/^OKG-[A-Z0-9]{8,40}$/) }),
    }),
    async (req, res) => {
      const booking = await findGuestBooking(req.params.token);
      const payment = await prisma.payment.findFirst({
        where: { bookingId: booking.id, reference: req.params.reference },
      });
      if (!payment) throw new HttpError(404, 'NOT_FOUND', 'Payment not found.');
      // Ask the provider only while it's still unfinished; otherwise the answer is known.
      if (payment.status === 'initiated') {
        await checkPayment(prisma, provider, payment).catch((err) => {
          // The provider being slow isn't the guest's problem: the page keeps waiting.
          req.log.warn({ err, reference: payment.reference }, 'payment check failed');
        });
      }
      const fresh = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
      res.set('Cache-Control', 'no-store').json({ status: fresh.status });
    },
  );

  // --- Add to calendar ---------------------------------------------------------------------

  router.get(
    '/public/bookings/:token/calendar.ics',
    limiter('guest'),
    validate({ params: TokenParams }),
    async (req, res) => {
      const booking = await findGuestBooking(req.params.token);
      res
        .set('Cache-Control', 'private, no-store')
        .set('Content-Disposition', `attachment; filename="${booking.reference}.ics"`)
        .type('text/calendar')
        .send(bookingCalendar(booking, `${webPublicUrl}/trip/${req.params.token}`));
    },
  );

  return router;
}

/**
 * The booking as a calendar event (an .ics file, which phones' calendars open). Lines are
 * CRLF-separated and text is escaped, as the iCalendar format (RFC 5545) requires.
 * @param {any} b  a booking with product, departure and product.operator
 * @param {string} tripUrl
 */
export function bookingCalendar(b, tripUrl) {
  /** @param {Date} d  → 20261205T080000Z */
  const stamp = (d) =>
    d
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}/, '');
  /** @param {string} t */
  const esc = (t) => t.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');
  const place = /** @type {{ name: string, address: string }} */ (
    b.pickupPoint ?? b.product.meetingPoint
  );
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//OkapiGo//Bookings//EN',
    'BEGIN:VEVENT',
    `UID:${b.id}@okapigo`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(b.departure.startsAt)}`,
    `DTEND:${stamp(b.departure.endsAt)}`,
    `SUMMARY:${esc(`${b.product.title} (${b.product.operator.name})`)}`,
    `LOCATION:${esc(`${place.name}, ${place.address}`)}`,
    `DESCRIPTION:${esc(`Booking ${b.reference}. Your ticket and map: ${tripUrl}`)}`,
    `URL:${tripUrl}`,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

/** "Child (3–12)" → "Child": the name without its age range. @param {{ name: string }} c */
function plainName(c) {
  return c.name.replace(/\s*\(.*\)\s*$/, '');
}

/** "3–12" or "13 and over". @param {{ minAge: number, maxAge: number | null }} c */
function ageRange(c) {
  return c.maxAge === null ? `${c.minAge} and over` : `${c.minAge}–${c.maxAge}`;
}
