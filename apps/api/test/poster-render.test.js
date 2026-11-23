/**
 * Stage 18b: drawing a poster (lib/poster.js). The boxes are checked for what each template
 * says; one real PNG per size proves the drawing works end to end.
 */
import { describe, it, expect } from 'vitest';
import { clip, fit, posterElement, renderPoster } from '../src/lib/poster.js';

const BASE = {
  business: { name: 'Ìrìn Lagos Tours', site: 'okapigo.app/irin-lagos-tours' },
  url: 'https://okapigo.app/irin-lagos-tours/lagos-island-heritage-walk',
  tour: {
    title: 'Lagos Island Heritage Walk',
    summary: 'Three unhurried hours through old Lagos.',
    stops: ['Tinubu Square', 'Freedom Park', 'National Museum', 'Cathedral', 'Popo Aguda', 'Sixth'],
    meetingPoint: 'Tinubu Square',
    price: '₦25,000',
    childPrice: '₦12,500',
    duration: '3 hours',
    runs: 'Daily 09:00',
  },
  departure: { when: 'Sat 28 Nov at 10:00', seats: 1 },
  weekend: [
    {
      day: 'SATURDAY 28 NOV',
      trips: Array.from({ length: 6 }, (_, i) => ({
        time: `0${i + 6}:00`,
        title: `Tour ${i + 1}`,
        price: i === 0 ? null : '₦25,000',
        seats: i < 2 ? 3 : 9,
      })),
    },
    {
      day: 'SUNDAY 29 NOV',
      trips: [{ time: '09:00', title: 'Tour 7', price: '₦25,000', seats: 12 }],
    },
  ],
};

/** Every piece of text in the boxes, in order. @param {any} el @returns {string[]} */
function texts(el) {
  if (el == null || el === false) return [];
  if (typeof el === 'string' || typeof el === 'number') return [String(el)];
  if (Array.isArray(el)) return el.flatMap(texts);
  return texts(el.props?.children);
}
/** @param {any} el @returns {number} */
const images = (el) =>
  el == null || typeof el !== 'object'
    ? 0
    : Array.isArray(el)
      ? el.reduce((n, x) => n + images(x), 0)
      : (el.type === 'img' ? 1 : 0) + images(el.props?.children);
const draw = (/** @type {any} */ over) => posterElement(/** @type {any} */ ({ ...BASE, ...over }));

describe('what each template says', () => {
  it('New tour: the words, the name, at most five stops, the price, the QR', () => {
    const el = draw({ template: 'new_tour', size: 'square', words: 'NEW TOUR' });
    const t = texts(el);
    expect(t).toEqual(
      expect.arrayContaining([
        'Ìrìn Lagos Tours',
        'NEW TOUR',
        'Lagos Island Heritage Walk',
        'THE ROUTE',
        '₦25,000',
        'Scan to book',
      ]),
    );
    expect(t).toContain('per adult · 3 hours · Daily 09:00');
    expect(t).not.toContain('Sixth');
    expect(images(el)).toBe(1);
    expect(el.props.style).toMatchObject({ width: 1080, height: 1080 });
  });

  it('New tour without stops: where to meet instead', () => {
    const t = texts(
      draw({
        template: 'new_tour',
        size: 'story',
        words: 'NEW',
        tour: { ...BASE.tour, stops: [] },
      }),
    );
    expect(t).toEqual(expect.arrayContaining(['MEET AT', 'Tinubu Square']));
    expect(t).not.toContain('THE ROUTE');
  });

  it('Offer: the owner’s words and the REAL price, with children’s', () => {
    const t = texts(draw({ template: 'offer', size: 'square', words: 'Festive season in Lagos' }));
    expect(t).toEqual(
      expect.arrayContaining([
        'Festive season in Lagos',
        'okapigo.app/irin-lagos-tours',
        '₦25,000',
      ]),
    );
    expect(t).toContain('per adult · children ₦12,500');
    expect(t).toContain('Daily 09:00 · 3 hours · from Tinubu Square');
  });

  it('Seats left: one seat is "seat", the day tag, the departure line', () => {
    const t = texts(draw({ template: 'seats_left', size: 'square', words: 'THIS SATURDAY' }));
    expect(t).toEqual(
      expect.arrayContaining(['1', 'seat', 'left', 'THIS SATURDAY', 'Scan to book before they go']),
    );
    expect(t).toContain('Sat 28 Nov at 10:00 · 3 hours · ₦25,000 per adult');
    const many = texts(
      draw({
        template: 'seats_left',
        size: 'story',
        words: 'X',
        departure: { when: 'w', seats: 12 },
      }),
    );
    expect(many).toEqual(expect.arrayContaining(['12', 'seats']));
  });

  it('This weekend: four rows on a square, eight on a story; nearly full ones say "left"', () => {
    const square = texts(draw({ template: 'weekend', size: 'square', words: 'This weekend' }));
    expect(square.filter((x) => /^Tour \d$/.test(x))).toEqual([
      'Tour 1',
      'Tour 2',
      'Tour 3',
      'Tour 4',
    ]);
    expect(square).not.toContain('SUNDAY 29 NOV');
    expect(square).toEqual(expect.arrayContaining(['This', 'weekend', '3 left', '9 seats']));
    const story = texts(draw({ template: 'weekend', size: 'story', words: 'Weekend' }));
    expect(story.filter((x) => /^Tour \d$/.test(x))).toHaveLength(7);
    expect(story).toContain('SUNDAY 29 NOV');
    // One word: it's the green one, alone.
    expect(story).toContain('Weekend');
    // No price for a tour without one.
    expect(story.filter((x) => x.startsWith('From '))).toHaveLength(6);
  });
});

describe('fitting text', () => {
  it('the longer, the smaller; the story cut at a word', () => {
    const steps = /** @type {Array<[number, number]>} */ ([
      [10, 90],
      [20, 70],
    ]);
    expect(fit('short', steps, 50)).toBe(90);
    expect(fit('x'.repeat(10), steps, 50)).toBe(90);
    expect(fit('x'.repeat(11), steps, 50)).toBe(70);
    expect(fit('x'.repeat(21), steps, 50)).toBe(50);
    expect(clip('Three unhurried hours.', 100)).toBe('Three unhurried hours.');
    // "hours," doesn't fit with its "…" in 22: cut at the word before.
    expect(clip('Three unhurried hours, through old Lagos.', 22)).toBe('Three unhurried…');
    // A trailing comma or full stop goes before the "…".
    expect(clip('Three unhurried hours, through old Lagos.', 23)).toBe('Three unhurried hours…');
  });
});

describe('the PNG', () => {
  it('square and story, real PNGs of the right size', async () => {
    for (const [size, h] of /** @type {const} */ ([
      ['square', 1080],
      ['story', 1920],
    ])) {
      const png = await renderPoster(
        /** @type {any} */ ({ ...BASE, template: 'new_tour', size, words: 'NEW' }),
      );
      expect(png.subarray(1, 4).toString()).toBe('PNG');
      expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1080, h]);
    }
  }, 60_000); // two full-size drawings: seconds each on a busy machine
});
