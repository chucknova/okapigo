// @ts-check
/**
 * dates.js — which dates a tour page shows (designs: B · Tour page, and its states).
 *
 *   'dates'         the next 4 departures, sold-out ones INCLUDED (shown disabled, so guests
 *                   see it's popular rather than closed)
 *   'soldOutUntil'  every date in the next 2 weeks is full: "Sold out until Sat 5 Dec", plus
 *                   the next 2 dates with seats
 *   'none'          nothing bookable in the period looked at: "No dates scheduled yet"
 *
 * Pure, so it's tested without a browser.
 */
import { addDays } from '@okapigo/shared/time';

/** Show at most this many dates on the tour page. */
export const TILE_COUNT = 4;
/** "Sold out for the next 2 weeks". */
export const SOLD_OUT_WINDOW_DAYS = 14;
/** "Only 3 left" from this many seats down. */
export const FEW_SEATS = 3;

/**
 * @typedef {{ id: string, localDate: string, localTime: string, seatsAvailable: number, soldOut: boolean }} Departure
 * @param {Departure[]} departures  upcoming, in date order (from the public API)
 * @param {string} today  'YYYY-MM-DD', the operator's local date
 * @returns {{ kind: 'dates', tiles: Departure[] }
 *   | { kind: 'soldOutUntil', until: string, next: Departure[] }
 *   | { kind: 'none' }}
 */
export function summariseDates(departures, today) {
  const open = departures.filter((d) => !d.soldOut);
  if (open.length === 0) return { kind: 'none' };
  const windowEnd = addDays(today, SOLD_OUT_WINDOW_DAYS - 1);
  const fullUntilAfterWindow = departures[0].soldOut && open[0].localDate > windowEnd;
  if (fullUntilAfterWindow) {
    return { kind: 'soldOutUntil', until: open[0].localDate, next: open.slice(0, 2) };
  }
  return { kind: 'dates', tiles: departures.slice(0, TILE_COUNT) };
}

/**
 * "09:00 · 12 left" / "09:00 · Only 3 left" / "Sold out", and how loudly to say it.
 * @param {Departure} d
 * @returns {{ text: string, tone: 'normal' | 'few' | 'soldOut' }}
 */
export function seatsLabel(d) {
  if (d.soldOut) return { text: 'Sold out', tone: 'soldOut' };
  if (d.seatsAvailable <= FEW_SEATS) return { text: `Only ${d.seatsAvailable} left`, tone: 'few' };
  return { text: `${d.seatsAvailable} left`, tone: 'normal' };
}
