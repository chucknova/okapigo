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
