// @ts-check
/**
 * states.js — the designs' states ("Sojourna — states"), in words: what happened, and what to
 * do. Each returns { tone, tag, title, body } for StatePanel.
 */

/** M1 · the supplier isn't answering. @param {string} supplier */
export const offline = (supplier) => ({
  tone: /** @type {const} */ ('bad'),
  tag: 'SUPPLIER OFFLINE',
  title: `${supplier} isn’t answering right now`,
  body: 'We can’t show live prices or seats, so you can’t book these experiences at the moment. Please try again in a few minutes.',
});

/** M1 · nothing on this channel. @param {string} supplier */
export const nothingListed = (supplier) => ({
  tone: /** @type {const} */ ('info'),
  tag: 'NOTHING LISTED',
  title: `No experiences from ${supplier} right now`,
  body: 'They haven’t put any tours on Sojourna yet, or they’ve paused them.',
});

/**
 * M2 → M3 · seats went between loading the page and Continue.
 * @param {number} left @param {string} time  "10:00"
 */
export const justTaken = (left, time) => ({
  tone: /** @type {const} */ ('warn'),
  tag: 'JUST TAKEN',
  title: 'Someone just took the last seats',
  body: `Between loading this page and pressing Continue, those seats were booked (perhaps on the operator’s own website). ${
    left === 0 ? 'None are' : left === 1 ? '1 seat is' : `${left} seats are`
  } left at ${time}.`,
});

/** M3 · the hold ran out. */
export const holdRanOut = () => ({
  tone: /** @type {const} */ ('warn'),
  tag: 'TIME’S UP',
  title: 'Your seats were released',
  body: 'You had 15 minutes to pay. The seats went back on sale so others could book. They may still be free.',
});

/** M3 · the supplier didn't confirm. @param {string} supplier @param {string | null} until  "11:20" */
export const notConfirmed = (supplier, until) => ({
  tone: /** @type {const} */ ('bad'),
  tag: 'NOT CONFIRMED',
  title: 'We couldn’t confirm your booking',
  body: `${supplier} didn’t confirm in time. You haven’t been charged.${until ? ` Your seats are still held until ${until}.` : ''}`,
});
