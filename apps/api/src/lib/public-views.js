// @ts-check
/**
 * public-views.js — what the PUBLIC sees of an operator and its tours (stages 11a, 12b).
 *
 * Used by two callers, so they can never disagree:
 *   - the public API (routes/public-catalogue.js): GET /public/:operator, …/tours/:tour
 *   - the share pages (routes/share-pages.js): the server-made HTML at /:operator and
 *     /:operator/:tour, which EMBEDS this same data so the guest web can draw the page at
 *     once, without a second request on a slow connection.
 *
 * Whitelists, field by field: only PUBLISHED tours, only ACTIVE prices and add-ons, no sales
 * figures, no internal ids guests have no use for.
 */
import { currentPolicyVersion } from '@okapigo/db';
import { fromPriceKobo } from '@okapigo/shared/catalogue';
import { describePolicy, scheduleSummary } from '@okapigo/shared/tour-facts';
import { localDate, localTime } from '@okapigo/shared/time';
import { OperatorPricingSchema } from '@okapigo/shared/schemas/pricing';

/**
 * @param {import('@prisma/client').Operator} o
 */
export function publicOperator(o) {
  const pricing = OperatorPricingSchema.safeParse(o.pricing);
  const tax = pricing.success ? pricing.data.tax : null;
  return {
    slug: o.slug,
    name: o.name,
    city: o.city,
    currency: o.currency,
    // Departure dates and times are the operator's local time ("Sat 5 Dec, 09:00").
    timeZone: o.timeZone,
    websiteStyle: o.websiteStyle,
    // "Prices include VAT": the tax's name when catalogue prices already include it.
    pricesInclude: tax?.inclusive ? tax.name : null,
  };
}

/**
 * Each published tour's next departure WITH A FREE SEAT, in one query. DISTINCT ON keeps the
 * first row per product_id in ORDER BY order, i.e. the earliest. (Raw SQL: Prisma can't
 * compare two columns, capacity − sold − held > 0.)
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} operatorId
 * @returns {Promise<Map<string, { startsAt: Date, seatsAvailable: number }>>}
 */
export async function nextDeparturesWithSeats(prisma, operatorId) {
  /** @type {Array<{ product_id: string, starts_at: Date, seats_available: number }>} */
  const rows = await prisma.$queryRaw`
    SELECT DISTINCT ON (product_id)
           product_id, starts_at, capacity - seats_sold - seats_held AS seats_available
      FROM departures
     WHERE operator_id = ${operatorId}::uuid
       AND status = 'scheduled'
       AND starts_at > now()
       AND capacity - seats_sold - seats_held > 0
     ORDER BY product_id, starts_at`;
  return new Map(
    rows.map((r) => [
      r.product_id,
      { startsAt: r.starts_at, seatsAvailable: Number(r.seats_available) },
    ]),
  );
}

/** The schedules that say when a tour runs ("Daily 09:00"). */
const ACTIVE_SCHEDULES = {
  where: { isActive: true },
  select: { daysOfWeek: true, times: true, isActive: true },
};

/**
 * The catalogue: the operator and a card per published tour. Null if no such operator.
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} operatorSlug
 */
export async function loadCatalogueView(prisma, operatorSlug) {
  const operator = await prisma.operator.findUnique({ where: { slug: operatorSlug } });
  if (!operator) return null;

  const tours = await prisma.product.findMany({
    where: { operatorId: operator.id, status: 'published' },
    include: {
      priceCategories: { where: { isActive: true } },
      schedules: ACTIVE_SCHEDULES,
    },
    orderBy: { title: 'asc' },
  });
  const next = await nextDeparturesWithSeats(prisma, operator.id);

  // Each tour's cancellation headline ("Free cancellation up to 48 hours before"). Tours
  // usually share one policy, so each version is read once.
  const policyIds = [...new Set(tours.map((t) => t.cancellationPolicyId).filter(Boolean))];
  const headlines = new Map(
    await Promise.all(
      policyIds.map(async (id) => {
        const v = await currentPolicyVersion(prisma, /** @type {string} */ (id));
        return /** @type {const} */ ([
          id,
          v ? describePolicy(/** @type {any} */ (v), operator.name).headline : null,
        ]);
      }),
    ),
  );

  return {
    operator: publicOperator(operator),
    tours: tours.map((t) => {
      const n = next.get(t.id);
      return {
        slug: t.slug,
        title: t.title,
        summary: t.summary,
        durationMinutes: t.durationMinutes,
        activityLabel: t.activityLabel,
        scheduleSummary: scheduleSummary(t.schedules),
        fromPriceKobo: fromPriceKobo(t.priceCategories),
        cancellationHeadline: t.cancellationPolicyId
          ? (headlines.get(t.cancellationPolicyId) ?? null)
          : null,
        // First photo only: a card needs one picture, and every byte counts on 3G.
        photo: /** @type {Array<{ url: string, alt: string }>} */ (t.photos)[0] ?? null,
        nextDeparture: n
          ? {
              localDate: localDate(n.startsAt, operator.timeZone),
              localTime: localTime(n.startsAt, operator.timeZone),
              seatsAvailable: n.seatsAvailable,
            }
          : null, // "No dates yet": the card still shows, without a date
      };
    }),
  };
}

/**
 * One published tour, with everything its page shows. Null if the operator or a PUBLISHED
 * tour with that slug doesn't exist (a draft looks exactly like a missing tour).
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} operatorSlug
 * @param {string} tourSlug
 */
export async function loadTourView(prisma, operatorSlug, tourSlug) {
  const operator = await prisma.operator.findUnique({ where: { slug: operatorSlug } });
  if (!operator) return null;
  const tour = await prisma.product.findFirst({
    where: { operatorId: operator.id, slug: tourSlug, status: 'published' },
    include: {
      priceCategories: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } },
      addOns: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } },
      schedules: ACTIVE_SCHEDULES,
    },
  });
  if (!tour) return null;

  // Guests must see the cancellation terms BEFORE paying: the terms a booking made now would
  // get (the policy's latest version, as createBooking uses).
  const version = tour.cancellationPolicyId
    ? await currentPolicyVersion(prisma, tour.cancellationPolicyId)
    : null;

  return {
    operator: publicOperator(operator),
    tour: {
      // Internal, needed by the share pages; withoutInternals() strips them before sending.
      _id: tour.id,
      _operatorId: operator.id,
      slug: tour.slug,
      title: tour.title,
      summary: tour.summary,
      description: tour.description,
      durationMinutes: tour.durationMinutes,
      activityLabel: tour.activityLabel,
      scheduleSummary: scheduleSummary(tour.schedules),
      // "Up to 15 guests": seats per departure unless a schedule says otherwise.
      maxGuests: tour.defaultCapacity,
      meetingPoint: tour.meetingPoint,
      pickupPoints: tour.pickupPoints,
      stops: tour.stops,
      photos: tour.photos,
      inclusions: tour.inclusions,
      exclusions: tour.exclusions,
      whatToBring: tour.whatToBring,
      faqs: tour.faqs,
      fromPriceKobo: fromPriceKobo(tour.priceCategories),
      // "Reserve with 30%": whether a deposit MAY be offered. The exact amount and due date
      // depend on the basket and the date, so checkout gets them from the booking (11c).
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
  };
}

/**
 * The view without internal fields (anything starting with "_"), ready to send.
 * @template {{ tour: Record<string, unknown> }} T
 * @param {T} view
 */
export function withoutInternals(view) {
  const tour = Object.fromEntries(Object.entries(view.tour).filter(([k]) => !k.startsWith('_')));
  return { ...view, tour };
}
