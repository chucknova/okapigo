// @ts-check
/**
 * posters.js — the poster maker's rules and words (MKT-01/02, stage 18b; designs P1–P2).
 *
 *   POSTER_TEMPLATES      New tour · Offer · Seats left · This weekend
 *   POSTER_SIZES          square 1080 × 1080 (Instagram, WhatsApp) · story 1080 × 1920
 *   templateState(…)      can this template be used for this tour? (and why not)
 *   weekendDays(…)        the coming weekend's dates ("This weekend")
 *   dayTag(…)             "TODAY" · "TOMORROW" · "THIS SATURDAY" · "SAT 5 DEC"
 *   posterTitle(tour)     the name, or the short name when the name is too long
 *   posterFileName(…)     "heritage-walk-new-tour.png"
 *
 * Shared by the staff app (the choices) and the API (which draws the PNG), so both say the
 * same. There's no discount engine: an Offer poster shows the owner's words and the REAL price.
 */
import { addDays, dayOfWeek } from './time.js';

/** @typedef {'new_tour' | 'offer' | 'seats_left' | 'weekend'} PosterTemplate */
/** @typedef {'square' | 'story'} PosterSize */

/** The templates, in the designs' order, with what each fills in and its words' default. */
export const POSTER_TEMPLATES = /** @type {const} */ ([
  { key: 'new_tour', name: 'New tour', what: 'Name, story, price', words: 'NEW TOUR' },
  { key: 'offer', name: 'Offer', what: 'Your words, real price', words: 'A day out in Lagos' },
  { key: 'seats_left', name: 'Seats left', what: 'One departure, live', words: '' },
  { key: 'weekend', name: 'This weekend', what: 'The next departures', words: 'This weekend' },
]);

/** The two sizes, in pixels (designs: "Square" and "Story"). */
export const POSTER_SIZES = /** @type {const} */ ({
  square: { width: 1080, height: 1080, label: 'Square', note: 'Instagram and WhatsApp' },
  story: { width: 1080, height: 1920, label: 'Story', note: 'Stories and status' },
});

/** The headline's longest ("Up to 30 characters"), so it fits the poster in big type. */
export const POSTER_WORDS_MAX = 30;

/** "Seats left" looks this many days ahead (designs P2: "No departures in the next 14 days"). */
export const SEATS_LEFT_DAYS = 14;

/** Longer names than this use the tour's short name (designs P2: "A long tour name"). */
export const POSTER_TITLE_MAX = 48;

/**
 * @param {{ title: string, shortTitle?: string | null }} tour
 */
export function posterTitle(tour) {
  return tour.title.length > POSTER_TITLE_MAX && tour.shortTitle ? tour.shortTitle : tour.title;
}

/**
 * Can this template be used? Seats left needs a departure with seats in the next 14 days;
 * This weekend needs something on this weekend. The others always can.
 * @param {PosterTemplate} template
 * @param {{ departures: unknown[] }} tour
 * @param {number} weekendCount  departures with seats this weekend, every tour
 * @returns {{ available: boolean, why: string | null }}
 */
export function templateState(template, tour, weekendCount) {
  if (template === 'seats_left' && tour.departures.length === 0) {
    return { available: false, why: `No departures in the next ${SEATS_LEFT_DAYS} days` };
  }
  if (template === 'weekend' && weekendCount === 0) {
    return { available: false, why: 'Nothing on this weekend' };
  }
  return { available: true, why: null };
}

/**
 * The coming weekend, as local dates: on a Saturday, today and tomorrow; on a Sunday, today;
 * on a weekday, the next Saturday and Sunday.
 * @param {string} today  "2026-11-23"
 * @returns {string[]}
 */
export function weekendDays(today) {
  const dow = dayOfWeek(today); // 0 = Sunday
  if (dow === 0) return [today];
  const saturday = addDays(today, 6 - dow);
  return [saturday, addDays(saturday, 1)];
}

const WEEKDAY = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
const DAY3 = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MONTH3 = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/**
 * The tag on a Seats left poster: when the departure is, from today.
 * @param {string} date   the departure's local date
 * @param {string} today  today's local date
 */
export function dayTag(date, today) {
  if (date === today) return 'TODAY';
  if (date === addDays(today, 1)) return 'TOMORROW';
  const dow = dayOfWeek(date);
  if (date > today && date <= addDays(today, 6)) return `THIS ${WEEKDAY[dow]}`;
  const [, m, d] = date.split('-').map(Number);
  return `${DAY3[dow]} ${d} ${MONTH3[m - 1]}`;
}

/**
 * A day on This weekend: "SATURDAY 28 NOV".
 * @param {string} date  a local date
 */
export function weekendDayLabel(date) {
  const [, m, d] = date.split('-').map(Number);
  return `${WEEKDAY[dayOfWeek(date)]} ${d} ${MONTH3[m - 1]}`;
}

/** "4 seats left", "1 seat left". @param {number} n */
export const seatsWords = (n) => `${n} ${n === 1 ? 'seat' : 'seats'} left`;

/**
 * The downloaded file's name: the tour's slug (or the business's, for This weekend), the
 * template, and "-story" for the tall size.
 * @param {string} slug @param {PosterTemplate} template @param {PosterSize} size
 */
export function posterFileName(slug, template, size) {
  return `${slug}-${template.replace('_', '-')}${size === 'story' ? '-story' : ''}.png`;
}
