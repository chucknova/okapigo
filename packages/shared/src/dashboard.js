// @ts-check
/**
 * dashboard.js — the dashboard's words (RPT-01, stage 18c; design D1), from the figures
 * packages/db/src/dashboard.js reads.
 *
 *   dashboardView(figures)   the four "today" tiles, the 30-day trend (with its change on the
 *                            30 days before), where bookings came from, seats filled by tour
 *
 * Pure, so the server says it once and the tests check every word.
 */
import { formatNaira } from './money.js';

const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-10-25" → "25 Oct". @param {string} date */
export const shortDate = (date) => {
  const [, m, d] = date.split('-').map(Number);
  return `${d} ${MONTH[m - 1]}`;
};

/** Where a booking came from, in the table. @param {string} key */
export const channelName = (key) =>
  ({ web: 'Website and widget', whatsapp: 'WhatsApp', staff: 'Booked at the desk' })[key] ?? key;

/** …and in today's short line ("4 website · 2 WhatsApp · 1 Sojourna"). @param {string} key */
const channelShort = (key) => ({ web: 'website', whatsapp: 'WhatsApp', staff: 'desk' })[key] ?? key;

/**
 * "+12%" against the 30 days before; null when there was nothing before (no fair percentage).
 * @param {number} now @param {number} before
 * @returns {null | { text: string, tone: 'up' | 'down' | 'flat' }}
 */
export function changeWords(now, before) {
  if (before <= 0) return null;
  const pct = Math.round(((now - before) / before) * 100);
  if (pct === 0) return { text: 'Same', tone: 'flat' };
  return pct > 0 ? { text: `+${pct}%`, tone: 'up' } : { text: `${pct}%`, tone: 'down' };
}

/**
 * Bar heights, as a share of the tallest day ("62%"). A day with more refunds than money in
 * draws as nothing (the total still says it).
 * @param {number[]} values
 */
export function barHeights(values) {
  const max = Math.max(0, ...values);
  return values.map((v) => (max > 0 ? `${Math.round((Math.max(0, v) / max) * 100)}%` : '0%'));
}

/**
 * @param {{ total: number, underWay: number, toCome: number, ended: number }} d
 */
export function departuresLine(d) {
  if (d.total === 0) return 'None today';
  return [
    d.underWay && `${d.underWay} under way`,
    d.toCome && `${d.toCome} to come`,
    d.ended && `${d.ended} ended`,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** @param {Array<{ name: string, count: number }>} byChannel */
export function bookingsLine(byChannel) {
  if (byChannel.length === 0) return 'None yet';
  return [...byChannel]
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .map((c) => `${c.count} ${channelShort(c.name)}`)
    .join(' · ');
}

/** @param {{ in: number, out: number }} m */
export function moneyLine(m) {
  if (m.in === 0 && m.out === 0) return 'Nothing yet';
  if (m.out === 0) return `${formatNaira(m.in)} paid`;
  return `${formatNaira(m.in)} paid · ${formatNaira(m.out)} refunded`;
}

/** @param {{ done: number, total: number }} c */
export function checkInsLine(c) {
  if (c.total === 0) return 'No travellers today';
  const left = c.total - c.done;
  return left === 0 ? 'Everyone’s in' : `${left} not yet`;
}

/**
 * @typedef {{
 *   today: {
 *     date: string,
 *     departures: { total: number, underWay: number, toCome: number, ended: number },
 *     bookings: { total: number, byChannel: Array<{ name: string, count: number }> },
 *     money: { in: number, out: number },
 *     checkIns: { done: number, total: number },
 *   },
 *   days: Array<{ date: string, moneyIn: number, bookings: number }>,
 *   previous: { moneyIn: number, bookings: number },
 *   channels: Array<{ name: string, bookings: number, kobo: number }>,
 *   tours: Array<{ title: string, sold: number, capacity: number }>,
 * }} DashboardFigures
 */

/** @param {DashboardFigures} f */
export function dashboardView(f) {
  const t = f.today;
  const moneyTotal = f.days.reduce((n, d) => n + d.moneyIn, 0);
  const bookingsTotal = f.days.reduce((n, d) => n + d.bookings, 0);
  const days = f.days.map((d) => d.date);
  return {
    today: [
      {
        key: 'departures',
        label: 'Departures today',
        value: String(t.departures.total),
        note: departuresLine(t.departures),
      },
      {
        key: 'bookings',
        label: 'Bookings today',
        value: String(t.bookings.total),
        note: bookingsLine(t.bookings.byChannel),
      },
      {
        key: 'money',
        label: 'Money in today',
        value: formatNaira(t.money.in - t.money.out),
        note: moneyLine(t.money),
      },
      {
        key: 'checkins',
        label: 'Checked in today',
        value: `${t.checkIns.done} of ${t.checkIns.total}`,
        note: checkInsLine(t.checkIns),
      },
    ],
    range: {
      from: shortDate(days[0]),
      middle: shortDate(days[Math.floor(days.length / 2)]),
      to: 'Today',
      words: `${shortDate(days[0])} – ${shortDate(days.at(-1) ?? days[0])}`,
    },
    money: {
      total: formatNaira(moneyTotal),
      change: changeWords(moneyTotal, f.previous.moneyIn),
      bars: barHeights(f.days.map((d) => d.moneyIn)),
    },
    bookings: {
      total: String(bookingsTotal),
      change: changeWords(bookingsTotal, f.previous.bookings),
      bars: barHeights(f.days.map((d) => d.bookings)),
    },
    channels: [...f.channels]
      .sort((a, b) => b.bookings - a.bookings || b.kobo - a.kobo)
      .map((c) => ({
        name: channelName(c.name),
        bookings: String(c.bookings),
        money: formatNaira(c.kobo),
      })),
    tours: f.tours
      .filter((x) => x.capacity > 0)
      .map((x) => ({ title: x.title, pct: Math.round((x.sold / x.capacity) * 100) }))
      .sort((a, b) => b.pct - a.pct || a.title.localeCompare(b.title))
      .map((x) => ({ title: x.title, fill: `${x.pct}%` })),
  };
}
