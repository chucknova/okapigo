// @ts-check
/** Stage 19b-1: what a tour needs before it goes on sale, in the words the app says. */
import { describe, it, expect } from 'vitest';
import {
  MIN_PHOTOS_TO_SELL,
  photosShort,
  photosWanted,
  missingToSell,
  notReadyMessage,
} from '../src/ready-to-sell.js';
import { PhotoSchema, MAX_TOUR_PHOTOS } from '../src/schemas/products.js';
import { SiteSchema } from '../src/schemas/website.js';

describe('photos to go on sale', () => {
  it('is 3, and counts what is short', () => {
    expect(MIN_PHOTOS_TO_SELL).toBe(3);
    expect([0, 1, 2, 3, 5].map(photosShort)).toEqual([3, 2, 1, 0, 0]);
    expect([0, 1, 2, 3].map(photosWanted)).toEqual([
      '3 photos',
      '2 more photos',
      '1 more photo',
      null,
    ]);
  });

  it("the draft's checklist: prices first, then photos", () => {
    expect(missingToSell({ activePrices: 0, photoCount: 1 })).toEqual([
      { part: 'prices', line: 'Add its prices' },
      { part: 'photos', line: 'Add 2 more photos (it has 1 of 3)' },
    ]);
    expect(missingToSell({ activePrices: 2, photoCount: 0 })).toEqual([
      { part: 'photos', line: 'Add 3 photos' },
    ]);
    expect(missingToSell({ activePrices: 1, photoCount: 3 })).toEqual([]);
  });

  it("the API's one sentence", () => {
    expect(notReadyMessage({ activePrices: 0, photoCount: 4 })).toBe(
      'Add at least one price before putting it on sale.',
    );
    expect(notReadyMessage({ activePrices: 1, photoCount: 0 })).toBe(
      'Add 3 photos before putting it on sale.',
    );
    expect(notReadyMessage({ activePrices: 1, photoCount: 2 })).toBe(
      'Add 1 more photo before putting it on sale (it has 2 of 3).',
    );
    expect(notReadyMessage({ activePrices: 0, photoCount: 0 })).toBe(
      'Add at least one price and 3 photos before putting it on sale.',
    );
    expect(notReadyMessage({ activePrices: 1, photoCount: 3 })).toBeNull();
  });
});

describe('the photo and logo shapes', () => {
  const url = 'http://localhost:4000/media/photos/0123456789abcdef.jpg';
  it('a photo: url and description needed; small and credit optional; empty credit is none', () => {
    expect(PhotoSchema.parse({ url, alt: 'The cathedral' })).toEqual({ url, alt: 'The cathedral' });
    expect(PhotoSchema.parse({ url, alt: 'x', credit: '  ' }).credit).toBeNull();
    expect(PhotoSchema.parse({ url, alt: 'x', credit: ' Sho, CC BY-SA 4.0 ' }).credit).toBe(
      'Sho, CC BY-SA 4.0',
    );
    expect(PhotoSchema.safeParse({ url, alt: 'x', small: 'not a url' }).success).toBe(false);
    expect(PhotoSchema.safeParse({ url, alt: 'x', credit: 'c'.repeat(121) }).success).toBe(false);
    expect(MAX_TOUR_PHOTOS).toBe(8);
  });

  it('the site: a logo { url, small } and a hero photo; null removes either', () => {
    const logo = { url, small: url };
    expect(SiteSchema.parse({ logo, hero: { url, alt: 'Tinubu Square' } })).toMatchObject({
      logo,
      hero: { url, alt: 'Tinubu Square' },
    });
    expect(SiteSchema.parse({ logo: null, hero: null })).toEqual({ logo: null, hero: null });
    expect(SiteSchema.safeParse({ logo: { url } }).success).toBe(false); // the small copy too
    expect(SiteSchema.safeParse({ hero: { url } }).success).toBe(false); // a description too
  });
});
