// @ts-check
/**
 * seats.js — how many seats a departure can sell (16b).
 *
 * Its own capacity, but never more than its van or boat holds (decided 2026-11-20: "once a van
 * is assigned, sales stop at its seat count too"). Every place that counts seats left uses
 * this: holds (the real check, under the row lock), the public catalogue and checkout, the
 * staff views, WhatsApp.
 * @param {{ capacity: number, resource?: { seats: number } | null }} d
 */
export const seatsOf = (d) => Math.min(d.capacity, d.resource?.seats ?? Infinity);

/** Seats left to sell. @param {{ capacity: number, seatsSold: number, seatsHeld: number, resource?: { seats: number } | null }} d */
export const seatsLeft = (d) => Math.max(0, seatsOf(d) - d.seatsSold - d.seatsHeld);
