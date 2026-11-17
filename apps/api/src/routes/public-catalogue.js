// @ts-check
/**
 * The PUBLIC catalogue (BKG-32): what a guest's browser reads to show tours and dates.
 * No sign-in. Every URL starts with the operator's slug, the same one their booking
 * links use (okapigo.app/irin-lagos-tours/…).
 *
 *   GET /public/:operatorSlug                                      the operator + tour cards
 *   GET /public/:operatorSlug/tours/:tourSlug                      one tour page
 *   GET /public/:operatorSlug/tours/:tourSlug/departures?from&to   bookable dates and seats
 *
 * How this differs from the staff API (/api/products):
 *   - only PUBLISHED tours exist here. A draft or archived tour answers 404, exactly like a
 *     tour that never existed, so outsiders can't discover unpublished work.
 *   - only ACTIVE prices and add-ons are listed.
 *   - its own serializers below, a whitelist built for guests: no internal ids that guests
 *     have no use for, no sold / held counts (how well a tour sells is the operator's
 *     business; guests see only "seats left").
 *   - Cache-Control headers. Tour content changes rarely, so browsers and CDNs may reuse it
 *     for a minute (less data on 3G). Seat counts change with every booking, so those are
 *     never cached.
 * Holds, bookings and payments for guests are added in stages 11b and 11c.
 */
import { Router } from 'express';
import { z } from 'zod';
import { listAvailability, currentPolicyVersion } from '@okapigo/db';
import { fromPriceKobo } from '@okapigo/shared/catalogue';
import { localDate, localTime } from '@okapigo/shared/time';
import { validate } from '../middleware/validate.js';
import { HttpError } from '../middleware/errors.js';
import { parseDateRange } from '../lib/date-range.js';

/** Slugs are lowercase words joined by hyphens (see packages/shared/src/slug.js). */
const Slug = z
  .string()
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const OperatorParams = z.object({ operatorSlug: Slug });
const TourParams = z.object({ operatorSlug: Slug, tourSlug: Slug });

/** Content: a browser or CDN may reuse it for 60 s. Seats: always ask again. */
const CACHE_CONTENT = 'public, max-age=60';
const CACHE_NEVER = 'no-store';

/** @param {import('@prisma/client').Operator} o */
function publicOperator(o) {
  return { slug: o.slug, name: o.name, currency: o.currency, websiteStyle: o.websiteStyle };
}

/**
 * A bookable date as a guest sees it.
 * @param {import('@prisma/client').Departure} d
 * @param {string} timeZone
 */
function publicDeparture(d, timeZone) {
  const seatsAvailable = Math.max(0, d.capacity - d.seatsSold - d.seatsHeld);
  return {
    id: d.id, // the checkout sends this back when it holds seats (stage 11b)
    startsAt: d.startsAt,
    endsAt: d.endsAt,
    localDate: localDate(d.startsAt, timeZone),
    localTime: localTime(d.startsAt, timeZone),
    seatsAvailable,
    soldOut: seatsAvailable === 0,
  };
}

/**
 * @param {{ prisma: import('@prisma/client').PrismaClient }} deps
 */
export function publicCatalogueRouter({ prisma }) {
  const router = Router();

  /** @param {string} slug */
  async function findOperator(slug) {
    const operator = await prisma.operator.findUnique({ where: { slug } });
    if (!operator) throw new HttpError(404, 'NOT_FOUND', 'Not found.');
    return operator;
  }

  /**
   * A published tour of this operator, or 404. `include` is passed through to Prisma.
   * @param {string} operatorId
   * @param {string} slug
   */
  async function findPublishedTour(operatorId, slug) {
    const tour = await prisma.product.findFirst({
      where: { operatorId, slug, status: 'published' },
      include: {
        priceCategories: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } },
        addOns: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } },
      },
    });
    if (!tour) throw new HttpError(404, 'NOT_FOUND', 'Tour not found.');
    return tour;
  }

  // --- The operator and its tour cards (catalogue page, website "Tours" section) ----------

  router.get('/public/:operatorSlug', validate({ params: OperatorParams }), async (req, res) => {
    const operator = await findOperator(req.params.operatorSlug);
    const tours = await prisma.product.findMany({
      where: { operatorId: operator.id, status: 'published' },
      include: { priceCategories: { where: { isActive: true } } },
      orderBy: { title: 'asc' },
    });

    // The NEXT date with a free seat, for every tour, in ONE query. DISTINCT ON keeps the
    // first row per product_id in the ORDER BY order, i.e. each tour's earliest bookable
    // departure. (Prisma's query builder can't express "capacity − sold − held > 0", which
    // compares columns with each other, so this one is raw SQL.)
    /** @type {Array<{ product_id: string, starts_at: Date, seats_available: number }>} */
    const next = await prisma.$queryRaw`
      SELECT DISTINCT ON (product_id)
             product_id, starts_at, capacity - seats_sold - seats_held AS seats_available
        FROM departures
       WHERE operator_id = ${operator.id}::uuid
         AND status = 'scheduled'
         AND starts_at > now()
         AND capacity - seats_sold - seats_held > 0
       ORDER BY product_id, starts_at`;
    const nextByTour = new Map(next.map((n) => [n.product_id, n]));

    res.set('Cache-Control', CACHE_CONTENT).json({
      operator: publicOperator(operator),
      tours: tours.map((t) => {
        const n = nextByTour.get(t.id);
        return {
          slug: t.slug,
          title: t.title,
          summary: t.summary,
          durationMinutes: t.durationMinutes,
          fromPriceKobo: fromPriceKobo(t.priceCategories),
          // First photo only: a card needs one picture, and every byte counts on 3G.
          photo: /** @type {Array<{ url: string, alt: string }>} */ (t.photos)[0] ?? null,
          nextDeparture: n
            ? {
                localDate: localDate(n.starts_at, operator.timeZone),
                localTime: localTime(n.starts_at, operator.timeZone),
                seatsAvailable: Number(n.seats_available),
              }
            : null, // "No dates yet": the card still shows, without a date
        };
      }),
    });
  });

  // --- One tour page ------------------------------------------------------------------------

  router.get(
    '/public/:operatorSlug/tours/:tourSlug',
    validate({ params: TourParams }),
    async (req, res) => {
      const operator = await findOperator(req.params.operatorSlug);
      const tour = await findPublishedTour(operator.id, req.params.tourSlug);

      // Guests must see the cancellation terms BEFORE paying. These are the terms a booking
      // made now would get (the policy's latest version, as createBooking uses).
      const version = tour.cancellationPolicyId
        ? await currentPolicyVersion(prisma, tour.cancellationPolicyId)
        : null;

      res.set('Cache-Control', CACHE_CONTENT).json({
        operator: publicOperator(operator),
        tour: {
          slug: tour.slug,
          title: tour.title,
          summary: tour.summary,
          description: tour.description,
          durationMinutes: tour.durationMinutes,
          meetingPoint: tour.meetingPoint,
          pickupPoints: tour.pickupPoints,
          stops: tour.stops,
          photos: tour.photos,
          inclusions: tour.inclusions,
          exclusions: tour.exclusions,
          whatToBring: tour.whatToBring,
          faqs: tour.faqs,
          fromPriceKobo: fromPriceKobo(tour.priceCategories),
          // "Reserve with 30%": whether a deposit MAY be offered. The exact amount and due
          // date depend on the basket and the date, so checkout gets them from the booking.
          depositBasisPoints: tour.depositBasisPoints,
          // The checkout's "who's coming" step: one counter per category.
          priceCategories: tour.priceCategories.map((c) => ({
            key: c.key,
            name: c.name,
            minAge: c.minAge,
            maxAge: c.maxAge,
            amountKobo: c.amountKobo,
          })),
          addOns: tour.addOns.map((a) => ({
            id: a.id,
            name: a.name,
            description: a.description,
            priceKobo: a.priceKobo,
          })),
          cancellationPolicy: version
            ? {
                rules: version.rules,
                noShowRefundBasisPoints: version.noShowRefundBasisPoints,
                // "Deposits are non-refundable" small print on the deposit choice.
                depositRefundable: version.depositRefundable,
              }
            : null,
        },
      });
    },
  );

  // --- Bookable dates -----------------------------------------------------------------------

  router.get(
    '/public/:operatorSlug/tours/:tourSlug/departures',
    validate({ params: TourParams }),
    async (req, res) => {
      const operator = await findOperator(req.params.operatorSlug);
      const tour = await findPublishedTour(operator.id, req.params.tourSlug);
      const { from, to } = parseDateRange(req.query, operator.timeZone);

      // Same query as the staff calendar: scheduled, not yet started, in the date range.
      // Sold-out dates are KEPT (marked soldOut) so the calendar can show them greyed out
      // instead of the date silently vanishing.
      const departures = await listAvailability(prisma, {
        operatorId: operator.id,
        productId: tour.id,
        from,
        to,
        timeZone: operator.timeZone,
      });

      res.set('Cache-Control', CACHE_NEVER).json({
        from,
        to,
        departures: departures.map((d) => publicDeparture(d, operator.timeZone)),
      });
    },
  );

  return router;
}
