// @ts-check
/**
 * engine.js — the WhatsApp booking assistant's brain (BKG-09, session 13).
 *
 *   converse(deps, { operator, conversation, state, input }) → { state, replies, … }
 *
 * One guest message in (a typed `text`, or the `choice` id of a button or list row they
 * tapped), the replies out, and the new state to remember. The SAME function serves the
 * simulator and the real WhatsApp: channels only carry messages (channels.js).
 *
 *   hello ─► choose_tour ─► choose_date ─► count (each price category) ─► age (each child)
 *         ─► add_on (each extra) ─► pickup (if any) ─► name ─► email ─► summary (seats HELD)
 *         ─► Pay ─► (full or deposit?) ─► the payment link; the ticket follows when it settles
 *
 * Every step accepts a tapped choice, a typed number ("2" = the 2nd row) or the row's name, and
 * otherwise asks again. "hi", "menu", "start again" go back to the start from anywhere; "person"
 * asks for the team. Booking goes through bookForGuest(), the website's own code: the same
 * prices, rules and seats (PRD: "the same prices and availability in both").
 */
import { releaseHold, listAvailability, createPaymentLink, BookingError } from '@okapigo/db';
import { formatNaira } from '@okapigo/shared/money';
import { formatLocalDay } from '@okapigo/shared/preview';
import { freeCancellationUntil, formatDurationShort } from '@okapigo/shared/tour-facts';
import { isAdultCategory } from '@okapigo/shared/catalogue';
import { addDays, localDate } from '@okapigo/shared/time';
import { normalizeEmail } from '@okapigo/shared/contact';
import { HttpError } from '../middleware/errors.js';
import { loadCatalogueView, loadTourView } from '../lib/public-views.js';
import { bookForGuest, plainName, ageRange } from '../lib/guest-booking.js';
import { paymentOptions } from '../lib/payment-options.js';
import { say } from './messages.js';

/** Decided 2026-11-18: seats are held longer on WhatsApp than on the website (15). */
export const WHATSAPP_HOLD_MINUTES = 30;
/** How far ahead the dates list looks. */
const DATES_AHEAD_DAYS = 90;
/** Date rows per page (the 10th row is "Later dates"). */
const DATES_PER_PAGE = 9;
const MAX_TRAVELLERS = 20;

const RESTART = /^\s*(hi|hello|hey|menu|start|start again|restart)\s*[.!]?\s*$/i;
const PERSON = /\b(person|human|agent|staff|someone)\b/i;

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
 */

/** "Adult (13+)" → "adults (13+)", "Child (3–12)" → "children (3–12)". @param {{ name: string }} c */
function plural(c) {
  const range = c.name.match(/\(.*\)\s*$/)?.[0] ?? '';
  const word = plainName(c).toLowerCase();
  const many = word === 'child' ? 'children' : word.endsWith('s') ? word : `${word}s`;
  return range ? `${many} ${range}` : many;
}

/** The tour's price categories in the order asked: adults first, then by age, oldest first. @param {any[]} cats */
const orderedCategories = (cats) =>
  [...cats].sort(
    (a, b) => Number(isAdultCategory(b)) - Number(isAdultCategory(a)) || b.minAge - a.minAge,
  );

/** A typed whole number, or null. @param {string | undefined} text */
const typedNumber = (text) => {
  const m = text?.match(/^\s*(\d{1,3})\s*$/);
  return m ? Number(m[1]) : null;
};

/**
 * Which row did the guest mean? Their tap (the id), a typed number ("2"), or the row's name.
 * @param {Input} input
 * @param {Array<{ id: string, title: string }>} rows
 */
function pickRow(input, rows) {
  if (input.choice) return rows.find((r) => r.id === input.choice) ?? null;
  const n = typedNumber(input.text);
  if (n !== null) return rows[n - 1] ?? null;
  const t = input.text?.trim().toLowerCase();
  if (!t || t.length < 3) return null;
  return rows.find((r) => r.title.toLowerCase().includes(t)) ?? null;
}

/**
 * One turn of the conversation.
 * @param {Deps} deps
 * @param {{ operator: import('@prisma/client').Operator, conversation: { guestPhone: string }, state: State, input: Input }} ctx
 * @returns {Promise<Turn>}
 */
export async function converse(deps, { operator, conversation, state, input }) {
  const text = input.text?.trim() ?? '';

  // From anywhere: start again (giving back any seats held), or ask for a person. Once a
  // payment link was sent, the seats stay held: the bot said "held until 14:35", and the
  // guest may still pay that link (or just be saying hi again).
  if (input.choice === 'restart' || (!input.choice && RESTART.test(text))) {
    await releaseHeld(deps, state, { unlessLinkSent: true });
    return { state: { step: 'hello' }, replies: [say.hello(operator.name)], bookingId: null };
  }
  if (input.choice === 'person' || (!input.choice && PERSON.test(text))) {
    return { state, replies: [say.person(operator.name)], needsPerson: true };
  }

  switch (state.step) {
    case 'hello':
      // "See tours", or anything at all: the guest wrote to book.
      return showTours(deps, operator);

    case 'choose_tour': {
      const view = await loadCatalogueView(deps.prisma, operator.slug);
      const rows = tourRows(view?.tours ?? []);
      const row = pickRow(input, rows);
      if (!row)
        return {
          state,
          replies: [
            say.didntGet('Choose a tour from the list'),
            say.tours(rows, view?.operator.pricesInclude ?? null),
          ],
        };
      return showDates(deps, operator, {
        step: 'choose_date',
        tourSlug: row.id.slice('tour:'.length),
        datePage: 0,
      });
    }

    case 'choose_date': {
      if (input.choice === 'tours') return showTours(deps, operator);
      if (input.choice === 'later') {
        return showDates(deps, operator, { ...state, datePage: (state.datePage ?? 0) + 1 });
      }
      const { rows, tour } = await dateRows(deps, operator, state);
      const row = pickRow(
        input,
        rows.filter((r) => r.id.startsWith('dep:')),
      );
      if (!row || !tour)
        return withPrefix(
          say.didntGet('Choose a date from the list'),
          await showDates(deps, operator, state),
        );
      const next = {
        ...state,
        departureId: row.id.slice('dep:'.length),
        counts: {},
        ages: {},
        categoryIndex: 0,
      };
      return askCount(tour, next);
    }

    case 'count':
    case 'count_type': {
      const tour = await tourOf(deps, operator, state);
      if (!tour) return restartFromTours(deps, operator);
      const cats = orderedCategories(tour.priceCategories);
      const cat = cats[state.categoryIndex ?? 0];
      if (input.choice === 'more')
        return { state: { ...state, step: 'count_type' }, replies: [say.typeCount(plural(cat))] };
      const n = input.choice?.startsWith('n:') ? Number(input.choice.slice(2)) : typedNumber(text);
      if (n === null || n < 0 || n > MAX_TRAVELLERS) {
        return withPrefix(
          say.didntGet('Choose a number'),
          askCount(tour, { ...state, step: 'count' }),
        );
      }
      const counts = { ...state.counts, [cat.key]: n };
      // Children and infants give their ages (decided 2026-11-18); adults don't.
      if (n > 0 && !isAdultCategory(cat)) {
        return {
          state: {
            ...state,
            step: 'age',
            counts,
            ageIndex: 0,
            ages: { ...state.ages, [cat.key]: [] },
          },
          replies: [say.age(plainName(cat).toLowerCase(), 1, ageRange(cat))],
        };
      }
      return afterCount(deps, operator, tour, { ...state, counts });
    }

    case 'age': {
      const tour = await tourOf(deps, operator, state);
      if (!tour) return restartFromTours(deps, operator);
      const cat = orderedCategories(tour.priceCategories)[state.categoryIndex ?? 0];
      const age = typedNumber(text);
      const i = state.ageIndex ?? 0;
      const who = plainName(cat).toLowerCase();
      if (age === null || age < cat.minAge || (cat.maxAge !== null && age > cat.maxAge)) {
        return {
          state,
          replies: [
            say.problem(
              `${plainName(cat)}: ages ${ageRange(cat)}. Type the age of ${who} ${i + 1}, or "menu" to start again.`,
            ),
          ],
        };
      }
      const ages = { ...state.ages, [cat.key]: [...(state.ages?.[cat.key] ?? []), age] };
      const total = state.counts?.[cat.key] ?? 0;
      if (i + 1 < total) {
        return {
          state: { ...state, ages, ageIndex: i + 1 },
          replies: [say.age(who, i + 2, ageRange(cat))],
        };
      }
      return afterCount(deps, operator, tour, { ...state, ages, step: 'count' });
    }

    case 'add_on': {
      const tour = await tourOf(deps, operator, state);
      if (!tour) return restartFromTours(deps, operator);
      const addOn = tour.addOns[state.addOnIndex ?? 0];
      const n = input.choice?.startsWith('n:') ? Number(input.choice.slice(2)) : typedNumber(text);
      if (!addOn || n === null || n < 0 || n > 50) {
        return withPrefix(say.didntGet('Choose one of the buttons'), askAddOn(tour, state));
      }
      const next = {
        ...state,
        addOns: { ...state.addOns, ...(n > 0 ? { [addOn.id]: n } : {}) },
        addOnIndex: (state.addOnIndex ?? 0) + 1,
      };
      return afterAddOns(tour, next);
    }

    case 'pickup': {
      const tour = await tourOf(deps, operator, state);
      if (!tour) return restartFromTours(deps, operator);
      const rows = pickupRows(tour);
      const row = pickRow(input, rows);
      if (!row)
        return withPrefix(say.didntGet('Choose a pickup point'), {
          state,
          replies: [say.pickup(rows)],
        });
      return {
        state: { ...state, step: 'name', pickup: row.id.slice('pickup:'.length) },
        replies: [say.name()],
      };
    }

    case 'name': {
      if (text.length < 2 || text.length > 80) return { state, replies: [say.name()] };
      return { state: { ...state, step: 'email', leadName: text }, replies: [say.email()] };
    }

    case 'email': {
      const email = input.choice === 'skip' ? null : normalizeEmail(text);
      if (input.choice !== 'skip' && !email) {
        return {
          state,
          replies: [
            say.problem('That doesn’t look like an email address. Type it again, or tap Skip.'),
            say.email(),
          ],
        };
      }
      return hold(deps, operator, conversation, { ...state, email });
    }

    case 'summary': {
      if (input.choice === 'cancel') {
        await releaseHeld(deps, state);
        return { state: { step: 'hello' }, replies: [say.cancelled()], bookingId: null };
      }
      if (input.choice === 'change') {
        await releaseHeld(deps, state);
        return showDates(deps, operator, {
          step: 'choose_date',
          tourSlug: state.tourSlug,
          datePage: 0,
        });
      }
      if (input.choice === 'pay' || (!input.choice && /^pay\b/i.test(text))) {
        return pay(deps, operator, state, null);
      }
      return { state, replies: [say.didntGet('Tap one of the buttons')] };
    }

    case 'hold_over': {
      // "Your 30 minutes are up" (notices.js): hold the same tour, date and people again.
      // Everything chosen is still in the state; hold() checks seats and prices afresh.
      if (input.choice === 'hold_again') {
        return hold(deps, operator, conversation, { ...state, bookingId: undefined });
      }
      return showTours(deps, operator);
    }

    case 'pay_choice': {
      if (input.choice === 'cancel') {
        await releaseHeld(deps, state);
        return { state: { step: 'hello' }, replies: [say.cancelled()], bookingId: null };
      }
      if (input.choice === 'pay_full') return pay(deps, operator, state, 'full');
      if (input.choice === 'pay_deposit') return pay(deps, operator, state, 'deposit');
      return withPrefix(
        say.didntGet('Tap one of the buttons'),
        await pay(deps, operator, state, null),
      );
    }
  }
  return { state: { step: 'hello' }, replies: [say.hello(operator.name)] };
}

// --- Steps ------------------------------------------------------------------------------------

/** @param {Deps} deps @param {any} operator @returns {Promise<Turn>} */
async function showTours(deps, operator) {
  const view = await loadCatalogueView(deps.prisma, operator.slug);
  const tours = view?.tours ?? [];
  if (tours.length === 0) return { state: { step: 'hello' }, replies: [say.noTours()] };
  return {
    state: { step: 'choose_tour' },
    replies: [say.tours(tourRows(tours), view?.operator.pricesInclude ?? null)],
  };
}

/** @param {Deps} deps @param {any} operator */
const restartFromTours = (deps, operator) => showTours(deps, operator);

/** @param {any[]} tours */
const tourRows = (tours) =>
  tours.map((t) => ({
    id: `tour:${t.slug}`,
    title: t.title,
    description: [
      t.fromPriceKobo !== null ? `from ${formatNaira(t.fromPriceKobo)}` : null,
      t.scheduleSummary,
    ]
      .filter(Boolean)
      .join(' · '),
  }));

/** @param {Deps} deps @param {any} operator @param {State} state */
async function tourOf(deps, operator, state) {
  if (!state.tourSlug) return null;
  const view = await loadTourView(deps.prisma, operator.slug, state.tourSlug);
  return view?.tour ?? null;
}

/**
 * The open dates of the chosen tour, a page at a time.
 * @param {Deps} deps @param {any} operator @param {State} state
 */
async function dateRows(deps, operator, state) {
  const tour = await tourOf(deps, operator, state);
  if (!tour) return { tour: null, rows: [] };
  const today = localDate((deps.now ?? (() => new Date()))(), operator.timeZone);
  const all = await listAvailability(deps.prisma, {
    operatorId: operator.id,
    productId: tour._id,
    from: today,
    to: addDays(today, DATES_AHEAD_DAYS),
    timeZone: operator.timeZone,
  });
  const open = all
    .map((d) => ({ d, left: Math.max(0, d.capacity - d.seatsSold - d.seatsHeld) }))
    .filter((x) => x.left > 0); // a list row can't be greyed out, so full dates aren't offered
  const page = state.datePage ?? 0;
  const slice = open.slice(page * DATES_PER_PAGE, (page + 1) * DATES_PER_PAGE);
  /** @type {Array<{ id: string, title: string, description?: string }>} */
  const rows = slice.map(({ d, left }) => ({
    id: `dep:${d.id}`,
    title: `${formatLocalDay(localDate(d.startsAt, operator.timeZone))} · ${new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: operator.timeZone }).format(d.startsAt)}`,
    description: left <= 3 ? `Only ${left} ${left === 1 ? 'seat' : 'seats'} left` : `${left} left`,
  }));
  if (open.length > (page + 1) * DATES_PER_PAGE) rows.push({ id: 'later', title: 'Later dates' });
  return { tour, rows };
}

/** @param {Deps} deps @param {any} operator @param {State} state @returns {Promise<Turn>} */
async function showDates(deps, operator, state) {
  const { tour, rows } = await dateRows(deps, operator, state);
  if (!tour) return showTours(deps, operator);
  if (rows.length === 0)
    return { state: { ...state, step: 'choose_date' }, replies: [say.noDates()] };
  const details = [
    `*${tour.title}* · ${formatDurationShort(tour.durationMinutes)}${tour.fromPriceKobo !== null ? ` · from ${formatNaira(tour.fromPriceKobo)}` : ''}`,
    tour.summary,
  ].join('\n');
  return { state: { ...state, step: 'choose_date' }, replies: [say.dates(details, rows)] };
}

/** @param {any} tour @param {State} state @returns {Turn} */
function askCount(tour, state) {
  const cats = orderedCategories(tour.priceCategories);
  const i = state.categoryIndex ?? 0;
  return { state: { ...state, step: 'count' }, replies: [say.howMany(plural(cats[i]), i === 0)] };
}

/**
 * After a category's count (and ages): the next category, or the checks, then extras.
 * @param {Deps} deps @param {any} operator @param {any} tour @param {State} state @returns {Promise<Turn>}
 */
async function afterCount(deps, operator, tour, state) {
  const cats = orderedCategories(tour.priceCategories);
  const i = (state.categoryIndex ?? 0) + 1;
  if (i < cats.length) return askCount(tour, { ...state, categoryIndex: i });

  const counts = state.counts ?? {};
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const again = { ...state, counts: {}, ages: {}, categoryIndex: 0 };
  if (total === 0)
    return withPrefix(say.problem('Add at least one traveller.'), askCount(tour, again));
  if (total > MAX_TRAVELLERS) {
    return withPrefix(
      say.problem(`For groups over ${MAX_TRAVELLERS}, please talk to the team (type "person").`),
      askCount(tour, again),
    );
  }
  // The same rules as the website, said in the same words, BEFORE asking the rest.
  const quoted = await deps.quotes.quote({
    operatorId: operator.id,
    productId: tour._id,
    travellers: travellersFor(tour, state).map((t) =>
      t.age !== null ? { age: t.age } : { categoryKey: t.categoryKey },
    ),
  });
  if (quoted.blocker) return withPrefix(say.problem(quoted.blocker.message), askCount(tour, again));
  const departure = await deps.prisma.departure.findUnique({
    where: { id: /** @type {string} */ (state.departureId) },
  });
  const left = departure
    ? Math.max(0, departure.capacity - departure.seatsSold - departure.seatsHeld)
    : 0;
  if (total > left) {
    return withPrefix(
      say.problem(
        left === 0
          ? 'Sorry, that date has just sold out.'
          : `Sorry, only ${left} ${left === 1 ? 'seat is' : 'seats are'} left on that date.`,
      ),
      await showDates(deps, operator, { ...state, step: 'choose_date', datePage: 0 }),
    );
  }
  return afterAddOns(tour, { ...state, addOnIndex: 0, addOns: {} });
}

/** @param {any} tour @param {State} state @returns {Turn} */
function askAddOn(tour, state) {
  const a = tour.addOns[state.addOnIndex ?? 0];
  const total = Object.values(state.counts ?? {}).reduce((x, y) => x + y, 0);
  return {
    state: { ...state, step: 'add_on' },
    replies: [say.addOn(a.name, formatNaira(a.priceKobo), total)],
  };
}

/** The next extra, or pickup, or the name. @param {any} tour @param {State} state @returns {Turn} */
function afterAddOns(tour, state) {
  if ((state.addOnIndex ?? 0) < tour.addOns.length) return askAddOn(tour, state);
  if (tour.pickupPoints.length > 0)
    return { state: { ...state, step: 'pickup' }, replies: [say.pickup(pickupRows(tour))] };
  return { state: { ...state, step: 'name' }, replies: [say.name()] };
}

/** @param {any} tour */
const pickupRows = (tour) =>
  tour.pickupPoints.map((/** @type {any} */ p) => ({
    id: `pickup:${p.name}`,
    title: p.name,
    description: [p.time, p.address].filter(Boolean).join(' · '),
  }));

/**
 * The travellers for a booking: the lead (by name) is the first adult; other adults are named
 * at check-in; children and infants come with their ages (decided 2026-11-18).
 * @param {any} tour @param {State} state
 * @returns {Array<{ name: string, age: number | null, categoryKey: string }>}
 */
function travellersFor(tour, state) {
  /** @type {Array<{ name: string, age: number | null, categoryKey: string }>} */
  const out = [];
  for (const cat of orderedCategories(tour.priceCategories)) {
    const n = state.counts?.[cat.key] ?? 0;
    for (let i = 0; i < n; i++) {
      const age = isAdultCategory(cat) ? null : (state.ages?.[cat.key]?.[i] ?? null);
      out.push({ name: out.length === 0 ? (state.leadName ?? '') : '', age, categoryKey: cat.key });
    }
  }
  return out;
}

/**
 * Holds the seats and creates the booking, the website's way, then the summary.
 * @param {Deps} deps @param {any} operator @param {{ guestPhone: string }} conversation @param {State} state
 * @returns {Promise<Turn>}
 */
async function hold(deps, operator, conversation, state) {
  const tour = await tourOf(deps, operator, state);
  if (!tour || !state.departureId) return restartFromTours(deps, operator);
  await releaseHeld(deps, state); // one guest, one hold (like the website, stage 12d)
  let created;
  try {
    created = await bookForGuest(deps, {
      operator,
      departureId: state.departureId,
      channel: 'whatsapp',
      holdMinutes: WHATSAPP_HOLD_MINUTES,
      lead: {
        name: /** @type {string} */ (state.leadName),
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
    if (err instanceof HttpError) {
      return withPrefix(
        say.problem(err.message),
        await showDates(deps, operator, {
          step: 'choose_date',
          tourSlug: state.tourSlug,
          datePage: 0,
        }),
      );
    }
    throw err;
  }
  const booking = await deps.prisma.booking.findUniqueOrThrow({
    where: { id: created.bookingId },
    include: { departure: true, travellers: true },
  });
  return {
    state: { ...state, step: 'summary', bookingId: booking.id },
    bookingId: booking.id,
    replies: [summary(deps, operator, tour, state, booking)],
  };
}

/** @param {Deps} deps @param {any} operator @param {any} tour @param {State} state @param {any} booking */
function summary(deps, operator, tour, state, booking) {
  const tz = operator.timeZone;
  const day = formatLocalDay(localDate(booking.departure.startsAt, tz));
  const time = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: tz,
  }).format(booking.departure.startsAt);
  const who = orderedCategories(tour.priceCategories)
    .map((c) => ({ c, n: state.counts?.[c.key] ?? 0 }))
    .filter((x) => x.n > 0)
    .map(
      (x) =>
        `${x.n} ${x.n === 1 ? plainName(x.c).toLowerCase() : plural(x.c).replace(/\s*\(.*\)$/, '')}`,
    )
    .join(', ');
  const extras = tour.addOns
    .filter((/** @type {any} */ a) => state.addOns?.[a.id])
    .map((/** @type {any} */ a) => `+ ${state.addOns?.[a.id]} × ${a.name}`);
  const free = tour.cancellationPolicy
    ? freeCancellationUntil(tour.cancellationPolicy, booking.departure.startsAt, tz)
    : null;
  const lines = [
    `*${tour.title}* · ${day} · ${time}`,
    `${who} · ${formatNaira(booking.totalKobo)}${operator.pricing?.tax?.inclusive ? ' (includes VAT)' : ''}`,
    ...extras,
    ...(state.pickup ? [`Pickup: ${state.pickup}`] : []),
    ...(free ? [`Free cancellation until ${free}.`] : []),
    `I'm holding your seats for ${WHATSAPP_HOLD_MINUTES} minutes.`,
  ];
  const termsUrl = `${deps.webPublicUrl.replace(/\/+$/, '')}/${operator.slug}/${tour.slug}`;
  return say.summary(lines, `Pay ${formatNaira(booking.totalKobo)}`, termsUrl);
}

/**
 * "Pay": what can the guest pay right now (the website's own rule, payment-options.js)?
 *   nothing (the hold ran out)       → "the 30 minutes are up"
 *   full or a deposit, not chosen    → ask which (pay_choice)
 *   otherwise                        → a payment link for that amount, and how long the seats
 *                                      stay held. The guest pays on the website's /pay page
 *                                      (Paystack); the ticket comes back here (tickets.js).
 * @param {Deps} deps @param {any} operator @param {State} state
 * @param {'full' | 'deposit' | null} chosen
 * @returns {Promise<Turn>}
 */
async function pay(deps, operator, state, chosen) {
  const now = (deps.now ?? (() => new Date()))();
  const booking = state.bookingId
    ? await deps.prisma.booking.findUnique({
        where: { id: state.bookingId },
        include: { product: { include: { operator: true } }, departure: true, hold: true },
      })
    : null;
  const options = booking ? paymentOptions(booking, now) : [];
  // A held booking always offers "full" while its hold is on; none means time ran out.
  const full = options.find((o) => o.type === 'full');
  if (!booking || !full) {
    return { state: { step: 'hello' }, replies: [say.holdOver()], bookingId: null };
  }
  const deposit = options.find((o) => o.type === 'deposit');
  if (!chosen && deposit && deposit.type === 'deposit') {
    return {
      state: { ...state, step: 'pay_choice' },
      replies: [
        say.payChoice(
          formatNaira(full.amountKobo),
          formatNaira(deposit.amountKobo),
          formatLocalDay(deposit.balanceDueDate),
        ),
      ],
    };
  }
  const option = (chosen === 'deposit' && deposit) || full;

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
    // The hold ran out between the check and the link (a race of seconds).
    if (err instanceof BookingError) {
      return { state: { step: 'hello' }, replies: [say.holdOver()], bookingId: null };
    }
    throw err;
  }
  const until = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: operator.timeZone,
  }).format(booking.hold.expiresAt);
  const url = `${deps.webPublicUrl.replace(/\/+$/, '')}/pay/${token}`;
  return {
    state: { ...state, step: 'summary' },
    replies: [say.payLink(formatNaira(option.amountKobo), url, until)],
  };
}

/**
 * Gives back the seats of a booking this chat is holding (the guest went back, or left).
 * `unlessLinkSent`: keep them if the guest already has a payment link for this booking.
 * @param {Deps} deps @param {State} state @param {{ unlessLinkSent?: boolean }} [opts]
 */
async function releaseHeld(deps, state, { unlessLinkSent = false } = {}) {
  if (!state.bookingId) return;
  const booking = await deps.prisma.booking.findUnique({
    where: { id: state.bookingId },
    include: { _count: { select: { paymentLinks: true } } },
  });
  if (unlessLinkSent && (booking?._count.paymentLinks ?? 0) > 0) return;
  if (booking?.status === 'held') {
    await releaseHold(deps.prisma, booking.holdId, {
      reason: 'released',
      actor: { type: 'guest' },
    });
  }
}

/** Puts a message before a step's replies ("Sorry…" then the question again). @param {any} first @param {Turn} turn */
const withPrefix = (first, turn) => ({ ...turn, replies: [first, ...turn.replies] });
