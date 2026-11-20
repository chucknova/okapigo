// @ts-check
/**
 * board.js — what the schedule (O6) and a departure's page (O7) show, from the server's week
 * and overview (packages/db/src/board.js). Wording and choices only; the screens lay it out.
 */

/**
 * One departure's card on the schedule.
 * @param {any} c  a card from /api/schedule/week
 * @param {{ phone?: boolean }} [o]
 */
export function cardView(c, { phone = false } = {}) {
  const cancelled = c.status === 'cancelled';
  return {
    tag: c.tag,
    tagTone: c.tag === 'SOLD OUT' ? 'warning' : c.tag === 'CANCELLED' ? 'muted' : 'urgent',
    seats: cancelled
      ? `Cancelled${c.cancelReason ? ` · ${shortReason(c.cancelReason)}` : ''}`
      : phone
        ? `${c.sold} / ${c.seats}`
        : `${c.sold} / ${c.seats} seats`,
    guide: cancelled
      ? 'Guests told and refunded'
      : c.guide
        ? phone
          ? `Guide: ${c.guide}`
          : c.guide
        : phone && c.needsGuide
          ? 'No guide yet · assign'
          : 'No guide yet',
    guideTone: !cancelled && c.needsGuide ? 'urgent' : 'ink',
    alert: !cancelled && c.needsGuide,
    cancelled,
    barTone: c.full ? 'warning' : 'ok',
  };
}

/** "the weather on the lagoon" → "weather" (a card has room for a word). @param {string} reason */
export function shortReason(reason) {
  const words = reason.replace(/^(the|a|an|bad)\s+/i, '').split(/\s+/);
  return words[0] ?? reason;
}

/**
 * The week, with only one tour's departures (or all). @param {any} week @param {string | null} tour
 */
export function filterWeek(week, tour) {
  if (!tour) return week;
  const days = week.days.map((/** @type {any} */ d) => ({
    ...d,
    cards: d.cards.filter((/** @type {any} */ c) => c.tourSlug === tour),
  }));
  return {
    ...week,
    days: days.map((/** @type {any} */ d) => ({
      ...d,
      flag: d.cards.some((/** @type {any} */ c) => c.needsGuide),
    })),
    withoutGuide: days.reduce(
      (/** @type {number} */ n, /** @type {any} */ d) =>
        n + d.cards.filter((/** @type {any} */ c) => c.needsGuide).length,
      0,
    ),
  };
}

/** On a phone, the day shown first: today if it's in this week, else the Monday. @param {any} week */
export const firstDay = (week) =>
  week.days.some((/** @type {any} */ d) => d.date === week.today) ? week.today : week.start;

/** "5 departures" @param {number} n */
export const departuresText = (n) => `${n} ${n === 1 ? 'departure' : 'departures'}`;

/**
 * The guests' sentence when a departure is called off (as the message will say it, 16b).
 * @param {string} reason
 */
export function cancelSentence(reason) {
  const why = reason.trim().replace(/[.\s]+$/, '');
  return `“We’re sorry: we had to cancel this trip${why ? ` because of ${why.charAt(0).toLowerCase()}${why.slice(1)}` : ''}.”`;
}

/**
 * After cancelling: "Cancelled. 4 refunds started, 4 bookings told." (designs: Cancelling).
 * @param {{ bookingsCancelled: number, refundsStarted: number, refundsFailed: number }} r
 */
export function cancelledText(r) {
  const parts = [
    `${r.refundsStarted} ${r.refundsStarted === 1 ? 'refund' : 'refunds'} started`,
    `${r.bookingsCancelled} ${r.bookingsCancelled === 1 ? 'booking' : 'bookings'} told`,
  ];
  const failed = r.refundsFailed
    ? ` ${r.refundsFailed} ${r.refundsFailed === 1 ? 'refund' : 'refunds'} didn’t start: see Today.`
    : ' Any refund that fails shows on Today.';
  return `Cancelled. ${parts.join(', ')}.${failed}`;
}

/**
 * What the assign button says (designs: "Assign Amaka"). @param {any} guide @param {any} current
 */
export const assignLabel = (guide, current) =>
  !guide
    ? 'Choose a guide'
    : current?.id === guide.id
      ? `${guide.name} is assigned`
      : `Assign ${guide.name}`;
