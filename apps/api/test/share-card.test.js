/**
 * The preview card renderer, without HTTP. The font check guards a bug found by looking at
 * the first render: the naira sign came out as a "no glyph" box.
 */
import { describe, it, expect } from 'vitest';
import { cardSvg, renderShareCard, createCardCache } from '../src/lib/share-card.js';

const input = {
  operatorName: 'Ọ̀ṣun Ìrìn Tours',
  facts: '3 hours · daily at 09:00',
  title: 'Lagos Island Heritage Walk',
  price: '₦25,000',
};

describe('share card', () => {
  it('has a font for every character: ₦, Ìrìn and Yoruba dotted letters', async () => {
    const missing = [];
    await cardSvg(input, { onMissingGlyph: (text) => missing.push(text) });
    expect(missing).toEqual([]);
  }, 30_000);

  it('draws a 1200×630 PNG', async () => {
    const png = await renderShareCard(input);
    expect(png.readUInt32BE(16)).toBe(1200);
    expect(png.readUInt32BE(20)).toBe(630);
  }, 30_000);

  it('caches by content: the same card is drawn once', async () => {
    const cache = createCardCache();
    const [a, b] = await Promise.all([cache.get(input), cache.get({ ...input })]);
    expect(a).toBe(b); // the very same Buffer
    expect(cache.key(input)).not.toBe(cache.key({ ...input, price: '₦26,000' }));
  }, 30_000);
});
