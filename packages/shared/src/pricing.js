// @ts-check
/**
 * pricing.js — THE pricing pipeline (INV-24). Every price a guest sees comes from here.
 *
 * The website, the WhatsApp flow, the mock OTA and the staff app all call priceBasket().
 * Because it's one PURE function (no database, no clock, no randomness), the same basket
 * always gives the same total on every channel. That's the PRD's "identical results on
 * every channel".
 *
 * THE FIXED ORDER (changing it changes totals, so it's fixed and tested):
 *
 *   1. tickets   each traveller → their price category (by age, or by explicit key)
 *   2. add-ons   unit price × quantity
 *      ─────────────────────────────────── subtotal = tickets + add-ons
 *   3. promo     discount on the subtotal (percent or fixed), never more than the subtotal
 *   4. fees      on the discounted amount (e.g. a 2.5% service fee)
 *   5. tax       VAT on (discounted amount + fees), either INCLUDED in prices or ADDED on top
 *      ─────────────────────────────────── total
 *
 * ROUNDING RULES ("naira rounding"):
 *   - Everything is integer KOBO (see money.js). Catalogue prices are whole naira.
 *   - Every PERCENTAGE result (discount, fee, tax) is rounded to the nearest whole NAIRA,
 *     with halves rounding UP (₦0.50 → ₦1). So totals stay in whole naira and a guest never
 *     sees "₦62,499.87".
 *   - Percentages are given in BASIS POINTS (1 bp = 0.01%), so 7.5% = 750 and 2.5% = 250.
 *     Integers again, so there are no float rates like 0.075 to drift.
 */

import { findCategoryForAge } from './catalogue.js';

/** Thrown for baskets that can't be priced, with a machine-readable code. */
export class PricingError extends Error {
  /**
   * @param {string} code e.g. 'NO_PRICE_FOR_AGE'
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const KOBO_PER_NAIRA = 100;
const BASIS_POINTS = 10_000; // 100% = 10,000 bp

/**
 * (numerator / denominator) rounded to the nearest whole naira, halves up, returned in kobo.
 * Pure integer maths: no floating point anywhere.
 *
 * The trick for "round half up" with integers: floor((2n + d) / 2d) equals round(n / d).
 * Here the unit we round to is 1 naira = 100 kobo, so d is multiplied by 100 first.
 *
 * @param {number} numerator    an amount in kobo multiplied by something (e.g. × bp)
 * @param {number} denominator  what to divide by (e.g. 10,000 for basis points)
 */
export function divideRoundToNaira(numerator, denominator) {
  const d = denominator * KOBO_PER_NAIRA;
  return Math.floor((2 * numerator + d) / (2 * d)) * KOBO_PER_NAIRA;
}

/**
 * `basisPoints` of `kobo`, rounded to whole naira. percentOf(5_625_000, 250) → 140_600 (₦1,406)
 * @param {number} kobo
 * @param {number} basisPoints
 */
export function percentOf(kobo, basisPoints) {
  return divideRoundToNaira(kobo * basisPoints, BASIS_POINTS);
}

/**
 * @typedef {{ id?: string, key: string, name: string, minAge: number, maxAge: number | null, amountKobo: number, isActive?: boolean }} PriceCategoryInput
 * @typedef {{ id: string, name: string, priceKobo: number, isActive?: boolean }} AddOnInput
 * @typedef {{ age: number } | { categoryKey: string }} TravellerInput
 * @typedef {{ addOnId: string, quantity: number }} AddOnSelection
 * @typedef {{ code: string, type: 'percent', basisPoints: number } | { code: string, type: 'fixed', amountKobo: number }} Promo
 * @typedef {{ name: string, type: 'percent', basisPoints: number } | { name: string, type: 'fixed', amountKobo: number }} Fee
 * @typedef {{ name: string, basisPoints: number, inclusive: boolean }} Tax
 */

/**
 * Prices a basket.
 *
 * @param {{
 *   priceCategories: PriceCategoryInput[],
 *   addOns: AddOnInput[],
 *   travellers: TravellerInput[],
 *   addOnSelections?: AddOnSelection[],
 *   promo?: Promo | null,
 *   fees?: Fee[],
 *   tax?: Tax | null,
 * }} basket
 */
export function priceBasket({
  priceCategories,
  addOns,
  travellers,
  addOnSelections = [],
  promo = null,
  fees = [],
  tax = null,
}) {
  if (travellers.length === 0) {
    throw new PricingError('NO_TRAVELLERS', 'Add at least one traveller.');
  }
  const active = priceCategories.filter((c) => c.isActive !== false);

  // --- 1. Tickets: one per traveller, grouped by category for the breakdown -----------
  /** @type {Map<string, { category: PriceCategoryInput, quantity: number }>} */
  const byCategory = new Map();
  for (const traveller of travellers) {
    const category = resolveCategory(active, traveller);
    const entry = byCategory.get(category.key) ?? { category, quantity: 0 };
    entry.quantity += 1;
    byCategory.set(category.key, entry);
  }
  // Show lines in the catalogue's order (adult, child, infant), not the order typed in.
  const ticketLines = active
    .filter((c) => byCategory.has(c.key))
    .map((c) => {
      const { quantity } = /** @type {{ quantity: number }} */ (byCategory.get(c.key));
      return {
        type: /** @type {const} */ ('ticket'),
        categoryKey: c.key,
        priceCategoryId: c.id,
        label: c.name,
        quantity,
        unitKobo: c.amountKobo,
        totalKobo: c.amountKobo * quantity,
      };
    });

  // --- 2. Add-ons -------------------------------------------------------------------
  const seen = new Set();
  const addOnLines = addOnSelections.map(({ addOnId, quantity }) => {
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new PricingError(
        'INVALID_QUANTITY',
        'Add-on quantities must be whole numbers of 1 or more.',
      );
    }
    if (seen.has(addOnId)) {
      throw new PricingError(
        'DUPLICATE_ADD_ON',
        'Each add-on can appear once; use quantity instead.',
      );
    }
    seen.add(addOnId);
    const addOn = addOns.find((a) => a.id === addOnId && a.isActive !== false);
    if (!addOn) throw new PricingError('UNKNOWN_ADD_ON', 'That add-on is not available.');
    return {
      type: /** @type {const} */ ('addOn'),
      addOnId: addOn.id,
      label: addOn.name,
      quantity,
      unitKobo: addOn.priceKobo,
      totalKobo: addOn.priceKobo * quantity,
    };
  });

  const subtotalKobo = sum([...ticketLines, ...addOnLines].map((l) => l.totalKobo));

  // --- 3. Promo: never more than the subtotal (a total can't go negative) -------------
  let discountKobo = 0;
  if (promo) {
    const raw =
      promo.type === 'percent' ? percentOf(subtotalKobo, promo.basisPoints) : promo.amountKobo;
    discountKobo = Math.min(raw, subtotalKobo);
  }
  const discountedKobo = subtotalKobo - discountKobo;

  // --- 4. Fees: on the discounted amount ---------------------------------------------
  const feeLines = fees.map((fee) => ({
    label: fee.name,
    totalKobo: fee.type === 'percent' ? percentOf(discountedKobo, fee.basisPoints) : fee.amountKobo,
  }));
  const feesKobo = sum(feeLines.map((f) => f.totalKobo));
  const beforeTaxKobo = discountedKobo + feesKobo;

  // --- 5. Tax -------------------------------------------------------------------------
  // Inclusive: prices already contain the tax, so we work out the part that IS tax:
  //   tax = gross × rate / (100% + rate)        e.g. ₦10,750 at 7.5% contains ₦750 of VAT
  // Exclusive: tax is added on top:
  //   tax = net × rate
  let taxKobo = 0;
  if (tax) {
    taxKobo = tax.inclusive
      ? divideRoundToNaira(beforeTaxKobo * tax.basisPoints, BASIS_POINTS + tax.basisPoints)
      : percentOf(beforeTaxKobo, tax.basisPoints);
  }
  const totalKobo = tax && !tax.inclusive ? beforeTaxKobo + taxKobo : beforeTaxKobo;

  return {
    currency: 'NGN',
    lines: [...ticketLines, ...addOnLines],
    subtotalKobo,
    promo: promo ? { code: promo.code, discountKobo } : null,
    discountKobo,
    fees: feeLines,
    feesKobo,
    tax: tax
      ? {
          name: tax.name,
          basisPoints: tax.basisPoints,
          inclusive: tax.inclusive,
          amountKobo: taxKobo,
        }
      : null,
    taxKobo,
    totalKobo,
    travellerCount: travellers.length,
  };
}

/**
 * Picks a traveller's price category: by explicit key, or by age.
 * @param {PriceCategoryInput[]} active
 * @param {TravellerInput} traveller
 */
function resolveCategory(active, traveller) {
  if ('categoryKey' in traveller) {
    const byKey = active.find((c) => c.key === traveller.categoryKey);
    if (!byKey)
      throw new PricingError(
        'UNKNOWN_CATEGORY',
        `No "${traveller.categoryKey}" price for this tour.`,
      );
    return byKey;
  }
  const { age } = traveller;
  if (!Number.isInteger(age) || age < 0) {
    throw new PricingError('INVALID_AGE', 'Ages must be whole numbers of 0 or more.');
  }
  // The same age rule the catalogue uses (one definition, so they can't disagree).
  const byAge = findCategoryForAge(active, age);
  if (!byAge) throw new PricingError('NO_PRICE_FOR_AGE', `This tour has no price for age ${age}.`);
  return byAge;
}

/** @param {number[]} values */
function sum(values) {
  return values.reduce((a, b) => a + b, 0);
}
