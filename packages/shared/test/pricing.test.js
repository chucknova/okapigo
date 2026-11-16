/**
 * The pricing pipeline (INV-24). Every expected number is worked out by hand in a comment
 * next to it, so you can check the arithmetic yourself.
 */
import { describe, it, expect } from 'vitest';
import { priceBasket, percentOf, divideRoundToNaira, PricingError } from '../src/pricing.js';
import { nairaToKobo as N } from '../src/money.js';

// Ìrìn's age bands, with the Heritage Walk's prices.
const HERITAGE = [
  {
    id: 'c-adult',
    key: 'adult',
    name: 'Adult (13+)',
    minAge: 13,
    maxAge: null,
    amountKobo: N(25000),
  },
  {
    id: 'c-child',
    key: 'child',
    name: 'Child (3–12)',
    minAge: 3,
    maxAge: 12,
    amountKobo: N(12500),
  },
  { id: 'c-infant', key: 'infant', name: 'Infant (0–2)', minAge: 0, maxAge: 2, amountKobo: 0 },
];
const FOOD_CRAWL = [
  {
    id: 'f-adult',
    key: 'adult',
    name: 'Adult (13+)',
    minAge: 13,
    maxAge: null,
    amountKobo: N(35000),
  },
  {
    id: 'f-child',
    key: 'child',
    name: 'Child (3–12)',
    minAge: 3,
    maxAge: 12,
    amountKobo: N(20000),
  },
];
const FOOD_ADD_ONS = [
  { id: 'a-plate', name: 'Extra tasting plate', priceKobo: N(5000) },
  { id: 'a-wine', name: 'Palm wine sampler', priceKobo: N(4000) },
];
const VAT_INCLUDED = { name: 'VAT', basisPoints: 750, inclusive: true };
const VAT_ADDED = { name: 'VAT', basisPoints: 750, inclusive: false };

describe('rounding helpers', () => {
  it('rounds percentages to the nearest whole naira', () => {
    // 2.5% of ₦56,250 = ₦1,406.25 → ₦1,406
    expect(percentOf(N(56250), 250)).toBe(N(1406));
  });

  it('rounds exactly half a naira UP', () => {
    // 5% of ₦10 = ₦0.50 → ₦1;  4.99% of ₦10 = ₦0.499 → ₦0
    expect(percentOf(N(10), 500)).toBe(N(1));
    expect(percentOf(N(10), 499)).toBe(0);
  });

  it('uses only integer maths (no 0.1 + 0.2 surprises)', () => {
    expect(divideRoundToNaira(N(10750) * 750, 10750)).toBe(N(750)); // VAT inside ₦10,750
  });
});

describe('the Heritage Walk: a family of four, VAT included', () => {
  const quote = priceBasket({
    priceCategories: HERITAGE,
    addOns: [],
    travellers: [{ age: 41 }, { age: 38 }, { age: 9 }, { age: 1 }],
    tax: VAT_INCLUDED,
  });

  it('prices each traveller by age and groups the lines', () => {
    expect(quote.lines.map((l) => [l.categoryKey, l.quantity, l.totalKobo])).toEqual([
      ['adult', 2, N(50000)],
      ['child', 1, N(12500)],
      ['infant', 1, 0], // infants travel free
    ]);
  });

  it('includes the VAT in the total rather than adding it', () => {
    // subtotal ₦62,500. VAT inside it = 62,500 × 7.5 / 107.5 = ₦4,360.47 → ₦4,360
    expect(quote.subtotalKobo).toBe(N(62500));
    expect(quote.taxKobo).toBe(N(4360));
    expect(quote.totalKobo).toBe(N(62500));
  });
});

describe('the Street Food Crawl: add-ons, promo, fee and VAT added on top', () => {
  // This one basket goes through every step, so it pins down the ORDER of the pipeline.
  const quote = priceBasket({
    priceCategories: FOOD_CRAWL,
    addOns: FOOD_ADD_ONS,
    travellers: [{ age: 30 }, { age: 29 }],
    addOnSelections: [{ addOnId: 'a-plate', quantity: 3 }],
    promo: { code: 'LAGOS10', type: 'percent', basisPoints: 1000 },
    fees: [{ name: 'Service fee', type: 'percent', basisPoints: 250 }],
    tax: VAT_ADDED,
  });

  it('1–2. tickets + add-ons = subtotal', () => {
    // 2 × ₦35,000 + 3 × ₦5,000 = ₦85,000
    expect(quote.subtotalKobo).toBe(N(85000));
  });

  it('3. promo comes off the subtotal', () => {
    // 10% of ₦85,000 = ₦8,500
    expect(quote.discountKobo).toBe(N(8500));
    expect(quote.promo).toEqual({ code: 'LAGOS10', discountKobo: N(8500) });
  });

  it('4. fees are charged on the DISCOUNTED amount, halves rounding up', () => {
    // 2.5% of ₦76,500 = ₦1,912.50 → ₦1,913   (on the undiscounted ₦85,000 it would be ₦2,125)
    expect(quote.feesKobo).toBe(N(1913));
  });

  it('5. VAT is added on discounted amount + fees', () => {
    // 7.5% of (₦76,500 + ₦1,913 = ₦78,413) = ₦5,880.98 → ₦5,881
    expect(quote.taxKobo).toBe(N(5881));
    // ₦78,413 + ₦5,881 = ₦84,294
    expect(quote.totalKobo).toBe(N(84294));
  });
});

describe('edge cases', () => {
  it('a fixed promo bigger than the basket brings it to zero, never below', () => {
    const quote = priceBasket({
      priceCategories: HERITAGE,
      addOns: [],
      travellers: [{ age: 5 }],
      promo: { code: 'FREEKID', type: 'fixed', amountKobo: N(20000) },
    });
    expect(quote.discountKobo).toBe(N(12500));
    expect(quote.totalKobo).toBe(0);
  });

  it('accepts an explicit category instead of an age', () => {
    const quote = priceBasket({
      priceCategories: HERITAGE,
      addOns: [],
      travellers: [{ categoryKey: 'adult' }],
    });
    expect(quote.totalKobo).toBe(N(25000));
  });

  it('without tax or fees, total = subtotal − discount', () => {
    const quote = priceBasket({
      priceCategories: HERITAGE,
      addOns: [],
      travellers: [{ age: 20 }],
      promo: { code: 'X', type: 'fixed', amountKobo: N(1000) },
    });
    expect(quote).toMatchObject({ taxKobo: 0, feesKobo: 0, tax: null, totalKobo: N(24000) });
  });
});

describe('baskets that cannot be priced', () => {
  /** Runs priceBasket and returns the PricingError code it throws. */
  function errorCode(basket) {
    try {
      priceBasket({ priceCategories: HERITAGE, addOns: FOOD_ADD_ONS, ...basket });
    } catch (err) {
      expect(err).toBeInstanceOf(PricingError);
      return err.code;
    }
    throw new Error('expected a PricingError');
  }

  it.each([
    ['no travellers', { travellers: [] }, 'NO_TRAVELLERS'],
    [
      'an age no price covers',
      { travellers: [{ age: 1 }], priceCategories: FOOD_CRAWL },
      'NO_PRICE_FOR_AGE',
    ],
    ['a negative age', { travellers: [{ age: -1 }] }, 'INVALID_AGE'],
    ['an unknown category', { travellers: [{ categoryKey: 'student' }] }, 'UNKNOWN_CATEGORY'],
    [
      'an unknown add-on',
      { travellers: [{ age: 30 }], addOnSelections: [{ addOnId: 'nope', quantity: 1 }] },
      'UNKNOWN_ADD_ON',
    ],
    [
      'a zero quantity',
      { travellers: [{ age: 30 }], addOnSelections: [{ addOnId: 'a-plate', quantity: 0 }] },
      'INVALID_QUANTITY',
    ],
    [
      'the same add-on twice',
      {
        travellers: [{ age: 30 }],
        addOnSelections: [
          { addOnId: 'a-plate', quantity: 1 },
          { addOnId: 'a-plate', quantity: 2 },
        ],
      },
      'DUPLICATE_ADD_ON',
    ],
  ])('refuses %s', (_label, basket, code) => {
    expect(errorCode(basket)).toBe(code);
  });

  it('ignores archived prices and add-ons', () => {
    const archivedChild = HERITAGE.map((c) => (c.key === 'child' ? { ...c, isActive: false } : c));
    expect(errorCode({ priceCategories: archivedChild, travellers: [{ age: 7 }] })).toBe(
      'NO_PRICE_FOR_AGE',
    );
  });
});

describe('properties that must hold for ANY basket', () => {
  // A tiny seeded random generator: "random" baskets, but the same ones every run, so a
  // failure can always be reproduced. (This is the idea behind property-based testing.)
  let seed = 42;
  const rand = (n) => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    return seed % n;
  };

  it('500 random baskets: whole-naira results, sensible bounds, totals add up', () => {
    for (let i = 0; i < 500; i++) {
      const basket = {
        priceCategories: FOOD_CRAWL,
        addOns: FOOD_ADD_ONS,
        travellers: Array.from({ length: 1 + rand(8) }, () => ({ age: 3 + rand(70) })),
        addOnSelections: rand(2) ? [{ addOnId: 'a-plate', quantity: 1 + rand(5) }] : [],
        promo: rand(2) ? { code: 'P', type: 'percent', basisPoints: rand(5001) } : null,
        fees: rand(2) ? [{ name: 'Fee', type: 'percent', basisPoints: rand(1001) }] : [],
        tax: [null, VAT_INCLUDED, VAT_ADDED][rand(3)],
      };
      const q = priceBasket(basket);

      for (const amount of [q.subtotalKobo, q.discountKobo, q.feesKobo, q.taxKobo, q.totalKobo]) {
        expect(Number.isInteger(amount)).toBe(true);
        expect(amount % 100).toBe(0); // whole naira, always
        expect(amount).toBeGreaterThanOrEqual(0);
      }
      expect(q.discountKobo).toBeLessThanOrEqual(q.subtotalKobo);
      const beforeTax = q.subtotalKobo - q.discountKobo + q.feesKobo;
      expect(q.totalKobo).toBe(
        basket.tax && !basket.tax.inclusive ? beforeTax + q.taxKobo : beforeTax,
      );
      // Same input → same output (no hidden state).
      expect(priceBasket(basket)).toEqual(q);
    }
  });
});
