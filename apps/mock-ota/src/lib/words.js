// @ts-check
/**
 * words.js — what Sojourna's pages say, worked out from the supplier's OCTO answers. Pure: no
 * fetching, no React, so every rule here is tested on its own.
 *
 *   cards        a tour on the storefront (M1): its kind, length, from-price, free cancellation
 *   calendar     a month, Monday first, each day open, sold out or not running (M2)
 *   who          the counters: who's coming, the total, a child without an adult, too many (M2)
 *   policy       the supplier's refund tiers in words, and the deadlines for one trip (M2, M3)
 *   dates        OCTO's local times ("2026-12-12T10:00:00+01:00") as "Sat 12 Dec", "10:00"
 */
import { formatNaira } from '@okapigo/shared/money';

export const naira = formatNaira;

// --- Dates -------------------------------------------------------------------------------------

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_NAMES = [
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

/** "2026-12-12" → a Date at noon UTC (a calendar day, whatever the time zone). @param {string} date */
const dayOf = (date) => new Date(`${date.slice(0, 10)}T12:00:00Z`);

/** "Sat 12 Dec" from "2026-12-12" (or a local date-time). @param {string} date */
export const dateLabel = (date) => {
  const d = dayOf(date);
  return `${DOW[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
};

/** "10:00" from OCTO's "2026-12-12T10:00:00+01:00". @param {string} local */
export const timeOf = (local) => local.slice(11, 16);

/** "December 2026" @param {number} year @param {number} month  1–12 */
export const monthLabel = (year, month) => `${MONTH_NAMES[month - 1]} ${year}`;

/** The first and last day of a month, as OCTO dates. @param {number} year @param {number} month */
export function monthRange(year, month) {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const mm = String(month).padStart(2, '0');
  return { from: `${year}-${mm}-01`, to: `${year}-${mm}-${String(last).padStart(2, '0')}` };
}

/** The month after (+1) or before (−1). @param {number} year @param {number} month @param {number} step */
export function shiftMonth(year, month, step) {
  const d = new Date(Date.UTC(year, month - 1 + step, 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

/** "14:52" left, from seconds. @param {number} seconds */
export const clock = (seconds) => {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** "6 hours", "3.5 hours", "45 minutes" @param {number} minutes */
export function durationWords(minutes) {
  if (minutes < 60) return `${minutes} minutes`;
  const hours = Math.round((minutes / 60) * 2) / 2;
  return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
}

// --- The storefront (M1) -----------------------------------------------------------------------

/** The coloured band behind a card, in turn (designs: no photos yet). */
export const BANDS = ['#1D3FAF', '#2A5BD7', '#B8432F', '#1F6E5A', '#5B3FA8'];

/**
 * What kind of experience, on the card's band: "Pickup included" for a tour that collects
 * guests; "Day trip" for a long one; else from the supplier's label ("Boat" → "Boat trip"), or
 * a tour named for its food ("Lagos Street Food Crawl" → "Food tour").
 * @param {any} p  an OCTO product with content and pickups
 */
export function kindOf(p) {
  const option = p.options?.[0] ?? {};
  if (option.pickupRequired) return 'Pickup included';
  if ((p.durationMinutesFrom ?? 0) >= 8 * 60) return 'Day trip';
  const label = String(p.categoryLabels?.[0] ?? '');
  if (/boat/i.test(label)) return 'Boat trip';
  if (/walk|foot/i.test(label)) return 'Walking tour';
  if (/food/i.test(label) || /food/i.test(p.title ?? '')) return 'Food tour';
  return label || 'Experience';
}

/** The price per adult (the first unit, OCTO's "from"). @param {any} p */
export const fromPrice = (p) => {
  const retail = p.options?.[0]?.units?.[0]?.pricingFrom?.[0]?.retail;
  return typeof retail === 'number' ? naira(retail) : null;
};

/**
 * "Free cancellation up to 48 hours before": the earliest a full refund still holds; null when
 * the supplier gives no full refund. @param {Array<{ hoursBefore: number, refundPercent: number }> | null | undefined} rules
 */
export function freeCancellation(rules) {
  const full = (rules ?? []).filter((r) => r.refundPercent >= 100);
  if (full.length === 0) return null;
  const h = Math.min(...full.map((r) => r.hoursBefore));
  return h === 0
    ? 'Free cancellation until the start'
    : `Free cancellation up to ${h} hours before`;
}

/** @param {any} p @param {number} i  its place on the page */
export const cardOf = (p, i) => ({
  id: p.id,
  title: p.title ?? p.internalName,
  summary: p.shortDescription ?? '',
  duration: p.durationMinutesFrom ? durationWords(p.durationMinutesFrom) : null,
  price: fromPrice(p),
  kind: kindOf(p),
  band: BANDS[i % BANDS.length],
  freeCancel: freeCancellation(p.options?.[0]?.refundRules),
});

/** Where guests meet (the START location): its name and address. @param {any} p */
export function meetingPointOf(p) {
  const start = (p?.locations ?? []).find((/** @type {any} */ l) => l.types?.includes('START'));
  if (!start) return null;
  const { latitude, longitude, postalAddress } = start.place ?? {};
  return {
    name: start.title,
    address: postalAddress?.streetAddress ?? null,
    note: start.shortDescription ?? null,
    map:
      typeof latitude === 'number' && typeof longitude === 'number'
        ? `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`
        : null,
  };
}

/** The supplier's content, one kind ("INCLUSION", "PREARRIVAL_INFORMATION"…). @param {any} p @param {string} type */
export const featuresOf = (p, type) =>
  (p?.features ?? [])
    .filter((/** @type {any} */ f) => f.type === type)
    .map((/** @type {any} */ f) => f.shortDescription);

// --- The calendar (M2) -------------------------------------------------------------------------

/**
 * A month, Monday first, padded with nulls, each day with how it stands:
 *   open (bookable), soldOut (struck through), closed (not running: grey), and "4 left" when few.
 * @param {number} year @param {number} month @param {any[]} days  OCTO calendar days
 */
export function monthGrid(year, month, days) {
  const byDate = new Map(days.map((d) => [d.localDate, d]));
  const { to } = monthRange(year, month);
  const last = Number(to.slice(8));
  const firstDow = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7; // Monday = 0
  /** @type {Array<null | { date: string, n: number, state: 'open' | 'soldOut' | 'closed', left: number | null, sub: string, aria: string }>} */
  const cells = Array(firstDow).fill(null);
  for (let n = 1; n <= last; n++) {
    const date = `${year}-${String(month).padStart(2, '0')}-${String(n).padStart(2, '0')}`;
    const d = byDate.get(date);
    const state = !d || d.status === 'CLOSED' ? 'closed' : d.available ? 'open' : 'soldOut';
    const left = d?.vacancies ?? null;
    const label = `${MONTHS[month - 1]} ${n}`;
    cells.push({
      date,
      n,
      state,
      left,
      sub:
        state === 'soldOut'
          ? 'Sold out'
          : state === 'open' && left !== null && left <= 4
            ? `${left} left`
            : '',
      aria:
        state === 'closed'
          ? `${label}, not running`
          : state === 'soldOut'
            ? `${label}, sold out`
            : `${label}, open`,
    });
  }
  while (cells.length % 7) cells.push(null);
  return cells;
}

/** "Only 4 left" (red) or "9 seats left". @param {number} left */
export const seatsLabel = (left) => (left <= 4 ? `Only ${left} left` : `${left} seats left`);

// --- Who's coming (M2) -------------------------------------------------------------------------

/** "₦40,000", or "Free · needs a seat" for a free unit (an infant). @param {any} unit */
export function unitPrice(unit) {
  const retail = unit.pricingFrom?.[0]?.retail;
  if (typeof retail !== 'number') return '';
  return retail === 0 ? 'Free · needs a seat' : naira(retail);
}

/** "2 adults, 1 child" ("No one yet"). @param {any[]} units @param {Record<string, number>} counts */
export function whoWords(units, counts) {
  const parts = units
    .filter((u) => (counts[u.id] ?? 0) > 0)
    .map((u) => {
      const n = counts[u.id];
      const word = String(u.type ?? u.id).toLowerCase();
      const plural = word === 'child' ? 'children' : `${word}s`;
      return `${n} ${n === 1 ? word : plural}`;
    });
  return parts.join(', ') || 'No one yet';
}

/** What it costs. @param {any[]} units @param {Record<string, number>} counts */
export const totalKobo = (units, counts) =>
  units.reduce((sum, u) => sum + (u.pricingFrom?.[0]?.retail ?? 0) * (counts[u.id] ?? 0), 0);

/**
 * Can these people book? A unit the supplier says must be accompanied (a child, an infant) needs
 * one of its companions; infants take a seat too.
 * @param {any[]} units @param {Record<string, number>} counts @param {number | null} seatsLeft
 */
export function checkWho(units, counts, seatsLeft) {
  const used = units.reduce((n, u) => n + (counts[u.id] ?? 0), 0);
  const noAdult = units.some(
    (u) =>
      (counts[u.id] ?? 0) > 0 &&
      (u.restrictions?.accompaniedBy ?? []).length > 0 &&
      !u.restrictions.accompaniedBy.some((/** @type {string} */ id) => (counts[id] ?? 0) > 0),
  );
  const tooMany = seatsLeft !== null && used > seatsLeft;
  return { used, noAdult, tooMany, ok: used > 0 && !noAdult && !tooMany };
}

// --- The policy (M2, M3) -----------------------------------------------------------------------

/** @param {number} p */
const share = (p) => (p >= 100 ? 'full refund' : p <= 0 ? 'no refund' : `${p}%`);

/**
 * "full refund 48 h+ · 50% 24–48 h · no refund under 24 h" @param {Array<{ hoursBefore: number, refundPercent: number }> | null | undefined} rules
 */
export function policyWords(rules) {
  const r = [...(rules ?? [])].sort((a, b) => b.hoursBefore - a.hoursBefore);
  if (r.length === 0) return 'refunds decided by the operator';
  const parts = r.map((x, i) => {
    const above = r[i - 1];
    if (x.hoursBefore === 0) {
      return above
        ? `${share(x.refundPercent)} under ${above.hoursBefore} h`
        : `${share(x.refundPercent)} any time`;
    }
    return above
      ? `${share(x.refundPercent)} ${x.hoursBefore}–${above.hoursBefore} h`
      : `${share(x.refundPercent)} ${x.hoursBefore} h+`;
  });
  const lowest = r.at(-1);
  if (lowest && lowest.hoursBefore > 0) parts.push(`no refund under ${lowest.hoursBefore} h`);
  return parts.join(' · ');
}

/**
 * For one trip: "Full refund until Thu 10 Dec, 10:00. 50% until Fri 11 Dec, 10:00." (each tier
 * that gives something back, while it's still ahead).
 * @param {Array<{ hoursBefore: number, refundPercent: number }> | null | undefined} rules
 * @param {string} start  OCTO's local start ("2026-12-12T10:00:00+01:00") @param {Date} [now]
 */
export function refundDeadlines(rules, start, now = new Date()) {
  const startsAt = new Date(start);
  const offset = start.slice(19); // "+01:00": shown in the trip's own time
  const sign = offset.startsWith('-') ? -1 : 1;
  const offsetMs = sign * (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4, 6))) * 60_000;
  const lines = [...(rules ?? [])]
    .filter((r) => r.refundPercent > 0 && r.hoursBefore > 0)
    .sort((a, b) => b.hoursBefore - a.hoursBefore)
    .map((r) => ({ r, until: new Date(startsAt.getTime() - r.hoursBefore * 3_600_000) }))
    .filter((x) => x.until > now)
    .map(({ r, until }) => {
      const local = new Date(until.getTime() + offsetMs).toISOString();
      const when = `${dateLabel(local)}, ${local.slice(11, 16)}`;
      return `${r.refundPercent >= 100 ? 'Full refund' : `${r.refundPercent}%`} until ${when}.`;
    });
  return lines.join(' ') || 'No refund if cancelled now.';
}

// --- A booking (M3, M4) ------------------------------------------------------------------------

/** "Hannah" from "Hannah Weber"; "Ìrìn" from "Ìrìn Lagos Tours". @param {string} name */
export const firstWord = (name) => name.trim().split(/\s+/)[0] ?? name;

/** How many of each unit an OCTO booking has. @param {Array<{ unitId: string }>} unitItems */
export function countsOf(unitItems) {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const i of unitItems) counts[i.unitId] = (counts[i.unitId] ?? 0) + 1;
  return counts;
}

/**
 * The order's lines: "2 × Adult  ₦80,000" (the unit's name without its ages).
 * @param {any[]} units @param {Array<{ unitId: string }>} unitItems
 */
export function orderLines(units, unitItems) {
  const counts = countsOf(unitItems);
  return units
    .filter((u) => (counts[u.id] ?? 0) > 0)
    .map((u) => ({
      id: u.id,
      text: `${counts[u.id]} × ${String(u.title).replace(/\s*\(.*\)$/, '')}`,
      price: naira(counts[u.id] * (u.pricingFrom?.[0]?.retail ?? 0)),
    }));
}

/**
 * Where it starts, for a booking: its pickup ("Pickup: Ikoyi at 07:30") or the meeting point.
 * @param {any} b  an OCTO booking @param {any} p  its product
 */
export const startPlace = (b, p) =>
  b.pickupLocation
    ? `Pickup: ${b.pickupLocation.title}${b.localPickupDateTimeStart ? ` at ${timeOf(b.localPickupDateTimeStart)}` : ''}`
    : (meetingPointOf(p)?.name ?? null);

/** "Ìrìn Lagos Tours’", "Sojourna’s" @param {string} name */
export const possessive = (name) => (/s$/i.test(name) ? `${name}’` : `${name}’s`);

/** "+234 809 000 0123" from "+2348090000123" (a Nigerian number); others as they are. @param {string} e164 */
export const phoneWords = (e164) =>
  /^\+234\d{10}$/.test(e164)
    ? `+234 ${e164.slice(4, 7)} ${e164.slice(7, 10)} ${e164.slice(10)}`
    : e164;

// --- The back office (M5, 17d-2) ---------------------------------------------------------------

/**
 * "last sync 10:42" (today), "last sync Sat 21 Nov", or "not synced yet".
 * @param {string | null} at @param {Date} [now]
 */
export function lastSyncWords(at, now = new Date()) {
  if (!at) return 'not synced yet';
  const t = new Date(at);
  const sameDay = t.toDateString() === now.toDateString();
  const hhmm = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
  return sameDay
    ? `last sync ${hhmm}`
    : `last sync ${DOW[t.getDay()]} ${t.getDate()} ${MONTHS[t.getMonth()]}`;
}

/**
 * A booking's status in the back office, as the supplier says it:
 *   Confirmed · Cancelled · ₦102,000 refunded (Sojourna cancelled it: its guest asked) ·
 *   Cancelled by supplier · full refund (the business did, e.g. weather) · …
 * @param {any} stored  Sojourna's own record @param {any | null} b  the OCTO booking (null: unreachable)
 * @returns {{ text: string, tone: 'ok' | 'muted' | 'bad' }}
 */
export function statusOf(stored, b) {
  if (!b) return { text: 'Can’t reach the supplier', tone: 'bad' };
  if (b.status === 'CANCELLED') {
    const amount = b.cancellation?.refundAmount;
    const back =
      b.cancellation?.refund === 'NONE' || amount === 0
        ? 'no refund'
        : typeof amount === 'number'
          ? `${naira(amount)} refunded`
          : 'refunded';
    if (stored.cancelledAt) return { text: `Cancelled · ${back}`, tone: 'muted' };
    return {
      text: `Cancelled by supplier · ${b.cancellation?.refund === 'FULL' ? 'full refund' : back}`,
      tone: 'muted',
    };
  }
  if (b.status === 'REDEEMED') return { text: 'Checked in', tone: 'ok' };
  if (b.status === 'EXPIRED') return { text: 'Expired', tone: 'muted' };
  return { text: 'Confirmed', tone: 'ok' };
}

/**
 * One row of the back office. `action`: 'cancel' while it can be; 'too_late' once the trip has
 * started (the designs' "Too late to cancel online"); null otherwise.
 * @param {{ stored: any, booking: any | null, title: string | null }} row
 */
export function bookingRow({ stored, booking: b, title }) {
  const start = b?.availability?.localDateTimeStart ?? null;
  const counts = b ? countsOf(b.unitItems) : {};
  const units = Object.keys(counts).map((id) => ({ id, type: id }));
  return {
    ref: stored.ref,
    ilt: stored.supplierReference,
    guest: stored.lead.name,
    tour: title ?? 'A tour no longer listed',
    date: start ? `${dateLabel(start)} · ${timeOf(start)}` : '',
    who: b ? whoWords(units, counts) : '',
    total: b?.pricing ? naira(b.pricing.retail) : '',
    status: statusOf(stored, b),
    action: b?.status === 'CONFIRMED' ? (b.cancellable ? 'cancel' : 'too_late') : null,
  };
}

/** "21 days", "30 hours" (before the trip). @param {number} hours */
const howLongBefore = (hours) =>
  hours >= 48 ? `${Math.floor(hours / 24)} days` : `${Math.max(1, Math.round(hours))} hours`;

/**
 * The question before cancelling (designs: "Cancel SJ-48213?"): what goes back, under whose
 * policy, from the supplier's own preview of this booking (refundIfCancelledNow).
 * @param {ReturnType<typeof bookingRow>} row @param {any} b @param {string} supplier
 */
export function cancelWords(row, b, supplier) {
  const p = b.refundIfCancelledNow ?? { amount: 0, percent: 0, hoursBefore: null };
  const seats = b.unitItems.length;
  const share =
    p.percent >= 100 ? 'full refund' : p.amount > 0 ? `${p.percent}% back` : 'no refund';
  return {
    title: `Cancel ${row.ref}?`,
    line: [row.guest, row.tour, row.date.replace(' · ', ', '), row.who].filter(Boolean).join(' · '),
    headline:
      p.hoursBefore === null ? share : `Cancelled ${howLongBefore(p.hoursBefore)} before: ${share}`,
    money:
      p.amount > 0
        ? `${naira(p.amount)} back to the guest, under ${possessive(supplier)} policy.`
        : `Nothing goes back to the guest, under ${possessive(supplier)} policy.`,
    tone: p.amount > 0 ? 'ok' : 'warn',
    note: `${firstWord(supplier)} is told at once and the ${seats} ${seats === 1 ? 'seat goes' : 'seats go'} back on sale everywhere.`,
    button: p.amount > 0 ? `Cancel and refund ${naira(p.amount)}` : 'Cancel booking',
  };
}

/**
 * When a trip started, for "too late": "09:00 today" or "10:00 on Sat 12 Dec".
 * @param {string} start  OCTO's local start @param {Date} [now]
 */
export function startedWhen(start, now = new Date()) {
  const today = new Intl.DateTimeFormat('en-CA').format(now);
  return start.slice(0, 10) === today
    ? `${timeOf(start)} today`
    : `${timeOf(start)} on ${dateLabel(start)}`;
}
