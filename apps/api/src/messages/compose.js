// @ts-check
/**
 * compose.js — turning a planned guest message into words (OPS-11, stage 14a).
 *
 *   templateFor(prisma, operatorId, kind)   the business's own wording, or the default
 *   messageValues(deps, booking, message)   what each {placeholder} becomes for this guest
 *   compose(deps, booking, message)         → { subject, body }
 *
 * Values come from the booking as it is now, plus what was frozen when the message was
 * decided (the deposit, the refund the policy gave, the link's amount): a reminder says the
 * balance that was due when it was written, even if a payment arrives a second later.
 */
import { guestToken } from '@okapigo/db';
import { MESSAGES, renderTemplate } from '@okapigo/shared/message-templates';
import { formatNaira } from '@okapigo/shared/money';
import { formatLocalDay } from '@okapigo/shared/preview';
import { localDate } from '@okapigo/shared/time';
import { balanceDueDate } from '@okapigo/shared/deposits';
import { clock, day, pickupWhere } from '../whatsapp/engine.js';
import { firstName } from '../whatsapp/messages.js';

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} operatorId
 * @param {import('@okapigo/shared/message-templates').MessageKind} kind
 * @returns {Promise<{ subject: string, body: string, custom: boolean }>}
 */
export async function templateFor(prisma, operatorId, kind) {
  const own = await prisma.messageTemplate.findUnique({
    where: { operatorId_kind: { operatorId, kind } },
  });
  return own
    ? { subject: own.subject, body: own.body, custom: true }
    : { subject: MESSAGES[kind].subject, body: MESSAGES[kind].body, custom: false };
}

/** "30 hours", "3 days". @param {number} hours */
const howLong = (hours) =>
  hours < 48 ? `${Math.max(0, Math.round(hours))} hours` : `${Math.floor(hours / 24)} days`;

/**
 * The refund, in the guest's words (your design: "Refund: ₦31,250 (50%, cancelled 30 hours
 * before). It goes back to the card or account you paid with.…").
 * @param {any} refund  frozen when the booking was cancelled
 * @param {number} amountPaidKobo
 * @param {{ initiatedBy?: string | null, reason?: string | null }} [who]  the business called it off?
 */
export function refundLine(refund, amountPaidKobo, { initiatedBy = null, reason = null } = {}) {
  // The business called the trip off (a whole departure, stage 15a; or staff for this booking):
  // always a full refund (the policy's "if the operator cancels" rule), and why, if given.
  if (initiatedBy === 'operator') {
    // "…because of the weather on the lagoon." (16b: the reason is written to follow "because of").
    const why = reason ? reason.trim().replace(/[.\s]+$/, '') : '';
    const sorry = `We’re sorry: we had to cancel this trip${why ? ` because of ${why.charAt(0).toLowerCase()}${why.slice(1)}` : ''}.`;
    if (!refund || amountPaidKobo === 0)
      return `${sorry} Nothing was paid, so there’s nothing to refund.`;
    return `${sorry} You’ll get a full refund of ${formatNaira(refund.refundKobo)}, back to the card or account you paid with. We’ll message you when it’s sent.`;
  }
  if (!refund || amountPaidKobo === 0) return 'Nothing was paid, so there’s nothing to refund.';
  const when =
    refund.hoursBefore !== null && refund.hoursBefore !== undefined
      ? `cancelled ${howLong(refund.hoursBefore)} before`
      : null;
  if (refund.refundKobo === 0) {
    return `No refund is due under the booking terms${when ? ` (${when})` : ''}.`;
  }
  const why =
    !refund.overridden && refund.refundBasisPoints !== null && when
      ? ` (${Math.round(refund.refundBasisPoints / 100)}%, ${when})`
      : '';
  return `Refund: ${formatNaira(refund.refundKobo)}${why}.\nIt goes back to the card or account you paid with. We’ll message you when it’s sent.`;
}

/**
 * @param {{ authSecret: string, webPublicUrl: string }} deps
 * @param {any} booking  with product.operator, departure, travellers
 * @param {{ kind: string, data: any }} message
 * @returns {Partial<Record<import('@okapigo/shared/message-templates').Placeholder, string>>}
 */
export function messageValues(deps, booking, message) {
  const operator = booking.product.operator;
  const tz = operator.timeZone;
  const web = deps.webPublicUrl.replace(/\/+$/, '');
  const token = guestToken(deps.authSecret, booking.id);
  const data = message.data ?? {};
  const n = booking.travellers.length;
  const tripDate = localDate(booking.departure.startsAt, tz);
  const mp = booking.product.meetingPoint ?? {};
  const pickup = /** @type {any} */ (booking.pickupPoint);
  const date = day(booking.departure.startsAt, tz);
  const balanceKobo = data.balanceKobo ?? booking.totalKobo - booking.amountPaidKobo;
  const linkFor = {
    full: 'Payment for',
    balance: 'Balance for',
    deposit: 'Deposit for',
    custom: 'Payment for',
  }[/** @type {string} */ (data.purpose)];
  return {
    first_name: firstName(booking.leadName ?? '') || 'there',
    operator: operator.name,
    reference: booking.reference,
    tour: booking.product.title,
    tour_short: booking.product.shortTitle ?? booking.product.title,
    date,
    time: clock(booking.departure.startsAt, tz),
    meeting_point: pickup ? pickupWhere(pickup) : [mp.name, mp.address].filter(Boolean).join(', '),
    travellers: `${n} ${n === 1 ? 'traveller' : 'travellers'}`,
    trip_url: `${web}/trip/${token}`,
    pay_url: `${web}/trip/${token}/pay`,
    deposit: formatNaira(data.depositKobo ?? booking.amountPaidKobo),
    balance: formatNaira(balanceKobo),
    due_date: formatLocalDay(balanceDueDate(tripDate)),
    amount: data.amountKobo !== undefined ? formatNaira(data.amountKobo) : '',
    link_for: linkFor ? `${linkFor} ${booking.product.title}, ${date}` : '',
    expiry: data.expiresAt ? formatLocalDay(localDate(new Date(data.expiresAt), tz)) : '',
    link_url: data.url ?? '',
    refund_line: refundLine(data.refund, booking.amountPaidKobo, {
      initiatedBy: data.initiatedBy ?? null,
      reason: data.reason ?? null,
    }),
    refund: data.refundKobo !== undefined ? formatNaira(data.refundKobo) : '',
  };
}

/**
 * The message's words, ready to send.
 * @param {{ prisma: import('@prisma/client').PrismaClient, authSecret: string, webPublicUrl: string }} deps
 * @param {any} booking @param {{ kind: string, data: any }} message
 */
export async function compose(deps, booking, message) {
  // A staff member's own words, sent by email when WhatsApp couldn't deliver them (16d-1):
  // no template; the subject says who it's from.
  if (message.kind === 'staff_message') {
    const values = messageValues(deps, booking, message);
    const who = String(message.data?.staffName ?? '')
      .trim()
      .split(/\s+/)[0];
    return {
      subject: `A message from ${who ? `${who} at ` : ''}${booking.product.operator.name}`,
      body: String(message.data?.text ?? ''),
      values,
    };
  }
  const kind = /** @type {import('@okapigo/shared/message-templates').MessageKind} */ (
    message.kind
  );
  const t = await templateFor(deps.prisma, booking.operatorId, kind);
  const values = messageValues(deps, booking, message);
  return {
    subject: renderTemplate(t.subject, values),
    body: renderTemplate(t.body, values),
    values,
  };
}
