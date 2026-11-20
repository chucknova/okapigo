// @ts-check
/**
 * email.js — a guest message as an email (OPS-11, stage 14b), in your layout from design
 * file 02 ("Email layout · booking confirmation"): 600 px at most, one column, system fonts,
 * no images. The same layout for every message; only the middle changes.
 *
 *   the business       its letter in a dark square, and its name
 *   the middle         a coloured line ("Booking confirmed"), the headline ("See you on Sat 5
 *                      Dec, Adaeze!"), the template's WORDS (decided 2026-11-19: the card plus
 *                      the words), the reference box with the money, the details table, the
 *                      button, short notes
 *   the footer         how to reach the business, its place, the booking terms, "Bookings by
 *                      OkapiGo"
 *
 * Emails need their styles INLINE (most mail apps drop <style> blocks) and are laid out with
 * tables, which every mail app draws the same. Every value from a guest or staff (names, the
 * template's words) is escaped: an email is HTML, and a name like "<b>" must stay text.
 * A plain-text copy goes with it, for mail apps that don't show HTML.
 */
import { LAGOON } from '@okapigo/shared/tokens';
import { formatNaira } from '@okapigo/shared/money';
import { isAdultCategory } from '@okapigo/shared/catalogue';
import { formatAt } from '@okapigo/shared/tour-facts';
import { formatPhoneForDisplay } from '@okapigo/shared/contact';
import { escapeHtml as esc } from '../routes/payments.js';
import { shortName } from '../whatsapp/messages.js';

/** Your tokens (Lagoon, light): emails don't follow the phone's dark mode reliably. */
const C = LAGOON.color.light;
const FONT = LAGOON.font.family.replace(/"/g, "'");

/**
 * What changes per message: the coloured line, the headline, the money in the box, the button.
 * @type {Record<string, (v: any) => { eyebrow: string, colour: string, headline: string, money: [string, string] | null, button: { label: string, url: string } | null, notes: string[] }>}
 */
const MIDDLE = {
  booking_confirmed: (v) => ({
    eyebrow: 'Booking confirmed',
    colour: C.success,
    headline: `See you on ${v.date}, ${v.first_name}!`,
    money: v.paid ? [`${v.paid} paid`, v.taxLine] : null,
    button: { label: 'Open your trip page', url: v.trip_url },
    notes: ['Your QR ticket, the map and what to bring are on your trip page.', v.policyNote],
  }),
  deposit_received: (v) => ({
    eyebrow: 'Deposit received',
    colour: C.success,
    headline: `You’re booked, ${v.first_name}!`,
    money: [`${v.deposit} paid`, `${v.balance} still to pay by ${v.due_date}`],
    button: { label: `Pay ${v.balance}`, url: v.pay_url },
    notes: ['Your QR ticket, the map and what to bring are on your trip page.', v.policyNote],
  }),
  balance_reminder: (v) => ({
    eyebrow: 'Balance reminder',
    colour: C.warning,
    headline: `${v.balance} due by ${v.due_date}`,
    money: [`${v.balance} to pay`, `by ${v.due_date}`],
    button: { label: `Pay ${v.balance}`, url: v.pay_url },
    notes: ['Can’t pay by then? Reply to this email. Your booking isn’t cancelled automatically.'],
  }),
  payment_link: (v) => ({
    eyebrow: 'Payment request',
    colour: C.warning,
    headline: `${v.amount} to pay`,
    money: [v.amount, `valid until ${v.expiry}`],
    button: { label: `Pay ${v.amount}`, url: v.link_url },
    notes: ['Card or bank transfer on the next step, secured by Paystack.'],
  }),
  booking_cancelled: (v) => ({
    eyebrow: 'Booking cancelled',
    colour: C.danger,
    headline: 'Your booking is cancelled',
    money: v.refundKobo
      ? [`${v.refundAmount} refund`, 'back to the card or account you paid with']
      : null,
    button: null,
    notes: [],
  }),
  // The office moved the booking (16d-2).
  booking_moved: (v) => ({
    eyebrow: 'Date changed',
    colour: C.success,
    headline: `See you on ${v.date}, ${v.first_name}!`,
    money: null,
    button: { label: 'Open your trip page', url: v.trip_url },
    notes: [`Moved from ${v.from_date}. Your QR ticket stays the same.`],
  }),
  // A staff member's message (16d-1): their words in the body, the trip page to hand.
  staff_message: (v) => ({
    eyebrow: 'A message for you',
    colour: C.success,
    headline: `Hi ${v.first_name}`,
    money: null,
    button: { label: 'Open your trip page', url: v.trip_url },
    notes: ['Reply to this email to answer.'],
  }),
  refund_sent: (v) => ({
    eyebrow: 'Refund sent',
    colour: C.success,
    headline: 'Your refund is on its way',
    money: [`${v.refund} refunded`, 'may take 5–10 working days to show'],
    button: null,
    notes: [],
  }),
};

/** 180 → "3 hours", 210 → "3 h 30 min". @param {number} minutes */
const hours = (minutes) => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} ${h === 1 ? 'hour' : 'hours'}` : h ? `${h} h ${m} min` : `${m} min`;
};

/**
 * "Free cancellation until Thu 3 Dec, 09:00. After that, 50% back until Fri 4 Dec, 09:00."
 * (your design), from the policy the booking was made under.
 * @param {any} version @param {Date} startsAt @param {string} tz
 */
export function policyNote(version, startsAt, tz, now = new Date()) {
  const deadline = (/** @type {any} */ r) => startsAt.getTime() - r.hoursBefore * 3_600_000;
  // Only deadlines still ahead: a trip tomorrow doesn't get "free cancellation until yesterday".
  const rules = [.../** @type {any[]} */ (version?.rules ?? [])]
    .filter((r) => r.hoursBefore > 0 && r.refundBasisPoints > 0 && deadline(r) > now.getTime())
    .sort((a, b) => b.hoursBefore - a.hoursBefore);
  if (rules.length === 0) return null;
  const at = (/** @type {any} */ r) => formatAt(deadline(r), tz);
  const [first, ...rest] = rules;
  const parts = [
    first.refundBasisPoints === 10_000
      ? `Free cancellation until ${at(first)}.`
      : `${first.refundBasisPoints / 100}% back until ${at(first)}.`,
    ...rest.map((r) => `After that, ${r.refundBasisPoints / 100}% back until ${at(r)}.`),
  ];
  return parts.join(' ');
}

/**
 * The template's words as HTML paragraphs: blank lines split paragraphs, line breaks stay,
 * and the button's own link line is left out (the button carries it). Other links stay links.
 * @param {string} body @param {string | null} buttonUrl
 */
function wordsHtml(body, buttonUrl) {
  const lines = body.split('\n').filter((l) => !buttonUrl || l.trim() !== buttonUrl);
  // "Your ticket and map:" right before the link it introduced reads oddly without it.
  const cleaned = lines.filter(
    (l, i) => !(buttonUrl && /:\s*$/.test(l) && (lines[i + 1] ?? '').trim() === ''),
  );
  return cleaned
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .split(/\n\n/)
    .map(
      (p) =>
        `<p style="margin:0 0 12px;font-size:16px;line-height:24px;color:${C.text}">${esc(p)
          .replace(
            /https?:\/\/[^\s<]+/g,
            (u) => `<a href="${u}" style="color:${C['primary-ink']}">${u}</a>`,
          )
          .replace(/\n/g, '<br>')}</p>`,
    )
    .join('');
}

/**
 * @param {{
 *   kind: string,
 *   subject: string,
 *   body: string,                  the template's words, already filled in
 *   values: Record<string, string>,  the placeholders' values (compose.js)
 *   booking: any,                  with product (+ operator, priceCategories), policyVersion, departure, travellers
 *   data?: any,                    what was frozen when the message was decided (the refund…)
 *   webPublicUrl: string,
 * }} m
 * @returns {{ subject: string, html: string, text: string }}
 */
export function renderEmail({ kind, subject, body, values, booking, data = {}, webPublicUrl }) {
  const operator = booking.product.operator;
  const tz = operator.timeZone;
  const quote = /** @type {any} */ (booking.quote ?? {});
  const refundKobo = data?.refund?.refundKobo ?? 0;
  const v = {
    ...values,
    paid: booking.amountPaidKobo > 0 ? formatNaira(booking.amountPaidKobo) : null,
    taxLine: quote.tax?.amountKobo
      ? `includes ${formatNaira(quote.tax.amountKobo)} ${quote.tax.name}`
      : '',
    policyNote: policyNote(booking.policyVersion, booking.departure.startsAt, tz),
    refundKobo,
    refundAmount: formatNaira(refundKobo),
  };
  const mid = MIDDLE[kind](v);
  const mp = booking.product.meetingPoint ?? {};
  const pickup = /** @type {any} */ (booking.pickupPoint);
  const cats = booking.product.priceCategories ?? [];
  const named = booking.travellers
    .slice()
    .sort((/** @type {any} */ a, /** @type {any} */ b) => a.position - b.position)
    .map((/** @type {any} */ t, /** @type {number} */ i) => {
      const cat = cats.find((/** @type {any} */ c) => c.key === t.categoryKey);
      const child =
        cat && !isAdultCategory(cat)
          ? ` (${cat.name.replace(/\s*\(.*\)$/, '').toLowerCase()})`
          : '';
      return `${t.name || `Guest ${i + 1}`}${child}`;
    });
  const where = pickup
    ? {
        label: 'Pickup',
        strong: pickup.name,
        rest: [pickup.address, pickup.time && `at ${pickup.time}`].filter(Boolean).join(' '),
      }
    : { label: 'Meet at', strong: mp.name ?? '', rest: mp.address ?? '' };
  const rows = [
    ['Tour', `<strong>${esc(booking.product.title)}</strong>`],
    [
      'When',
      `<strong>${esc(`${values.date}, ${values.time} · ${hours(booking.product.durationMinutes)}`)}</strong>`,
    ],
    [
      where.label,
      `<strong>${esc(where.strong)}</strong>${where.rest ? `<br>${esc(where.rest)}` : ''}`,
    ],
    ['Travellers', esc(named.join(', '))],
  ];
  const site = /** @type {any} */ (operator.site ?? {});
  const phone = operator.whatsapp ?? operator.phone;
  // "0809 000 0123", the way people write numbers here (your design: "[0800 000 0000]").
  const contact = phone ? formatPhoneForDisplay(phone) : null;
  const terms = `${webPublicUrl.replace(/\/+$/, '')}/${operator.slug}/${booking.product.slug}`;
  const place = [operator.name, site.address ?? operator.city].filter(Boolean).join(' · ');

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:24px 12px;background:${C.bg};font-family:${FONT};color:${C.text}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:${C.surface};border:1px solid ${C.border};border-radius:12px;border-collapse:separate">
<tr><td style="padding:20px 28px">
<span style="display:inline-block;width:32px;height:32px;line-height:32px;text-align:center;border-radius:8px;background:${C['strip-bg']};color:${C.primary};font-weight:800">${esc([...operator.name][0] ?? '')}</span>
<span style="font-weight:700;margin-left:8px;vertical-align:middle">${esc(operator.name)}</span>
</td></tr>
<tr><td style="padding:28px">
<div style="font-size:14px;font-weight:700;color:${mid.colour}">${esc(mid.eyebrow)}</div>
<h1 style="margin:4px 0 16px;font-size:26px;line-height:32px;font-weight:700">${esc(mid.headline)}</h1>
${wordsHtml(body, mid.button?.url ?? null)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg};border-radius:12px;margin:8px 0 16px"><tr>
<td style="padding:16px"><div style="font-size:13px;color:${C['text-muted']}">Booking reference</div><div style="font-size:24px;font-weight:800">${esc(booking.reference)}</div></td>
${mid.money ? `<td style="padding:16px;text-align:right;font-size:14px"><div style="font-weight:700">${esc(mid.money[0])}</div><div style="color:${C['text-muted']}">${esc(mid.money[1] ?? '')}</div></td>` : ''}
</tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:15px;line-height:22px;margin-bottom:20px">
${rows
  .map(
    ([label, value], i) =>
      `<tr><td style="padding:8px 0;width:120px;vertical-align:top;color:${C['text-muted']};${i ? `border-top:1px solid ${C.border};` : ''}">${esc(label)}</td><td style="padding:8px 0;vertical-align:top;${i ? `border-top:1px solid ${C.border};` : ''}">${value}</td></tr>`,
  )
  .join('\n')}
</table>
${mid.button ? `<a href="${esc(mid.button.url)}" style="display:block;text-align:center;background:${C.primary};color:${C['on-primary']};font-size:17px;font-weight:700;text-decoration:none;border-radius:12px;padding:16px">${esc(mid.button.label)}</a>` : ''}
${mid.notes
  .filter(Boolean)
  .map(
    (n) =>
      `<p style="margin:16px 0 0;font-size:14px;line-height:20px;color:${C['text-muted']}">${esc(n)}</p>`,
  )
  .join('\n')}
</td></tr>
<tr><td style="padding:20px 28px;background:${C.bg};border-radius:0 0 12px 12px;font-size:13px;line-height:20px;color:${C['text-muted']}">
<div>Questions? Reply to this email${contact ? ` or WhatsApp ${esc(shortName(operator.name))} on ${esc(contact)}` : ''}.</div>
<div>${esc(place)} · <a href="${esc(terms)}" style="color:${C['primary-ink']}">Booking terms</a></div>
<div>Bookings by OkapiGo</div>
</td></tr>
</table>
</body></html>`;

  const text = [
    mid.headline,
    '',
    body,
    '',
    `Booking reference: ${booking.reference}`,
    ...(mid.money ? [mid.money.filter(Boolean).join(' · ')] : []),
    `Tour: ${booking.product.title}`,
    `When: ${values.date}, ${values.time} · ${hours(booking.product.durationMinutes)}`,
    `${where.label}: ${[where.strong, where.rest].filter(Boolean).join(', ')}`,
    `Travellers: ${named.join(', ')}`,
    ...(mid.button && !body.includes(mid.button.url)
      ? ['', `${mid.button.label}: ${mid.button.url}`]
      : []),
    ...mid.notes.filter(Boolean).flatMap((n) => ['', n]),
    '',
    '—',
    `Questions? Reply to this email${contact ? ` or WhatsApp ${shortName(operator.name)} on ${contact}` : ''}.`,
    `${place} · Booking terms: ${terms}`,
    'Bookings by OkapiGo',
  ].join('\n');

  return { subject, html, text };
}
