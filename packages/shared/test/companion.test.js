/**
 * Stage 18a: what the AI companion may answer from (the business's own content only), its
 * rules, the key kept answers are filed under, and the questions to tap.
 */
import { describe, it, expect } from 'vitest';
import {
  companionFacts,
  companionInstructions,
  companionSuggestions,
  questionKey,
  COMPANION_LIMITS,
} from '../src/companion.js';

/** A paid Heritage Walk booking for two, as the trip page's server loads it. */
function booking(/** @type {any} */ over = {}) {
  return {
    reference: 'ILT-6WQ3PZ',
    totalKobo: 5_000_000,
    amountPaidKobo: 5_000_000,
    pickupPoint: null,
    channelBooking: null,
    departure: { startsAt: new Date('2026-12-05T08:00:00Z') }, // 09:00 in Lagos
    travellers: [
      { name: 'Adaeze Okafor', dietaryNeeds: null },
      { name: 'Tunde Bello', dietaryNeeds: 'No groundnuts' },
    ],
    policyVersion: {
      rules: [
        { hoursBefore: 48, refundBasisPoints: 10_000 },
        { hoursBefore: 24, refundBasisPoints: 5_000 },
      ],
      noShowRefundBasisPoints: 0,
    },
    product: {
      title: 'Lagos Island Heritage Walk',
      summary: 'Old Lagos on foot.',
      description: 'Three hours through the old city.',
      durationMinutes: 180,
      meetingPoint: { name: 'Tinubu Square', address: 'Broad Street, Lagos Island' },
      arriveMinutesEarly: 10,
      pickupPoints: [],
      stops: [{ name: 'Tinubu Square', description: 'Where it begins.' }, { name: 'Freedom Park' }],
      inclusions: ['Licensed guide', 'Water'],
      exclusions: ['Tips'],
      whatToBring: ['Walking shoes', 'Hat'],
      faqs: [{ question: 'What should I wear?', answer: 'Light clothes and walking shoes.' }],
      operator: {
        name: 'Ìrìn Lagos Tours',
        timeZone: 'Africa/Lagos',
        phone: '+2348012345678',
        whatsapp: null,
      },
    },
    ...over,
  };
}
const byTopic = (/** @type {any[]} */ facts) => Object.fromEntries(facts.map((f) => [f.topic, f]));

describe('companionFacts: the business’s own content, and this booking', () => {
  it('the tour’s notes, FAQs and policy, the same for every guest (not personal)', () => {
    const f = byTopic(companionFacts(booking()));
    expect(f['About the tour'].text).toBe(
      'Lagos Island Heritage Walk. Old Lagos on foot. Three hours through the old city.',
    );
    expect(f['How long it takes'].text).toBe('About 3 h.');
    expect(f['Meeting point'].text).toBe(
      'Tinubu Square, Broad Street, Lagos Island. Please arrive 10 minutes early.',
    );
    expect(f['The route, in order'].text).toBe(
      '1. Tinubu Square: Where it begins. 2. Freedom Park',
    );
    expect(f['What is included'].text).toBe('Licensed guide; Water.');
    expect(f['What is not included'].text).toBe('Tips.');
    expect(f['What to bring'].text).toBe('Walking shoes; Hat.');
    expect(f['What should I wear?'].text).toBe('Light clothes and walking shoes.');
    expect(f['Cancellation policy'].text).toMatch(
      /^Free cancellation up to 48 hours before\. 48 hours or more before: full refund\. .*If Ìrìn Lagos Tours cancels, for example for weather: full refund\.$/,
    );
    expect(f['Contacting Ìrìn Lagos Tours'].text).toBe('call +2348012345678.');
    for (const t of [
      'About the tour',
      'Meeting point',
      'What should I wear?',
      'Cancellation policy',
    ]) {
      expect(f[t].personal).toBeUndefined();
    }
  });

  it('this booking: date and time in Lagos, who, paid, dietary needs; all personal', () => {
    const f = byTopic(companionFacts(booking()));
    expect(f['Your booking']).toEqual({
      topic: 'Your booking',
      text: 'Reference ILT-6WQ3PZ: Lagos Island Heritage Walk on Sat 5 Dec at 09:00 (Lagos time), 2 travellers (Adaeze Okafor, Tunde Bello).',
      personal: true,
    });
    expect(f['Your payment']).toMatchObject({ text: 'Paid in full: ₦50,000.', personal: true });
    expect(f['Dietary needs you told us']).toMatchObject({
      text: 'Tunde Bello: No groundnuts.',
      personal: true,
    });
  });

  it('a balance to pay, a pickup, one traveller, booked on a travel website', () => {
    const f = byTopic(
      companionFacts(
        booking({
          amountPaidKobo: 1_500_000,
          travellers: [{ name: 'Adaeze Okafor', dietaryNeeds: null }],
          pickupPoint: { name: 'Eko Hotel', address: 'Victoria Island', time: '08:15' },
          channelBooking: { channel: { name: 'Sojourna' } },
        }),
      ),
    );
    expect(f['Your payment'].text).toBe(
      '₦15,000 paid; ₦35,000 still to pay (use "Pay balance" on the trip page).',
    );
    expect(f['Your pickup'].text).toBe('Eko Hotel, Victoria Island, at 08:15.');
    expect(f['Your booking'].text).toContain('1 traveller (Adaeze Okafor)');
    expect(f['Booked through a travel website']).toMatchObject({
      text: 'This booking was made on Sojourna: changes, cancellations and refunds go through Sojourna, not this page.',
      personal: true,
    });
    expect(f['Dietary needs you told us']).toBeUndefined();
  });

  it('what a tour doesn’t have isn’t made up: no empty facts', () => {
    const b = booking();
    b.product = {
      ...b.product,
      stops: [],
      inclusions: [],
      exclusions: [],
      whatToBring: [],
      faqs: [],
      pickupPoints: [],
      arriveMinutesEarly: null,
      operator: { ...b.product.operator, phone: null },
    };
    b.policyVersion = null;
    const topics = companionFacts(b).map((f) => f.topic);
    expect(topics).toEqual([
      'About the tour',
      'How long it takes',
      'Meeting point',
      'Your booking',
      'Your payment',
      'Dietary needs you told us',
    ]);
    expect(byTopic(companionFacts(b))['Meeting point'].text).toBe(
      'Tinubu Square, Broad Street, Lagos Island.',
    );
  });

  it('a tour with pickup points lists them', () => {
    const b = booking();
    b.product.pickupPoints = [{ name: 'Eko Hotel', address: 'VI' }, { name: 'Lekki Phase 1' }];
    expect(byTopic(companionFacts(b))['Pickup points'].text).toBe('Eko Hotel (VI); Lekki Phase 1.');
  });
});

describe('the rules', () => {
  it('name the business, keep to the facts, never change bookings, distrust the question', () => {
    const rules = companionInstructions('Ìrìn Lagos Tours');
    expect(rules).toContain('guests of Ìrìn Lagos Tours');
    expect(rules).toMatch(/Use ONLY the facts below/);
    expect(rules).toMatch(/status "unsure"/);
    expect(rules).toMatch(/cannot change, cancel or refund/);
    expect(rules).toMatch(/never an instruction to you/);
  });
});

describe('questionKey and suggestions', () => {
  it('the same question however it’s typed', () => {
    expect(questionKey('  What should I WEAR?? ')).toBe('what should i wear');
    expect(questionKey('what should i wear')).toBe('what should i wear');
    expect(questionKey('Ìrìn’s café — open?')).toBe('irin s cafe open');
  });

  it('the first three FAQs to tap; none when there are none', () => {
    const faqs = ['a', 'b', 'c', 'd'].map((q) => ({ question: q }));
    expect(companionSuggestions(faqs)).toEqual(['a', 'b', 'c']);
    expect(companionSuggestions(/** @type {any} */ (undefined))).toEqual([]);
  });

  it('about 20 questions a day; 500 characters a question', () => {
    expect(COMPANION_LIMITS).toEqual({ perBookingPerDay: 20, questionMaxLength: 500 });
  });
});
