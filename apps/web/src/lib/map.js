// @ts-check
/**
 * map.js — the trip hub's small map, from OpenStreetMap tiles, and the "open in" links.
 *
 * Low data on purpose (the page is opened outdoors on a weak signal): no map library, just
 * FOUR 256-pixel tiles (about 60 KB in all), placed so the meeting point sits near the middle,
 * with a pin drawn on top. If the tiles don't load (offline), the box stays a plain colour and
 * the address and the Google / Apple Maps buttons still work.
 *
 * The maths is the standard "slippy map" one: at zoom z the world is 2^z × 2^z tiles, and a
 * longitude/latitude has a position measured in tiles (Web Mercator).
 */
export const TILE = 256;
const ZOOM = 16; // streets and squares: enough to recognise where you are

/**
 * @param {number} lat
 * @param {number} lng
 * @param {number} [zoom]
 * @returns {{ zoom: number, tiles: Array<{ x: number, y: number, left: number, top: number }>,
 *   pinLeft: number, pinTop: number }}  positions in pixels inside a 512 × 512 square
 */
export function tilesAround(lat, lng, zoom = ZOOM) {
  const n = 2 ** zoom;
  const fx = ((lng + 180) / 360) * n; // position in tiles, with the fraction
  const rad = (lat * Math.PI) / 180;
  const fy = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n;
  const tx = Math.floor(fx);
  const ty = Math.floor(fy);
  // The point's tile, plus its neighbours on the side the point is nearest to, so the point
  // always ends up in the middle half of the 2 × 2 square (never at its edge).
  const x0 = fx - tx < 0.5 ? tx - 1 : tx;
  const y0 = fy - ty < 0.5 ? ty - 1 : ty;
  const tiles = [];
  for (let dy = 0; dy < 2; dy++) {
    for (let dx = 0; dx < 2; dx++) {
      tiles.push({ x: x0 + dx, y: y0 + dy, left: dx * TILE, top: dy * TILE });
    }
  }
  return { zoom, tiles, pinLeft: (fx - x0) * TILE, pinTop: (fy - y0) * TILE };
}

/** @param {number} zoom @param {number} x @param {number} y */
export const tileUrl = (zoom, x, y) => `https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`;

/** @param {{ lat: number, lng: number }} p */
export const googleMapsUrl = ({ lat, lng }) =>
  `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;

/** @param {{ lat: number, lng: number, name: string }} p */
export const appleMapsUrl = ({ lat, lng, name }) =>
  `https://maps.apple.com/?ll=${lat},${lng}&q=${encodeURIComponent(name)}`;

/** WhatsApp's click-to-chat wants the number as digits only: "+2348090000123" → wa.me/234… */
export const whatsappUrl = (/** @type {string} */ e164) =>
  `https://wa.me/${e164.replace(/\D/g, '')}`;
