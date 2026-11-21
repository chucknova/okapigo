// @ts-check
/**
 * message-templates.js — the guest messages OkapiGo sends (OPS-11, session 14), and their
 * default wording: yours, from design file 02 ("WhatsApp and SMS wording", subject lines).
 *
 * A template is { subject, body }. The body is the WhatsApp message as it is, and the words
 * inside the email layout (stage 14b); the subject is the email's. {placeholders} are filled
 * from the booking when the message is sent. An operator may write their own (the
 * message_templates table); these are what everyone starts with.
 *
 * Pure: no database, so the API, the preview and the tests all use exactly the same rules.
 */

/** @typedef {'booking_confirmed' | 'deposit_received' | 'balance_reminder' | 'payment_link' | 'booking_cancelled' | 'refund_sent' | 'booking_moved' | 'trip_link'} MessageKind */

/** Every placeholder, and what it becomes ("Sat 5 Dec"). */
export const PLACEHOLDERS = /** @type {const} */ ({
  first_name: 'The lead guest’s first name: “Adaeze” (“there” if none was given)',
  operator: 'Your business’s name: “Ìrìn Lagos Tours”',
  reference: 'The booking reference: “ILT-7K4Q2M”',
  tour: 'The tour’s title: “Lagos Island Heritage Walk”',
  tour_short: 'The tour’s short name: “Heritage Walk”',
  date: 'The trip’s day: “Sat 5 Dec”',
  time: 'The start time: “09:00”',
  meeting_point: 'Where to meet (or the pickup): “Tinubu Square, Broad Street”',
  travellers: 'How many are coming: “3 travellers”',
  trip_url: 'The guest’s trip page (ticket, map, what to bring)',
  deposit: 'The deposit paid: “₦19,500”',
  balance: 'What’s still to pay: “₦45,500”',
  due_date: 'When the balance is due: “Sat 28 Nov”',
  pay_url: 'The page where the guest pays the balance',
  amount: 'A payment link’s amount: “₦45,500”',
  link_for: 'What a payment link is for: “Balance for Badagry Heritage Day Trip, Sat 5 Dec”',
  expiry: 'When a payment link stops working: “Tue 24 Nov”',
  link_url: 'The payment link itself',
  refund_line:
    'The refund, worked out by the policy: “Refund: ₦31,250 (50%, cancelled 30 hours before).…”',
  refund: 'The refund sent: “₦31,250”',
  from_date: 'The day a moved booking was on before: “Sat 5 Dec”',
  booked_through: 'The travel website the guest booked on: “Sojourna”',
});

/** @typedef {keyof typeof PLACEHOLDERS} Placeholder */

const COMMON = /** @type {Placeholder[]} */ ([
  'first_name',
  'operator',
  'reference',
  'tour',
  'tour_short',
  'date',
  'time',
]);

/**
 * The eight messages ("Date changed" since 16d-2; "Trip page link", for a travel website's
 * guests, since 17c-3): when each goes, what it may say, what it MUST say (the brief's "must
 * include", so an edit can't drop the link or the amount), and your default wording.
 * @type {Record<MessageKind, {
 *   name: string, when: string,
 *   placeholders: Placeholder[], required: Placeholder[],
 *   subject: string, body: string,
 * }>}
 */
export const MESSAGES = {
  booking_confirmed: {
    name: 'Booking confirmation',
    when: 'when a booking is paid in full (or confirmed with nothing to pay)',
    placeholders: [...COMMON, 'meeting_point', 'travellers', 'trip_url'],
    required: ['reference', 'trip_url'],
    subject: 'Booking confirmed: {tour_short}, {date} ({reference})',
    body: 'Hi {first_name}, your booking is confirmed!\n\n{tour}\n{date}, {time}\nMeet at {meeting_point}\n{travellers} · Ref {reference}\n\nYour ticket and map:\n{trip_url}',
  },
  deposit_received: {
    name: 'Deposit received',
    when: 'when a deposit is paid',
    placeholders: [...COMMON, 'deposit', 'balance', 'due_date', 'pay_url', 'trip_url'],
    required: ['balance', 'due_date', 'pay_url'],
    subject: 'Deposit received: balance due {due_date}',
    body: 'Hi {first_name}, we got your deposit of {deposit} for the {tour} on {date}. You’re booked!\n\nBalance: {balance}, due by {due_date}.\nPay any time here:\n{pay_url}',
  },
  balance_reminder: {
    name: 'Balance reminder',
    when: '7, 3 and 1 days before the balance is due',
    placeholders: [...COMMON, 'balance', 'due_date', 'pay_url'],
    required: ['balance', 'due_date', 'pay_url'],
    subject: 'Reminder: {balance} due by {due_date}',
    body: 'Hi {first_name}, a reminder: {balance} is due by {due_date} for your {tour_short} on {date} ({reference}).\n\nPay here:\n{pay_url}\n\nCan’t make it? Just reply and we’ll help.',
  },
  payment_link: {
    name: 'Payment link',
    when: 'when a member of staff sends one',
    placeholders: [...COMMON, 'amount', 'link_for', 'expiry', 'link_url'],
    required: ['amount', 'link_url'],
    subject: 'Payment request from {operator}',
    body: 'Hi {first_name}, here’s your payment link from {operator}.\n\n{link_for}\n{amount}\nValid until {expiry}\n\n{link_url}',
  },
  booking_cancelled: {
    name: 'Cancellation',
    when: 'when a paid booking is cancelled (by the guest or by staff)',
    placeholders: [...COMMON, 'refund_line'],
    required: ['reference', 'refund_line'],
    subject: 'Your booking {reference} is cancelled',
    body: 'Hi {first_name}, your booking {reference} ({tour_short}, {date}) is cancelled.\n\n{refund_line}',
  },
  refund_sent: {
    name: 'Refund sent',
    when: 'when the refund has left (the payment provider confirms it)',
    placeholders: [...COMMON, 'refund'],
    required: ['refund'],
    subject: 'Your refund of {refund} is on its way',
    // Your design ends "We hope to walk Lagos with you another time.": that's Ìrìn's own
    // line, so it's Ìrìn's template (the seed); everyone else starts with this.
    body: 'Hi {first_name}, your refund of {refund} for {reference} has been sent.\n\nIt may take 5–10 working days to show in your account, depending on your bank.\n\nWe hope to see you again soon.',
  },
  booking_moved: {
    name: 'Date changed',
    when: 'when a member of staff moves a booking to another date',
    placeholders: [...COMMON, 'from_date', 'meeting_point', 'travellers', 'trip_url'],
    required: ['date', 'time', 'trip_url'],
    subject: 'New date: {tour_short}, {date} ({reference})',
    body: 'Hi {first_name}, your booking {reference} has moved.\n\n{tour}\nNow on {date}, {time} (was {from_date})\nMeet at {meeting_point}\n\nYour ticket and trip page have the new date:\n{trip_url}',
  },
  // A travel website's guest (17c-3, decided 2026-11-21): the website sends its own confirmation
  // and handles the money; the business sends the trip page, by email (OCTO always gives one).
  trip_link: {
    name: 'Trip page link',
    when: 'when a travel website (an OTA) sells a booking: it sends its own confirmation',
    placeholders: [...COMMON, 'meeting_point', 'travellers', 'trip_url', 'booked_through'],
    required: ['trip_url'],
    subject: 'Your trip page: {tour_short}, {date} ({reference})',
    body: 'Hi {first_name}, this is {operator}: we run your {tour} on {date}, {time}.\n\nMeet at {meeting_point}\n{travellers} · Ref {reference}\n\nYour ticket, the map and what to bring:\n{trip_url}\n\nYou booked through {booked_through}: changes and cancellations go through them.',
  },
};

export const MESSAGE_KINDS = /** @type {MessageKind[]} */ (Object.keys(MESSAGES));

export const LIMITS = { subject: 150, body: 1500 };

const PLACEHOLDER = /\{([a-z_]+)\}/g;

/**
 * Fills the {placeholders}. Every one a template may use has a value when it's sent (an
 * empty one becomes ""), so nothing like "{date}" ever reaches a guest.
 * @param {string} text @param {Partial<Record<Placeholder, string>>} values
 */
export function renderTemplate(text, values) {
  return text.replace(PLACEHOLDER, (_, name) => values[/** @type {Placeholder} */ (name)] ?? '');
}

/**
 * What's wrong with an edited template, in words for staff; [] when it's fine.
 * @param {MessageKind} kind @param {{ subject: string, body: string }} t
 * @returns {string[]}
 */
export function checkTemplate(kind, { subject, body }) {
  const m = MESSAGES[kind];
  /** @type {string[]} */
  const problems = [];
  if (!subject.trim()) problems.push('The subject can’t be empty.');
  if (!body.trim()) problems.push('The message can’t be empty.');
  if (subject.length > LIMITS.subject)
    problems.push(`Keep the subject under ${LIMITS.subject} characters.`);
  if (body.length > LIMITS.body) problems.push(`Keep the message under ${LIMITS.body} characters.`);
  if (/\n/.test(subject)) problems.push('The subject must be one line.');
  for (const [where, text] of /** @type {const} */ ([
    ['subject', subject],
    ['message', body],
  ])) {
    for (const [, name] of text.matchAll(PLACEHOLDER)) {
      if (!m.placeholders.includes(/** @type {Placeholder} */ (name))) {
        problems.push(
          `{${name}} can’t be used in ${where === 'subject' ? 'the subject' : 'this message'}.`,
        );
      }
    }
    // A brace left over ("{date" or "date}") would reach the guest as it is.
    if (/[{}]/.test(text.replace(PLACEHOLDER, ''))) {
      problems.push(`The ${where} has a { or } that isn’t part of a placeholder.`);
    }
  }
  for (const name of m.required) {
    if (!body.includes(`{${name}}`)) problems.push(`The message must include {${name}}.`);
  }
  return [...new Set(problems)];
}
