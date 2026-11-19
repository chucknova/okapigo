// @ts-check
/**
 * qr.js — the trip hub's QR ticket, drawn on the SERVER as one SVG path (stage 12f).
 *
 * Why here and not in the browser? The QR has to work with no signal on the day, so it must be
 * part of the booking data the phone saves. A short path string ("M0 0h7v1h-7z…", about 2 KB)
 * saves and redraws anywhere, and the guest app doesn't carry a QR library (its 300 KB budget).
 *
 * The encoder is `uqr` (MIT, no dependencies). Each dark module becomes part of a horizontal
 * run ("h3" = three modules wide), which keeps the path short. The page draws it in a
 * `viewBox="0 0 size size"` with a white quiet zone around it, so cameras find the edges.
 */
import { encode } from 'uqr';
import { Resvg } from '@resvg/resvg-js';
import satori from 'satori';
import { loadFonts, FONT_STACK } from './share-card.js';

/**
 * @param {string} text  what the guide's scanner reads (the ticket code)
 * @returns {{ size: number, path: string }}
 */
export function qrPath(text) {
  // ECC "M" survives ~15% damage (a cracked screen, glare). border 0: the page adds the margin.
  const { size, data } = encode(text, { ecc: 'M', border: 0 });
  let path = '';
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!data[y][x]) continue;
      let run = 1;
      while (x + run < size && data[y][x + run]) run++;
      path += `M${x} ${y}h${run}v1h-${run}z`;
      x += run - 1;
    }
  }
  return { size, path };
}

/** The white margin (in modules) cameras need around a QR. */
const QUIET_ZONE = 4;
/** The ticket image's size (drawn at 2× for sharp phone screens). */
const TICKET = { width: 460, height: 560, scale: 2 };

/** The QR alone as an SVG: black on white, whatever the brand (scanners read contrast). @param {string} text */
function qrSvg(text) {
  const { size, path } = qrPath(text);
  const full = size + QUIET_ZONE * 2;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${full} ${full}" shape-rendering="crispEdges">` +
    `<rect width="${full}" height="${full}" fill="#fff"/>` +
    `<path transform="translate(${QUIET_ZONE} ${QUIET_ZONE})" fill="#000" d="${path}"/></svg>`
  );
}

/**
 * The WhatsApp ticket (stage 13c; design: the happy path's ticket image): the QR, the booking
 * reference under it, and "Ìrìn Lagos Tours · 2 travellers". A PNG, because WhatsApp sends
 * pictures, not SVG. Text is drawn by satori with the share card's own fonts (never fetched).
 * @param {{ code: string, reference: string, line: string }} t
 * @returns {Promise<Buffer>}
 */
export async function ticketPng({ code, reference, line }) {
  const qr = `data:image/svg+xml;base64,${Buffer.from(qrSvg(code)).toString('base64')}`;
  const el = {
    type: 'div',
    props: {
      style: {
        width: TICKET.width,
        height: TICKET.height,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#FFFFFF',
        fontFamily: FONT_STACK,
        color: '#111511',
      },
      children: [
        { type: 'img', props: { src: qr, width: 340, height: 340 } },
        {
          type: 'div',
          props: {
            style: { fontSize: 34, fontWeight: 800, letterSpacing: 4, marginTop: 18 },
            children: reference,
          },
        },
        {
          type: 'div',
          props: { style: { fontSize: 20, color: '#4F584F', marginTop: 8 }, children: line },
        },
      ],
    },
  };
  const svg = await satori(/** @type {any} */ (el), {
    width: TICKET.width,
    height: TICKET.height,
    fonts: loadFonts(),
    loadAdditionalAsset: async () => [], // never fetch fonts from the internet
  });
  return new Resvg(svg, { fitTo: { mode: 'width', value: TICKET.width * TICKET.scale } })
    .render()
    .asPng();
}
