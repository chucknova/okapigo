// @ts-check
/**
 * stops.js — the manifest of a pickup tour, by stop (designs: "Manifest with pickup points —
 * Lekki"; decided 2026-11-19: pickup times now).
 *
 *   DONE · 07:16   07:15 · Victoria Island · Eko Hotel main gate              3 of 3
 *   NEXT STOP      07:30 · Ikoyi · Falomo roundabout   [Directions]           0 of 4
 *                  … Everyone here: check in 4
 *   LATER          07:45 · Lekki Phase 1 · Admiralty Way gate                 0 of 2
 *
 * Stops are in the van's order (the tour's pickup points). A stop is DONE once nobody there is
 * still "Not yet"; the NEXT STOP is the first that isn't. "The next stop moves on by itself
 * once everyone there is checked in. A stop with someone still missing stays open."
 */
import { localTime } from '@okapigo/shared/time';
import { CAN_CHECK_IN } from './outbox.js';
import { needsOweQuestion } from './manifest.js';

/**
 * The stops, or null for a tour without pickup points (the plain manifest).
 * @param {any} m  the departure's manifest (with the outbox applied) @param {string} tz
 */
export function stopsView(m, tz) {
  const points = /** @type {any[]} */ (m.tour.pickupPoints ?? []);
  if (points.length === 0) return null;
  const live = m.bookings.filter(
    (/** @type {any} */ b) => CAN_CHECK_IN.includes(b.status) || b.status === 'no_show',
  );
  const groups = points.map((p) => ({
    key: p.name,
    time: p.time ?? null,
    area: p.name,
    place: p.address ?? '',
    directions: `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent([p.address, p.name].filter(Boolean).join(', '))}`,
    bookings: live.filter((/** @type {any} */ b) => b.pickupPoint?.name === p.name),
  }));
  // Booked without a stop (met at the start instead): last, under the meeting point.
  const elsewhere = live.filter(
    (/** @type {any} */ b) => !points.some((p) => p.name === b.pickupPoint?.name),
  );
  if (elsewhere.length) {
    groups.push({
      key: '__start',
      time: null,
      area: 'At the start',
      place: m.tour.meetingPoint?.name ?? '',
      directions: null,
      bookings: elsewhere,
    });
  }

  let nextFound = false;
  const stops = groups
    .filter((g) => g.bookings.length > 0)
    .map((g) => {
      const people = g.bookings.flatMap((/** @type {any} */ b) => b.travellers);
      const inCount = people.filter(
        (/** @type {any} */ t) => t.checkInStatus === 'present' || t.checkInStatus === 'late',
      ).length;
      const waiting = people.filter((/** @type {any} */ t) => t.checkInStatus === 'pending').length;
      const done = waiting === 0;
      const lastIn = people
        .map((/** @type {any} */ t) => t.checkedInAt)
        .filter(Boolean)
        .sort()
        .at(-1);
      const state = done ? 'done' : nextFound ? 'later' : 'next';
      if (!done) nextFound = true;
      return {
        ...g,
        bookingIds: g.bookings.map((/** @type {any} */ b) => b.id),
        state,
        tag:
          state === 'done'
            ? `DONE${lastIn ? ` · ${localTime(new Date(lastIn), tz)}` : ''}`
            : state === 'next'
              ? 'NEXT STOP'
              : 'LATER',
        count: `${inCount} of ${people.length}`,
        inCount,
        total: people.length,
      };
    });
  const next = stops.find((s) => s.state === 'next') ?? null;
  const pickedUp = stops.reduce((n, s) => n + s.inCount, 0);
  const total = stops.reduce((n, s) => n + s.total, 0);
  return { stops, next, pickedUp, total };
}

/**
 * "Everyone here: check in 4": a check-in for each booking at the stop with someone still
 * "Not yet". A booking that owes money (and hasn't been asked) is left out, to ask one by one.
 * @param {any} m @param {{ bookings: any[] }} stop
 * @returns {{ changes: any[], count: number, owing: any[] }}
 */
export function everyoneHere(m, stop) {
  const changes = [];
  const owing = [];
  let count = 0;
  for (const b of stop.bookings) {
    const waiting = b.travellers.filter((/** @type {any} */ t) => t.checkInStatus === 'pending');
    if (!waiting.length || !CAN_CHECK_IN.includes(b.status)) continue;
    if (needsOweQuestion(b, waiting[0], 'present')) {
      owing.push(b);
      continue;
    }
    count += waiting.length;
    changes.push({
      kind: /** @type {const} */ ('check_in'),
      departureId: m.departure.id,
      bookingId: b.id,
      travellerIds: waiting.map((/** @type {any} */ t) => t.id),
      status: /** @type {const} */ ('present'),
      seen: Object.fromEntries(waiting.map((/** @type {any} */ t) => [t.id, 'pending'])),
      ...(b.money.owedKobo > 0 ? { confirmOwed: true } : {}),
    });
  }
  return { changes, count, owing };
}
