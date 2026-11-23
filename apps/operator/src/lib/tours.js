// @ts-check
/**
 * tours.js — what Settings › Tours shows and checks, outside the screens (stage 16e-4a).
 *
 *   tourRows()        the list: each tour, when it runs ("Daily 09:00 · 15 seats"), ON SALE…
 *   basics…           a tour's basics as a form: from the server, checked as you type, what
 *                     changed ("Unsaved changes: Name, Meeting point"), what PATCH gets
 *   lines…            the text lists (stops, included, not included, what to bring, FAQs): one
 *                     per line, the way people write them
 *   newTour…          the short form for a new tour, and what POST gets
 *   price…            Prices (16e-4b): the rows, their checks, what changed in words ("You
 *                     changed Adult from ₦65,000 to ₦70,000. New bookings pay ₦70,000; the 26
 *                     existing bookings keep their price."), what PUT gets
 *   schedule…         Schedule and seats (16e-4b): days, start times, seats, until, the dates
 *                     it doesn't run; a one-off departure
 *   extra… pickup…    Extras and pickup points (16e-4c)
 *   policy…           Cancellation and deposit (16e-4c): the policy chosen, the deposit allowed
 *
 * The pin is read by @okapigo/shared/map-pin ("paste a map link", decided 2026-11-21).
 */
import { missingToSell, photosWanted } from '@okapigo/shared/ready-to-sell';
import { readMapPin, pinText } from '@okapigo/shared/map-pin';
import { findAgeOverlap } from '@okapigo/shared/catalogue';
import { formatNaira } from '@okapigo/shared/money';
import { formatLocalDay } from '@okapigo/shared/preview';
import { scheduleSummary, policyLine } from '@okapigo/shared/tour-facts';

/** How a tour travels (16b). */
export const TRANSPORT_CHOICES = /** @type {const} */ ([
  { key: 'on_foot', label: 'On foot', hint: 'No vehicle' },
  { key: 'van', label: 'Van', hint: 'A van is assigned to each departure' },
  { key: 'boat', label: 'Boat', hint: 'A boat is assigned to each departure' },
]);

/** A tour's status in the designs' words. @param {string} status */
export const statusTag = (status) =>
  status === 'published' ? 'ON SALE' : status === 'archived' ? 'RETIRED' : 'DRAFT';

/** The line under the tour's name. @param {string} status */
export const statusLine = (status) =>
  status === 'published'
    ? 'Published (on sale)'
    : status === 'archived'
      ? 'Retired (not on sale)'
      : 'Draft (not on sale yet)';

/**
 * The list (designs: name, "Daily 09:00 · 15 seats", ON SALE / DRAFT). Retired tours last.
 * @param {any[]} products  from GET /api/products (with `runs`)
 */
export const tourRows = (products) =>
  [...products]
    .sort((a, b) => Number(a.status === 'archived') - Number(b.status === 'archived'))
    .map((p) => ({
      id: p.id,
      title: p.title,
      runs: p.runs ?? '',
      tag: statusTag(p.status),
      tone: p.status === 'published' ? 'success' : p.status === 'archived' ? 'muted' : 'warning',
      needs: needsLine(p),
    }));

/**
 * What a tour still needs, for the list (19b-2a; designs: U7 "Settings › Tours: the list"):
 *   a draft      "needs prices and 2 more photos" (what's missing to go on sale)
 *   on sale      "needs 1 more photo" (it keeps selling: decided 2026-11-23)
 *   retired, or nothing missing: null
 * @param {any} p
 */
export function needsLine(p) {
  if (p.status === 'archived') return null;
  const photoCount = (p.photos ?? []).length;
  const wanted = photosWanted(photoCount);
  if (p.status === 'published') return wanted ? `needs ${wanted}` : null;
  const parts = missingToSell({ activePrices: activePrices(p), photoCount }).map((m) =>
    m.part === 'prices' ? 'prices' : wanted,
  );
  return parts.length ? `needs ${parts.join(' and ')}` : null;
}

/** @param {any} p */
const activePrices = (p) =>
  (p.priceCategories ?? []).filter((/** @type {any} */ c) => c.isActive).length;

// --- The text lists ---------------------------------------------------------------------------

/** One item per line; blank lines dropped. @param {string} text */
export const linesOf = (text) =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

/** Stops: "Name" or "Name — what happens there". @param {any[]} stops */
export const stopsText = (stops) =>
  stops.map((s) => (s.description ? `${s.name} — ${s.description}` : s.name)).join('\n');

/** @param {string} text */
export const stopsOf = (text) =>
  linesOf(text).map((l) => {
    const [name, ...rest] = l.split(/\s+[—–-]\s+/);
    return { name: name.trim(), description: rest.join(' — ').trim() };
  });

/** FAQs: the question on its own line, the answer under it, a blank line between. @param {any[]} faqs */
export const faqsText = (faqs) => faqs.map((f) => `${f.question}\n${f.answer}`).join('\n\n');

/** @param {string} text */
export const faqsOf = (text) =>
  text
    .split(/\n\s*\n/)
    .map((block) => linesOf(block))
    .filter((l) => l.length > 0)
    .map(([question, ...answer]) => ({ question, answer: answer.join('\n') }));

// --- Basics -----------------------------------------------------------------------------------

/**
 * @typedef {{
 *   title: string, shortTitle: string, summary: string, description: string,
 *   hours: string, minutes: string, transport: string, activityLabel: string,
 *   meetingName: string, meetingAddress: string, meetingNote: string, pin: string,
 *   arrive: string,
 *   stops: string, inclusions: string, exclusions: string, whatToBring: string, faqs: string,
 * }} BasicsForm
 */

/** The fields, in order, with their labels ("Unsaved changes: Name, Meeting point"). */
const BASICS_LABELS = /** @type {Array<[keyof BasicsForm, string]>} */ ([
  ['title', 'Name'],
  ['shortTitle', 'Short name'],
  ['summary', 'Summary'],
  ['description', 'Description'],
  ['hours', 'Duration'],
  ['minutes', 'Duration'],
  ['transport', 'How it travels'],
  ['activityLabel', 'Activity'],
  ['meetingName', 'Meeting point'],
  ['meetingAddress', 'Meeting point'],
  ['meetingNote', 'Meeting point'],
  ['pin', 'Map pin'],
  ['arrive', 'Arrive by'],
  ['stops', 'Stops'],
  ['inclusions', 'Included'],
  ['exclusions', 'Not included'],
  ['whatToBring', 'What to bring'],
  ['faqs', 'FAQs'],
]);

/** The form from a tour. @param {any} p @returns {BasicsForm} */
export function basicsForm(p) {
  const mp = p.meetingPoint ?? {};
  return {
    title: p.title ?? '',
    shortTitle: p.shortTitle ?? '',
    summary: p.summary ?? '',
    description: p.description ?? '',
    hours: String(Math.floor((p.durationMinutes ?? 0) / 60)),
    minutes: String((p.durationMinutes ?? 0) % 60),
    transport: p.transport ?? 'on_foot',
    activityLabel: p.activityLabel ?? '',
    meetingName: mp.name ?? '',
    meetingAddress: mp.address ?? '',
    meetingNote: mp.note ?? '',
    // An approximate pin (only the city's) shows as not set.
    pin: Number.isFinite(mp.lat) && !mp.approximate ? pinText(mp) : '',
    arrive: p.arriveMinutesEarly == null ? '' : String(p.arriveMinutesEarly),
    stops: stopsText(p.stops ?? []),
    inclusions: (p.inclusions ?? []).join('\n'),
    exclusions: (p.exclusions ?? []).join('\n'),
    whatToBring: (p.whatToBring ?? []).join('\n'),
    faqs: faqsText(p.faqs ?? []),
  };
}

/** Minutes from the hours and minutes typed; NaN when they aren't whole numbers. @param {BasicsForm | { hours: string, minutes: string }} f */
export const durationOf = (f) => {
  const h = f.hours.trim() === '' ? 0 : Number(f.hours);
  const m = f.minutes.trim() === '' ? 0 : Number(f.minutes);
  return Number.isInteger(h) && Number.isInteger(m) && h >= 0 && m >= 0 ? h * 60 + m : NaN;
};

/** "34 of 120 characters" @param {string} text @param {number} max */
const count = (text, max) => `${text.trim().length} of ${max} characters`;

/**
 * What's wrong, field by field, in plain words. Empty: nothing.
 * @param {BasicsForm} f @returns {Partial<Record<keyof BasicsForm, string>>}
 */
export function basicsErrors(f) {
  /** @type {Partial<Record<keyof BasicsForm, string>>} */
  const e = {};
  /** @param {keyof BasicsForm} k @param {string} what @param {number} max */
  const needed = (k, what, max) => {
    const n = f[k].trim().length;
    if (n === 0) e[k] = `Add ${what}.`;
    else if (n > max) e[k] = `Too long: ${count(f[k], max)}.`;
  };
  needed('title', 'a name', 120);
  if (f.shortTitle.trim().length > 24)
    e.shortTitle = `Too long: ${count(f.shortTitle, 24)}. WhatsApp’s lists cut it off.`;
  needed('summary', 'a one-line summary', 300);
  needed('description', 'a description', 10_000);
  const minutes = durationOf(f);
  if (Number.isNaN(minutes)) e.hours = 'Use whole hours and minutes, like 3 and 30.';
  else if (minutes < 15) e.hours = 'A tour lasts at least 15 minutes.';
  else if (minutes > 14 * 24 * 60) e.hours = 'A tour lasts at most 14 days.';
  if (f.activityLabel.trim().length > 40)
    e.activityLabel = `Too long: ${count(f.activityLabel, 40)}.`;
  needed('meetingName', 'where guests meet', 120);
  needed('meetingAddress', 'the address', 300);
  if (f.meetingNote.trim().length > 300) e.meetingNote = `Too long: ${count(f.meetingNote, 300)}.`;
  if (f.pin.trim()) {
    const p = readMapPin(f.pin);
    if (!p.ok) e.pin = p.problem;
  }
  if (f.arrive.trim()) {
    const n = Number(f.arrive);
    if (!Number.isInteger(n) || n < 0 || n > 120) e.arrive = 'Use minutes from 0 to 120.';
  }
  for (const k of /** @type {const} */ (['inclusions', 'exclusions', 'whatToBring'])) {
    const items = linesOf(f[k]);
    if (items.length > 30) e[k] = `At most 30 lines (this has ${items.length}).`;
    else if (items.some((i) => i.length > 200)) e[k] = 'Keep each line under 200 characters.';
  }
  const stops = stopsOf(f.stops);
  if (stops.length > 30) e.stops = `At most 30 stops (this has ${stops.length}).`;
  else if (stops.some((s) => s.name.length > 120))
    e.stops = 'Keep each stop’s name under 120 characters.';
  const faqs = faqsOf(f.faqs);
  if (faqs.some((q) => !q.answer))
    e.faqs = 'Each question needs its answer on the next line (a blank line between FAQs).';
  else if (faqs.some((q) => q.question.length > 300 || q.answer.length > 2000))
    e.faqs = 'Keep questions under 300 characters and answers under 2,000.';
  return e;
}

/** "Unsaved changes: Name, Meeting point" @param {BasicsForm} f @param {BasicsForm} saved */
export const basicsChanges = (f, saved) => [
  ...new Set(BASICS_LABELS.filter(([k]) => f[k].trim() !== saved[k].trim()).map(([, l]) => l)),
];

/**
 * What PATCH /api/products/:id gets: only what changed. The meeting point goes whole (its pin
 * from the pasted text; none when the text is empty: the city's, approximate).
 * @param {BasicsForm} f @param {BasicsForm} saved
 */
export function basicsBody(f, saved) {
  const changed = (/** @type {keyof BasicsForm} */ k) => f[k].trim() !== saved[k].trim();
  /** @type {Record<string, unknown>} */
  const body = {};
  if (changed('title')) body.title = f.title.trim();
  if (changed('shortTitle')) body.shortTitle = f.shortTitle.trim() || null;
  if (changed('summary')) body.summary = f.summary.trim();
  if (changed('description')) body.description = f.description.trim();
  if (changed('hours') || changed('minutes')) body.durationMinutes = durationOf(f);
  if (changed('transport')) body.transport = f.transport;
  if (changed('activityLabel')) body.activityLabel = f.activityLabel.trim() || null;
  if (
    ['meetingName', 'meetingAddress', 'meetingNote', 'pin'].some((k) =>
      changed(/** @type {any} */ (k)),
    )
  )
    body.meetingPoint = meetingPointOf(f);
  if (changed('arrive')) body.arriveMinutesEarly = f.arrive.trim() ? Number(f.arrive) : null;
  if (changed('stops')) body.stops = stopsOf(f.stops);
  if (changed('inclusions')) body.inclusions = linesOf(f.inclusions);
  if (changed('exclusions')) body.exclusions = linesOf(f.exclusions);
  if (changed('whatToBring')) body.whatToBring = linesOf(f.whatToBring);
  if (changed('faqs')) body.faqs = faqsOf(f.faqs);
  return body;
}

/** The meeting point from the form. @param {{ meetingName: string, meetingAddress: string, meetingNote?: string, pin: string }} f */
export function meetingPointOf(f) {
  const p = f.pin.trim() ? readMapPin(f.pin) : null;
  const note = (f.meetingNote ?? '').trim();
  return {
    name: f.meetingName.trim(),
    address: f.meetingAddress.trim(),
    ...(note && { note }),
    ...(p?.ok && { lat: p.lat, lng: p.lng }),
  };
}

/** Under the pin field: what the trip page will do. @param {string} pin */
export function pinLine(pin) {
  if (!pin.trim())
    return 'Not set: guests see the address, with no map or directions, until you add the pin.';
  const p = readMapPin(pin);
  return p.ok ? `Pin at ${pinText(p)}. Guests get a map and directions.` : null;
}

// --- A new tour -------------------------------------------------------------------------------

/** @typedef {{ title: string, summary: string, hours: string, minutes: string, seats: string, meetingName: string, meetingAddress: string, pin: string, transport: string }} NewTourForm */

/** @returns {NewTourForm} */
export const blankTour = () => ({
  title: '',
  summary: '',
  hours: '3',
  minutes: '0',
  seats: '12',
  meetingName: '',
  meetingAddress: '',
  pin: '',
  transport: 'on_foot',
});

/** @param {NewTourForm} f @returns {Partial<Record<keyof NewTourForm, string>>} */
export function newTourErrors(f) {
  /** @type {Partial<Record<keyof NewTourForm, string>>} */
  const e = {};
  if (!f.title.trim()) e.title = 'Add a name.';
  else if (f.title.trim().length > 120) e.title = `Too long: ${count(f.title, 120)}.`;
  if (!f.summary.trim()) e.summary = 'Add a one-line summary.';
  else if (f.summary.trim().length > 300) e.summary = `Too long: ${count(f.summary, 300)}.`;
  const minutes = durationOf(f);
  if (Number.isNaN(minutes) || minutes < 15 || minutes > 14 * 24 * 60)
    e.hours = 'From 15 minutes to 14 days, in whole hours and minutes.';
  const seats = Number(f.seats);
  if (!Number.isInteger(seats) || seats < 1 || seats > 500) e.seats = 'From 1 to 500 seats.';
  if (!f.meetingName.trim()) e.meetingName = 'Add where guests meet.';
  if (!f.meetingAddress.trim()) e.meetingAddress = 'Add the address.';
  if (f.pin.trim()) {
    const p = readMapPin(f.pin);
    if (!p.ok) e.pin = p.problem;
  }
  return e;
}

/**
 * What POST /api/products gets (a draft; the description starts as the summary), with its
 * photos when it has some (19b-2a).
 * @param {NewTourForm} f @param {Array<{ url: string, small: string, alt: string, credit: string | null }>} [photos]
 */
export const newTourBody = (f, photos = []) => ({
  ...(photos.length > 0 && { photos }),
  title: f.title.trim(),
  summary: f.summary.trim(),
  description: f.summary.trim(),
  durationMinutes: durationOf(f),
  defaultCapacity: Number(f.seats),
  transport: f.transport,
  meetingPoint: meetingPointOf({ ...f, meetingNote: '' }),
});

// --- On sale ----------------------------------------------------------------------------------

/**
 * Putting a tour on sale, or taking it off, in words. A draft lists what it still needs
 * (19b-2a; designs: U7 "The draft's page, until it's ready"), each with the section to go to.
 * @param {any} p
 * @returns {{ action: string, ask: string | null, ready: boolean,
 *   missing: Array<{ part: 'prices' | 'photos', line: string, href: string }> }}
 */
export function saleWords(p) {
  if (p.status === 'published') {
    return {
      action: 'Take off sale',
      ask: 'Take it off sale? Guests can’t book it any more. Bookings already made stay, and their trips still run.',
      ready: true,
      missing: [],
    };
  }
  const missing = missingToSell({
    activePrices: activePrices(p),
    photoCount: (p.photos ?? []).length,
  }).map((m) => ({ ...m, href: m.part === 'prices' ? '#tour-prices' : '#tour-photos' }));
  return { action: 'Put on sale', ask: null, ready: missing.length === 0, missing };
}

// --- Prices (16e-4b) --------------------------------------------------------------------------

/** @typedef {{ id: string | null, name: string, minAge: string, maxAge: string, naira: string }} PriceRow */

/** The tour's prices as rows to edit (active ones, in order). @param {any} p @returns {PriceRow[]} */
export const priceRows = (p) =>
  (p.priceCategories ?? [])
    .filter((/** @type {any} */ c) => c.isActive)
    .map((/** @type {any} */ c) => ({
      id: c.id,
      name: c.name,
      minAge: String(c.minAge),
      maxAge: c.maxAge == null ? '' : String(c.maxAge),
      naira: String(c.amountKobo / 100),
    }));

/** A new, empty row. @returns {PriceRow} */
export const blankPrice = () => ({ id: null, name: '', minAge: '', maxAge: '', naira: '' });

/** Whole number in a range, or NaN. @param {string} t @param {number} min @param {number} max */
const whole = (t, min, max) => {
  const n = Number(t.trim());
  return t.trim() !== '' && Number.isInteger(n) && n >= min && n <= max ? n : NaN;
};

/** Naira typed ("70,000", "1500.50") → kobo; NaN if it isn't money. @param {string} t */
export function koboOf(t) {
  const clean = t.replace(/[₦,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return NaN;
  const kobo = Math.round(Number(clean) * 100);
  return kobo <= 2_000_000_000 ? kobo : NaN;
}

/** "13 and over", "3–12", "Any age" (designs: the Ages column). @param {PriceRow} r */
export function agesLine(r) {
  const min = whole(r.minAge, 0, 120);
  const max = r.maxAge.trim() === '' ? null : whole(r.maxAge, 0, 120);
  if (Number.isNaN(min) || Number.isNaN(max)) return '';
  if (max === null) return min === 0 ? 'Any age' : `${min} and over`;
  return `${min}–${max}`;
}

/** No upper age: counts as an adult (children need one with them). @param {PriceRow} r */
export const countsAsAdult = (r) => r.maxAge.trim() === '';

/**
 * What's wrong: per row, and for the prices together.
 * @param {PriceRow[]} rows @param {boolean} onSale
 * @returns {{ rows: Array<Partial<Record<'name' | 'minAge' | 'maxAge' | 'naira', string>>>, all: string | null, count: number }}
 */
export function priceErrors(rows, onSale) {
  const each = rows.map((r) => {
    /** @type {Partial<Record<'name' | 'minAge' | 'maxAge' | 'naira', string>>} */
    const e = {};
    if (!r.name.trim()) e.name = 'Name it, like “Adult”.';
    else if (r.name.trim().length > 50) e.name = 'Keep it under 50 characters.';
    const min = whole(r.minAge, 0, 120);
    if (Number.isNaN(min)) e.minAge = 'An age from 0 to 120.';
    if (r.maxAge.trim()) {
      const max = whole(r.maxAge, 0, 120);
      if (Number.isNaN(max)) e.maxAge = 'An age from 0 to 120, or empty for “and over”.';
      else if (!Number.isNaN(min) && max < min) e.maxAge = 'Not below the youngest age.';
    }
    if (Number.isNaN(koboOf(r.naira))) e.naira = 'A price in naira, like 70,000 (0 for free).';
    return e;
  });
  let all = null;
  if (rows.length === 0 && onSale) all = 'A tour on sale needs at least one price.';
  else if (each.every((e) => Object.keys(e).length === 0)) {
    const overlap = findAgeOverlap(
      rows.map((r, i) => ({
        key: r.name.trim() || `price ${i + 1}`,
        minAge: Number(r.minAge),
        maxAge: r.maxAge.trim() === '' ? null : Number(r.maxAge),
      })),
    );
    if (overlap) all = `${overlap[0]} and ${overlap[1]} cover some of the same ages.`;
  }
  const count = each.reduce((n, e) => n + Object.keys(e).length, 0) + (all ? 1 : 0);
  return { rows: each, all, count };
}

/** What PUT /api/products/:id/price-categories gets. @param {PriceRow[]} rows */
export const pricesBody = (rows) => ({
  categories: rows.map((r) => ({
    ...(r.id && { id: r.id }),
    name: r.name.trim(),
    minAge: Number(r.minAge),
    maxAge: r.maxAge.trim() === '' ? null : Number(r.maxAge),
    amountKobo: koboOf(r.naira),
  })),
});

/** A row as compared (spaces and "70,000" vs "70000" aren't changes). @param {PriceRow} r */
const norm = (r) =>
  JSON.stringify([r.name.trim(), r.minAge.trim(), r.maxAge.trim(), koboOf(r.naira)]);

/** "Unsaved changes: Adult price, New price: Senior, Removed: Infant" @param {PriceRow[]} rows @param {PriceRow[]} saved */
export function priceChanges(rows, saved) {
  /** @type {string[]} */
  const out = [];
  const before = new Map(saved.map((r) => [r.id, r]));
  for (const r of rows) {
    const was = r.id ? before.get(r.id) : null;
    if (!was) out.push(`New price: ${r.name.trim() || 'unnamed'}`);
    else if (norm(r) !== norm(was)) {
      out.push(koboOf(r.naira) !== koboOf(was.naira) ? `${was.name} price` : was.name);
    }
  }
  const kept = new Set(rows.map((r) => r.id));
  for (const r of saved) if (!kept.has(r.id)) out.push(`Removed: ${r.name}`);
  // Moved up or down only.
  if (out.length === 0 && rows.map((r) => r.id).join() !== saved.map((r) => r.id).join())
    out.push('Price order');
  return out;
}

/**
 * The prices that changed, and what that means for bookings (designs: "You changed Adult from
 * ₦65,000 to ₦70,000. New bookings pay ₦70,000; the 26 existing bookings keep their price.").
 * null when no amount changed. @param {PriceRow[]} rows @param {PriceRow[]} saved @param {number} upcoming
 */
export function priceChangeWords(rows, saved, upcoming) {
  const before = new Map(saved.map((r) => [r.id, r]));
  const moved = rows
    .filter((r) => r.id && before.has(r.id))
    .map((r) => ({ r, was: /** @type {PriceRow} */ (before.get(r.id)) }))
    .filter(
      ({ r, was }) => !Number.isNaN(koboOf(r.naira)) && koboOf(r.naira) !== koboOf(was.naira),
    );
  if (moved.length === 0) return null;
  const what = moved
    .map(
      ({ r, was }) =>
        `${was.name} from ${formatNaira(koboOf(was.naira))} to ${formatNaira(koboOf(r.naira))}`,
    )
    .join(' and ');
  const pay =
    moved.length === 1
      ? `New bookings pay ${formatNaira(koboOf(moved[0].r.naira))}`
      : 'New bookings pay the new prices';
  const keep =
    upcoming === 0
      ? 'no booking is waiting at the old price.'
      : upcoming === 1
        ? 'the 1 existing booking keeps its price.'
        : `the ${upcoming} existing bookings keep their price.`;
  return `You changed ${what}. ${pay}; ${keep}`;
}

// --- Schedule and seats (16e-4b) --------------------------------------------------------------

/** Monday first, the way a week is read here. */
export const WEEK = /** @type {const} */ ([
  [1, 'Mon'],
  [2, 'Tue'],
  [3, 'Wed'],
  [4, 'Thu'],
  [5, 'Fri'],
  [6, 'Sat'],
  [0, 'Sun'],
]);

/** @typedef {{ days: number[], times: string, seats: string, until: string, skip: string[] }} ScheduleForm */

/**
 * The rule to edit: the first switched-on schedule (or the first), or a new one.
 * @param {any[]} schedules @param {any} p
 * @returns {{ id: string | null, form: ScheduleForm, others: number }}
 */
export function scheduleOf(schedules, p) {
  const rule = schedules.find((s) => s.isActive) ?? schedules[0] ?? null;
  return {
    id: rule?.id ?? null,
    // The rule shown is switched on whenever any is, so the others are the rest of those.
    others: Math.max(0, schedules.filter((s) => s.isActive).length - 1),
    form: rule
      ? {
          days: [...rule.daysOfWeek].sort(),
          times: rule.times.join(', '),
          seats: String(rule.capacity ?? p.defaultCapacity),
          until: rule.endDate ?? '',
          skip: [...rule.skipDates].sort(),
        }
      : { days: [], times: '', seats: String(p.defaultCapacity ?? ''), until: '', skip: [] },
  };
}

/** "07:00, 14:30" → ["07:00", "14:30"] (sorted; "7:00" is fine). @param {string} t */
export const timesOf = (t) =>
  t
    .split(/[,\s]+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => (/^\d:\d\d$/.test(x) ? `0${x}` : x))
    .sort();

/** @param {ScheduleForm} f @returns {Partial<Record<'days' | 'times' | 'seats' | 'until', string>>} */
export function scheduleErrors(f) {
  /** @type {Partial<Record<'days' | 'times' | 'seats' | 'until', string>>} */
  const e = {};
  if (f.days.length === 0) e.days = 'Pick at least one day.';
  const times = timesOf(f.times);
  if (times.length === 0) e.times = 'Add a start time, like 07:00.';
  else if (times.some((t) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(t)))
    e.times = 'Use 24-hour times like 07:00 or 18:30, separated by commas.';
  else if (new Set(times).size !== times.length) e.times = 'That time is there twice.';
  else if (times.length > 12) e.times = 'At most 12 start times.';
  if (Number.isNaN(whole(f.seats, 1, 500))) e.seats = 'From 1 to 500 seats.';
  if (f.until && !/^\d{4}-\d{2}-\d{2}$/.test(f.until)) e.until = 'Pick a date.';
  return e;
}

/** "Saturdays 07:00", from the form as it is (or null). @param {ScheduleForm} f */
export const runsPreview = (f) =>
  f.days.length && timesOf(f.times).length
    ? scheduleSummary([{ daysOfWeek: f.days, times: timesOf(f.times) }])
    : null;

/** "Unsaved changes: Days, Seats" @param {ScheduleForm} f @param {ScheduleForm} saved */
export function scheduleChanges(f, saved) {
  /** @type {string[]} */
  const out = [];
  if ([...f.days].sort().join() !== [...saved.days].sort().join()) out.push('Days');
  if (timesOf(f.times).join() !== timesOf(saved.times).join()) out.push('Start time');
  if (f.seats.trim() !== saved.seats.trim()) out.push('Seats');
  if (f.until !== saved.until) out.push('Until');
  if ([...f.skip].sort().join() !== [...saved.skip].sort().join()) out.push('Not running on');
  return out;
}

/**
 * What the server gets: PATCH for the rule there is (only what changed), POST for a new one
 * (starting today). @param {ScheduleForm} f @param {ScheduleForm} saved @param {boolean} isNew @param {string} today
 */
export function scheduleBody(f, saved, isNew, today) {
  const all = {
    daysOfWeek: [...f.days].sort(),
    times: timesOf(f.times),
    capacity: Number(f.seats),
    endDate: f.until || null,
    skipDates: [...f.skip].sort(),
  };
  if (isNew) return { startDate: today, ...all };
  const ch = scheduleChanges(f, saved);
  /** @type {Record<string, unknown>} */
  const body = {};
  if (ch.includes('Days')) body.daysOfWeek = all.daysOfWeek;
  if (ch.includes('Start time')) body.times = all.times;
  if (ch.includes('Seats')) body.capacity = all.capacity;
  if (ch.includes('Until')) body.endDate = all.endDate;
  if (ch.includes('Not running on')) body.skipDates = all.skipDates;
  return body;
}

/** "Sat 26 Dec" @param {string} date 'YYYY-MM-DD' */
export const dayChip = (date) => formatLocalDay(date);

/** After a schedule save: what changed, in a line. @param {{ created: number, removed: number }} sync */
export function syncLine({ created, removed }) {
  const parts = [
    created ? `${created} ${created === 1 ? 'departure' : 'departures'} added` : null,
    removed ? `${removed} removed` : null,
  ].filter(Boolean);
  return parts.length ? `${parts.join(', ')}.` : 'The departures already matched.';
}

/** A one-off departure's form, checked. @param {{ date: string, time: string, seats: string }} f @param {string} today */
export function oneOffErrors(f, today) {
  /** @type {Partial<Record<'date' | 'time' | 'seats', string>>} */
  const e = {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date)) e.date = 'Pick a date.';
  else if (f.date < today) e.date = 'That date has passed.';
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(f.time)) e.time = 'A 24-hour time, like 10:00.';
  if (Number.isNaN(whole(f.seats, 1, 500))) e.seats = 'From 1 to 500 seats.';
  return e;
}

// --- Extras (16e-4c) --------------------------------------------------------------------------

/** @typedef {{ id: string | null, name: string, description: string, naira: string, limit: string }} ExtraRow */

/** The tour's extras as rows to edit (active ones, in order). @param {any} p @returns {ExtraRow[]} */
export const extraRows = (p) =>
  (p.addOns ?? [])
    .filter((/** @type {any} */ a) => a.isActive)
    .map((/** @type {any} */ a) => ({
      id: a.id,
      name: a.name,
      description: a.description ?? '',
      naira: String(a.priceKobo / 100),
      limit: a.stockPerDeparture == null ? '' : String(a.stockPerDeparture),
    }));

/** @returns {ExtraRow} */
export const blankExtra = () => ({ id: null, name: '', description: '', naira: '', limit: '' });

/** "₦8,000 each · No limit per departure" (designs) or "· 10 per departure". @param {ExtraRow} r */
export function extraLine(r) {
  const kobo = koboOf(r.naira);
  const price = Number.isNaN(kobo) ? '' : kobo === 0 ? 'Free' : `${formatNaira(kobo)} each`;
  const n = r.limit.trim() === '' ? null : whole(r.limit, 0, 10_000);
  const limit = n === null ? 'No limit per departure' : Number.isNaN(n) ? '' : `${n} per departure`;
  return [price, limit].filter(Boolean).join(' · ');
}

/** @param {ExtraRow[]} rows */
export function extraErrors(rows) {
  const each = rows.map((r) => {
    /** @type {Partial<Record<'name' | 'description' | 'naira' | 'limit', string>>} */
    const e = {};
    if (!r.name.trim()) e.name = 'Name it, like “Lunch”.';
    else if (r.name.trim().length > 100) e.name = 'Keep it under 100 characters.';
    if (r.description.trim().length > 500) e.description = 'Keep it under 500 characters.';
    if (Number.isNaN(koboOf(r.naira))) e.naira = 'A price in naira, like 8,000 (0 for free).';
    if (r.limit.trim() && Number.isNaN(whole(r.limit, 0, 10_000)))
      e.limit = 'A number, or empty for no limit.';
    return e;
  });
  return { rows: each, count: each.reduce((n, e) => n + Object.keys(e).length, 0) };
}

/** What PUT /api/products/:id/add-ons gets. @param {ExtraRow[]} rows */
export const extrasBody = (rows) => ({
  addOns: rows.map((r) => ({
    ...(r.id && { id: r.id }),
    name: r.name.trim(),
    description: r.description.trim(),
    priceKobo: koboOf(r.naira),
    stockPerDeparture: r.limit.trim() === '' ? null : Number(r.limit),
  })),
});

/** "Unsaved changes: Lunch, New extra: Palm wine, Removed: Boat ride" @param {ExtraRow[]} rows @param {ExtraRow[]} saved */
export function extraChanges(rows, saved) {
  const same = (/** @type {ExtraRow} */ r) =>
    JSON.stringify([r.name.trim(), r.description.trim(), koboOf(r.naira), r.limit.trim()]);
  const before = new Map(saved.map((r) => [r.id, r]));
  /** @type {string[]} */
  const out = [];
  for (const r of rows) {
    const was = r.id ? before.get(r.id) : null;
    if (!was) out.push(`New extra: ${r.name.trim() || 'unnamed'}`);
    else if (same(r) !== same(was)) out.push(was.name);
  }
  const kept = new Set(rows.map((r) => r.id));
  for (const r of saved) if (!kept.has(r.id)) out.push(`Removed: ${r.name}`);
  if (out.length === 0 && rows.map((r) => r.id).join() !== saved.map((r) => r.id).join())
    out.push('Extras order');
  return out;
}

// --- Pickup points (16e-4c) -------------------------------------------------------------------

/** @typedef {{ area: string, place: string, time: string }} PickupRow */

/** Area ("Victoria Island"), place ("Eko Hotel main gate"), time. @param {any} p @returns {PickupRow[]} */
export const pickupRows = (p) =>
  (p.pickupPoints ?? []).map((/** @type {any} */ x) => ({
    area: x.name,
    place: x.address,
    time: x.time ?? '',
  }));

/** @returns {PickupRow} */
export const blankPickup = () => ({ area: '', place: '', time: '' });

/** @param {PickupRow[]} rows */
export function pickupErrors(rows) {
  const each = rows.map((r) => {
    /** @type {Partial<Record<'area' | 'place' | 'time', string>>} */
    const e = {};
    if (!r.area.trim()) e.area = 'The area, like “Victoria Island”.';
    else if (r.area.trim().length > 120) e.area = 'Keep it under 120 characters.';
    if (!r.place.trim()) e.place = 'Where exactly, like “Eko Hotel main gate”.';
    else if (r.place.trim().length > 300) e.place = 'Keep it under 300 characters.';
    if (r.time.trim() && !/^([01]\d|2[0-3]):[0-5]\d$/.test(r.time.trim()))
      e.time = 'A 24-hour time, like 07:15.';
    return e;
  });
  return { rows: each, count: each.reduce((n, e) => n + Object.keys(e).length, 0) };
}

/** What PATCH gets (the list replaced whole). @param {PickupRow[]} rows */
export const pickupsBody = (rows) => ({
  pickupPoints: rows.map((r) => ({
    name: r.area.trim(),
    address: r.place.trim(),
    ...(r.time.trim() && { time: r.time.trim() }),
  })),
});

/** @param {PickupRow[]} rows @param {PickupRow[]} saved */
export const pickupChanges = (rows, saved) =>
  JSON.stringify(pickupsBody(rows)) === JSON.stringify(pickupsBody(saved)) ? [] : ['Pickup points'];

/** With none: where guests meet instead (designs). @param {any} p */
export const noPickupsLine = (p) =>
  `No pickup points: guests meet at ${p.meetingPoint?.name ?? 'the meeting point'}.`;

// --- Cancellation and deposit (16e-4c) --------------------------------------------------------

/** @typedef {{ policyId: string, deposit: 'none' | 'allowed', percent: string }} TermsForm */

/** @param {any} p @returns {TermsForm} */
export const termsForm = (p) => ({
  policyId: p.cancellationPolicyId ?? '',
  deposit: p.depositBasisPoints == null ? 'none' : 'allowed',
  percent: p.depositBasisPoints == null ? '30' : String(p.depositBasisPoints / 100),
});

/** @param {TermsForm} f */
export function termsErrors(f) {
  /** @type {Partial<Record<'percent', string>>} */
  const e = {};
  if (f.deposit === 'allowed' && Number.isNaN(whole(f.percent, 1, 99)))
    e.percent = 'A whole percentage from 1 to 99.';
  return e;
}

/** @param {TermsForm} f @param {TermsForm} saved */
export function termsChanges(f, saved) {
  /** @type {string[]} */
  const out = [];
  if (f.policyId !== saved.policyId) out.push('Cancellation policy');
  const bp = (/** @type {TermsForm} */ x) =>
    x.deposit === 'none' ? null : Number(x.percent) * 100;
  if (bp(f) !== bp(saved)) out.push('Deposit');
  return out;
}

/** What PATCH /api/products/:id gets. @param {TermsForm} f @param {TermsForm} saved */
export function termsBody(f, saved) {
  const ch = termsChanges(f, saved);
  /** @type {Record<string, unknown>} */
  const body = {};
  if (ch.includes('Cancellation policy')) body.cancellationPolicyId = f.policyId || null;
  if (ch.includes('Deposit'))
    body.depositBasisPoints = f.deposit === 'none' ? null : Number(f.percent) * 100;
  return body;
}

/** The menu: "Standard: Full refund 48 h+ · 50% 24–48 h · …" @param {any[]} policies */
export const policyChoices = (policies) =>
  policies
    .filter((/** @type {any} */ x) => x.current)
    .map((/** @type {any} */ x) => ({ id: x.id, label: `${x.name}: ${policyLine(x.current)}` }));

/**
 * What a change of terms means for bookings (like the prices': bookings keep what they
 * booked). null when nothing changed. @param {TermsForm} f @param {TermsForm} saved @param {number} upcoming
 */
export function termsWords(f, saved, upcoming) {
  if (termsChanges(f, saved).length === 0) return null;
  const keep =
    upcoming === 0
      ? 'No booking is waiting on the old terms.'
      : upcoming === 1
        ? 'The 1 existing booking keeps the terms it was made with.'
        : `The ${upcoming} existing bookings keep the terms they were made with.`;
  return `New bookings get these terms. ${keep}`;
}

/** Under the deposit choice. @param {TermsForm} f @param {number} days */
export const depositLine = (f, days) =>
  f.deposit === 'none'
    ? 'Guests pay in full when they book.'
    : `Guests may pay ${Number.isNaN(whole(f.percent, 1, 99)) ? '…' : `${Number(f.percent)}%`} now; the balance is due ${days} days before the trip. Booking later than that, they pay in full.`;
