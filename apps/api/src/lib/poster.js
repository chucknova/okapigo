// @ts-check
/**
 * poster.js — draws a poster as a PNG (MKT-01/02, stage 18b; designs: the four templates on
 * the session 18 canvas).
 *
 *   poster data ──satori──► SVG ──resvg──► PNG      (as the link-preview card, share-card.js)
 *
 *   New tour      dark: the name, its story, "THE ROUTE" from its stops, the price, a QR
 *   Offer         pale green: the owner's words, big; a white card with the REAL price
 *   Seats left    bright green: "4 seats left", when, the price; a dark "scan" band
 *   This weekend  dark: the weekend's departures, with "3 left" on the nearly full ones
 *
 * Square (1080 × 1080) or story (1080 × 1920): the same boxes, stacked for the tall size.
 * No tour has photos yet (uploads come in session 19), so every template is complete without
 * one: the coloured panel is where a photo will go.
 *
 * The QR is black on white whatever the colours around it: scanners need the contrast.
 */
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { loadFonts, FONT_STACK } from './share-card.js';
import { qrSvg } from './qr.js';
import { POSTER_SIZES } from '@okapigo/shared/posters';

/** The designs' colours (Lagoon). */
const C = {
  ink: '#111511',
  ink2: '#212821',
  line: '#2E362E',
  green: '#9BD10F',
  greenInk: '#3F5A00',
  pale: '#F1FBD6',
  white: '#FFFFFF',
  text: '#EEF2EC',
  soft: '#C9D1C8',
  muted: '#A9B3A8',
  mutedDark: '#4F584F',
  amber: '#FFE3A3',
  amberInk: '#5C3800',
};

/**
 * @typedef {{
 *   template: import('@okapigo/shared/posters').PosterTemplate,
 *   size: import('@okapigo/shared/posters').PosterSize,
 *   words: string,
 *   business: { name: string, site: string },
 *   url: string,                          // what the QR opens
 *   tour?: {
 *     title: string, summary: string, stops: string[], meetingPoint: string,
 *     price: string | null, childPrice: string | null, duration: string, runs: string | null,
 *   },
 *   departure?: { when: string, seats: number },
 *   weekend?: Array<{ day: string, trips: Array<{ time: string, title: string, price: string | null, seats: number }> }>,
 * }} PosterData
 */

/** A satori box: { type, props: { style, children } }. @param {string} type @param {object} style @param {any} [children] */
const h = (type, style, children) => ({ type, props: { style, children } });
const row = (/** @type {object} */ style, /** @type {any} */ children) =>
  h('div', { display: 'flex', ...style }, children);
const col = (/** @type {object} */ style, /** @type {any} */ children) =>
  h('div', { display: 'flex', flexDirection: 'column', ...style }, children);
const text = (/** @type {object} */ style, /** @type {string} */ words) =>
  h('div', { display: 'flex', ...style }, words);

/**
 * A size that fits: the longer the text, the smaller (the poster has no room to wrap long
 * names onto many lines).
 * @param {string} s @param {Array<[number, number]>} steps  [up to this many characters, size]
 * @param {number} smallest
 */
export function fit(s, steps, smallest) {
  for (const [chars, size] of steps) if (s.length <= chars) return size;
  return smallest;
}

/** Cuts a long story at a word, with "…". @param {string} s @param {number} max */
export const clip = (s, max) =>
  s.length <= max ? s : `${s.slice(0, s.lastIndexOf(' ', max - 1)).replace(/[.,;:]$/, '')}…`;

/** The business's letter mark: "Ì" for Ìrìn. @param {string} name @param {string} bg @param {string} fg @param {number} px */
const mark = (name, bg, fg, px = 64) =>
  text(
    {
      width: px,
      height: px,
      borderRadius: px / 4,
      background: bg,
      color: fg,
      alignItems: 'center',
      justifyContent: 'center',
      fontWeight: 800,
      fontSize: px * 0.56,
    },
    Array.from(name)[0] ?? 'O',
  );

/** The top line: the mark and the name, and a tag pill on the right. */
const header = (
  /** @type {PosterData} */ d,
  /** @type {{ markBg: string, markFg: string, color: string }} */ c,
  /** @type {any} */ right,
) =>
  row(
    { justifyContent: 'space-between', alignItems: 'center' },
    [
      row({ alignItems: 'center', gap: 16 }, [
        mark(d.business.name, c.markBg, c.markFg),
        text({ fontSize: 30, fontWeight: 700, color: c.color }, d.business.name),
      ]),
      right,
    ].filter(Boolean),
  );

const pill = (/** @type {string} */ words, /** @type {string} */ bg, /** @type {string} */ fg) =>
  text(
    {
      padding: '12px 24px',
      borderRadius: 999,
      background: bg,
      color: fg,
      fontSize: 26,
      fontWeight: 800,
      letterSpacing: 2,
    },
    words,
  );

/** The QR, black on white, on its own white tile. @param {string} url @param {number} px */
const qr = (url, px) => ({
  type: 'img',
  props: {
    src: `data:image/svg+xml;base64,${Buffer.from(qrSvg(url)).toString('base64')}`,
    width: px,
    height: px,
  },
});

/** @param {PosterData} d */
function newTour(d) {
  const t = /** @type {NonNullable<PosterData['tour']>} */ (d.tour);
  const story = d.size === 'story';
  const stops = t.stops.slice(0, 5);
  const panel = col(
    {
      width: story ? '100%' : 360,
      boxSizing: 'border-box',
      flexShrink: 0,
      borderRadius: 28,
      background: C.green,
      color: C.ink,
      padding: '40px 36px',
      gap: 10,
    },
    stops.length
      ? [
          text({ fontSize: 22, fontWeight: 800, letterSpacing: 2, marginBottom: 10 }, 'THE ROUTE'),
          ...stops.map((s, i) =>
            row({ gap: 18, alignItems: 'flex-start' }, [
              col({ width: 22, alignItems: 'center' }, [
                h('div', { width: 22, height: 22, borderRadius: 999, background: C.ink }),
                h('div', {
                  width: 4,
                  height: 34,
                  background: i < stops.length - 1 ? C.ink : 'transparent',
                }),
              ]),
              text({ fontSize: 27, fontWeight: 700, lineHeight: 1 }, s),
            ]),
          ),
        ]
      : [
          text({ fontSize: 22, fontWeight: 800, letterSpacing: 2 }, 'MEET AT'),
          text({ fontSize: 34, fontWeight: 800, lineHeight: 1.1 }, t.meetingPoint),
        ],
  );
  const title = text(
    {
      fontSize: story
        ? fit(
            t.title,
            [
              [22, 96],
              [34, 84],
              [44, 72],
            ],
            64,
          )
        : fit(
            t.title,
            [
              [18, 84],
              [30, 70],
              [44, 60],
            ],
            54,
          ),
      lineHeight: 1,
      fontWeight: 800,
      letterSpacing: -1,
      color: C.white,
    },
    t.title,
  );
  const summary = text(
    { fontSize: story ? 32 : 28, lineHeight: 1.35, color: C.soft },
    clip(t.summary, story ? 220 : 110),
  );
  return col(
    {
      width: '100%',
      height: '100%',
      boxSizing: 'border-box', // the padding inside the poster's size, not added to it
      padding: 72,
      background: C.ink,
      color: C.text,
      justifyContent: 'space-between',
      gap: 40,
    },
    [
      header(d, { markBg: C.green, markFg: C.ink, color: C.text }, pill(d.words, C.green, C.ink)),
      story
        ? col({ gap: 48 }, [col({ gap: 28 }, [title, summary]), panel])
        : row({ gap: 56 }, [
            col({ flex: 1, gap: 28, justifyContent: 'center' }, [title, summary]),
            panel,
          ]),
      row({ justifyContent: 'space-between', alignItems: 'flex-end' }, [
        col({ gap: 8 }, [
          text({ fontSize: 30, color: C.muted }, 'From'),
          text(
            { fontSize: story ? 84 : 72, fontWeight: 800, lineHeight: 1, color: C.white },
            t.price ?? '',
          ),
          text(
            { fontSize: 28, color: C.soft },
            ['per adult', t.duration, t.runs].filter(Boolean).join(' · '),
          ),
        ]),
        col({ alignItems: 'center', gap: 12 }, [
          row({ background: C.white, padding: 16, borderRadius: 16 }, [
            qr(d.url, story ? 220 : 170),
          ]),
          text({ fontSize: 24, fontWeight: 700 }, 'Scan to book'),
        ]),
      ]),
    ],
  );
}

/** @param {PosterData} d */
function offer(d) {
  const t = /** @type {NonNullable<PosterData['tour']>} */ (d.tour);
  const story = d.size === 'story';
  const words = text(
    {
      flex: 1,
      fontSize: story
        ? fit(
            d.words,
            [
              [14, 140],
              [22, 124],
              [30, 104],
            ],
            92,
          )
        : fit(
            d.words,
            [
              [14, 116],
              [22, 92],
              [30, 80],
            ],
            72,
          ),
      lineHeight: 0.98,
      fontWeight: 800,
      letterSpacing: -2,
    },
    d.words,
  );
  const circle = text(
    {
      width: story ? 420 : 300,
      height: story ? 420 : 300,
      flexShrink: 0,
      borderRadius: 999,
      border: `14px solid ${C.green}`,
      background: '#E6EDE2',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: 150,
      fontWeight: 800,
      color: C.greenInk,
    },
    Array.from(d.business.name)[0] ?? '',
  );
  return col(
    {
      width: '100%',
      height: '100%',
      boxSizing: 'border-box', // the padding inside the poster's size, not added to it
      padding: 72,
      background: C.pale,
      color: C.ink,
      gap: 48,
      justifyContent: 'space-between',
    },
    [
      header(
        d,
        { markBg: C.ink, markFg: C.green, color: C.ink },
        text({ fontSize: 24, fontWeight: 700, color: C.greenInk }, d.business.site),
      ),
      story
        ? col({ gap: 56, alignItems: 'flex-start' }, [words, circle])
        : row({ gap: 48, alignItems: 'center' }, [words, circle]),
      row(
        {
          background: C.white,
          borderRadius: 32,
          padding: 40,
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 40,
        },
        [
          col({ flex: 1, gap: 14 }, [
            text(
              {
                fontSize: fit(
                  t.title,
                  [
                    [24, 48],
                    [34, 40],
                  ],
                  34,
                ),
                fontWeight: 800,
                lineHeight: 1.05,
              },
              t.title,
            ),
            text(
              { fontSize: 26, color: C.mutedDark },
              [t.runs, t.duration, `from ${t.meetingPoint}`].filter(Boolean).join(' · '),
            ),
            row({ alignItems: 'baseline', gap: 12, fontSize: 26 }, [
              text({ fontSize: 42, fontWeight: 800 }, t.price ?? ''),
              text(
                {},
                ['per adult', t.childPrice && `children ${t.childPrice}`]
                  .filter(Boolean)
                  .join(' · '),
              ),
            ]),
          ]),
          col({ alignItems: 'center', gap: 10 }, [
            qr(d.url, 160),
            text({ fontSize: 22, fontWeight: 700 }, 'Scan to book'),
          ]),
        ],
      ),
    ],
  );
}

/** Waves under a sun: the boat panel on Seats left (a photo goes here once tours have them). */
const WAVES =
  '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="140" viewBox="0 0 200 140" fill="none" stroke="#9BD10F" stroke-width="7" stroke-linecap="round"><circle cx="150" cy="38" r="20"/><path d="M10 86c20-14 40-14 60 0s40 14 60 0 40-14 60 0"/><path d="M10 116c20-14 40-14 60 0s40 14 60 0 40-14 60 0"/></svg>';

/** @param {PosterData} d */
function seatsLeft(d) {
  const t = /** @type {NonNullable<PosterData['tour']>} */ (d.tour);
  const dep = /** @type {NonNullable<PosterData['departure']>} */ (d.departure);
  const story = d.size === 'story';
  const panel = row(
    {
      width: story ? '100%' : 260,
      height: story ? 360 : 260,
      flexShrink: 0,
      borderRadius: 28,
      background: C.ink,
      alignItems: 'center',
      justifyContent: 'center',
    },
    [
      {
        type: 'img',
        props: {
          src: `data:image/svg+xml;base64,${Buffer.from(WAVES).toString('base64')}`,
          width: 200,
          height: 140,
        },
      },
    ],
  );
  const big = row({ alignItems: 'flex-end', gap: 24, flex: 1 }, [
    text(
      {
        fontSize: (dep.seats > 9 ? 0.82 : 1) * (story ? 360 : 300),
        fontWeight: 800,
        lineHeight: 0.8,
        letterSpacing: -12,
      },
      String(dep.seats),
    ),
    col({ fontSize: story ? 96 : 80, fontWeight: 800, lineHeight: 0.95 }, [
      text({}, dep.seats === 1 ? 'seat' : 'seats'),
      text({}, 'left'),
    ]),
  ]);
  return col(
    {
      width: '100%',
      height: '100%',
      boxSizing: 'border-box', // the padding inside the poster's size, not added to it
      padding: 72,
      background: C.green,
      color: C.ink,
      justifyContent: 'space-between',
      gap: 40,
    },
    [
      header(d, { markBg: C.ink, markFg: C.green, color: C.ink }, pill(d.words, C.ink, C.green)),
      story ? col({ gap: 56 }, [big, panel]) : row({ alignItems: 'center', gap: 40 }, [big, panel]),
      col({ gap: 28 }, [
        col({ gap: 10 }, [
          text(
            {
              fontSize: fit(
                t.title,
                [
                  [26, 64],
                  [40, 54],
                ],
                46,
              ),
              fontWeight: 800,
              lineHeight: 1,
            },
            t.title,
          ),
          text(
            { fontSize: 30, fontWeight: 600 },
            [dep.when, t.duration, t.price && `${t.price} per adult`].filter(Boolean).join(' · '),
          ),
        ]),
        row(
          {
            alignItems: 'center',
            gap: 28,
            background: C.ink,
            color: C.text,
            borderRadius: 28,
            padding: '20px 24px',
          },
          [
            row({ background: C.white, padding: 12, borderRadius: 12 }, [
              qr(d.url, story ? 180 : 120),
            ]),
            text({ fontSize: 34, fontWeight: 700, lineHeight: 1.2 }, 'Scan to book before they go'),
          ],
        ),
      ]),
    ],
  );
}

/** @param {PosterData} d */
function weekend(d) {
  const story = d.size === 'story';
  // As many as fit: a square has room for four rows, a story for eight.
  let room = story ? 8 : 4;
  const days = (d.weekend ?? [])
    .map((day) => {
      const trips = day.trips.slice(0, room);
      room -= trips.length;
      return { ...day, trips };
    })
    .filter((day) => day.trips.length > 0);
  const wordsList = d.words.trim().split(/\s+/);
  const last = wordsList.pop() ?? '';
  const heading = col(
    {
      fontSize: story ? 112 : 84,
      fontWeight: 800,
      lineHeight: 0.92,
      letterSpacing: -3,
      color: C.white,
    },
    [
      wordsList.length ? text({}, wordsList.join(' ')) : null,
      text({ color: C.green }, last),
    ].filter(Boolean),
  );
  return col(
    {
      width: '100%',
      height: '100%',
      boxSizing: 'border-box', // the padding inside the poster's size, not added to it
      padding: story ? '96px 72px' : 64,
      background: C.ink,
      color: C.text,
      gap: story ? 36 : 22,
    },
    [
      header(d, { markBg: C.green, markFg: C.ink, color: C.text }, null),
      heading,
      ...days.map((day) =>
        col({ gap: story ? 12 : 8 }, [
          text(
            { fontSize: story ? 36 : 26, fontWeight: 800, color: C.green, letterSpacing: 1 },
            day.day,
          ),
          ...day.trips.map((t) =>
            row(
              {
                alignItems: 'center',
                gap: 24,
                padding: story ? '16px 28px' : '10px 22px',
                background: C.ink2,
                borderRadius: 24,
              },
              [
                text(
                  { width: story ? 140 : 110, fontSize: story ? 46 : 36, fontWeight: 800 },
                  t.time,
                ),
                col(
                  { flex: 1, gap: 4 },
                  [
                    text(
                      {
                        fontSize: story ? 34 : 28,
                        fontWeight: 700,
                        color: C.white,
                        lineHeight: 1.1,
                      },
                      t.title,
                    ),
                    t.price
                      ? text({ fontSize: story ? 28 : 22, color: C.muted }, `From ${t.price}`)
                      : null,
                  ].filter(Boolean),
                ),
                text(
                  {
                    padding: '10px 18px',
                    borderRadius: 999,
                    background: t.seats <= 4 ? C.amber : C.line,
                    color: t.seats <= 4 ? C.amberInk : C.text,
                    fontSize: story ? 26 : 22,
                    fontWeight: 800,
                  },
                  t.seats <= 4 ? `${t.seats} left` : `${t.seats} seats`,
                ),
              ],
            ),
          ),
        ]),
      ),
      row(
        {
          marginTop: 'auto',
          alignItems: 'center',
          gap: 32,
          background: C.green,
          color: C.ink,
          borderRadius: 32,
          padding: story ? 32 : 20,
        },
        [
          row({ background: C.white, padding: 12, borderRadius: 14 }, [
            qr(d.url, story ? 200 : 110),
          ]),
          col({ gap: 8 }, [
            text({ fontSize: story ? 46 : 38, fontWeight: 800 }, 'Scan to book'),
            text({ fontSize: story ? 30 : 26, fontWeight: 600 }, d.business.site),
          ]),
        ],
      ),
    ],
  );
}

const TEMPLATES = { new_tour: newTour, offer, seats_left: seatsLeft, weekend };

/**
 * The poster as satori boxes (tests look at these; renderPoster draws them).
 * @param {PosterData} d
 */
export function posterElement(d) {
  const { width, height } = POSTER_SIZES[d.size];
  return h('div', { width, height, display: 'flex', fontFamily: FONT_STACK }, [
    TEMPLATES[d.template](d),
  ]);
}

/**
 * @param {PosterData} d
 * @returns {Promise<Buffer>}
 */
export async function renderPoster(d) {
  const { width, height } = POSTER_SIZES[d.size];
  const svg = await satori(/** @type {any} */ (posterElement(d)), {
    width,
    height,
    fonts: loadFonts(),
    loadAdditionalAsset: async () => [], // never fetch fonts from the internet
  });
  return new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render().asPng();
}
