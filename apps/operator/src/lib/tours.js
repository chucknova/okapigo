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
 *
 * The pin is read by @okapigo/shared/map-pin ("paste a map link", decided 2026-11-21).
 */
import { readMapPin, pinText } from '@okapigo/shared/map-pin';

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
    }));

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

/** What POST /api/products gets (a draft; the description starts as the summary). @param {NewTourForm} f */
export const newTourBody = (f) => ({
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
 * Putting a tour on sale, or taking it off, in words.
 * @param {any} p
 */
export function saleWords(p) {
  const prices = (p.priceCategories ?? []).filter((/** @type {any} */ c) => c.isActive).length;
  if (p.status === 'published') {
    return {
      action: 'Take off sale',
      ask: 'Take it off sale? Guests can’t book it any more. Bookings already made stay, and their trips still run.',
      ready: true,
      why: null,
    };
  }
  return {
    action: 'Put on sale',
    ask: null,
    ready: prices > 0,
    why:
      prices > 0 ? null : 'Add its prices before it goes on sale (prices come in the next part).',
  };
}
