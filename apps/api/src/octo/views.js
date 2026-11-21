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
 * Until when an OTA may cancel for a full refund: the policy's free-cancellation tier ("48 hours
 * before"); none: until the start. @param {{ rules: any[] } | null} policy
 */
export function cancellationCutoffOf(policy) {
  const free = (policy?.rules ?? [])
    .filter((r) => r.refundBasisPoints >= 10_000)
    .map((r) => r.hoursBefore);
  const hours = free.length ? Math.min(...free) : 0;
  return {
    cancellationCutoff: hours ? `${hours} hours before the start` : 'Until the start',
    cancellationCutoffAmount: hours,
    cancellationCutoffUnit: /** @type {const} */ ('hour'),
  };
}

/**
 * A tour as an OCTO Product.
 * @param {any} p  with priceCategories (active, in order), and its policy's current version
 * @param {{ timeZone: string, startTimes: string[], settings: { tax: any, fees: any[] }, commissionBasisPoints: number, pricing: boolean }} o
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
 * A moment as local ISO 8601 with its offset: "2026-12-05T09:00:00+01:00" (OCTO's
 * localDateTimeStart). @param {Date} at @param {string} timeZone
 */
export function localIso(at, timeZone) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(at)
      .map((x) => [x.type, x.value]),
  );
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  const offset = Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
  const sign = offset < 0 ? '-' : '+';
  const abs = Math.abs(offset);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${sign}${hh}:${mm}`;
}

/**
 * How a departure stands, in OCTO's words: SOLD_OUT, LIMITED (under half left), AVAILABLE.
 * @param {number} left @param {number} capacity
 */
export const statusOf = (left, capacity) =>
  left <= 0 ? 'SOLD_OUT' : left * 2 < capacity ? 'LIMITED' : 'AVAILABLE';

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
