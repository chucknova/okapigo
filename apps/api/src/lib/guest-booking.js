// @ts-check
/**
 * guest-booking.js — holding seats and creating a booking FOR A GUEST, the same way on every
 * channel: the website's checkout (stage 11b) and the WhatsApp conversation (session 13).
 * One place, so a guest gets the same prices, the same rules and the same seats wherever they
 * book (PRD: "the same prices and availability in both").
 *
 *   1. the departure must be on sale (a published tour of THIS operator)
 *   2. price the basket and apply the booking rules (no children without an adult…)
 *   3. each traveller's category: from their AGE when given (it must match the counter they
 *      chose); without an age, only an adult category (decided 2026-11-18: on WhatsApp only
 *      children and infants give an age)
 *   4. hold the seats and create the booking, all or nothing (row lock inside createBooking)
 *   5. schedule the hold's expiry (the sweeper catches it if this fails)
 */
import { createBooking } from '@okapigo/db';
import { findCategoryForAge, isAdultCategory } from '@okapigo/shared/catalogue';
import { HttpError } from '../middleware/errors.js';
import { toHttp } from '../routes/bookings.js';

/** "Child (3–12)" → "Child": the name without its age range. @param {{ name: string }} c */
export function plainName(c) {
  return c.name.replace(/\s*\(.*\)\s*$/, '');
}

/** "3–12" or "13 and over". @param {{ minAge: number, maxAge: number | null }} c */
export function ageRange(c) {
  return c.maxAge === null ? `${c.minAge} and over` : `${c.minAge}–${c.maxAge}`;
}

/**
 * @typedef {{ name: string, age?: number | null, categoryKey?: string, dietaryNeeds?: string }} GuestTraveller
 */

/**
 * @param {{
 *   prisma: import('@prisma/client').PrismaClient,
 *   quotes: ReturnType<typeof import('../pricing/quote-service.js').createQuoteService>,
 *   jobs: { scheduleHoldExpiry: (holdId: string, at: Date) => Promise<void> },
 *   log: { warn: Function },
 * }} deps
 * @param {{
 *   operator: import('@prisma/client').Operator,
 *   departureId: string,
 *   channel: 'web' | 'whatsapp',
 *   holdMinutes: number,
 *   lead: { name: string, email?: string | null, phone?: string | null, marketingConsent?: boolean },
 *   travellers: GuestTraveller[],
 *   addOns?: Array<{ addOnId: string, quantity: number }>,
 *   pickupPoint?: string | null,
 *   attribution?: Record<string, string>,
 * }} input
 * @returns {Promise<{ bookingId: string, holdExpiresAt: Date }>}
 */
export async function bookForGuest({ prisma, quotes, jobs, log }, input) {
  const { operator, departureId, travellers, addOns = [] } = input;

  // 1. On sale: this operator's departure, of a PUBLISHED tour (no booking a draft by guessing
  //    a departure id).
  const departure = await prisma.departure.findFirst({
    where: { id: departureId, operatorId: operator.id, product: { status: 'published' } },
  });
  if (!departure) throw new HttpError(404, 'NOT_FOUND', 'Departure not found.');

  // 2. Price it, and apply the booking rules.
  const { quote, priceCategories } = await quotes.quoteForBooking({
    operatorId: operator.id,
    productId: departure.productId,
    travellers: travellers.map((t) =>
      t.age !== null && t.age !== undefined
        ? { age: t.age }
        : { categoryKey: /** @type {string} */ (t.categoryKey) },
    ),
    addOns,
  });

  // 3. Each traveller's category.
  const withCategories = travellers.map((t, i) => {
    if (t.age === null || t.age === undefined) {
      const chosen = priceCategories.find((c) => c.key === t.categoryKey);
      // Only adults may come without an age: a child's age decides their price, and the
      // server must check it (stage 12d).
      if (!chosen || !isAdultCategory(chosen)) {
        throw new HttpError(400, 'AGE_REQUIRED', 'Children and infants need an age.', {
          traveller: i,
        });
      }
      return { ...t, age: null, categoryKey: chosen.key };
    }
    // The AGE decides the price. If the guest also said which counter they came from, they
    // must agree, or they'd pay a different price than the one they saw.
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

  // 4. Hold + booking, all or nothing.
  let created;
  try {
    created = await createBooking(prisma, {
      operatorId: operator.id,
      operatorSlug: operator.slug,
      departureId,
      productId: departure.productId,
      channel: input.channel,
      attribution: input.attribution,
      lead: {
        name: input.lead.name,
        email: input.lead.email ?? null,
        phone: input.lead.phone ?? null,
        marketingConsent: input.lead.marketingConsent ?? false,
      },
      travellers: /** @type {any} */ (withCategories),
      addOns: addOnLines.map((l) => ({
        addOnId: l.addOnId,
        quantity: l.quantity,
        unitKobo: l.unitKobo,
      })),
      quote,
      totalKobo: quote.totalKobo,
      holdMinutes: input.holdMinutes,
      pickupPointName: input.pickupPoint ?? null,
      actor: { type: 'guest' },
    });
  } catch (err) {
    throw toHttp(err);
  }

  // 5. The hold's expiry job.
  try {
    await jobs.scheduleHoldExpiry(created.hold.id, created.hold.expiresAt);
  } catch (err) {
    log.warn(
      { err, holdId: created.hold.id },
      'could not schedule hold expiry; sweeper will handle it',
    );
  }
  return { bookingId: created.booking.id, holdExpiresAt: created.hold.expiresAt };
}
