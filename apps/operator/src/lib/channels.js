// @ts-check
/**
 * channels.js — Settings › Channels (session 17c-2; designs: "O11 · Settings › Channels" and
 * "O11 · Connect, key shown once, empty, off, new key, OTA payment"). The screen's words and
 * checks; the numbers and most lines come from the server (/api/channels).
 *
 *   connectForm…      "Connect a channel": a name and the commission it keeps
 *   commission…       the commission field on a channel's page (new sales only)
 *   payment…          "Payment received from Sojourna": the amount (what it owes, to start),
 *                     the day, the bank reference; what's owed after it
 *   …Words            the questions asked first (a new key, switching off), and the rest
 */
import { formatNaira } from '@okapigo/shared/money';
import { nairaField } from './money.js';

/** "20", "17.5": a commission typed, as a number; null when it isn't one. @param {string} typed */
export function parsePercent(typed) {
  const clean = typed.replace(/[%\s]/g, '').replace(',', '.');
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(clean)) return null;
  const n = Number(clean);
  return n <= 100 ? n : null;
}

/** What's wrong with a typed commission, or null. @param {string} typed */
export const commissionError = (typed) =>
  parsePercent(typed) === null ? 'A percentage from 0 to 100, like 20 or 17.5' : null;

/** @returns {{ name: string, commission: string }} */
export const blankConnect = () => ({ name: '', commission: '20' });

/**
 * The connect form's problems. @param {{ name: string, commission: string }} f
 * @param {string[]} taken  the names already used (case aside)
 * @returns {{ name?: string, commission?: string }}
 */
export function connectErrors(f, taken = []) {
  /** @type {{ name?: string, commission?: string }} */
  const e = {};
  const name = f.name.trim();
  if (name.length < 2) e.name = 'At least 2 characters';
  else if (name.length > 60) e.name = 'At most 60 characters';
  else if (taken.some((t) => t.toLowerCase() === name.toLowerCase()))
    e.name = 'You already have a channel with that name';
  const c = commissionError(f.commission);
  if (c) e.commission = c;
  return e;
}

/** @param {{ name: string, commission: string }} f */
export const connectBody = (f) => ({
  name: f.name.trim(),
  commissionPercent: /** @type {number} */ (parsePercent(f.commission)),
});

/** How it shows on bookings (designs: the name field's help). @param {string} name */
export const viaHelp = (name) => `How it shows on bookings: “via ${name.trim() || 'Sojourna'}”`;

/** "20" for the commission field, from basis points. @param {number} bp */
export const commissionField = (bp) => String(bp / 100);

// --- A payment from the OTA --------------------------------------------------------------------

/**
 * The form to start from: what it owes, received today. @param {number} owedKobo @param {string} today
 */
export const paymentForm = (owedKobo, today) => ({
  amount: owedKobo > 0 ? nairaField(owedKobo) : '',
  receivedOn: today,
  reference: '',
});

/**
 * The amount typed: "329,600" → 32_960_000 kobo; null when it isn't an amount.
 * @param {string} typed
 */
export function parseNaira(typed) {
  const clean = typed.replace(/[₦,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  const kobo = Math.round(Number(clean) * 100);
  return kobo >= 100 ? kobo : null;
}

/**
 * @param {{ amount: string, receivedOn: string, reference: string }} f
 * @param {{ owedKobo: number, today: string, name: string }} o
 * @returns {{ amount?: string, receivedOn?: string, reference?: string }}
 */
export function paymentErrors(f, { owedKobo, today, name }) {
  /** @type {{ amount?: string, receivedOn?: string, reference?: string }} */
  const e = {};
  const kobo = parseNaira(f.amount);
  if (kobo === null) e.amount = 'Type the amount in naira, like 329,600';
  else if (kobo > owedKobo)
    e.amount =
      owedKobo > 0
        ? `${name} owes ${formatNaira(owedKobo)}: record up to that`
        : `${name} owes nothing right now`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.receivedOn)) e.receivedOn = 'Pick the day it arrived';
  else if (f.receivedOn > today) e.receivedOn = 'That day hasn’t come yet';
  if (f.reference.trim().length > 80) e.reference = 'At most 80 characters';
  return e;
}

/** @param {{ amount: string, receivedOn: string, reference: string }} f */
export const paymentBody = (f) => ({
  amountKobo: /** @type {number} */ (parseNaira(f.amount)),
  receivedOn: f.receivedOn,
  reference: f.reference.trim() || null,
});

/**
 * "Pays off the oldest bookings first. Owed after this: ₦0." @param {number} owedKobo
 * @param {string} typed
 */
export function owedAfterLine(owedKobo, typed) {
  const kobo = parseNaira(typed) ?? 0;
  return `Pays off the oldest bookings first. Owed after this: ${formatNaira(Math.max(0, owedKobo - kobo))}.`;
}

/** "Record ₦329,600" @param {string} typed */
export const recordLabel = (typed) => {
  const kobo = parseNaira(typed);
  return kobo === null ? 'Record the payment' : `Record ${formatNaira(kobo)}`;
};

// --- The questions, and the other words ----------------------------------------------------------

/** @param {string} name @param {string} hint  the key's last 4 characters */
export const newKeyWords = (name, hint) => ({
  title: `Make a new key for ${name}?`,
  body: `The old key (••••${hint}) stops working at once. ${name} can’t check seats or sell until someone pastes the new key into their settings.`,
  kept: 'Existing bookings aren’t affected.',
});

/** @param {string} name */
export const switchOffWords = (name) => ({
  title: `Switch off ${name}?`,
  body: `${name} won’t be able to sell. Its bookings stay.`,
});

/** @param {string} name */
export const offLine = (name) =>
  `${name} can’t see your tours, prices or seats, and can’t sell. Its key is turned off.`;

/** @param {string} name */
export const keyOnceTitle = (name) => `Paste these into ${name}’s supplier settings`;

export const KEY_ONCE_WARNING = 'Store it now: you won’t see it again. Lost it? Make a new key.';

export const EMPTY_WORDS =
  'Connect a travel website (Viator, GetYourGuide, or the test OTA) with OCTO. It sells from your seats and prices, and every sale lands in Bookings.';

/** A booking's line, as it reads: owes (amber), settled (green), cancelled (muted). @param {string} tone */
export const stateClass = (tone) =>
  tone === 'owes' ? 'tone--warning' : tone === 'ok' ? 'tone--ok' : 'tone--muted';
