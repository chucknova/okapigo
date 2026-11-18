// @ts-check
/**
 * tour-facts.js — the short phrases tour cards and pages show (stage 12b).
 *
 *   formatDurationShort(210)                       "3.5 h"
 *   scheduleSummary([{ daysOfWeek: [4,5,6], times: ['18:30'] }])   "Thu–Sat 18:30"
 *   describePolicy(rules, …, 'Ìrìn')               headline + one line per tier
 *   priceNote(categories)                          "per adult · child ₦12,500 · infant free"
 *
 * Pure functions in the shared package, so the guest web, the share pages and later the
 * operator website (12g) and emails (session 14) say exactly the same thing.
 */
import { formatNaira } from './money.js';
import { isAdultCategory, fromPriceKobo } from './catalogue.js';

/**
 * Card-sized durations: 180 → "3 h", 210 → "3.5 h", 45 → "45 min", 195 → "3 h 15 min".
 * @param {number} minutes
 */
export function formatDurationShort(minutes) {
  if (minutes < 60) return `${minutes} min`;
  if (minutes % 30 === 0) return `${minutes / 60} h`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAYS = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];

/**
 * When a tour runs, in a few words: "Daily 09:00", "Weekends 10:00", "Saturdays 07:00",
 * "Thu–Sat 18:30", "Wed, Sat 08:00". Only ACTIVE schedules count. Several schedules with
 * different patterns can't be said in a few words, so they give null (the chip is left out).
 *
 * @param {Array<{ daysOfWeek: number[], times: string[], isActive?: boolean }>} schedules
 * @returns {string | null}
 */
export function scheduleSummary(schedules) {
  const active = schedules.filter((s) => s.isActive !== false);
  if (active.length === 0) return null;
  const key = (/** @type {typeof active[0]} */ s) =>
    `${[...s.daysOfWeek].sort().join()}|${[...s.times].sort().join()}`;
  if (new Set(active.map(key)).size > 1) return null;

  const days = [...new Set(active[0].daysOfWeek)].sort((a, b) => a - b);
  const times = [...active[0].times].sort().join(', ');
  return `${describeDays(days)} ${times}`;
}

/** @param {number[]} days  sorted, 0 = Sunday */
function describeDays(days) {
  if (days.length === 7) return 'Daily';
  if (days.length === 2 && days[0] === 0 && days[1] === 6) return 'Weekends';
  if (days.length === 1) return DAYS[days[0]];
  // A run of 3 or more days in a row (Mon=1 … Sat=6): "Thu–Sat".
  const consecutive = days.every((d, i) => i === 0 || d === days[i - 1] + 1);
  if (consecutive && days.length >= 3) return `${DAY[days[0]]}–${DAY[days.at(-1) ?? 0]}`;
  // Monday-first reads better in a list: "Wed, Sat", "Mon, Sun".
  const mondayFirst = [...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
  return mondayFirst.map((d) => DAY[d]).join(', ');
}

/** @param {number} basisPoints */
const refundWords = (basisPoints) =>
  basisPoints >= 10_000
    ? 'full refund'
    : basisPoints <= 0
      ? 'no refund'
      : `${basisPoints / 100}% back`;

/**
 * A cancellation policy in plain words, for the tour page:
 *
 *   headline  "Free cancellation up to 48 hours before"      (null if nothing is ever free)
 *   lines     "48 hours or more before: full refund"
 *             "24 to 48 hours before: 50% back"
 *             "Less than 24 hours, or no-show: no refund"
 *             "If Ìrìn cancels, for example for weather: full refund"
 *
 * The words follow the same rules the refund engine applies (cancellation.js): a tier
 * applies when cancelling at least `hoursBefore` hours ahead, and below the lowest tier
 * nothing is refunded.
 *
 * @param {{ rules: Array<{ hoursBefore: number, refundBasisPoints: number }>, noShowRefundBasisPoints: number }} policy
 * @param {string} operatorShortName  e.g. "Ìrìn"
 */
export function describePolicy(policy, operatorShortName) {
  const rules = [...policy.rules].sort((a, b) => b.hoursBefore - a.hoursBefore);
  const free = rules.filter((r) => r.refundBasisPoints >= 10_000).at(-1);
  const headline = free
    ? free.hoursBefore === 0
      ? 'Free cancellation until the tour starts'
      : `Free cancellation up to ${free.hoursBefore} hours before`
    : null;

  /** @type {string[]} */
  const lines = [];
  rules.forEach((rule, i) => {
    const words = refundWords(rule.refundBasisPoints);
    const above = rules[i - 1];
    if (rule.hoursBefore === 0) {
      // "0 hours or more" = any time before the start, up to the next tier above.
      const noShowSame = rule.refundBasisPoints === policy.noShowRefundBasisPoints;
      lines.push(
        above
          ? `Less than ${above.hoursBefore} hours${noShowSame ? ', or no-show' : ''}: ${words}`
          : `Any time before the start: ${words}`,
      );
      if (!noShowSame) lines.push(`No-show: ${refundWords(policy.noShowRefundBasisPoints)}`);
    } else if (!above) {
      lines.push(`${rule.hoursBefore} hours or more before: ${words}`);
    } else {
      lines.push(`${rule.hoursBefore} to ${above.hoursBefore} hours before: ${words}`);
    }
  });
  const lowest = rules.at(-1);
  if (lowest && lowest.hoursBefore > 0) {
    lines.push(`Less than ${lowest.hoursBefore} hours, or no-show: no refund`);
  }
  lines.push(`If ${operatorShortName} cancels, for example for weather: full refund`);
  return { headline, lines };
}

/**
 * The words next to the "from" price: "per adult" (short) and the other categories
 * ("child ₦12,500", "infant free") for the desktop booking card. Category names lose their
 * age range for this: "Child (3–12)" → "child".
 *
 * @param {Array<{ key: string, name: string, minAge: number, maxAge: number | null, amountKobo: number, isActive?: boolean }>} categories
 */
export function priceNote(categories) {
  const active = categories.filter((c) => c.isActive !== false);
  const fromKobo = fromPriceKobo(active);
  const plain = (/** @type {{ name: string }} */ c) =>
    c.name.replace(/\s*\(.*\)\s*$/, '').toLocaleLowerCase('en');
  const from =
    active.find((c) => c.amountKobo === fromKobo && isAdultCategory(c)) ??
    active.find((c) => c.amountKobo === fromKobo);
  return {
    per: from ? `per ${plain(from)}` : null,
    others: active
      .filter((c) => c !== from)
      .map((c) => `${plain(c)} ${c.amountKobo === 0 ? 'free' : formatNaira(c.amountKobo)}`),
  };
}

/**
 * When free cancellation ends for one departure, for people: "Thu 3 Dec, 09:00" (the
 * departure's start minus the policy's full-refund hours, in the operator's time zone).
 * Null when nothing is ever free, or when it's free right up to the start.
 *
 * @param {{ rules: Array<{ hoursBefore: number, refundBasisPoints: number }> }} policy
 * @param {Date | string} startsAt
 * @param {string} timeZone
 */
export function freeCancellationUntil(policy, startsAt, timeZone) {
  const free = policy.rules
    .filter((r) => r.refundBasisPoints >= 10_000)
    .sort((a, b) => a.hoursBefore - b.hoursBefore)[0];
  if (!free || free.hoursBefore === 0) return null;
  const deadline = new Date(new Date(startsAt).getTime() - free.hoursBefore * 3_600_000);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone,
    })
      .formatToParts(deadline)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.weekday} ${parts.day} ${parts.month}, ${parts.hour}:${parts.minute}`;
}
