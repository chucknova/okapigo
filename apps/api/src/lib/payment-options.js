// @ts-check
/**
 * payment-options.js — what a guest can pay for a booking RIGHT NOW (stage 11c), on every
 * channel: the website's review screen (stage 12d) and the WhatsApp assistant (stage 13b).
 * The guest is only ever offered what the server will accept.
 */
import { PAYABLE_STATUSES } from '@okapigo/db';
import { depositOffer } from '@okapigo/shared/deposits';
import { localDate } from '@okapigo/shared/time';

/**
 * @typedef {{ type: 'full', amountKobo: number }
 *   | { type: 'deposit', amountKobo: number, balanceKobo: number, balanceDueDate: string }
 *   | { type: 'balance', amountKobo: number }} PaymentOption
 */

/**
 * What the guest can pay right now. Shown on the review screen AND used to check "Pay", so
 * the screen can only offer what the server will accept.
 *   held, hold still on  → full, plus a deposit if the tour allows one (deposits.js)
 *   confirmed / part_paid / amended with money owed → the balance
 *   anything else (paid, cancelled, hold expired…) → nothing
 * @param {any} b  booking with product.operator, departure, hold
 * @param {Date} now
 * @returns {PaymentOption[]}
 */
export function paymentOptions(b, now) {
  const balanceKobo = b.totalKobo - b.amountPaidKobo;
  if (balanceKobo <= 0 || !PAYABLE_STATUSES.includes(b.status)) return [];
  if (b.status !== 'held') return [{ type: 'balance', amountKobo: balanceKobo }];
  if (b.hold.status !== 'active' || b.hold.expiresAt <= now) return [];

  const { timeZone } = b.product.operator;
  const deposit = depositOffer({
    totalKobo: b.totalKobo,
    amountPaidKobo: b.amountPaidKobo,
    depositBasisPoints: b.product.depositBasisPoints,
    departureLocalDate: localDate(b.departure.startsAt, timeZone),
    todayLocalDate: localDate(now, timeZone),
  });
  /** @type {PaymentOption[]} */
  const options = [{ type: 'full', amountKobo: balanceKobo }];
  if (deposit) {
    options.push({
      type: 'deposit',
      amountKobo: deposit.depositKobo,
      balanceKobo: deposit.balanceKobo,
      balanceDueDate: deposit.balanceDueDate,
    });
  }
  return options;
}
