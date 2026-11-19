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

/** Pixels per QR module, and the white margin (in modules) cameras need around it. */
const PNG_SCALE = 12;
const QUIET_ZONE = 4;

/**
 * The same QR as a PNG (stage 13b): WhatsApp sends images, and doesn't take SVG. A black
 * QR on white, whatever the operator's colours: scanners read contrast, not brand.
 * @param {string} text
 * @returns {Buffer}
 */
export function qrPng(text) {
  const { size, path } = qrPath(text);
  const full = size + QUIET_ZONE * 2;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${full} ${full}" width="${full * PNG_SCALE}" height="${full * PNG_SCALE}" shape-rendering="crispEdges">` +
    `<rect width="${full}" height="${full}" fill="#fff"/>` +
    `<path transform="translate(${QUIET_ZONE} ${QUIET_ZONE})" fill="#000" d="${path}"/></svg>`;
  return new Resvg(svg).render().asPng();
}
