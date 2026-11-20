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
import { originApproved } from '@okapigo/shared/schemas/website';
import { STYLES } from '@okapigo/shared/tokens';
import { Router } from 'express';
import { z } from 'zod';
import { listAvailability, seatsLeft } from '@okapigo/db';
import { localDate, localTime } from '@okapigo/shared/time';
import { validate } from '../middleware/validate.js';
import { HttpError } from '../middleware/errors.js';
import { parseDateRange } from '../lib/date-range.js';
import { loadCatalogueView, loadTourView, withoutInternals } from '../lib/public-views.js';

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

/**
 * A bookable date as a guest sees it.
 * @param {import('@prisma/client').Departure} d
 * @param {string} timeZone
 */
function publicDeparture(d, timeZone) {
  // Never more than its van or boat holds (16b).
  const seatsAvailable = seatsLeft(/** @type {any} */ (d));
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
   * A published tour of this operator (its id is enough for the departures), or 404.
   * @param {string} operatorId
   * @param {string} slug
   */
  async function findPublishedTour(operatorId, slug) {
    const tour = await prisma.product.findFirst({
      where: { operatorId, slug, status: 'published' },
      select: { id: true },
    });
    if (!tour) throw new HttpError(404, 'NOT_FOUND', 'Tour not found.');
    return tour;
  }

  // --- May this website show the booking widget? (stage 12h) --------------------------------
  // embed.js asks from the HOST page, so the browser sends that page's Origin, which page
  // scripts can't fake. The answer is only yes or no (the list itself stays private), and
  // any site may ask (CORS *). The real guard is the frame's own Content-Security-Policy.
  router.get(
    '/public/:operatorSlug/embed-check',
    validate({ params: OperatorParams }),
    async (req, res) => {
      const operator = await prisma.operator.findUnique({
        where: { slug: req.params.operatorSlug },
        select: { embedDomains: true, websiteStyle: true },
      });
      const ok = operator ? originApproved(operator.embedDomains, req.get('Origin')) : false;
      // The "Book now" button's corners follow the operator's style (designs: "radius from
      // the style"), so embed.js can draw it without knowing anything else.
      const style =
        STYLES[/** @type {keyof typeof STYLES} */ (operator?.websiteStyle)] ?? STYLES.lagoon;
      res
        .set('Access-Control-Allow-Origin', '*')
        .set('Vary', 'Origin')
        .set('Cache-Control', 'no-store')
        .json(ok ? { approved: true, buttonRadius: style.radius.button } : { approved: false });
    },
  );

  // --- The operator and its tour cards (catalogue page, website "Tours" section) ----------

  router.get('/public/:operatorSlug', validate({ params: OperatorParams }), async (req, res) => {
    const view = await loadCatalogueView(prisma, req.params.operatorSlug);
    if (!view) throw new HttpError(404, 'NOT_FOUND', 'Not found.');
    res.set('Cache-Control', CACHE_CONTENT).json(view);
  });

  // --- One tour page ------------------------------------------------------------------------

  router.get(
    '/public/:operatorSlug/tours/:tourSlug',
    validate({ params: TourParams }),
    async (req, res) => {
      const view = await loadTourView(prisma, req.params.operatorSlug, req.params.tourSlug);
      if (!view) throw new HttpError(404, 'NOT_FOUND', 'Tour not found.');
      res.set('Cache-Control', CACHE_CONTENT).json(withoutInternals(view));
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
