// @ts-check
/**
 * views.js — our tours, prices and departures as OCTO shapes (session 17a). Pure: no database,
 * so each rule is tested on its own, and the contract tests check the whole answers against
 * @okapigo/shared/octo.
 *
 *   our tour            → an OCTO Product with ONE option ("DEFAULT": the tour as sold)
 *   a price category    → a Unit (its key is the unit id: "adult", "child", "infant")
 *   a departure         → an Availability (its id is the departure's id)
 *   a price             → OCTO Pricing: retail = what the guest pays (tax included), net =
 *                         what the OTA owes us (retail minus its commission), in kobo
 *                         (currencyPrecision 2)
 */
import { priceBasket } from '@okapigo/shared/pricing';
import { percentOf, divideRoundToNaira } from '@okapigo/shared/pricing';
import { policyLine } from '@okapigo/shared/tour-facts';
import { localIso, statusOf } from '@okapigo/shared/octo';
import { slugify } from '@okapigo/shared/slug';

export { localIso, statusOf };

export const OPTION_ID = 'DEFAULT';
const CURRENCY = 'NGN';

/**
 * A price category's OCTO unit type: no upper age is an adult (a senior from 60); else by its
 * oldest age. @param {{ minAge: number, maxAge: number | null }} c
 */
export function unitTypeOf(c) {
  if (c.maxAge === null) return c.minAge >= 60 ? 'SENIOR' : 'ADULT';
  if (c.maxAge <= 2) return 'INFANT';
  if (c.maxAge <= 12) return 'CHILD';
  if (c.maxAge <= 17) return 'YOUTH';
  return 'OTHER';
}

/**
 * OCTO Pricing for an amount the guest pays (retail, tax included).
 * @param {number} retail kobo @param {number} taxKobo the tax inside it
 * @param {number} commissionBasisPoints the OTA's share
 * @param {string | null} taxName
 */
export function pricingOf(retail, taxKobo, commissionBasisPoints, taxName) {
  const net = retail - percentOf(retail, commissionBasisPoints);
  return {
    original: retail,
    retail,
    net,
    currency: CURRENCY,
    currencyPrecision: 2,
    includedTaxes:
      taxName && taxKobo > 0
        ? [
            {
              name: taxName,
              retail: taxKobo,
              original: taxKobo,
              // The tax inside the net amount, in the same proportion.
              net: retail === 0 ? 0 : divideRoundToNaira(net * taxKobo, retail),
            },
          ]
        : [],
  };
}

/**
 * What a basket costs, as OCTO Pricing (the same pipeline as every other channel: INV-24).
 * @param {any[]} categories active ones @param {Array<{ categoryKey: string }>} travellers
 * @param {{ tax: any, fees: any[] }} settings @param {number} commissionBasisPoints
 */
export function basketPricing(categories, travellers, settings, commissionBasisPoints) {
  const quote = priceBasket({
    priceCategories: categories,
    addOns: [],
    travellers,
    fees: settings.fees,
    tax: settings.tax,
  });
  return pricingOf(
    quote.totalKobo,
    quote.taxKobo ?? 0,
    commissionBasisPoints,
    settings.tax?.name ?? null,
  );
}

/**
 * The units: one per active price category. Children and infants come with an adult (decided
 * 2026-11-17): `accompaniedBy` names the adult units.
 * @param {any[]} categories active, in order @param {{ tax: any, fees: any[] }} settings
 * @param {number} commissionBasisPoints @param {boolean} pricing
 */
export function unitsOf(categories, settings, commissionBasisPoints, pricing) {
  const adults = categories.filter((c) => c.maxAge === null).map((c) => c.key);
  return categories.map((c) => ({
    id: c.key,
    internalName: c.name,
    reference: c.key,
    type: unitTypeOf(c),
    title: c.name,
    requiredContactFields: [],
    restrictions: {
      minAge: c.minAge,
      maxAge: c.maxAge ?? 120,
      idRequired: false,
      minQuantity: null,
      maxQuantity: null,
      paxCount: 1,
      accompaniedBy: c.maxAge === null ? [] : adults,
    },
    ...(pricing && {
      pricingFrom: [
        basketPricing(categories, [{ categoryKey: c.key }], settings, commissionBasisPoints),
      ],
    }),
  }));
}

/**
 * Until when an OTA may cancel: until the start, with the refund the business's policy gives
 * (decided 2026-11-21: an OTA's cancellation follows the policy until the start).
 * @param {{ rules: any[] } | null} policy
 */
export function cancellationCutoffOf(policy) {
  return {
    cancellationCutoff: policy?.rules?.length
      ? `Until the start. Refund by the policy: ${policyLine(policy)}`
      : 'Until the start. No refunds are set: the business decides each one.',
    cancellationCutoffAmount: 0,
    cancellationCutoffUnit: /** @type {const} */ ('hour'),
  };
}

// --- Content and pickups (17d-1: OCTO's optional capabilities, for an OTA's pages) -----------

/** An address as OCTO's place. @param {{ address?: string, lat?: number, lng?: number } | null | undefined} a */
const placeOf = (a) => ({
  latitude: a?.lat ?? null,
  longitude: a?.lng ?? null,
  postalAddress: {
    streetAddress: a?.address ?? null,
    addressLocality: null,
    addressRegion: null,
    postalCode: null,
    addressCountry: 'NG',
    postOfficeBoxNumber: null,
  },
});

/** A picture's media type, from its address. @param {string} url */
const mediaTypeOf = (url) =>
  /\.png($|\?)/i.test(url) ? 'image/png' : /\.webp($|\?)/i.test(url) ? 'image/webp' : 'image/jpeg';

/**
 * What the `content` capability adds to a product: what's included and not, what to bring and
 * when to arrive, the stops, the cancellation terms (OCTO's `features`); where to meet (a
 * START location); the tour's label ("Boat", "Walking": `categoryLabels`); its photos.
 * @param {any} p  with its policy's current version
 */
export function contentOf(p) {
  /** @param {string[] | undefined} list @param {string} type */
  const features = (list, type) =>
    (list ?? []).map((shortDescription) => ({ shortDescription, type }));
  const mp = /** @type {any} */ (p.meetingPoint);
  return {
    features: [
      ...(p.stops ?? []).map((/** @type {any} */ s) => ({
        shortDescription: s.name,
        type: 'HIGHLIGHT',
      })),
      ...features(p.inclusions, 'INCLUSION'),
      ...features(p.exclusions, 'EXCLUSION'),
      ...features(p.whatToBring, 'PREARRIVAL_INFORMATION'),
      ...(p.arriveMinutesEarly
        ? [
            {
              shortDescription: `Be at the meeting point ${p.arriveMinutesEarly} minutes before the start`,
              type: 'PREARRIVAL_INFORMATION',
            },
          ]
        : []),
      ...(p.policy?.rules?.length
        ? [{ shortDescription: policyLine(p.policy), type: 'CANCELLATION_TERM' }]
        : []),
    ],
    locations: mp?.name
      ? [
          {
            title: mp.name,
            shortDescription: mp.note ?? null,
            types: ['START'],
            minutesTo: null,
            minutesAt: null,
            place: placeOf(mp),
          },
        ]
      : [],
    categoryLabels: p.activityLabel ? [p.activityLabel] : [],
    media: (p.photos ?? []).map((/** @type {any} */ ph) => ({
      src: ph.url,
      type: mediaTypeOf(ph.url),
      rel: 'GALLERY',
      title: ph.alt ?? null,
      caption: null,
      copyright: null,
    })),
  };
}

/**
 * A booking's pickup, in the `pickups` capability's words: its location and its time on the
 * day ("2026-12-09T07:30:00+01:00"). @param {any} b  with departure and pickupPoint
 * @param {string} timeZone
 */
export function bookingPickupOf(b, timeZone) {
  const pt = /** @type {{ name: string, address?: string, time?: string } | null} */ (
    b.pickupPoint
  );
  const day = localIso(b.departure.startsAt, timeZone);
  const at = pt?.time ? `${day.slice(0, 11)}${pt.time}:00${day.slice(19)}` : null;
  return {
    pickupRequested: Boolean(pt),
    pickupLocationId: pt ? slugify(pt.name) : null,
    pickupNotes: null,
    localPickupDateTimeStart: at,
    localPickupDateTimeEnd: at,
    pickupLocation: pt ? pickupLocationOf(pt) : null,
  };
}

/** A pickup point as OCTO's pickup location. @param {{ name: string, address?: string, time?: string }} pt */
export const pickupLocationOf = (pt) => ({
  id: slugify(pt.name),
  title: pt.name,
  shortDescription:
    [pt.address, pt.time && `pickup at ${pt.time}`].filter(Boolean).join(' · ') || null,
  place: placeOf(pt),
});

/** What the `pickups` capability adds to the option. @param {any} p */
export function pickupsOf(p) {
  const points = /** @type {any[]} */ (p.pickupPoints ?? []);
  return {
    pickupAvailable: points.length > 0,
    pickupRequired: points.length > 0,
    pickupLocations: points.map(pickupLocationOf),
  };
}

/**
 * The refund the policy gives, tier by tier: [{ hoursBefore: 48, refundPercent: 100 }, …].
 * NOT IN THE SPEC (OCTO has only the cutoff, in words; OTAs ignore what they don't know): an
 * OTA can say "Full refund until Thu 10 Dec, 10:00" and preview a cancellation's refund.
 * @param {{ rules: Array<{ hoursBefore: number, refundBasisPoints: number }> } | null} policy
 */
export const refundRulesOf = (policy) =>
  policy?.rules?.length
    ? [...policy.rules]
        .sort((a, b) => b.hoursBefore - a.hoursBefore)
        .map((r) => ({ hoursBefore: r.hoursBefore, refundPercent: r.refundBasisPoints / 100 }))
    : null;

/**
 * A tour as an OCTO Product.
 * @param {any} p  with priceCategories (active, in order), and its policy's current version
 * @param {{ timeZone: string, startTimes: string[], settings: { tax: any, fees: any[] }, commissionBasisPoints: number, pricing: boolean, content?: boolean, pickups?: boolean }} o
 */
export function productOf(p, o) {
  const units = unitsOf(p.priceCategories, o.settings, o.commissionBasisPoints, o.pricing);
  return {
    id: p.id,
    internalName: p.title,
    reference: p.slug,
    locale: 'en',
    timeZone: o.timeZone,
    allowFreesale: false,
    instantConfirmation: true,
    instantDelivery: true,
    availabilityRequired: true,
    availabilityType: 'START_TIME',
    deliveryFormats: ['QRCODE'],
    deliveryMethods: ['TICKET'],
    redemptionMethod: 'DIGITAL',
    title: p.title,
    shortDescription: p.summary,
    description: p.description,
    durationMinutesFrom: p.durationMinutes,
    durationMinutesTo: null,
    faqs: (p.faqs ?? []).map((/** @type {any} */ f) => ({
      question: f.question,
      answer: f.answer,
    })),
    ...(o.content && contentOf(p)),
    ...(o.pricing && {
      defaultCurrency: CURRENCY,
      availableCurrencies: [CURRENCY],
      pricingPer: 'UNIT',
    }),
    options: [
      {
        id: OPTION_ID,
        default: true,
        internalName: p.title,
        reference: null,
        title: p.title,
        // At least one (the spec's minimum): the tour's start times, or 09:00 before it has any.
        availabilityLocalStartTimes: o.startTimes.length ? o.startTimes : ['09:00'],
        ...cancellationCutoffOf(p.policy ?? null),
        // Not in the spec: the policy's tiers (refundRulesOf).
        refundRules: refundRulesOf(p.policy ?? null),
        ...(o.pickups && pickupsOf(p)),
        requiredContactFields: ['firstName', 'lastName', 'emailAddress'],
        restrictions: { minUnits: 1, maxUnits: null },
        units,
        ...(o.pricing && {
          pricingFrom: [
            units.length
              ? /** @type {any} */ (units[0]).pricingFrom[0]
              : pricingOf(0, 0, o.commissionBasisPoints, null),
          ],
        }),
      },
    ],
  };
}

/**
 * A departure as an OCTO Availability.
 * @param {{ id: string, startsAt: Date, endsAt: Date, capacity: number, seatsAvailable: number }} d
 * @param {{ timeZone: string, pax: number, unitPricing?: any[], pricing?: any }} o
 *   pax: seats the OTA asked about (0: just looking)
 */
export function availabilityOf(d, o) {
  const left = Math.max(0, d.seatsAvailable);
  return {
    id: d.id,
    localDateTimeStart: localIso(d.startsAt, o.timeZone),
    localDateTimeEnd: localIso(d.endsAt, o.timeZone),
    // Bookable until the start, like the website.
    utcCutoffAt: d.startsAt.toISOString(),
    allDay: false,
    available: left > 0 && left >= o.pax,
    status: statusOf(left, d.capacity),
    vacancies: left,
    capacity: d.capacity,
    maxUnits: left,
    openingHours: [],
    ...(o.unitPricing && { unitPricing: o.unitPricing }),
    ...(o.pricing && { pricing: o.pricing }),
  };
}

// --- Bookings (17b) ---------------------------------------------------------------------------

/** OCTO's contact, every key present. @param {Partial<Record<string, string | null>>} [c] */
export const contactOf = (c = {}) => ({
  fullName: c.fullName ?? null,
  firstName: c.firstName ?? null,
  lastName: c.lastName ?? null,
  emailAddress: c.emailAddress ?? null,
  phoneNumber: c.phoneNumber ?? null,
  locales: [],
  postalCode: null,
  country: null,
  notes: null,
});

/** "Funmi Adeyemi" → first and last. @param {string} name */
export function splitName(name) {
  const parts = name.trim().split(/\s+/);
  return {
    firstName: parts[0] ?? null,
    lastName: parts.length > 1 ? parts.slice(1).join(' ') : null,
  };
}

/**
 * The refund OCTO reports for a cancellation: FULL (everything paid back), PARTIAL, NONE.
 * @param {number} refundKobo @param {number} paidKobo
 */
export const refundKindOf = (refundKobo, paidKobo) =>
  refundKobo <= 0 ? 'NONE' : refundKobo >= paidKobo ? 'FULL' : 'PARTIAL';

/**
 * One of our bookings as an OCTO Booking.
 * @param {{
 *   channelBooking: any,         the OCTO side (uuid, unit items, commission, confirmed)
 *   booking: any,                with hold, departure, travellers (in order)
 *   status: string,              its OCTO status (octoStatusOf)
 *   cancelled: { reason: string | null, at: Date } | null,
 *   timeZone: string,
 *   seatsAvailable: number,      what's left on its departure now
 *   ticketCode: string | null,   the signed QR code (given only once confirmed: the voucher)
 *   tripUrl: string | null,      the guest's trip page, once confirmed
 *   pricing: boolean,
 *   taxName: string | null,
 *   now: Date,
 * }} o
 */
export function bookingOf(o) {
  const { channelBooking: cb, booking: b } = o;
  const lead = cb.confirmedAt
    ? contactOf({
        fullName: b.leadName,
        ...splitName(b.leadName),
        emailAddress: b.leadEmail,
        phoneNumber: b.leadPhone,
      })
    : contactOf();
  const items = /** @type {Array<{ uuid: string, unitId: string }>} */ (cb.unitItems);
  return {
    id: cb.id,
    uuid: cb.uuid,
    testMode: false,
    resellerReference: cb.resellerReference ?? null,
    supplierReference: b.reference,
    status: o.status,
    utcCreatedAt: cb.createdAt.toISOString(),
    utcUpdatedAt: (b.updatedAt > cb.updatedAt ? b.updatedAt : cb.updatedAt).toISOString(),
    utcExpiresAt: o.status === 'ON_HOLD' ? b.hold.expiresAt.toISOString() : null,
    utcRedeemedAt: null,
    utcConfirmedAt: cb.confirmedAt ? cb.confirmedAt.toISOString() : null,
    productId: b.productId,
    optionId: OPTION_ID,
    cancellable:
      (o.status === 'ON_HOLD' || o.status === 'CONFIRMED') && b.departure.startsAt > o.now,
    cancellation:
      o.status === 'CANCELLED' && o.cancelled
        ? {
            refund: refundKindOf(b.refundDueKobo, b.amountPaidKobo),
            reason: o.cancelled.reason,
            utcCancelledAt: o.cancelled.at.toISOString(),
            // Not in the spec (17d-2): how much went back (the refund kind says only FULL,
            // PARTIAL or NONE), so an OTA can say "₦51,000 refunded".
            refundAmount: b.refundDueKobo,
          }
        : null,
    freesale: false,
    availabilityId: b.departureId,
    availability: availabilityOf(
      { ...b.departure, seatsAvailable: o.seatsAvailable },
      { timeZone: o.timeZone, pax: 0 },
    ),
    contact: lead,
    notes: b.notes || null,
    deliveryMethods: ['TICKET'],
    voucher: o.ticketCode
      ? {
          redemptionMethod: 'DIGITAL',
          utcRedeemedAt: null,
          deliveryOptions: [{ deliveryFormat: 'QRCODE', deliveryValue: o.ticketCode }],
        }
      : null,
    unitItems: items.map((u, i) => {
      const t = b.travellers[i];
      return {
        uuid: u.uuid,
        resellerReference: null,
        supplierReference: t?.id ?? null,
        unitId: u.unitId,
        status: o.status,
        utcRedeemedAt: t?.checkedInAt ? t.checkedInAt.toISOString() : null,
        contact: contactOf({ fullName: t?.name || null }),
        ticket: null,
      };
    }),
    ...(o.pricing && {
      pricing: pricingOf(
        b.totalKobo,
        /** @type {any} */ (b.quote)?.taxKobo ?? 0,
        cb.commissionBasisPoints,
        o.taxName,
      ),
    }),
    // The `pickups` capability: where the van collects them, and when (17d-1).
    ...(o.pickups && bookingPickupOf(b, o.timeZone)),
    // Not in the spec (17d-2): what cancelling now would give back ({ amount, percent,
    // hoursBefore }), while it can still be cancelled; null otherwise.
    refundIfCancelledNow: o.refundIfCancelledNow ?? null,
    // Not in the spec (OTAs ignore what they don't know): the guest's trip page, to pass on.
    ...(o.tripUrl && { tripUrl: o.tripUrl }),
  };
}
