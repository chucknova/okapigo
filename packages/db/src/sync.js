// @ts-check
/**
 * sync.js — the operator app with no signal (OPS-09, stage 15b; flow brief 07, section 4).
 * PRD: "72 hours of offline actions sync with zero data loss".
 *
 *   offlinePackage()   what a guide's phone saves: today's and tomorrow's departures they're
 *                      on, each with its whole manifest, and a fingerprint of every ticket
 *   applyChanges()     the phone's outbox, sent when signal returns: each change applied in
 *                      order, ONCE (sending it again gets the same answer), or, when it can't
 *                      be applied any more, kept as a conflict, in plain words
 *   listConflicts() / dismissConflict()   screen O5: what's waiting to be looked at; "OK"
 *
 * How a change stays "once" when the phone sends it twice (it lost signal before the answer
 * arrived): every change carries the phone's own id for it. The answer is stored under that
 * id; a second send finds it and gets the stored answer back. And the changes themselves are
 * safe to repeat (checking someone in twice is a no-op), so even two sends racing each other
 * can't change anything twice: whichever answer is stored first is the one both get.
 *
 * Who wins a conflict: nobody guesses (brief: "the server's version stands until staff
 * choose"). A conflict changes nothing, and waits, with its reason, until someone dismisses it.
 */
import { createHash } from 'node:crypto';
import { addDays, localDate, localTime, zonedTimeToUtc } from '@okapigo/shared/time';
import { formatAt } from '@okapigo/shared/tour-facts';
import { formatNaira } from '@okapigo/shared/money';
import { BookingError } from './booking-lifecycle.js';
import { ticketCode, bookingIdFromTicketCode } from './guest-links.js';
import { manifest, checkIn, noShow, nameTraveller } from './operations.js';

/** At most this many changes per request; a phone with more sends them in turns. */
export const MAX_CHANGES_PER_SYNC = 500;

/**
 * Can't be applied any more because the world changed while the phone was offline: kept
 * as a CONFLICT, to look at. Every other refusal (a forged ticket, a traveller who doesn't
 * exist) means the change was never valid: REJECTED.
 */
const CONFLICT_CODES = new Set([
  'BOOKING_CANCELLED', //  cancelled meanwhile
  'NO_SHOW_MARKED', //     someone marked it a no-show first
  'OTHER_DEPARTURE', //    moved to another departure
  'BALANCE_OWED', //       owes money the phone didn't know about
  'NOT_BOOKED', //         no longer a confirmed booking
  'CHANGED_FIRST', //      someone else changed this traveller first
  'CHECKED_IN', //         a no-show, but someone checked them in
  'NOT_ASSIGNED', //       this guide was taken off the departure
  'NOT_STARTED', //        a no-show before the start (the phone's clock?)
  'INVALID_TRANSITION', // the booking's state moved on some other way
]);

/**
 * The fingerprint of a ticket code, as the phone stores it: SHA-256 of the code's text, in
 * hex. A scanned QR is fingerprinted the same way (crypto.subtle.digest in the browser) and
 * looked up in the saved manifests. The phone never holds the codes themselves, so a lost
 * phone gives nobody tickets, and it can't make a code (that needs the server's secret).
 * @param {string} code
 */
export const ticketFingerprint = (code) => createHash('sha256').update(code, 'utf8').digest('hex');

// --- The offline package -----------------------------------------------------------------------

/**
 * Everything a guide's phone saves to work with no signal (brief section 4): today's and
 * tomorrow's departures (in the business's time zone) this person is the guide on, each
 * with its whole manifest (screen O3), every booking with its ticket's fingerprint.
 *
 * No "generated at" inside, on purpose: the same data gives the same response, so the phone
 * refreshing every few minutes gets "304 Not Modified" (an ETag) unless something changed.
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ operatorId: string, userId: string, secret: string, now?: Date }} q
 */
export async function offlinePackage(prisma, { operatorId, userId, secret, now = new Date() }) {
  const operator = await prisma.operator.findUniqueOrThrow({ where: { id: operatorId } });
  const tz = operator.timeZone;
  const today = localDate(now, tz);
  const departures = await prisma.departure.findMany({
    where: {
      operatorId,
      guideId: userId,
      startsAt: {
        gte: zonedTimeToUtc(today, '00:00', tz),
        lt: zonedTimeToUtc(addDays(today, 2), '00:00', tz),
      },
    },
    orderBy: { startsAt: 'asc' },
    select: { id: true },
  });
  const manifests = [];
  for (const { id } of departures) {
    const m = await manifest(prisma, { operatorId, departureId: id });
    manifests.push({
      ...m,
      bookings: m.bookings.map((b) => ({
        ...b,
        ticketFingerprint: ticketFingerprint(ticketCode(secret, b.id)),
      })),
    });
  }
  return {
    // "Call the office" (O4, O5): the business's phone, if it has one.
    operator: { name: operator.name, timeZone: tz, phone: operator.phone },
    days: [today, addDays(today, 1)],
    departures: manifests,
  };
}

// --- The outbox --------------------------------------------------------------------------------

/**
 * @typedef {{ id: string, at: string, departureId: string } & (
 *   | { kind: 'check_in', code?: string, bookingId?: string, travellerIds?: string[],
 *       status: 'present' | 'late' | 'pending', confirmOwed?: boolean, seen?: Record<string, string> }
 *   | { kind: 'no_show', bookingId: string }
 *   | { kind: 'name', travellerId: string, name: string, seen?: string }
 * )} Change
 *
 * @typedef {{
 *   title: string, youDid: string, theyLabel: string, theyHad: string, soNow: string,
 *   canUseMine: boolean,
 * }} Explanation  a conflict as screen O5 shows it (YOU DID / THE OFFICE HAD / SO NOW)
 *
 * @typedef {{
 *   id: string, outcome: 'applied' | 'conflict' | 'rejected', code: string | null,
 *   message: string | null, explanation: Explanation | null, repeated: boolean, data: unknown,
 * }} ChangeResult
 */

/**
 * Applies a phone's outbox, oldest first, one change at a time: each is applied, or kept as
 * a conflict, or rejected; a conflict doesn't stop the ones after it (they're about other
 * guests, usually). The phone removes each change from its outbox once it has an answer.
 *
 * Each change happened at `at` (the phone's clock): a check-in made at 09:05 offline says
 * 09:05, not the time signal came back. Never later than now (a phone's clock running fast).
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{
 *   operatorId: string, userId: string, secret: string,
 *   anyDeparture: boolean,   // may act on any departure (bookings: edit), not only their own
 *   changes: Change[], now?: Date,
 * }} input
 * @returns {Promise<ChangeResult[]>}
 */
export async function applyChanges(prisma, { changes, now = new Date(), ...who }) {
  /** @type {ChangeResult[]} */
  const results = [];
  for (const change of changes) results.push(await applyOne(prisma, who, change, now));
  return results;
}

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ operatorId: string, userId: string, secret: string, anyDeparture: boolean }} who
 * @param {Change} change
 * @param {Date} now
 * @returns {Promise<ChangeResult>}
 */
async function applyOne(prisma, who, change, now) {
  const key = { userId_clientId: { userId: who.userId, clientId: change.id } };
  const before = await prisma.syncChange.findUnique({ where: key });
  if (before) return resultOf(before, true); // sent before: the same answer, nothing redone

  const at = new Date(Math.min(new Date(change.at).getTime(), now.getTime()));
  /** @type {'applied' | 'conflict' | 'rejected'} */
  let outcome = 'applied';
  /** @type {string | null} */
  let code = null;
  /** @type {string | null} */
  let message = null;
  /** @type {any} */
  let explanation;
  /** @type {any} */
  let data;
  try {
    data = await perform(prisma, who, change, at);
  } catch (err) {
    if (!(err instanceof BookingError)) throw err; // our bug or the database: the phone retries
    outcome = CONFLICT_CODES.has(err.code) ? 'conflict' : 'rejected';
    code = err.code;
    if (outcome === 'conflict') {
      ({ message, explanation } = await explain(prisma, who, change, at, now, err));
    } else {
      message = err.message;
    }
    data = err.details ?? null;
  }

  const { id: _id, at: _at, kind, departureId, ...payload } = change;
  // skipDuplicates: if the same change, sent twice at once, got here first in another
  // request, its answer is kept and returned (both requests did the same, harmless, thing).
  const inserted = await prisma.syncChange.createManyAndReturn({
    data: [
      {
        operatorId: who.operatorId,
        userId: who.userId,
        clientId: change.id,
        kind,
        departureId,
        payload: /** @type {any} */ (payload),
        happenedAt: at,
        receivedAt: now,
        outcome,
        code,
        message,
        explanation,
        data: data ?? undefined,
      },
    ],
    skipDuplicates: true,
  });
  if (inserted[0]) return resultOf(inserted[0], false);
  return resultOf(await prisma.syncChange.findUniqueOrThrow({ where: key }), true);
}

/**
 * One change, through the same functions the screens use online (15a), so the rules are the
 * same with and without signal.
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ operatorId: string, userId: string, secret: string, anyDeparture: boolean }} who
 * @param {Change} change
 * @param {Date} at
 */
async function perform(prisma, { operatorId, userId, secret, anyDeparture }, change, at) {
  const departure = await prisma.departure.findFirst({
    where: { id: change.departureId, operatorId },
  });
  if (!departure) throw new BookingError('NOT_FOUND', 'Departure not found.');
  if (!anyDeparture && departure.guideId !== userId) {
    throw new BookingError('NOT_ASSIGNED', 'You’re no longer the guide on this departure.');
  }
  const departureId = departure.id;

  if (change.kind === 'check_in') {
    const r = await checkIn(prisma, {
      operatorId,
      departureId,
      secret,
      code: change.code,
      bookingId: change.bookingId,
      travellerIds: change.travellerIds,
      status: change.status,
      confirmOwed: change.confirmOwed,
      seen: change.seen,
      userId,
      now: at,
    });
    return { bookingId: r.booking.id, already: r.already };
  }
  if (change.kind === 'no_show') {
    return noShow(prisma, {
      operatorId,
      departureId,
      bookingId: change.bookingId,
      userId,
      now: at,
    });
  }
  const t = await prisma.traveller.findFirst({
    where: { id: change.travellerId, operatorId, booking: { departureId } },
  });
  if (!t) throw new BookingError('NOT_FOUND', 'That traveller isn’t on this departure.');
  const named = await nameTraveller(prisma, {
    operatorId,
    travellerId: t.id,
    name: change.name,
    seen: change.seen,
  });
  return { travellerId: named.id, name: named.name };
}

/** @param {any} row @param {boolean} repeated @returns {ChangeResult} */
const resultOf = (row, repeated) => ({
  id: row.clientId,
  outcome: row.outcome,
  code: row.code,
  message: row.message,
  explanation: row.explanation ?? null,
  repeated,
  data: row.data,
});

// --- Conflicts, in plain words (screen O5) -------------------------------------------------------

/**
 * "You marked Tunde Bakare present at 09:05, but the booking was cancelled at 08:30.
 *  Nothing changed." What this phone did, what the server had, and what happens now.
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ operatorId: string, userId: string, secret: string }} who
 * @param {Change} change
 * @param {Date} at
 * @param {Date} now
 * @param {BookingError} err
 */
async function explain(prisma, { operatorId, userId, secret }, change, at, now, err) {
  const operator = await prisma.operator.findUniqueOrThrow({ where: { id: operatorId } });
  const tz = operator.timeZone;
  /** A time: "09:05" on the same day as `ref`, else "Sat 5 Dec, 09:05". @param {Date} d @param {Date} ref */
  const stamp = (d, ref) =>
    localDate(d, tz) === localDate(ref, tz) ? localTime(d, tz) : formatAt(d.getTime(), tz);
  const atText = stamp(at, now);

  const bookingId =
    change.kind === 'check_in'
      ? change.code
        ? bookingIdFromTicketCode(secret, change.code)
        : change.bookingId
      : change.kind === 'no_show'
        ? change.bookingId
        : ((await prisma.traveller.findFirst({ where: { id: change.travellerId, operatorId } }))
            ?.bookingId ?? null);
  const b = bookingId
    ? await prisma.booking.findFirst({
        where: { id: bookingId, operatorId },
        include: {
          travellers: { orderBy: { position: 'asc' } },
          events: {
            where: { toStatus: { in: ['cancelled', 'no_show'] } },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      })
    : null;
  const lead = b?.leadName ?? 'the guest';
  /** @param {any} t */
  const nameOf = (t) => t?.name || (t ? `Guest ${t.position} of ${lead}’s booking` : 'a guest');
  const details = /** @type {any} */ (err.details ?? {});
  const traveller = b?.travellers.find((t) => t.id === details.travellerId);
  const by = details.byId
    ? details.byId === userId
      ? 'you'
      : ((await prisma.user.findFirst({ where: { id: details.byId, operatorId } }))?.name ??
        'someone else')
    : 'someone else';
  const when = details.at ? ` at ${stamp(new Date(details.at), at)}` : '';

  // What this phone did.
  let did;
  let title;
  if (change.kind === 'check_in') {
    const chosen = change.travellerIds?.length
      ? (b?.travellers ?? []).filter((t) => change.travellerIds?.includes(t.id))
      : (b?.travellers ?? []);
    const whom =
      chosen.length === 1
        ? nameOf(chosen[0])
        : chosen.length === b?.travellers.length
          ? `${lead}’s booking (${chosen.length} guests)`
          : `${chosen.length} guests on ${lead}’s booking`;
    did =
      change.status === 'pending'
        ? `undid the check-in for ${whom}`
        : `marked ${whom} ${change.status}`;
    title =
      change.status === 'pending'
        ? `The check-in for ${whom} wasn’t undone`
        : `${capital(whom)} ${chosen.length > 1 ? 'weren’t' : 'wasn’t'} ${change.status === 'late' ? 'marked late' : 'checked in'}`;
  } else if (change.kind === 'no_show') {
    did = `marked ${lead}’s booking a no-show`;
    title = `${lead}’s booking wasn’t marked a no-show`;
  } else {
    // As the phone knew them: unnamed, if it saw no name.
    const t = b?.travellers.find((x) => x.id === change.travellerId);
    const known = change.seen !== undefined ? nameOf(t && { ...t, name: change.seen }) : nameOf(t);
    did = `named ${known} “${change.name.trim()}”`;
    title = `The name “${change.name.trim()}” wasn’t saved`;
  }

  // What the server had: in the sentence (`why`), and as O5's "THE OFFICE HAD" (`had`).
  const ended = b?.events[0] ? ` at ${stamp(b.events[0].createdAt, at)}` : '';
  /** @type {Record<string, string>} */
  const otherDid = {
    present: `checked ${nameOf(traveller)} in`,
    late: `marked ${nameOf(traveller)} late`,
    no_show: `marked ${nameOf(traveller)} a no-show`,
    pending: `undone the check-in for ${nameOf(traveller)}`,
  };
  const moved = details.startsAt
    ? formatAt(new Date(details.startsAt).getTime(), tz)
    : 'another departure';
  const owed = formatNaira(details.owedKobo ?? 0);
  const theirs = otherDid[details.status] ?? 'changed them';
  const office = 'The office had';
  const byLabel =
    by === 'you'
      ? 'You had (on another phone)'
      : `${by === 'someone else' ? 'Someone else' : by} had`;
  /** @type {Record<string, { why: string, label: string, had: string, now: string }>} */
  const parts = {
    BOOKING_CANCELLED: {
      why: `the booking was cancelled${ended}`,
      label: office,
      had: `Cancelled the booking${ended}.`,
      now: 'Nothing changed. The booking stays cancelled. If they’re with you, call the office.',
    },
    NO_SHOW_MARKED: {
      why: `the booking was marked a no-show${ended}`,
      label: office,
      had: `Marked the booking a no-show${ended}.`,
      now: 'Nothing changed. It stays a no-show; the office can change it.',
    },
    OTHER_DEPARTURE: {
      why: `the booking was moved to ${moved}`,
      label: office,
      had: `Moved the booking to ${moved}.`,
      now: 'Nothing changed. They’re booked on another trip: call the office.',
    },
    BALANCE_OWED: {
      why: `they now owe ${owed}`,
      label: office,
      had: `${owed} still to pay on this booking.`,
      now: `Nothing changed. Check them in again to confirm they still owe ${owed}.`,
    },
    NOT_BOOKED: {
      why: 'the booking isn’t confirmed any more',
      label: office,
      had: 'A booking that isn’t confirmed any more.',
      now: 'Nothing changed. Call the office.',
    },
    CHANGED_FIRST:
      change.kind === 'name'
        ? {
            why: `someone else had already named them “${details.name}”`,
            label: 'Someone else had',
            had: `Named them “${details.name}”.`,
            now: `Theirs stands: “${details.name}”.`,
          }
        : {
            why: `${by} had already ${theirs}${when}`,
            label: byLabel,
            had: `${capital(theirs)}${when}.`,
            now: 'Theirs stands. Use mine sends yours again, after theirs.',
          },
    CHECKED_IN: {
      why: `${by} had checked ${nameOf(traveller)} in${when}`,
      label: byLabel,
      had: `Checked ${nameOf(traveller)} in${when}.`,
      now: 'Nothing changed: they stay checked in.',
    },
    NOT_ASSIGNED: {
      why: 'you’re no longer the guide on this departure',
      label: office,
      had: 'Taken you off this departure.',
      now: 'Nothing changed. Ask the office who’s guiding it now.',
    },
    NOT_STARTED: {
      why: 'the tour hadn’t started yet (is this phone’s clock right?)',
      label: 'The tour',
      had: 'Hadn’t started yet. Is this phone’s clock right?',
      now: 'Nothing changed. Mark it again once the tour has started.',
    },
    INVALID_TRANSITION: {
      why: `the booking had changed (it’s now ${b?.status.replace('_', ' ') ?? 'gone'})`,
      label: office,
      had: `Changed the booking (it’s now ${b?.status.replace('_', ' ') ?? 'gone'}).`,
      now: 'Nothing changed. Call the office.',
    },
  };
  const p = parts[err.code] ?? {
    why: err.message,
    label: office,
    had: err.message,
    now: 'Nothing changed.',
  };
  // The one-sentence form ends with what happens now: nothing, or theirs stands.
  const after =
    err.code === 'CHANGED_FIRST' || err.code === 'CHECKED_IN'
      ? 'Theirs stands.'
      : 'Nothing changed.';
  // "(offline)": done more than a minute before it reached us.
  const offline = now.getTime() - at.getTime() > 60_000 ? ' (offline)' : '';
  return {
    message: `You ${did} at ${atText}, but ${p.why}. ${after}`,
    explanation: {
      title,
      youDid: `${capital(did)} at ${atText}${offline}.`,
      theyLabel: p.label,
      theyHad: p.had,
      soNow: p.now,
      // "Use mine": only when someone else's check-in state won (send mine again, after theirs).
      canUseMine: err.code === 'CHANGED_FIRST' && change.kind === 'check_in',
    },
  };
}

/** "marked …" → "Marked …" @param {string} s */
const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Conflicts nobody has looked at yet (screen O5): a guide's own; staff who can edit bookings
 * see everyone's (the manager decides, brief section 4).
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ operatorId: string, userId: string, everyone: boolean }} q
 */
export async function listConflicts(prisma, { operatorId, userId, everyone }) {
  const rows = await prisma.syncChange.findMany({
    where: {
      operatorId,
      outcome: 'conflict',
      dismissedAt: null,
      ...(everyone ? {} : { userId }),
    },
    orderBy: { happenedAt: 'asc' },
    include: { user: true },
  });
  return rows.map((r) => ({
    id: r.id,
    changeId: r.clientId,
    kind: r.kind,
    departureId: r.departureId,
    code: r.code,
    message: r.message,
    explanation: r.explanation,
    // What the phone sent, so "Use mine" can send it again (with what the server has now).
    payload: r.payload,
    data: r.data,
    happenedAt: r.happenedAt,
    receivedAt: r.receivedAt,
    by: { id: r.user.id, name: r.user.name },
  }));
}

/**
 * "OK" on a conflict: someone has seen it. Nothing else changes (the server's version
 * already stands; "Undo mine" on the phone is just a new change in the outbox).
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ operatorId: string, userId: string, everyone: boolean, id: string, now?: Date }} q
 */
export async function dismissConflict(
  prisma,
  { operatorId, userId, everyone, id, now = new Date() },
) {
  const { count } = await prisma.syncChange.updateMany({
    where: {
      id,
      operatorId,
      outcome: 'conflict',
      dismissedAt: null,
      ...(everyone ? {} : { userId }),
    },
    data: { dismissedAt: now, dismissedById: userId },
  });
  if (count === 0) throw new BookingError('NOT_FOUND', 'That conflict wasn’t found.');
}
