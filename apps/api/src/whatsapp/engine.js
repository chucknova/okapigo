// @ts-check
/**
 * engine.js — the WhatsApp booking assistant's brain (BKG-09, session 13; the conversation as
 * designed: docs/designs/06-whatsapp/).
 *
 *   converse(deps, { operator, conversation, state, input }) → { state, replies, … }
 *
 * One guest message in (a typed `text`, or the `choice` id of a button or list row they
 * tapped), the replies out, and the new state to remember. The SAME function serves the
 * simulator and the real WhatsApp: channels only carry messages (channels.js).
 *
 *   hello ─► choose_tour ─► choose_date ─► adults ─► under 13? ─► how many ─► each child's age
 *         ─► extras (one at a time, "Anything else?") ─► pickup (if any) ─► name ─► email
 *         ─► summary: seats HELD 30 minutes ─► Pay (in full, or a deposit) ─► the link
 *   … the ticket arrives when the money settles (notices.js) ─► booked
 *
 * At any step the guest may type: help · menu · start again · cancel · person. "Change
 * something" at the summary changes ONE part (date, travellers, extras, pickup, details) and
 * comes straight back to a new summary, keeping every other answer.
 *
 * Booking goes through bookForGuest(), the website's own code: the same prices, rules and
 * seats (PRD: "the same prices and availability in both").
 */
import {
  releaseHold,
  listAvailability,
  createPaymentLink,
  cancelPaymentLink,
  addOnUsage,
  BookingError,
} from '@okapigo/db';
import { formatNaira } from '@okapigo/shared/money';
import { formatLocalDay } from '@okapigo/shared/preview';
import { freeCancellationUntil } from '@okapigo/shared/tour-facts';
import { isAdultCategory, findCategoryForAge } from '@okapigo/shared/catalogue';
import { addDays, localDate } from '@okapigo/shared/time';
import { normalizeEmail } from '@okapigo/shared/contact';
import { readSite } from '@okapigo/shared/schemas/website';
import { HttpError } from '../middleware/errors.js';
import { loadCatalogueView, loadTourView } from '../lib/public-views.js';
import { bookForGuest, plainName } from '../lib/guest-booking.js';
import { paymentOptions } from '../lib/payment-options.js';
import { say, firstName, text } from './messages.js';

/** Decided 2026-11-18: seats are held longer on WhatsApp than on the website (15). */
export const WHATSAPP_HOLD_MINUTES = 30;
/** How far ahead the dates list looks. */
const DATES_AHEAD_DAYS = 90;
/** Date rows per page (the 10th row is "Later dates"). */
const DATES_PER_PAGE = 9;
/** Bigger groups are planned with the team (catalogue: group_limit). */
export const MAX_TRAVELLERS = 20;

const HELLO = /^\s*(hi|hello|hey|good (morning|afternoon|evening))\s*[.!]*\s*$/i;
const MENU = /^\s*menu\s*[.!]*\s*$/i;
const START_AGAIN = /^\s*(start again|start over|restart)\s*[.!]*\s*$/i;
const HELP = /^\s*(help|\?)\s*[.!]*\s*$/i;
const CANCEL = /^\s*(cancel|stop)\s*[.!]*\s*$/i;
const PERSON = /\b(person|human|agent|staff|someone)\b/i;
const PAY = /^\s*pay\b/i;

/**
 * @typedef {import('./state.js').ConversationState} State
 * @typedef {{ text?: string, choice?: string }} Input
 * @typedef {{
 *   prisma: import('@prisma/client').PrismaClient,
 *   quotes: any,
 *   jobs: { scheduleHoldExpiry: Function },
 *   log: { warn: Function },
 *   webPublicUrl: string,
 *   now?: () => Date,
 * }} Deps
 * @typedef {{ state: State, replies: any[], bookingId?: string | null, needsPerson?: boolean }} Turn
 * @typedef {{ deps: Deps, operator: any, conversation: { guestPhone: string, guestName?: string } }} Ctx
 */

// --- Small helpers ----------------------------------------------------------------------------

/** @param {Deps} deps */
const nowOf = (deps) => (deps.now ?? (() => new Date()))();

/** "18:30" in the operator's time zone. @param {Date} at @param {string} tz */
export const clock = (at, tz) =>
  new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: tz,
  }).format(at);

/** "Sat 5 Dec". @param {Date} at @param {string} tz */
export const day = (at, tz) => formatLocalDay(localDate(at, tz));

/**
 * The chat's durations, as your design writes them: 210 → "3 h 30 min", 180 → "3 h",
 * 45 → "45 min". (The website's cards say "3.5 h".)
 * @param {number} minutes
 */
export const duration = (minutes) => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h ? `${h} h` : '', m ? `${m} min` : ''].filter(Boolean).join(' ');
};

/** A typed whole number, or null. @param {string | undefined} text */
const typedNumber = (text) => {
  const m = text?.match(/^\s*(\d{1,3})\s*$/);
  return m ? Number(m[1]) : null;
};

/**
 * Which row did the guest mean? Their tap (the id), a typed number ("2"), or the row's name.
 * @param {Input} input
 * @param {Array<{ id: string, title: string, also?: string }>} rows
 */
function pickRow(input, rows) {
  if (input.choice) return rows.find((r) => r.id === input.choice) ?? null;
  const n = typedNumber(input.text);
  if (n !== null) return rows[n - 1] ?? null;
  const t = input.text?.trim().toLowerCase();
  if (!t || t.length < 3) return null;
  return (
    rows.find(
      (r) => r.title.toLowerCase().includes(t) || (r.also ?? '').toLowerCase().includes(t),
    ) ?? null
  );
}

/** The number the guest tapped ("n:2") or typed ("2"), or null. @param {Input} input */
const numberIn = (input) =>
  input.choice?.startsWith('n:') ? Number(input.choice.slice(2)) : typedNumber(input.text);

/** Puts a message before a turn's replies. @param {any} first @param {Turn} turn @returns {Turn} */
const withPrefix = (first, turn) => ({ ...turn, replies: [first, ...turn.replies] });

/** The adult category: "13 or over" comes from its minimum age. @param {any} tour */
const adultCategory = (tour) =>
  tour.priceCategories.find((/** @type {any} */ c) => isAdultCategory(c)) ?? null;
/** 13 for Ìrìn's tours. @param {any} tour */
const adultFrom = (tour) => adultCategory(tour)?.minAge ?? 13;
/** Does the tour take anyone under the adult age at all? @param {any} tour */
const takesUnder = (tour) =>
  tour.priceCategories.some((/** @type {any} */ c) => !isAdultCategory(c));

/** Total travellers so far. @param {State} s */
const travellerCount = (s) => (s.adults ?? 0) + (s.underCount ?? 0);

/**
 * "Adult (13+)" + 2 → "2 adults"; "Child (3–12)" + 1 → "1 child".
 * @param {{ name: string }} c @param {number} n
 */
function countOf(c, n) {
  const word = plainName(c).toLowerCase();
  const many = word === 'child' ? 'children' : word.endsWith('s') ? word : `${word}s`;
  return `${n} ${n === 1 ? word : many}`;
}

/** "1 palm wine sampler", "2 palm wine samplers". @param {string} name @param {number} n */
const extraOf = (name, n) =>
  `${n} ${name.charAt(0).toLowerCase()}${name.slice(1)}${n === 1 ? '' : 's'}`;

/**
 * The price lines: "2 adults · ₦70,000", "1 child (8) · ₦20,000", "1 infant (1) · free, needs a
 * seat", "1 palm wine sampler · ₦4,000" (catalogue: travellers_ok, summary).
 * @param {any} tour @param {any} quote @param {number[]} childAges
 */
function priceLines(tour, quote, childAges) {
  return quote.lines.map((/** @type {any} */ l) => {
    if (l.type === 'addOn') return `${extraOf(l.label, l.quantity)} · ${formatNaira(l.totalKobo)}`;
    const cat = tour.priceCategories.find((/** @type {any} */ c) => c.key === l.categoryKey);
    const ages =
      cat && !isAdultCategory(cat)
        ? childAges.filter((a) => findCategoryForAge([cat], a) !== null)
        : [];
    const who = `${countOf(cat ?? { name: l.label }, l.quantity)}${ages.length ? ` (${ages.join(', ')})` : ''}`;
    return `${who} · ${l.totalKobo === 0 ? 'free, needs a seat' : formatNaira(l.totalKobo)}`;
  });
}

/** What the price service needs for this guest's travellers. @param {any} tour @param {State} s */
function quoteTravellers(tour, s) {
  const adult = adultCategory(tour);
  return [
    ...Array.from({ length: s.adults ?? 0 }, () => ({ categoryKey: adult.key })),
    ...(s.childAges ?? []).map((age) => ({ age })),
  ];
}

/**
 * The travellers for a booking: the lead (by name) is the first adult; other adults are named
 * at check-in; under-13s come with their ages (decided 2026-11-18).
 * @param {any} tour @param {State} s
 */
function travellersFor(tour, s) {
  const adult = adultCategory(tour);
  return [
    ...Array.from({ length: s.adults ?? 0 }, (_, i) => ({
      name: i === 0 ? (s.leadName ?? '') : '',
      age: null,
      categoryKey: adult.key,
    })),
    ...(s.childAges ?? []).map((age) => ({
      name: '',
      age,
      categoryKey: /** @type {any} */ (findCategoryForAge(tour.priceCategories, age))?.key,
    })),
  ];
}

// --- One turn ---------------------------------------------------------------------------------

/**
 * @param {Deps} deps
 * @param {{ operator: any, conversation: { guestPhone: string, guestName?: string }, state: State, input: Input }} args
 * @returns {Promise<Turn>}
 */
export async function converse(deps, { operator, conversation, state, input }) {
  const ctx = { deps, operator, conversation };
  const typed = input.choice ? '' : (input.text?.trim() ?? '');

  // --- Words that work at any step (message catalogue: help) ---
  if (HELP.test(typed)) return { state, replies: [say.help()] };
  if (
    input.choice === 'person' ||
    (typed && PERSON.test(typed) && !['name', 'email'].includes(state.step))
  ) {
    return handover(ctx, state);
  }
  if (START_AGAIN.test(typed) || input.choice === 'restart') {
    if (state.step === 'booked') return hello(operator, { step: 'hello' });
    await giveBack(deps, state, { cancelLinks: true });
    return { state: { step: 'hello' }, replies: [say.startAgain()], bookingId: null };
  }
  if (HELLO.test(typed)) {
    if (state.step === 'booked') return hello(operator, state);
    await giveBack(deps, state, { unlessLinkSent: true });
    return { ...hello(operator, { step: 'hello' }), bookingId: null };
  }
  // "menu" and every "See tours" button: the tours, from anywhere.
  if (MENU.test(typed) || input.choice === 'tours') {
    if (state.step === 'booked') return showTours(ctx);
    await giveBack(deps, state, { unlessLinkSent: true });
    return { ...(await showTours(ctx)), bookingId: null };
  }
  if (CANCEL.test(typed) || (input.choice === 'cancel' && state.step !== 'hold_over')) {
    if (['hello', 'booked', 'confirm_cancel', 'choose_tour'].includes(state.step)) {
      return { state: { step: 'hello' }, replies: [say.cancelled()] };
    }
    return {
      state: { ...state, step: 'confirm_cancel', resume: state.step },
      replies: [say.cancelConfirm(await seatsHeld(deps, state))],
    };
  }

  return step(ctx, state, input, typed);
}

/**
 * The current step's own answer.
 * @param {Ctx} ctx @param {State} state @param {Input} input @param {string} typed
 * @returns {Promise<Turn>}
 */
async function step(ctx, state, input, typed) {
  const { deps, operator } = ctx;
  switch (state.step) {
    case 'hello':
      return { state, replies: [say.notUnderstood(operator.name)] };

    case 'booked':
      // Decided 2026-11-19: after paying, anything typed goes to the team.
      return { state, replies: [say.passedOn(operator.name)], needsPerson: true };

    case 'choose_tour': {
      const view = await loadCatalogueView(deps.prisma, operator.slug);
      const row = pickRow(input, tourRows(view?.tours ?? []));
      if (!row) return withPrefix(say.didntCatch(), await showTours(ctx));
      return showDates(ctx, { step: 'choose_date', tourSlug: row.id.slice(5), datePage: 0 });
    }

    case 'choose_date': {
      if (input.choice === 'later') {
        return showDates(ctx, { ...state, datePage: (state.datePage ?? 0) + 1 });
      }
      const { tour, rows, dates } = await dateRows(ctx, state);
      if (!tour) return showTours(ctx);
      const row = pickRow(
        input,
        rows.filter((r) => r.id.startsWith('dep:')),
      );
      if (!row) return withPrefix(say.didntCatch(), await showDates(ctx, state));
      const chosen = /** @type {any} */ (dates.find((d) => `dep:${d.id}` === row.id));
      if (chosen.left === 0) {
        return {
          state,
          replies: [say.soldOutPick(day(chosen.startsAt, operator.timeZone), rows)],
        };
      }
      const next = { ...state, departureId: chosen.id };
      // Changing only the date (or another date after seats ran out): hold again at once.
      if (state.changing) return hold(ctx, next);
      return askAdults(ctx, tour, {
        ...next,
        adults: 0,
        underCount: 0,
        childAges: [],
        addOns: {},
        kidsPending: false,
      });
    }

    case 'adults':
    case 'adults_type': {
      const tour = await tourOf(ctx, state);
      if (!tour) return showTours(ctx);
      if (input.choice === 'recount') return askAdults(ctx, tour, state);
      if (input.choice === 'more') {
        return { state: { ...state, step: 'adults_type' }, replies: [say.typeNumber()] };
      }
      const n = numberIn(input);
      if (n === null) return { state, replies: [say.typeNumber()] };
      if (n + (state.underCount ?? 0) > MAX_TRAVELLERS) {
        return { state: { ...state, step: 'adults' }, replies: [say.groupLimit(MAX_TRAVELLERS)] };
      }
      const next = { ...state, adults: n };
      if (state.kidsPending) {
        if (n === 0) return { state, replies: [say.noAdult(adultFrom(tour))] };
        return askAge({ ...next, kidsPending: false, ageIndex: 0, childAges: [] });
      }
      if (!takesUnder(tour)) {
        if (n === 0) return { state, replies: [say.typeNumber()] };
        return afterTravellers(ctx, tour, next);
      }
      // Echo a TYPED number ("4 adults. Anyone under 13…"), as in your design.
      const echo = input.choice ? '' : `${countOf(adultCategory(tour), n)}. `;
      return {
        state: { ...next, step: 'under' },
        replies: [say.under(adultFrom(tour), echo)],
      };
    }

    case 'under': {
      const tour = await tourOf(ctx, state);
      if (!tour) return showTours(ctx);
      const answer =
        input.choice ??
        (/^\s*(no|none|0)\b/i.test(typed) ? 'no' : /^\s*yes\b/i.test(typed) ? 'yes' : null);
      if (answer === 'no') {
        if ((state.adults ?? 0) === 0) {
          return { state: { ...state, step: 'adults' }, replies: [say.typeNumber()] };
        }
        return afterTravellers(ctx, tour, { ...state, underCount: 0, childAges: [] });
      }
      if (answer === 'yes') {
        return {
          state: { ...state, step: 'under_count' },
          replies: [say.underCount(adultFrom(tour))],
        };
      }
      return withPrefix(say.didntCatch(), { state, replies: [say.under(adultFrom(tour))] });
    }

    case 'under_count':
    case 'under_type': {
      const tour = await tourOf(ctx, state);
      if (!tour) return showTours(ctx);
      if (input.choice === 'more') {
        return { state: { ...state, step: 'under_type' }, replies: [say.typeNumber()] };
      }
      const n = numberIn(input);
      if (n === null || n < 1) return { state, replies: [say.typeNumber()] };
      if ((state.adults ?? 0) + n > MAX_TRAVELLERS) {
        return {
          state: { ...state, step: 'adults', underCount: 0 },
          replies: [say.groupLimit(MAX_TRAVELLERS)],
        };
      }
      const next = { ...state, underCount: n, childAges: [], ageIndex: 0 };
      // Children must travel with an adult: ask for the adults first, then the ages.
      if ((state.adults ?? 0) === 0) {
        return {
          state: { ...next, step: 'adults', kidsPending: true },
          replies: [say.noAdult(adultFrom(tour))],
        };
      }
      return askAge(next);
    }

    case 'child_age': {
      const tour = await tourOf(ctx, state);
      if (!tour) return showTours(ctx);
      const age = typedNumber(typed);
      if (age === null) return { state, replies: [say.typeNumber()] };
      if (age >= adultFrom(tour)) return { state, replies: [say.childAgeAgain(adultFrom(tour))] };
      const childAges = [...(state.childAges ?? []), age];
      const i = (state.ageIndex ?? 0) + 1;
      if (i < (state.underCount ?? 0)) return askAge({ ...state, childAges, ageIndex: i });
      // The website's own rules and prices (an age no category takes, for example).
      const next = { ...state, childAges };
      const quoted = await deps.quotes.quote({
        operatorId: operator.id,
        productId: tour._id,
        travellers: quoteTravellers(tour, next),
      });
      if (quoted.blocker) {
        return withPrefix(
          say.problem(quoted.blocker.message),
          await askAdults(ctx, tour, { ...state, adults: 0, underCount: 0, childAges: [] }),
        );
      }
      return withPrefix(
        say.travellersOk(priceLines(tour, quoted.quote, childAges)),
        await afterTravellers(ctx, tour, next),
      );
    }

    case 'extras': {
      const tour = await tourOf(ctx, state);
      if (!tour) return showTours(ctx);
      if (input.choice === 'noextras' || /^\s*no\b/i.test(typed)) {
        return afterExtras(ctx, tour, state);
      }
      const rows = await extraRows(ctx, tour, state);
      const row = pickRow(input, rows);
      if (!row) return withPrefix(say.didntCatch(), await askExtras(ctx, tour, state));
      const addOn = tour.addOns.find((/** @type {any} */ a) => `addon:${a.id}` === row.id);
      const left = await extraLeft(ctx, addOn, state);
      return {
        state: { ...state, step: 'extra_qty', addOnId: addOn.id },
        replies: [say.extraQty(addOn.name, formatNaira(addOn.priceKobo), left)],
      };
    }

    case 'extra_qty':
    case 'extra_qty_type': {
      const tour = await tourOf(ctx, state);
      const addOn = tour?.addOns.find((/** @type {any} */ a) => a.id === state.addOnId);
      if (!tour || !addOn) return showTours(ctx);
      if (input.choice === 'more') {
        return { state: { ...state, step: 'extra_qty_type' }, replies: [say.typeNumber()] };
      }
      const n = numberIn(input);
      if (n === null || n < 1 || n > 50) return { state, replies: [say.typeNumber()] };
      const left = await extraLeft(ctx, addOn, state);
      if (left !== null && n > left) return { state, replies: [say.extraTooMany(left)] };
      const next = { ...state, addOns: { ...state.addOns, [addOn.id]: n }, addOnId: undefined };
      if ((await extraRows(ctx, tour, next)).length === 0) return afterExtras(ctx, tour, next);
      return { state: { ...next, step: 'extra_more' }, replies: [say.extraMore()] };
    }

    case 'extra_more': {
      const tour = await tourOf(ctx, state);
      if (!tour) return showTours(ctx);
      if (input.choice === 'more_extras' || /^\s*(yes|add)\b/i.test(typed)) {
        return askExtras(ctx, tour, state, true);
      }
      if (input.choice === 'done' || /^\s*no\b/i.test(typed)) return afterExtras(ctx, tour, state);
      return withPrefix(say.didntCatch(), { state, replies: [say.extraMore()] });
    }

    case 'pickup': {
      const tour = await tourOf(ctx, state);
      if (!tour) return showTours(ctx);
      const rows = pickupRows(tour);
      const row = pickRow(input, rows);
      if (!row) return withPrefix(say.didntCatch(), { state, replies: [say.pickup(rows)] });
      const point = tour.pickupPoints.find((/** @type {any} */ p) => `pickup:${p.name}` === row.id);
      const where = pickupWhere(point);
      const next = { ...state, pickup: point.name };
      if (state.changing) return withPrefix(text(`Pickup: ${where}.`), await hold(ctx, next));
      return {
        state: { ...next, step: 'name' },
        replies: [say.pickupChosen(where, say.nameText)],
      };
    }

    case 'name': {
      if (typed.length < 2 || typed.length > 80) return { state, replies: [say.name()] };
      return {
        state: { ...state, step: 'email', leadName: typed },
        replies: [say.email(firstName(typed))],
      };
    }

    case 'email': {
      if (input.choice === 'skip' || /^\s*skip\s*$/i.test(typed)) {
        return hold(ctx, { ...state, email: null });
      }
      const email = normalizeEmail(typed);
      if (!email) return { state, replies: [say.emailAgain()] };
      return hold(ctx, { ...state, email });
    }

    case 'seats_short': {
      if (input.choice === 'shrink' && (state.underCount ?? 0) === 0 && state.seatsLeft) {
        return hold(ctx, { ...state, adults: state.seatsLeft });
      }
      if (input.choice === 'other_date' || /another date/i.test(typed))
        return otherDate(ctx, state);
      return withPrefix(say.didntCatch(), await reask(ctx, state));
    }

    case 'summary': {
      if (input.choice === 'pay' || input.choice === 'pay_full' || PAY.test(typed)) {
        return pay(ctx, state, 'full');
      }
      if (input.choice === 'pay_deposit') return pay(ctx, state, 'deposit');
      if (input.choice === 'retry') {
        return pay(ctx, state, state.payChoice ?? 'full', { retry: true });
      }
      if (input.choice === 'change' || /^\s*change\b/i.test(typed)) {
        return {
          state: { ...state, step: 'change' },
          replies: [say.change(await changeRows(ctx, state))],
        };
      }
      return withPrefix(say.didntCatch(), await reask(ctx, state));
    }

    case 'change': {
      const row = pickRow(input, await changeRows(ctx, state));
      if (!row) return withPrefix(say.didntCatch(), await reask(ctx, state));
      const tour = await tourOf(ctx, state);
      if (!tour) return showTours(ctx);
      const changing = { ...state, changing: true };
      switch (row.id) {
        case 'change:date':
          return showDates(ctx, { ...changing, datePage: 0 });
        case 'change:travellers':
          return askAdults(ctx, tour, {
            ...changing,
            adults: 0,
            underCount: 0,
            childAges: [],
            kidsPending: false,
          });
        case 'change:extras':
          return askExtras(ctx, tour, { ...changing, addOns: {} });
        case 'change:pickup':
          return {
            state: { ...changing, step: 'pickup' },
            replies: [say.pickup(pickupRows(tour))],
          };
        default:
          return { state: { ...changing, step: 'name' }, replies: [say.name()] };
      }
    }

    case 'confirm_cancel': {
      if (input.choice === 'stop' || /^\s*yes\b/i.test(typed)) {
        await giveBack(deps, state, { cancelLinks: true });
        return { state: { step: 'hello' }, replies: [say.cancelled()], bookingId: null };
      }
      if (input.choice === 'carry_on' || /^\s*no\b/i.test(typed)) {
        return reask(ctx, { ...state, step: state.resume ?? 'hello', resume: undefined });
      }
      return { state, replies: [say.cancelConfirm(await seatsHeld(deps, state))] };
    }

    case 'hold_over': {
      if (input.choice === 'hold_again' || /\bhold\b/i.test(typed)) {
        return hold(ctx, { ...state, bookingId: undefined }, { thenLink: true });
      }
      if (input.choice === 'other_date' || /another date/i.test(typed))
        return otherDate(ctx, state);
      if (input.choice === 'cancel') {
        return { state: { step: 'hello' }, replies: [say.cancelled()], bookingId: null };
      }
      return withPrefix(say.didntCatch(), await reask(ctx, state));
    }
  }
  return hello(operator, { step: 'hello' });
}

// --- Asking each step's question ---------------------------------------------------------------

/** @param {any} operator @param {State} state @returns {Turn} */
const hello = (operator, state) => ({ state, replies: [say.hello(operator.name)] });

/**
 * The current step's question again (after "No, carry on", "Sorry, I didn't catch that", or
 * when staff hand the chat back).
 * @param {Ctx} ctx @param {State} state @returns {Promise<Turn>}
 */
export async function reask(ctx, state) {
  const tour = state.tourSlug ? await tourOf(ctx, state) : null;
  switch (state.step) {
    case 'choose_tour':
      return showTours(ctx);
    case 'choose_date':
      return showDates(ctx, state);
    case 'adults':
    case 'adults_type':
      return tour ? askAdults(ctx, tour, state) : showTours(ctx);
    case 'under':
      return tour ? { state, replies: [say.under(adultFrom(tour))] } : showTours(ctx);
    case 'under_count':
    case 'under_type':
      return tour ? { state, replies: [say.underCount(adultFrom(tour))] } : showTours(ctx);
    case 'child_age':
      return askAge(state);
    case 'extras':
      return tour ? askExtras(ctx, tour, state) : showTours(ctx);
    case 'extra_qty':
    case 'extra_qty_type': {
      const addOn = tour?.addOns.find((/** @type {any} */ a) => a.id === state.addOnId);
      if (!tour || !addOn) return tour ? askExtras(ctx, tour, state) : showTours(ctx);
      const left = await extraLeft(ctx, addOn, state);
      return { state, replies: [say.extraQty(addOn.name, formatNaira(addOn.priceKobo), left)] };
    }
    case 'extra_more':
      return { state, replies: [say.extraMore()] };
    case 'pickup':
      return tour ? { state, replies: [say.pickup(pickupRows(tour))] } : showTours(ctx);
    case 'name':
      return { state, replies: [say.name()] };
    case 'email':
      return { state, replies: [say.email(firstName(state.leadName ?? ''))] };
    case 'seats_short': {
      const departure = state.departureId
        ? await ctx.deps.prisma.departure.findUnique({ where: { id: state.departureId } })
        : null;
      return {
        state,
        replies: [
          say.seatsShort(
            state.seatsLeft ?? 0,
            departure ? day(departure.startsAt, ctx.operator.timeZone) : 'that date',
            travellerCount(state),
            (state.underCount ?? 0) === 0,
          ),
        ],
      };
    }
    case 'summary': {
      const booking = await heldBooking(ctx, state);
      if (!booking || !tour) return holdOver(state);
      return { state, replies: [summary(ctx, tour, state, booking)] };
    }
    case 'change':
      return { state, replies: [say.change(await changeRows(ctx, state))] };
    case 'hold_over':
      return holdOver(state);
    case 'booked':
      return { state, replies: [say.after()] };
  }
  return hello(ctx.operator, { step: 'hello' });
}

/** @param {Ctx} ctx @returns {Promise<Turn>} */
async function showTours(ctx) {
  const view = await loadCatalogueView(ctx.deps.prisma, ctx.operator.slug);
  const tours = view?.tours ?? [];
  if (tours.length === 0) return { state: { step: 'hello' }, replies: [say.noTours()] };
  return {
    state: { step: 'choose_tour' },
    replies: [say.tours(tourRows(tours), view?.operator.pricesInclude ?? null)],
  };
}

/**
 * List rows: the short name (24 characters, decided 2026-11-19), then "from ₦25,000 · daily
 * 09:00 · 3 h". Typing the full title works too.
 * @param {any[]} tours
 */
const tourRows = (tours) =>
  tours.map((t) => ({
    id: `tour:${t.slug}`,
    title: t.shortTitle ?? t.title,
    also: t.title,
    description: [
      t.fromPriceKobo !== null ? `from ${formatNaira(t.fromPriceKobo)}` : null,
      t.scheduleSummary,
      duration(t.durationMinutes),
    ]
      .filter(Boolean)
      .join(' · '),
  }));

/** @param {Ctx} ctx @param {State} state */
async function tourOf(ctx, state) {
  if (!state.tourSlug) return null;
  const view = await loadTourView(ctx.deps.prisma, ctx.operator.slug, state.tourSlug);
  return view?.tour ?? null;
}

/**
 * The tour's dates, a page at a time: full ones too, marked "Sold out" (your design).
 * @param {Ctx} ctx @param {State} state
 */
async function dateRows(ctx, state) {
  const { operator } = ctx;
  const tour = await tourOf(ctx, state);
  if (!tour) return { tour: null, rows: [], dates: [] };
  const now = nowOf(ctx.deps);
  const today = localDate(now, operator.timeZone);
  const all = await listAvailability(ctx.deps.prisma, {
    operatorId: operator.id,
    productId: tour._id,
    from: today,
    to: addDays(today, DATES_AHEAD_DAYS),
    timeZone: operator.timeZone,
  });
  const dates = all
    .filter((d) => d.startsAt > now)
    .map((d) => ({
      id: d.id,
      startsAt: d.startsAt,
      left: Math.max(0, d.capacity - d.seatsSold - d.seatsHeld),
    }));
  const page = state.datePage ?? 0;
  const slice = dates.slice(page * DATES_PER_PAGE, (page + 1) * DATES_PER_PAGE);
  /** @type {Array<{ id: string, title: string, description?: string }>} */
  const rows = slice.map((d) => ({
    id: `dep:${d.id}`,
    title: `${day(d.startsAt, operator.timeZone)} · ${clock(d.startsAt, operator.timeZone)}`,
    description: d.left === 0 ? 'Sold out' : d.left <= 3 ? `Only ${d.left} left` : `${d.left} left`,
  }));
  if (dates.length > (page + 1) * DATES_PER_PAGE) {
    const last = /** @type {any} */ (slice.at(-1));
    rows.push({
      id: 'later',
      title: 'Later dates',
      description: `See dates after ${day(last.startsAt, operator.timeZone)}`,
    });
  }
  return { tour, rows, dates };
}

/** The tour message with its dates (catalogue: tour, no_dates). @param {Ctx} ctx @param {State} state @returns {Promise<Turn>} */
async function showDates(ctx, state) {
  const { tour, rows, dates } = await dateRows(ctx, state);
  if (!tour) return showTours(ctx);
  if (dates.every((d) => d.left === 0) && (state.datePage ?? 0) === 0) {
    return { state: { ...state, step: 'choose_date' }, replies: [say.noDates(tour.title)] };
  }
  const view = await loadCatalogueView(ctx.deps.prisma, ctx.operator.slug);
  const headline = view?.tours.find((t) => t.slug === tour.slug)?.cancellationHeadline ?? null;
  const url = `${ctx.deps.webPublicUrl.replace(/\/+$/, '')}/${ctx.operator.slug}/${tour.slug}`;
  const body = [
    `*${tour.title}*`,
    tour.summary,
    `${duration(tour.durationMinutes)}${tour.fromPriceKobo !== null ? ` · from ${formatNaira(tour.fromPriceKobo)} per adult` : ''}`,
    ...(headline ? [`${headline}.`] : []),
    '',
    `All the details: ${url}`,
  ].join('\n');
  return { state: { ...state, step: 'choose_date' }, replies: [say.tour(body, rows)] };
}

/** "Sat 5 Dec at 18:30. 8 seats left. How many adults?" @param {Ctx} ctx @param {any} tour @param {State} state @returns {Promise<Turn>} */
async function askAdults(ctx, tour, state) {
  const departure = state.departureId
    ? await ctx.deps.prisma.departure.findUnique({ where: { id: state.departureId } })
    : null;
  if (!departure) return showDates(ctx, { ...state, datePage: 0 });
  const tz = ctx.operator.timeZone;
  const left = Math.max(0, departure.capacity - departure.seatsSold - departure.seatsHeld);
  return {
    state: { ...state, step: 'adults' },
    replies: [
      say.adults(
        `${day(departure.startsAt, tz)} at ${clock(departure.startsAt, tz)}`,
        left,
        adultFrom(tour),
      ),
    ],
  };
}

/** @param {State} state @returns {Turn} */
const askAge = (state) => ({
  state: { ...state, step: 'child_age' },
  replies: [say.childAge(state.ageIndex ?? 0)],
});

/** After who's coming: extras, pickup or the name (or, when changing, a new summary). @param {Ctx} ctx @param {any} tour @param {State} state @returns {Promise<Turn>} */
async function afterTravellers(ctx, tour, state) {
  if (travellerCount(state) === 0) return askAdults(ctx, tour, state);
  if (state.changing) return hold(ctx, state);
  if (tour.addOns.length > 0) return askExtras(ctx, tour, { ...state, addOns: {} });
  return afterExtras(ctx, tour, state);
}

/** What's left of an extra on the chosen date (null = no limit). @param {Ctx} ctx @param {any} addOn @param {State} state */
async function extraLeft(ctx, addOn, state) {
  if (addOn.stockPerDeparture === null || !state.departureId) return null;
  const used = await addOnUsage(ctx.deps.prisma, state.departureId);
  // When changing extras, this chat's own hold gives its extras back on the new hold: they
  // aren't really taken from this guest.
  let mine = 0;
  if (state.bookingId) {
    const b = await ctx.deps.prisma.booking.findUnique({
      where: { id: state.bookingId },
      include: { hold: { include: { addOns: true } } },
    });
    if (b?.status === 'held' && b.hold.status === 'active' && b.departureId === state.departureId) {
      mine = b.hold.addOns
        .filter((x) => x.addOnId === addOn.id)
        .reduce((sum, x) => sum + x.quantity, 0);
    }
  }
  return Math.max(0, addOn.stockPerDeparture - (used.get(addOn.id) ?? 0) + mine);
}

/** The extras not chosen yet, with what's left (sold-out ones aren't offered). @param {Ctx} ctx @param {any} tour @param {State} state */
async function extraRows(ctx, tour, state) {
  const rows = [];
  for (const a of tour.addOns) {
    if (state.addOns?.[a.id]) continue;
    const left = await extraLeft(ctx, a, state);
    if (left === 0) continue;
    rows.push({
      id: `addon:${a.id}`,
      title: a.name,
      description: [
        `+${formatNaira(a.priceKobo)} each`,
        a.description,
        left !== null ? `${left} left` : null,
      ]
        .filter(Boolean)
        .join(' · '),
    });
  }
  return rows;
}

/** @param {Ctx} ctx @param {any} tour @param {State} state @param {boolean} [again] @returns {Promise<Turn>} */
async function askExtras(ctx, tour, state, again = false) {
  const rows = await extraRows(ctx, tour, state);
  if (rows.length === 0) return afterExtras(ctx, tour, state);
  return { state: { ...state, step: 'extras' }, replies: [say.extras(rows, again)] };
}

/** @param {Ctx} ctx @param {any} tour @param {State} state @returns {Promise<Turn>} */
async function afterExtras(ctx, tour, state) {
  if (state.changing) return hold(ctx, state);
  if (tour.pickupPoints.length > 0) {
    return { state: { ...state, step: 'pickup' }, replies: [say.pickup(pickupRows(tour))] };
  }
  return { state: { ...state, step: 'name' }, replies: [say.name()] };
}

/** Pickup rows: the area, then "Falomo roundabout · 07:30". @param {any} tour */
const pickupRows = (tour) =>
  tour.pickupPoints.map((/** @type {any} */ p) => ({
    id: `pickup:${p.name}`,
    title: p.name,
    description: [p.address, p.time].filter(Boolean).join(' · '),
  }));

/** "Ikoyi, Falomo roundabout at 07:30". @param {any} p */
export const pickupWhere = (p) =>
  `${p.name}${p.address ? `, ${p.address}` : ''}${p.time ? ` at ${p.time}` : ''}`;

/** "What would you like to change?" rows (only what this tour has). @param {Ctx} ctx @param {State} state */
async function changeRows(ctx, state) {
  const tour = await tourOf(ctx, state);
  return [
    { id: 'change:date', title: 'Date' },
    { id: 'change:travellers', title: 'Travellers' },
    ...(tour?.addOns.length ? [{ id: 'change:extras', title: 'Extras' }] : []),
    ...(tour?.pickupPoints.length ? [{ id: 'change:pickup', title: 'Pickup point' }] : []),
    { id: 'change:details', title: 'Name or email' },
  ];
}

/** "Choose another date": keep every other answer, hold again once a date is chosen. @param {Ctx} ctx @param {State} state @returns {Promise<Turn>} */
async function otherDate(ctx, state) {
  const turn = await showDates(ctx, {
    ...state,
    changing: true,
    datePage: 0,
    bookingId: undefined,
  });
  const listed = turn.replies.at(-1);
  if (listed?.kind !== 'list') return turn;
  return { ...turn, replies: [say.keepAnswers(listed.rows)] };
}

// --- Holding, the summary, paying ---------------------------------------------------------------

/**
 * Holds the seats and creates the booking, the website's way, then the summary (or, after
 * "Hold them again", straight to a fresh link).
 * @param {Ctx} ctx @param {State} state @param {{ thenLink?: boolean }} [opts]
 * @returns {Promise<Turn>}
 */
async function hold(ctx, state, { thenLink = false } = {}) {
  const { deps, operator, conversation } = ctx;
  const tour = await tourOf(ctx, state);
  if (!tour || !state.departureId) return showTours(ctx);
  await giveBack(deps, state); // one guest, one hold (like the website, stage 12d)
  const done = { ...state, changing: false, bookingId: undefined };
  let created;
  try {
    created = await bookForGuest(deps, {
      operator,
      departureId: state.departureId,
      channel: 'whatsapp',
      holdMinutes: WHATSAPP_HOLD_MINUTES,
      lead: {
        name: state.leadName ?? conversation.guestName ?? '',
        email: state.email ?? null,
        phone: conversation.guestPhone,
      },
      travellers: travellersFor(tour, state),
      addOns: Object.entries(state.addOns ?? {}).map(([addOnId, quantity]) => ({
        addOnId,
        quantity,
      })),
      pickupPoint: state.pickup ?? null,
    });
  } catch (err) {
    if (!(err instanceof HttpError)) throw err;
    if (err.code === 'SOLD_OUT') {
      // Someone booked while we were chatting (catalogue: seats_short). Answers are kept.
      const left = /** @type {any} */ (err.details)?.seatsAvailable ?? 0;
      const departure = await deps.prisma.departure.findUnique({
        where: { id: state.departureId },
      });
      return {
        state: { ...done, step: 'seats_short', seatsLeft: left },
        bookingId: null,
        replies: [
          say.seatsShort(
            left,
            departure ? day(departure.startsAt, operator.timeZone) : 'that date',
            travellerCount(state),
            (state.underCount ?? 0) === 0,
          ),
        ],
      };
    }
    // Any other rule (an extra sold out, the date started…): say it, choose again.
    return withPrefix(say.problem(err.message), await otherDate(ctx, done));
  }
  /** @type {State} */
  const held = { ...done, step: 'summary', bookingId: created.bookingId };
  if (thenLink) return pay(ctx, held, held.payChoice ?? 'full', { heldAgain: true });
  const booking = await heldBooking(ctx, held);
  return {
    state: held,
    bookingId: created.bookingId,
    replies: [summary(ctx, tour, held, booking)],
  };
}

/** The booking the chat is holding, with what the summary needs; null if not held any more. @param {Ctx} ctx @param {State} state */
async function heldBooking(ctx, state) {
  if (!state.bookingId) return null;
  const b = await ctx.deps.prisma.booking.findUnique({
    where: { id: state.bookingId },
    include: {
      product: { include: { operator: true } },
      departure: true,
      hold: true,
      travellers: true,
    },
  });
  return b &&
    b.status === 'held' &&
    b.hold.status === 'active' &&
    b.hold.expiresAt > nowOf(ctx.deps)
    ? b
    : null;
}

/** @param {State} state @returns {Turn} */
const holdOver = (state) => ({
  state: { ...state, step: 'hold_over', bookingId: undefined },
  replies: [say.holdOver()],
  bookingId: null,
});

/**
 * The summary (catalogue: summary, summary_deposit).
 * @param {Ctx} ctx @param {any} tour @param {State} state @param {any} booking
 */
export function summary(ctx, tour, state, booking) {
  const { operator, deps } = ctx;
  const tz = operator.timeZone;
  const quote = /** @type {any} */ (booking.quote);
  const n = booking.travellers.length;
  const point = state.pickup
    ? tour.pickupPoints.find((/** @type {any} */ p) => p.name === state.pickup)
    : null;
  const free = tour.cancellationPolicy
    ? freeCancellationUntil(tour.cancellationPolicy, booking.departure.startsAt, tz)
    : null;
  const deposit = paymentOptions(booking, nowOf(deps)).find((o) => o.type === 'deposit');
  const pct = Math.round((tour.depositBasisPoints ?? 0) / 100);
  const tax = quote.tax?.amountKobo
    ? ` (includes ${formatNaira(quote.tax.amountKobo)} ${quote.tax.name})`
    : '';
  const body = [
    '*Your booking*',
    tour.title,
    `${day(booking.departure.startsAt, tz)} · ${clock(booking.departure.startsAt, tz)}`,
    point ? `Pickup: ${pickupWhere(point)}` : `Meet at ${tour.meetingPoint.name}`,
    '',
    ...priceLines(tour, quote, state.childAges ?? []),
    `Total ${formatNaira(booking.totalKobo)}${tax}`,
    '',
    ...(free ? [`Free cancellation until ${free}.`] : []),
    `I’m holding your ${n === 1 ? 'seat' : `${n} seats`} until ${clock(booking.hold.expiresAt, tz)} (${WHATSAPP_HOLD_MINUTES} minutes).`,
    ...(deposit && deposit.type === 'deposit'
      ? [
          '',
          `Pay in full now, or pay a ${pct}% deposit now and the rest (${formatNaira(deposit.balanceKobo)}) by ${formatLocalDay(deposit.balanceDueDate)}.${tour.cancellationPolicy?.depositRefundable === false ? ' Deposits are non-refundable.' : ''}`,
        ]
      : []),
    '',
    `By tapping Pay you accept the booking terms: ${deps.webPublicUrl.replace(/\/+$/, '')}/${operator.slug}/${tour.slug}`,
  ].join('\n');
  return say.summary(body, {
    full: formatNaira(booking.totalKobo),
    ...(deposit && { deposit: { pct, amount: formatNaira(deposit.amountKobo) } }),
  });
}

/**
 * Pay: a payment link on the website's own /pay page (catalogue: pay_link; branches: the
 * deposit link, "Try again", "Hold them again").
 * @param {Ctx} ctx @param {State} state @param {'full' | 'deposit'} choice
 * @param {{ retry?: boolean, heldAgain?: boolean }} [opts]
 * @returns {Promise<Turn>}
 */
async function pay(ctx, state, choice, { retry = false, heldAgain = false } = {}) {
  const { deps, operator } = ctx;
  const now = nowOf(deps);
  const booking = await heldBooking(ctx, state);
  const options = booking ? paymentOptions(booking, now) : [];
  const full = options.find((o) => o.type === 'full');
  if (!booking || !full) return holdOver(state);
  const deposit = options.find((o) => o.type === 'deposit');
  const option = (choice === 'deposit' && deposit) || full;

  // "Try again": the old link stops working (branches design).
  if (retry) await cancelOpenLinks(deps, booking);
  let token;
  try {
    ({ token } = await createPaymentLink(deps.prisma, {
      operatorId: operator.id,
      bookingId: booking.id,
      amountKobo: option.amountKobo,
      actor: { type: 'guest' },
      now,
    }));
  } catch (err) {
    if (err instanceof BookingError) return holdOver(state); // the hold ran out this second
    throw err;
  }
  const url = `${deps.webPublicUrl.replace(/\/+$/, '')}/pay/${token}`;
  const tz = operator.timeZone;
  const until = clock(booking.hold.expiresAt, tz);
  const amount = formatNaira(option.amountKobo);
  const preview = {
    title: `${option.type === 'deposit' ? 'Deposit' : 'Pay'} ${amount} · ${operator.name}`,
    description: `${booking.product.shortTitle ?? booking.product.title} · ${day(booking.departure.startsAt, tz)}`,
  };
  const n = booking.travellers.length;
  const reply = heldAgain
    ? say.heldAgain(n, until, amount, url, preview)
    : retry
      ? say.newLink(url, preview)
      : option.type === 'deposit'
        ? say.depositLink(amount, formatLocalDay(option.balanceDueDate), url, preview)
        : say.payLink(url, until, preview);
  return {
    state: {
      ...state,
      step: 'summary',
      payChoice: option.type === 'deposit' ? 'deposit' : 'full',
    },
    bookingId: booking.id,
    replies: [reply],
  };
}

/**
 * Staff handed the chat back (catalogue: handback): "Welcome back, Adaeze. Here's where we
 * were: 2 seats on Sat 5 Dec held until 11:15, total ₦74,000." with the summary's buttons; or,
 * mid-booking, the question the guest was on (not in the designs).
 * @param {Ctx} ctx @param {State} state @returns {Promise<Turn>}
 */
export async function welcomeBack(ctx, state) {
  const first = firstName(state.leadName ?? ctx.conversation.guestName ?? '');
  if (state.step === 'summary') {
    const tour = await tourOf(ctx, state);
    const booking = await heldBooking(ctx, state);
    if (!tour || !booking) return holdOver(state);
    const tz = ctx.operator.timeZone;
    const n = booking.travellers.length;
    const where = `${n} ${n === 1 ? 'seat' : 'seats'} on ${day(booking.departure.startsAt, tz)} held until ${clock(booking.hold.expiresAt, tz)}, total ${formatNaira(booking.totalKobo)}.`;
    return { state, replies: [say.welcomeBack(first, where, summary(ctx, tour, state, booking))] };
  }
  if (['hello', 'choose_tour', 'booked', 'confirm_cancel'].includes(state.step)) {
    const s = state.step === 'confirm_cancel' ? { ...state, step: state.resume ?? 'hello' } : state;
    if (s.step !== 'hello' && s.step !== 'choose_tour' && s.step !== 'booked') {
      return withPrefix(
        text(`Welcome back${first ? `, ${first}` : ''}. Here’s where we were:`),
        await reask(ctx, s),
      );
    }
    return { state: s, replies: [say.welcomeBackFresh(first)] };
  }
  return withPrefix(
    text(`Welcome back${first ? `, ${first}` : ''}. Here’s where we were:`),
    await reask(ctx, state),
  );
}

// --- A person -----------------------------------------------------------------------------------

/**
 * "Talk to a person" (catalogue: handover, team_away). Opening hours decided 2026-11-19.
 * @param {Ctx} ctx @param {State} state @returns {Promise<Turn>}
 */
async function handover(ctx, state) {
  const { operator, deps } = ctx;
  const tz = operator.timeZone;
  const booking = await heldBooking(ctx, state);
  const heldUntil = booking ? clock(booking.hold.expiresAt, tz) : null;
  const hours = readSite(operator.site).hours ?? null;
  const now = clock(nowOf(deps), tz);
  return {
    state,
    needsPerson: true,
    replies: [
      hours && (now < hours.opens || now >= hours.closes)
        ? say.teamAway(hours.opens, heldUntil)
        : say.handover(operator.name, hours ? `${hours.opens}–${hours.closes}` : null, heldUntil),
    ],
  };
}

// --- Giving seats back ---------------------------------------------------------------------------

/** Are seats held for this chat right now? @param {Deps} deps @param {State} state */
async function seatsHeld(deps, state) {
  if (!state.bookingId) return false;
  const b = await deps.prisma.booking.findUnique({ where: { id: state.bookingId } });
  return b?.status === 'held';
}

/**
 * Gives back the seats this chat is holding.
 *   unlessLinkSent  keep them if the guest has a payment link (the bot promised "held until…")
 *   cancelLinks     and stop its payment links working ("Yes, stop", "start again")
 * @param {Deps} deps @param {State} state
 * @param {{ unlessLinkSent?: boolean, cancelLinks?: boolean }} [opts]
 */
async function giveBack(deps, state, { unlessLinkSent = false, cancelLinks = false } = {}) {
  if (!state.bookingId) return;
  const booking = await deps.prisma.booking.findUnique({
    where: { id: state.bookingId },
    include: { _count: { select: { paymentLinks: true } } },
  });
  if (booking?.status !== 'held') return;
  if (unlessLinkSent && booking._count.paymentLinks > 0) return;
  if (cancelLinks) await cancelOpenLinks(deps, booking);
  await releaseHold(deps.prisma, booking.holdId, { reason: 'released', actor: { type: 'guest' } });
}

/** @param {Deps} deps @param {{ id: string, operatorId: string }} booking */
async function cancelOpenLinks(deps, booking) {
  const links = await deps.prisma.paymentLink.findMany({
    where: { bookingId: booking.id, status: 'active' },
  });
  for (const l of links) {
    // Already used or cancelled meanwhile: nothing to stop.
    await cancelPaymentLink(deps.prisma, { operatorId: booking.operatorId, linkId: l.id }).catch(
      () => {},
    );
  }
}
