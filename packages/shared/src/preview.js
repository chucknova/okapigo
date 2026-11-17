// @ts-check
/**
 * preview.js — the words in a link preview (BKG-32, stage 11e).
 *
 * When a tour link is pasted into WhatsApp, Instagram or X, their "crawler" fetches the page
 * and reads its Open Graph tags (og:title, og:description, og:image) to draw the preview
 * card. These helpers build that text. Pure functions, so the guest web (session 12) shows
 * the same words on the page itself.
 */
import { formatNaira } from './money.js';

/**
 * A duration for people: 180 → "3 hours", 210 → "3 h 30 min", 60 → "1 hour", 45 → "45 min".
 * @param {number} minutes
 */
export function formatDuration(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return h === 1 ? '1 hour' : `${h} hours`;
  return `${h} h ${m} min`;
}

/**
 * A departure's day for people, in the operator's time zone: "Sat 5 Dec".
 * @param {Date} instant
 * @param {string} timeZone
 */
export function formatDay(instant, timeZone) {
  // en-GB gives "Sat 5 Dec" (day before month, no commas), the format the briefs use.
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone,
  }).format(instant);
}

/** Previews show roughly the first 150–200 characters; keep the summary within this. */
export const SUMMARY_LIMIT = 150;

/**
 * Shortens text to `limit` characters at a word boundary, adding "…" when it cut anything.
 * @param {string} text
 * @param {number} limit
 */
export function truncate(text, limit) {
  const clean = text.trim().replace(/\s+/g, ' ');
  if (clean.length <= limit) return clean;
  const cut = clean.slice(0, limit - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s.,;:–-]+$/, '')}…`;
}

/**
 * The description line of a tour's preview: the summary first (it's the most persuasive),
 * then the facts people decide on. Missing facts are simply left out.
 *
 *   "A full day in Badagry: the Point of No Return… · From ₦65,000 · 10 hours · Next: Sat 5 Dec"
 *
 * @param {{ summary: string, fromPriceKobo: number | null, durationMinutes: number, nextDay: string | null }} tour
 */
export function tourPreviewDescription({ summary, fromPriceKobo, durationMinutes, nextDay }) {
  return [
    truncate(summary, SUMMARY_LIMIT),
    fromPriceKobo !== null ? `From ${formatNaira(fromPriceKobo)}` : null,
    formatDuration(durationMinutes),
    nextDay ? `Next: ${nextDay}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * A LOCAL date string for people: '2026-11-18' → "Wed 18 Nov". No time zone maths: the date
 * is already the operator's local date (departures carry localDate from the API).
 * @param {string} localDate  'YYYY-MM-DD'
 */
export function formatLocalDay(localDate) {
  // Noon UTC on that date, formatted in UTC, can't slip to a neighbouring day.
  return formatDay(new Date(`${localDate}T12:00:00Z`), 'UTC');
}
