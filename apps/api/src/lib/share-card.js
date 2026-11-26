// @ts-check
/**
 * share-card.js — draws the 1200×630 link-preview card (designs: "B · Share card 1200×630").
 * WhatsApp, Facebook and X show this image, big, when a tour link is pasted.
 *
 *   tour data ──satori──► SVG ──resvg──► PNG (cached in memory)
 *
 * - satori lays out boxes and text like a browser would (flexbox, real font measurements,
 *   line wrapping). It takes plain objects { type, props: { style, children } }, the same
 *   shape React elements have, so no React is needed on the server.
 * - resvg turns the SVG into a PNG. Link-preview crawlers don't accept SVG.
 * - Fonts are files we ship (Inter, open licence OFL-1.1), because a server may have no
 *   fonts installed. Three character sets: latin ("Ìrìn"), latin-ext (the naira sign ₦) and
 *   vietnamese, which happens to hold the dotted letters Yoruba uses (ọ, ẹ, ṣ…).
 *
 * The card's look is from the design file; its colours are fixed (a dark card reads well in
 * any chat app's light or dark mode).
 *
 * Photos (19b-2b; designs: U6): with a photo (a tour's cover, or the website's hero), it fills
 * the right 500 px with its credit on it, and the words keep to the left. The logo, when there
 * is one, replaces the letter mark.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;

/** The design's colours (Lagoon dark-card values). */
const C = {
  bg: '#111511',
  ring: '#2E362E',
  primary: '#9BD10F',
  text: '#EEF2EC',
  muted: '#A9B3A8',
  price: '#C6F432',
  onPrimary: '#111511',
};

/**
 * Each character set gets its OWN font name, listed in order in fontFamily, like a CSS font
 * stack. (With one shared name, satori didn't fall back between the files: the naira sign,
 * which only latin-ext contains, came out as a "no glyph" box. Seen in the first render.)
 */
const SUBSETS = /** @type {const} */ ([
  ['latin', 'Inter'],
  ['latin-ext', 'Inter Ext'],
  ['vietnamese', 'Inter Viet'],
]);
export const FONT_STACK = SUBSETS.map(([, name]) => name).join(', ');

/** @type {Array<{ name: string, data: Buffer, weight: 400 | 600 | 700 | 800, style: 'normal' }> | null} */
let fonts = null;
export function loadFonts() {
  if (fonts) return fonts;
  const require = createRequire(import.meta.url);
  const dir = join(dirname(require.resolve('@fontsource/inter/package.json')), 'files');
  fonts = [];
  for (const weight of /** @type {const} */ ([400, 600, 700, 800])) {
    for (const [subset, name] of SUBSETS) {
      fonts.push({
        name,
        data: readFileSync(join(dir, `inter-${subset}-${weight}-normal.woff`)),
        weight,
        style: 'normal',
      });
    }
  }
  return fonts;
}

/**
 * @typedef {{
 *   operatorName: string,
 *   facts: string,              // "3 hours · daily at 09:00"
 *   title: string,              // "Lagos Island Heritage Walk"
 *   price: string | null,       // "₦25,000" (already formatted), or null
 *   action?: string,            // the button: "Book now"
 *   logo?: string | null,       // the logo's address (19b-2b)
 *   photo?: { url: string, credit: string | null } | null,   // the photo's address and credit
 * }} CardInput
 */

/**
 * The card as satori elements (the design, measured: padding 64/72, mark 56, name 30,
 * facts 30, title 84 bold, price 64 in bright green, button bottom right).
 * @param {CardInput} input
 */
function cardElement({ operatorName, facts, title, price, action = 'Book now' }, pictures = {}) {
  const { logo = null, photo = null, credit = null } = pictures;
  /** @param {string} type @param {Record<string, unknown>} style @param {...unknown} children */
  const el = (type, style, ...children) => ({
    type,
    props: { style, children: children.length === 1 ? children[0] : children },
  });
  const letter =
    [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(operatorName.trim())][0]
      ?.segment ?? '';
  // Long titles would run into the price: step the size down instead (sooner beside a photo).
  const titleSize = photo
    ? title.length > 34
      ? 48
      : title.length > 22
        ? 56
        : 68
    : title.length > 44
      ? 60
      : title.length > 30
        ? 72
        : 84;
  const circle = (size, x, y, filled) =>
    el('div', {
      position: 'absolute',
      left: x,
      top: y,
      width: size,
      height: size,
      borderRadius: 999,
      ...(filled ? { backgroundColor: C.primary } : { border: `2px solid ${C.ring}` }),
    });

  return el(
    'div',
    {
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      // satori sizes boxes like CSS's default content-box: without this, the 64/72 px of
      // padding were ADDED to 1200×630 and the bottom row fell off the image.
      boxSizing: 'border-box',
      display: 'flex',
      flexDirection: 'column',
      // Beside a photo, the words keep to the left 700 px.
      padding: photo ? '56px 556px 56px 64px' : '64px 72px',
      backgroundColor: C.bg,
      fontFamily: FONT_STACK,
      position: 'relative',
    },
    ...(photo
      ? [
          {
            type: 'img',
            props: {
              src: photo,
              width: 500,
              height: CARD_HEIGHT,
              style: { position: 'absolute', right: 0, top: 0, objectFit: 'cover' },
            },
          },
          credit
            ? el(
                'div',
                {
                  position: 'absolute',
                  right: 16,
                  bottom: 14,
                  padding: '4px 10px',
                  borderRadius: 8,
                  backgroundColor: C.bg,
                  color: C.muted,
                  fontSize: 16,
                },
                `Photo: ${credit}`,
              )
            : null,
        ].filter(Boolean)
      : [circle(564, 756, -120, false), circle(404, 836, -40, false), circle(200, 940, 60, true)]),
    el(
      'div',
      { display: 'flex', alignItems: 'center' },
      logo
        ? {
            type: 'img',
            // A ring: a dark logo would vanish into the dark card.
            props: {
              src: logo,
              width: 56,
              height: 56,
              style: { borderRadius: 14, border: `2px solid ${C.ring}` },
            },
          }
        : el(
            'div',
            {
              width: 56,
              height: 56,
              borderRadius: 14,
              backgroundColor: C.primary,
              color: C.onPrimary,
              fontSize: 30,
              fontWeight: 800,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            },
            letter,
          ),
      el('div', { marginLeft: 16, color: C.text, fontSize: 30, fontWeight: 700 }, operatorName),
    ),
    el('div', { marginTop: photo ? 72 : 96, color: C.muted, fontSize: 30, fontWeight: 600 }, facts),
    el(
      'div',
      {
        marginTop: 10,
        width: photo ? 580 : 820,
        color: C.text,
        fontSize: titleSize,
        lineHeight: 1.02,
        fontWeight: 800,
        letterSpacing: -2,
      },
      title,
    ),
    el(
      'div',
      {
        // The last row, pushed to the bottom by the free space above it (marginTop: auto).
        marginTop: 'auto',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
      },
      price
        ? el(
            'div',
            { display: 'flex', alignItems: 'baseline' },
            el('div', { color: C.muted, fontSize: 30 }, 'from'),
            el('div', { marginLeft: 14, color: C.price, fontSize: 64, fontWeight: 800 }, price),
          )
        : el('div', {}, ''),
      el(
        'div',
        {
          padding: '16px 28px',
          borderRadius: 14,
          backgroundColor: C.primary,
          color: C.onPrimary,
          fontSize: 30,
          fontWeight: 800,
        },
        action,
      ),
    ),
  );
}

/**
 * The card as SVG. `onMissingGlyph` hears about any character no loaded font can draw
 * (tests use it to prove ₦, Ìrìn and Ọ̀ṣun all render).
 * @param {CardInput} input
 * @param {{ onMissingGlyph?: (text: string) => void,
 *   readPicture?: (url: string | null | undefined) => Promise<string | null> }} [options]
 *   readPicture: our own pictures as data (lib/pictures.js); anything else: none
 */
export async function cardSvg(input, { onMissingGlyph, readPicture = async () => null } = {}) {
  const [logo, photo] = await Promise.all([readPicture(input.logo), readPicture(input.photo?.url)]);
  const pictures = { logo, photo, credit: photo ? (input.photo?.credit ?? null) : null };
  return satori(/** @type {any} */ (cardElement(input, pictures)), {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    fonts: loadFonts(),
    // satori calls this for text no font covers. We never fetch fonts from the internet:
    // report it, and draw nothing rather than a broken box.
    loadAdditionalAsset: async (_code, text) => {
      onMissingGlyph?.(text);
      return [];
    },
  });
}

/**
 * Draws a card as PNG bytes.
 * @param {CardInput} input
 * @param {{ readPicture?: (url: string | null | undefined) => Promise<string | null> }} [options]
 * @returns {Promise<Buffer>}
 */
export async function renderShareCard(input, { readPicture } = {}) {
  const svg = await cardSvg(input, { readPicture });
  return new Resvg(svg, { fitTo: { mode: 'width', value: CARD_WIDTH } }).render().asPng();
}

/**
 * A small memory cache: the same card is drawn once, then served from memory. The key is a
 * hash of everything printed on the card, so editing the tour (title, price…) draws a new
 * one automatically. Oldest entries are dropped beyond `limit`.
 * @param {number} [limit]
 * @param {(url: string | null | undefined) => Promise<string | null>} [readPicture]
 *   the logo's and photos' bytes (19b-2b); their addresses are in the key, and change with them
 */
export function createCardCache(limit = 200, readPicture = async () => null) {
  /** @type {Map<string, Promise<Buffer>>} */
  const cache = new Map();
  return {
    /** @param {CardInput} input */
    key(input) {
      return createHash('sha256').update(JSON.stringify(input)).digest('base64url').slice(0, 16);
    },
    /** @param {CardInput} input */
    get(input) {
      const key = this.key(input);
      let png = cache.get(key);
      if (!png) {
        png = renderShareCard(input, { readPicture });
        // A failed render mustn't stay cached: drop it so the next request tries again.
        png.catch(() => cache.delete(key));
        cache.set(key, png);
        if (cache.size > limit) cache.delete(/** @type {string} */ (cache.keys().next().value));
      }
      return png;
    },
  };
}
