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
 *
 * The SAME engine as staff bookings: quoteForBooking() (pricing + booking rules such as
 * "children need an adult") and createBooking() (row lock, seats, add-on stock, pickup
 * point, policy version). Only the edges differ:
 *   - channel "web" and actor "guest" on the timeline
 *   - the guest proves which booking is theirs with a SIGNED link token (guest-links.js),
 *     not a sign-in
 *   - rate limits per IP address (middleware/rate-limit.js)
 *   - a guest-only view of the booking: no staff notes, no timeline, no internal ids
 * Paying (full or deposit) is stage 11c.
 */
import { Router } from 'express';
import { z } from 'zod';
import {
  createBooking,
  releaseHold,
  addOnUsage,
  guestToken,
  bookingIdFromGuestToken,
} from '@okapigo/db';
import { findCategoryForAge } from '@okapigo/shared/catalogue';
import { localDate, localTime } from '@okapigo/shared/time';
import { PublicQuoteRequestSchema } from '@okapigo/shared/schemas/pricing';
import { PublicCreateBookingSchema } from '@okapigo/shared/schemas/bookings';
import { validate } from '../middleware/validate.js';
import { HttpError } from '../middleware/errors.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { toHttp } from './bookings.js';

const Slug = z
  .string()
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const TokenParams = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{44}$/) });

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
 */
function guestView(b) {
  const { timeZone } = b.product.operator;
  return {
    reference: b.reference,
    status: b.status,
    operator: { slug: b.product.operator.slug, name: b.product.operator.name },
    tour: {
      slug: b.product.slug,
      title: b.product.title,
      meetingPoint: b.product.meetingPoint,
      whatToBring: b.product.whatToBring,
    },
    departure: {
      startsAt: b.departure.startsAt,
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
    balanceKobo: b.totalKobo - b.amountPaidKobo,
    // The countdown on the review screen. Only meaningful while the booking is "held".
    holdExpiresAt: b.status === 'held' ? b.hold.expiresAt : null,
    cancellationPolicy: b.policyVersion
      ? {
          rules: b.policyVersion.rules,
          noShowRefundBasisPoints: b.policyVersion.noShowRefundBasisPoints,
        }
      : null,
  };
}

const GUEST_INCLUDE = {
  product: { include: { operator: true } },
  departure: true,
  travellers: { orderBy: { position: /** @type {const} */ ('asc') } },
  addOns: { include: { addOn: true } },
  hold: true,
  policyVersion: true,
};

/**
 * @param {{
 *   prisma: import('@prisma/client').PrismaClient,
 *   quotes: ReturnType<typeof import('../pricing/quote-service.js').createQuoteService>,
 *   jobs: { scheduleHoldExpiry: (holdId: string, expiresAt: Date) => Promise<void> },
 *   authSecret: string,
 *   rateLimitStore: import('../middleware/rate-limit.js').RateLimitStore,
 *   limits?: typeof DEFAULT_PUBLIC_LIMITS,
 * }} deps
 */
export function publicCheckoutRouter({
  prisma,
  quotes,
  jobs,
  authSecret,
  rateLimitStore,
  limits = DEFAULT_PUBLIC_LIMITS,
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
            // Category names carry their ages ("Child (3–12)"), so naming both explains it.
            chosen
              ? `For age ${t.age}, choose ${charged.name}, not ${chosen.name}.`
              : `For age ${t.age}, choose ${charged.name}.`,
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
        booking: guestView(booking),
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
      res.set('Cache-Control', 'private, no-store').json({ booking: guestView(booking) });
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

  return router;
}
