// @ts-check
/**
 * map-pin.js — a meeting point's pin from what an owner pastes (Settings › Tours, 16e-4;
 * decided 2026-11-21: "paste a map link"). No map service is called: the pin is read from the
 * text itself.
 *
 *   "6.4541, 3.3947"                                   coordinates, as Google Maps copies them
 *   "6.4541 3.3947" · "(6.4541, 3.3947)"
 *   https://www.google.com/maps/place/…/@6.4541,3.3947,17z      the map's centre
 *   https://www.google.com/maps/place/…!3d6.4541!4d3.3947       the place itself (preferred)
 *   https://www.google.com/maps?q=6.4541,3.3947                 also ?query=, ?ll=, ?center=
 *   https://maps.apple.com/?ll=6.4541,3.3947
 *
 * A short link (maps.app.goo.gl, goo.gl/maps) hides the place behind a redirect we won't
 * follow: the owner is asked for the full link or the coordinates instead.
 *
 *   readMapPin(text) → { ok: true, lat, lng } | { ok: false, problem }
 */

/** A number with an optional sign and decimals. */
const NUM = String.raw`-?\d{1,3}(?:\.\d+)?`;

/** @param {string} lat @param {string} lng */
function pin(lat, lng) {
  const a = Number(lat);
  const b = Number(lng);
  if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a) > 90 || Math.abs(b) > 180) {
    return /** @type {const} */ ({
      ok: false,
      problem: 'Those numbers aren’t a place on the map. Check the coordinates.',
    });
  }
  // Six decimals is about 10 cm: plenty, and tidy.
  const round = (/** @type {number} */ n) => Math.round(n * 1e6) / 1e6;
  return /** @type {const} */ ({ ok: true, lat: round(a), lng: round(b) });
}

/** @param {string} text */
export function readMapPin(text) {
  const t = text.trim();
  if (!t) {
    return /** @type {const} */ ({
      ok: false,
      problem: 'Paste a Google Maps link or the coordinates.',
    });
  }
  if (/(^|\/\/)(maps\.app\.goo\.gl|goo\.gl\/maps)\//i.test(t)) {
    return /** @type {const} */ ({
      ok: false,
      problem:
        'Short links can’t be read. Open it, then copy the full link from the address bar, or paste the coordinates (like 6.4541, 3.3947).',
    });
  }
  // Coordinates on their own.
  const plain = new RegExp(String.raw`^\(?\s*(${NUM})\s*[,\s]\s*(${NUM})\s*\)?$`).exec(t);
  if (plain) return pin(plain[1], plain[2]);
  // The place itself, inside a Google Maps link: !3d<lat>!4d<lng>.
  const place = new RegExp(String.raw`!3d(${NUM})!4d(${NUM})`).exec(t);
  if (place) return pin(place[1], place[2]);
  // ?q=, ?query=, ?ll=, ?center= with "lat,lng" (the comma may be encoded).
  const param = new RegExp(
    String.raw`[?&](?:q|query|ll|center|destination)=(${NUM})(?:,|%2C)\s*(${NUM})`,
    'i',
  ).exec(t);
  if (param) return pin(param[1], param[2]);
  // The map's centre: /@<lat>,<lng>,<zoom>z
  const at = new RegExp(String.raw`/@(${NUM}),(${NUM})`).exec(t);
  if (at) return pin(at[1], at[2]);
  return /** @type {const} */ ({
    ok: false,
    problem:
      'We couldn’t find a place in that. Paste the full Google Maps link, or the coordinates (like 6.4541, 3.3947).',
  });
}

/** "6.4541, 3.3947": how a pin is shown back. @param {{ lat: number, lng: number }} p */
export const pinText = ({ lat, lng }) => `${lat}, ${lng}`;
