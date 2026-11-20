// @ts-check
/**
 * templates.js — the guest messages as WhatsApp TEMPLATES (stage 14c).
 *
 * WhatsApp lets a business write freely only within 24 hours of the guest's last message.
 * Outside that window (and for a guest who has never written, like a website guest), only
 * a TEMPLATE Meta has approved may be sent: fixed words with numbered blanks, {{1}} {{2}}…,
 * filled when sending. So each of the six messages has a template version too: your wording
 * from design file 02, shaped by Meta's rules:
 *   - a template can't START or END with a blank (each ends with a short fixed line)
 *   - a blank can't hold a line break, a tab or more than 4 spaces in a row
 * The business's OWN edited wording can't be used here (Meta approves the text once); inside
 * the window, the editable wording is sent as it is.
 *
 * The texts below are what you submit in Meta (WhatsApp Manager → Message templates), in the
 * "Utility" category, language English: see docs/learning/14c-whatsapp-templates.md.
 */

/** @typedef {import('@okapigo/shared/message-templates').MessageKind} MessageKind */
/** @typedef {import('@okapigo/shared/message-templates').Placeholder} Placeholder */

/**
 * The seven guest messages ("Date changed" since 16d-2), and one the inbox sends (16d-1, decided 2026-11-21): "Can we help you
 * finish booking?", for a guest who last wrote over 24 hours ago. It only ever goes OUTSIDE the
 * window, so it has no editable wording: Meta's approved text is the message.
 * @type {Record<MessageKind | 'chat_followup', { name: string, text: string, params: Placeholder[] }>}
 *   text: what Meta approves; params: which placeholder fills {{1}}, {{2}}…, in order
 */
export const WHATSAPP_TEMPLATES = {
  booking_confirmed: {
    name: 'okapigo_booking_confirmed',
    text: 'Hi {{1}}, your booking is confirmed!\n\n{{2}}\n{{3}}, {{4}}\nMeet at {{5}}\n{{6}} · Ref {{7}}\n\nYour ticket and map:\n{{8}}\n\nSee you soon!',
    params: [
      'first_name',
      'tour',
      'date',
      'time',
      'meeting_point',
      'travellers',
      'reference',
      'trip_url',
    ],
  },
  deposit_received: {
    name: 'okapigo_deposit_received',
    text: 'Hi {{1}}, we got your deposit of {{2}} for the {{3}} on {{4}}. You’re booked!\n\nBalance: {{5}}, due by {{6}}.\nPay any time here:\n{{7}}\n\nThank you!',
    params: ['first_name', 'deposit', 'tour', 'date', 'balance', 'due_date', 'pay_url'],
  },
  balance_reminder: {
    name: 'okapigo_balance_reminder',
    text: 'Hi {{1}}, a reminder: {{2}} is due by {{3}} for your {{4}} on {{5}} ({{6}}).\n\nPay here:\n{{7}}\n\nCan’t make it? Just reply and we’ll help.',
    params: ['first_name', 'balance', 'due_date', 'tour_short', 'date', 'reference', 'pay_url'],
  },
  payment_link: {
    name: 'okapigo_payment_link',
    text: 'Hi {{1}}, here’s your payment link from {{2}}.\n\n{{3}}\n{{4}}\nValid until {{5}}\n\n{{6}}\n\nReply here if you have any questions.',
    params: ['first_name', 'operator', 'link_for', 'amount', 'expiry', 'link_url'],
  },
  booking_cancelled: {
    name: 'okapigo_booking_cancelled',
    text: 'Hi {{1}}, your booking {{2}} ({{3}}, {{4}}) is cancelled.\n\n{{5}}\n\nReply here if you have any questions.',
    params: ['first_name', 'reference', 'tour_short', 'date', 'refund_line'],
  },
  booking_moved: {
    name: 'okapigo_booking_moved',
    text: 'Hi {{1}}, your booking {{2}} has moved.\n\n{{3}}\nNow on {{4}}, {{5}} (was {{6}})\nMeet at {{7}}\n\nYour ticket and trip page have the new date:\n{{8}}\n\nSee you then!',
    params: [
      'first_name',
      'reference',
      'tour',
      'date',
      'time',
      'from_date',
      'meeting_point',
      'trip_url',
    ],
  },
  chat_followup: {
    name: 'okapigo_chat_followup',
    text: 'Hi {{1}}, it’s {{2}} on WhatsApp. Can we help you finish booking?\n\nJust reply to this message and we’ll pick up where you left off.',
    params: ['first_name', 'operator'],
  },
  refund_sent: {
    name: 'okapigo_refund_sent',
    text: 'Hi {{1}}, your refund of {{2}} for {{3}} has been sent.\n\nIt may take 5–10 working days to show in your account, depending on your bank.',
    params: ['first_name', 'refund', 'reference'],
  },
};

/**
 * A value as Meta accepts it in a blank: one line, no tabs, no long runs of spaces, not empty.
 * @param {string} value
 */
export const blank = (value) =>
  (value ?? '')
    .replace(/\s*\n+\s*/g, ' ')
    .replace(/\t/g, ' ')
    .replace(/ {4,}/g, '   ')
    .trim() || '-';

/**
 * The template for one message, filled for this guest: what's stored in the chat (so staff
 * and the simulator see the words) and what's sent to Meta outside the window.
 * @param {MessageKind | 'chat_followup'} kind @param {Partial<Record<Placeholder, string>>} values
 * @returns {{ name: string, params: string[], text: string }}
 */
export function fillTemplate(kind, values) {
  const t = WHATSAPP_TEMPLATES[kind];
  const params = t.params.map((p) => blank(values[p] ?? ''));
  const text = t.text.replace(/\{\{(\d+)\}\}/g, (_, n) => params[Number(n) - 1] ?? '');
  return { name: t.name, params, text };
}
