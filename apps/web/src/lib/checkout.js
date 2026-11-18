// @ts-check
/**
 * checkout.js — the pure parts of checkout steps 1–2 (designs: file 01, screens 1 and 2).
 * No React, no network: easy to test, and the screens only render what these return.
 *
 * Business rules stay on the SERVER: prices, the adult rule and stock all come from the
 * quote. These functions only turn data into what the screen shows, and decide when
 * Continue may be pressed (and say why not, in words).
 */
import { addDays, dayOfWeek } from '@okapigo/shared/time';
import { formatLocalDay } from '@okapigo/shared/preview';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * @typedef {{ id: string, startsAt?: string, localDate: string, localTime: string, seatsAvailable: number, soldOut: boolean }} Departure
 */

/**
 * The month tabs: this month and the next two ("Nov  Dec  Jan").
 * @param {string} today  'YYYY-MM-DD'
 * @returns {Array<{ key: string, label: string, long: string }>}  key: 'YYYY-MM'
 */
export function monthTabs(today) {
  const [y, m] = today.split('-').map(Number);
  return [0, 1, 2].map((i) => {
    const month = ((m - 1 + i) % 12) + 1;
    const year = y + Math.floor((m - 1 + i) / 12);
    return {
      key: `${year}-${String(month).padStart(2, '0')}`,
      label: MONTHS[month - 1],
      long: MONTHS_LONG[month - 1],
    };
  });
}

/**
 * Which month to open on: the first with a date that still has seats (designs: December
 * selected when November is full or over), else the current month.
 * @param {Departure[]} departures
 * @param {ReturnType<typeof monthTabs>} tabs
 */
export function initialMonth(departures, tabs) {
  const firstOpen = departures.find((d) => !d.soldOut);
  const key = firstOpen?.localDate.slice(0, 7);
  return tabs.find((t) => t.key === key)?.key ?? tabs[0].key;
}

/**
 * The Monday of a date's week (weeks run Monday to Sunday, as the designs show).
 * @param {string} date
 */
function mondayOf(date) {
  return addDays(date, -((dayOfWeek(date) + 6) % 7));
}

/**
 * Departures grouped into Monday–Sunday weeks, with the design's labels:
 *   "Mon 30 Nov – Sun 6 Dec"   (crosses a month: both months)
 *   "Mon 7 – Sun 13 Dec"       (one month: said once)
 * @param {Departure[]} departures  in date order
 * @returns {Array<{ label: string, departures: Departure[] }>}
 */
export function groupByWeek(departures) {
  /** @type {Map<string, Departure[]>} */
  const weeks = new Map();
  for (const d of departures) {
    const monday = mondayOf(d.localDate);
    weeks.set(monday, [...(weeks.get(monday) ?? []), d]);
  }
  return [...weeks.entries()].map(([monday, list]) => ({
    label: weekLabel(monday),
    departures: list,
  }));
}

/** @param {string} monday */
function weekLabel(monday) {
  const sunday = addDays(monday, 6);
  const [mon, sun] = [formatLocalDay(monday), formatLocalDay(sunday)]; // "Mon 30 Nov"
  if (monday.slice(5, 7) === sunday.slice(5, 7)) {
    return `${mon.split(' ').slice(0, 2).join(' ')} – ${sun}`; // "Mon 7 – Sun 13 Dec"
  }
  return `${mon} – ${sun}`;
}

/**
 * The seats chip on a date row: "15 left", "Only 2 left", "Sold out".
 * @param {Departure} d
 * @returns {{ text: string, tone: 'primary' | 'warning' | 'soldOut' }}
 */
export function seatsChip(d) {
  if (d.soldOut) return { text: 'Sold out', tone: 'soldOut' };
  if (d.seatsAvailable <= 3) return { text: `Only ${d.seatsAvailable} left`, tone: 'warning' };
  return { text: `${d.seatsAvailable} left`, tone: 'primary' };
}

// --- Step 2 -------------------------------------------------------------------------------

/**
 * Counter values → the quote request's travellers, in the tour's category order:
 * { adult: 2, child: 1 } → [{categoryKey:'adult'}, {categoryKey:'adult'}, {categoryKey:'child'}]
 * @param {Record<string, number>} counts
 * @param {Array<{ key: string }>} categories
 */
export function travellersFromCounts(counts, categories) {
  return categories.flatMap((c) =>
    Array.from({ length: counts[c.key] ?? 0 }, () => ({ categoryKey: c.key })),
  );
}

/**
 * Add-on counters → the quote request's add-ons (only those chosen).
 * @param {Record<string, number>} addOns  addOnId → quantity
 */
export function addOnSelections(addOns) {
  return Object.entries(addOns)
    .filter(([, quantity]) => quantity > 0)
    .map(([addOnId, quantity]) => ({ addOnId, quantity }));
}

/** @param {Record<string, number>} counts */
export const travellerCount = (counts) => Object.values(counts).reduce((a, b) => a + b, 0);

/**
 * The words for an add-on's stock: shown only when it's running low.
 *   "4 left tonight" · "Last 1 tonight" · "Sold out tonight"   (an evening departure)
 *   "4 left on this trip" …                                     (a daytime one)
 * @param {number | null} left  null = unlimited
 * @param {string} localTime  the departure's start, "18:30"
 * @returns {{ text: string, soldOut: boolean } | null}
 */
export function addOnStockLabel(left, localTime) {
  if (left === null || left > 5) return null;
  const when = localTime >= '17:00' ? 'tonight' : 'on this trip';
  if (left === 0) return { text: `Sold out ${when}`, soldOut: true };
  if (left === 1) return { text: `Last 1 ${when}`, soldOut: false };
  return { text: `${left} left ${when}`, soldOut: false };
}

/**
 * The note under the travellers: seats left, and (if the tour has a free category) that
 * those travellers still take a seat.
 *   "Infants (0–2) are free but need a seat. 7 seats left on Sat 5 Dec."
 *   "6 seats left tonight."
 * @param {{ seatsAvailable: number, localDate: string, localTime: string }} departure
 * @param {Array<{ name: string, amountKobo: number }>} categories
 */
export function seatsNote(departure, categories) {
  const free = categories.find((c) => c.amountKobo === 0);
  const when =
    departure.localTime >= '17:00' ? 'tonight' : `on ${formatLocalDay(departure.localDate)}`;
  const seats = `${departure.seatsAvailable} ${departure.seatsAvailable === 1 ? 'seat' : 'seats'} left ${when}.`;
  // "Infant (0–2)" → "Infants (0–2)": the plural goes on the first word, not the end.
  return free ? `${free.name.replace(/^(\S+)/, '$1s')} are free but need a seat. ${seats}` : seats;
}

/**
 * Can the guest continue from step 2, and if not, why (in words, under the button)?
 * Order matters: the first problem is the one worth fixing first.
 *
 * @param {{
 *   travellers: number,
 *   seatsAvailable: number,
 *   blocker: { code: string, message: string } | null,   // from the server's quote
 *   pickupRequired: boolean,
 *   pickup: string | null,
 *   updating: boolean,                                    // a newer quote is on its way
 *   quoteError: boolean,
 * }} s
 * @returns {{ disabled: boolean, reason: string | null }}
 */
export function continueState(s) {
  if (s.travellers === 0) return { disabled: true, reason: 'Add at least one traveller' };
  if (s.travellers > s.seatsAvailable) {
    return { disabled: true, reason: `Only ${s.seatsAvailable} seats left on this date` };
  }
  if (s.blocker?.code === 'ADULT_REQUIRED')
    return { disabled: true, reason: 'Add an adult to continue' };
  if (s.blocker) return { disabled: true, reason: s.blocker.message };
  if (s.pickupRequired && !s.pickup) return { disabled: true, reason: 'Choose a pickup point' };
  // The total on screen must be the one the guest agrees to: wait for the newest quote.
  if (s.updating || s.quoteError) return { disabled: true, reason: null };
  return { disabled: false, reason: null };
}

/**
 * A quote line's label: "2 × Adult" (the category's name without its ages) or
 * "2 × Extra tasting plate".
 * @param {{ type: string, label: string, quantity: number }} line
 */
export function lineLabel(line) {
  const name = line.type === 'ticket' ? line.label.replace(/\s*\(.*\)\s*$/, '') : line.label;
  return `${line.quantity} × ${name}`;
}
