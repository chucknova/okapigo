// @ts-check
/**
 * today.js — what Today (O2) shows about each departure, worked out from the package.
 *
 *   07:00                    Starts in 20 min | Started 07:00 | Starts at 07:00 | Ended
 *   Badagry Heritage Day Trip
 *   Ìrìn office, Yaba
 *   Van 1 · 14 seats · Driver: Sola       (the van or boat, and the departure's note)
 *   8 of 12 checked in (3 not sent yet)   back about 17:00
 *   1 booking still owes money · 6 lunches · 1 no peanuts
 */
import { localDate, localTime } from '@okapigo/shared/time';
import { CAN_CHECK_IN } from './outbox.js';

/**
 * Today's and tomorrow's departures, from the package's two days. A departure on another day
 * (the package is from an earlier day) isn't today's.
 * @param {any} pkg @param {Date} now
 */
export function daysOf(pkg, now) {
  const tz = pkg?.operator?.timeZone ?? 'Africa/Lagos';
  const today = localDate(now, tz);
  const all = pkg?.departures ?? [];
  const on = (/** @type {string} */ d) =>
    all.filter((/** @type {any} */ m) => m.departure.localDate === d);
  const tomorrowDate = pkg?.days?.find((/** @type {string} */ d) => d > today) ?? null;
  return {
    today: on(today),
    tomorrow: tomorrowDate ? on(tomorrowDate) : [],
    tomorrowDate,
    // The package doesn't cover today (it was saved days ago: "No saved trips for today").
    coversToday: Boolean(pkg?.days?.includes(today)),
  };
}

/** @param {number} n @param {string} one @param {string} [many] */
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The facts on one departure's card.
 * @param {any} m  one departure's manifest (with the outbox applied: outbox.js withChanges)
 * @param {Date} now @param {string} tz
 */
export function cardFacts(m, now, tz) {
  const starts = new Date(m.departure.startsAt);
  const ends = new Date(m.departure.endsAt);
  const mins = Math.round((starts.getTime() - now.getTime()) / 60_000);
  const when =
    now >= ends
      ? 'Ended'
      : mins <= 0
        ? `Started ${localTime(starts, tz)}`
        : mins <= 120
          ? `Starts in ${mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)} h ${mins % 60} min`}`
          : null;
  const c = m.counts;
  const checkedIn = c.present + c.late;
  const unsent = c.unsent ? ` (${c.unsent} not sent yet)` : '';
  const live = m.bookings.filter((/** @type {any} */ b) => CAN_CHECK_IN.includes(b.status));
  const owing = live.filter((/** @type {any} */ b) => b.money.owedKobo > 0).length;
  /** @type {Map<string, number>} */
  const extras = new Map();
  for (const b of live)
    for (const a of b.addOns ?? []) extras.set(a.name, (extras.get(a.name) ?? 0) + a.quantity);
  /** @type {Map<string, number>} */
  const diets = new Map();
  for (const b of live) {
    for (const t of b.travellers) {
      const d = (t.dietaryNeeds ?? '').trim().toLowerCase();
      if (d) diets.set(d, (diets.get(d) ?? 0) + 1);
    }
  }
  const notes = [
    owing ? `${plural(owing, 'booking')} still ${owing === 1 ? 'owes' : 'owe'} money` : null,
    ...[...extras].map(([name, n]) => `${n} ${n === 1 ? name.toLowerCase() : pluralName(name)}`),
    ...[...diets].map(([d, n]) => `${n} ${d}`),
  ].filter(Boolean);
  const r = m.resource;
  const resource = [r ? `${r.name} · ${r.seats} seats` : null, m.departure.notes || null]
    .filter(Boolean)
    .join(' · ');
  return {
    time: localTime(starts, tz),
    when,
    title: m.tour.title,
    meetingPoint: m.tour.meetingPoint?.name ?? null,
    resource: resource || null,
    checkedIn,
    countText: `${checkedIn} of ${c.travellers} checked in${unsent}`,
    pct: c.travellers ? Math.max(2, Math.round((checkedIn / c.travellers) * 100)) : 0,
    back: `back about ${localTime(ends, tz)}`,
    booked: `${c.travellers} booked`,
    notes: notes.join(' · '),
  };
}

/** "Lunch" → "lunches", "Palm wine sampler" → "palm wine samplers". @param {string} name */
function pluralName(name) {
  const n = name.toLowerCase();
  return /(s|x|ch|sh)$/.test(n) ? `${n}es` : `${n}s`;
}
