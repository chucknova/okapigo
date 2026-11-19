// @ts-check
/**
 * scan.js — what a scanned ticket means, worked out on the phone (O4; flow brief 07,
 * section 4: "the QR holds a signed code; the phone matches it to its saved manifest").
 *
 * The phone never holds ticket codes, only their FINGERPRINTS (SHA-256, 15b). A scan is
 * fingerprinted here and looked up in the saved package, so scanning works with no signal:
 *
 *   ok           on this departure, someone still to check in   → "Ticket OK", tick who's here
 *   already      everyone on it is already in                   → "Already checked in at 06:52"
 *   other-trip   on another saved departure                     → "Not this trip", which one
 *   cancelled    cancelled (or refunded)                        → "Cancelled: don’t check in"
 *   no-show      the booking was marked a no-show               → ask the office
 *   not-booked   not confirmed (still in checkout)              → ask the office
 *   unknown-trip an OkapiGo ticket, but not on a trip saved here → another day, or guide
 *   not-ours     not an OkapiGo ticket at all, or unreadable    → search instead
 *
 * Then the check-in itself is one change in the outbox (15c-1), like a tap on the manifest.
 */
import { localDate, localTime } from '@okapigo/shared/time';
import { formatNaira } from '@okapigo/shared/money';
import { formatAt } from '@okapigo/shared/tour-facts';
import { balanceDueDate } from '@okapigo/shared/deposits';
import { CAN_CHECK_IN } from './outbox.js';

/** The shape of an OkapiGo ticket code (packages/db guest-links.js): readable without the secret. */
export const TICKET_PATTERN = /^OKG1[A-Za-z0-9_-]{38}$/;

/**
 * A ticket code's fingerprint, as the package stores it: SHA-256 of its text, in hex.
 * (The browser's own crypto: works offline, and only on https or localhost.)
 * @param {string} code
 */
export async function fingerprint(code) {
  const bytes = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code)),
  );
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The departure the scanner is for, when opened from the Scan tab: the one under way today,
 * else today's next, else today's last, else tomorrow's first.
 * @param {any} pkg @param {Date} now
 */
export function currentDeparture(pkg, now) {
  const tz = pkg?.operator?.timeZone ?? 'Africa/Lagos';
  const today = localDate(now, tz);
  const all = /** @type {any[]} */ (pkg?.departures ?? []);
  const t = now.getTime();
  const todays = all.filter((m) => m.departure.localDate === today);
  return (
    todays.find(
      (m) => Date.parse(m.departure.startsAt) <= t && t < Date.parse(m.departure.endsAt),
    ) ??
    todays.find((m) => Date.parse(m.departure.startsAt) > t) ??
    todays.at(-1) ??
    all.find((m) => m.departure.localDate > today) ??
    null
  );
}

/**
 * What a scanned code means (see the top of this file).
 * @param {{ code: string, fp: string, pkg: any, departureId: string }} s
 */
export function classify({ code, fp, pkg, departureId }) {
  for (const m of pkg?.departures ?? []) {
    const b = m.bookings.find((/** @type {any} */ x) => x.ticketFingerprint === fp);
    if (!b) continue;
    if (m.departure.id !== departureId) return { kind: /** @type {const} */ ('other-trip'), m, b };
    if (b.status === 'cancelled' || b.status === 'refunded')
      return { kind: /** @type {const} */ ('cancelled'), m, b };
    if (b.status === 'no_show') return { kind: /** @type {const} */ ('no-show'), m, b };
    if (!CAN_CHECK_IN.includes(b.status))
      return { kind: /** @type {const} */ ('not-booked'), m, b };
    const waiting = b.travellers.filter((/** @type {any} */ t) => t.checkInStatus === 'pending');
    if (waiting.length === 0) return { kind: /** @type {const} */ ('already'), m, b };
    return { kind: /** @type {const} */ ('ok'), m, b };
  }
  return {
    kind: TICKET_PATTERN.test(code.trim())
      ? /** @type {const} */ ('unknown-trip')
      : /** @type {const} */ ('not-ours'),
  };
}

/**
 * The words for a ticket that can't be checked in (designs: O4 Scan — problem states).
 * @param {ReturnType<typeof classify>} r
 * @param {{ current: any, business: string, now: Date, tz: string }} o
 * @returns {{ tone: 'warning' | 'danger' | 'neutral', icon: string, title: string, sub: string, body: string, call: boolean, search: boolean }}
 */
export function problemOf(r, { current, business, now, tz }) {
  const short = (/** @type {any} */ m) => m.tour.shortTitle || m.tour.title;
  if (r.kind === 'other-trip') {
    const where = r.m.tour.meetingPoint?.name ? `, at ${r.m.tour.meetingPoint.name}` : '';
    return {
      tone: 'warning',
      icon: '!',
      title: 'Not this trip',
      sub: `${r.b.reference} · ${r.m.tour.title}`,
      body: `This ticket is for the ${short(r.m)}, ${formatAt(Date.parse(r.m.departure.startsAt), tz)}${where}. It isn’t on your ${short(current)} trip.`,
      call: false,
      search: false,
    };
  }
  if (r.kind === 'cancelled') {
    const on = r.b.endedAt ? ` on ${formatAt(Date.parse(r.b.endedAt), tz).split(',')[0]}` : '';
    return {
      tone: 'danger',
      icon: '✕',
      title: 'Cancelled: don’t check in',
      sub: `${r.b.reference} · ${r.b.lead.name}`,
      body: `This booking was cancelled${on}${r.b.status === 'refunded' ? ' and refunded' : ''}. If the guest says otherwise, ask them to call the office.`,
      call: true,
      search: false,
    };
  }
  if (r.kind === 'no-show') {
    return {
      tone: 'danger',
      icon: '✕',
      title: 'Marked a no-show',
      sub: `${r.b.reference} · ${r.b.lead.name}`,
      body: 'This booking was marked a no-show. If they’re here after all, ask the office to change it.',
      call: true,
      search: false,
    };
  }
  if (r.kind === 'not-booked') {
    return {
      tone: 'warning',
      icon: '!',
      title: 'Not confirmed',
      sub: `${r.b.reference} · ${r.b.lead.name}`,
      body: 'This booking isn’t confirmed (it may still be in checkout). Ask the office.',
      call: true,
      search: false,
    };
  }
  if (r.kind === 'already') {
    const inAt = r.b.travellers
      .map((/** @type {any} */ t) => t.checkedInAt)
      .filter(Boolean)
      .sort()[0];
    const names = r.b.travellers
      .filter((/** @type {any} */ t) => t.checkInStatus === 'present' || t.checkInStatus === 'late')
      .map((/** @type {any} */ t) => t.displayName);
    const time = inAt
      ? localDate(new Date(inAt), tz) === localDate(now, tz)
        ? localTime(new Date(inAt), tz)
        : formatAt(Date.parse(inAt), tz)
      : null;
    return {
      tone: 'neutral',
      icon: '✓',
      title: 'Already checked in',
      sub: `${r.b.reference} · ${r.b.lead.name}`,
      body: `${time ? `Checked in at ${time}` : 'Checked in'}${names.length ? `: ${names.join(', ')}` : ''}. Nothing changed.`,
      call: false,
      search: false,
    };
  }
  if (r.kind === 'unknown-trip') {
    return {
      tone: 'neutral',
      icon: '?',
      title: 'Not on your saved trips',
      sub: `A ${business} ticket, for another trip or day`,
      body: 'It isn’t on the trips saved on this phone: it may be for another day, or another guide’s tour. Ask for the booking reference, or call the office.',
      call: true,
      search: true,
    };
  }
  return {
    tone: 'neutral',
    icon: '?',
    title: `Not ${/^[AEIOUÀ-ÖØ-Ý]/i.test(business.normalize('NFD')) ? 'an' : 'a'} ${business} ticket`,
    sub: 'The code isn’t one this app can read',
    body: 'It may be another company’s ticket, a screenshot that’s too small, or a cracked screen. Ask for the booking reference or the lead’s name.',
    call: false,
    search: true,
  };
}

/**
 * The "Ticket OK" sheet (O4 Good scan; Search and check-in, Partial check-in): who's on the
 * booking, ticked if still to come, and what's owed.
 * @param {any} m @param {any} b @param {{ now: Date, tz: string }} o
 */
export function goodScan(m, b, { now, tz }) {
  const owedKobo = b.money.owedKobo;
  const paid = b.money.paidKobo ?? 0;
  const due = balanceDueDate(m.departure.localDate);
  const dueText = formatAt(Date.parse(`${due}T12:00:00Z`), 'UTC').split(',')[0];
  const lead = b.lead.name;
  return {
    ref: b.reference,
    lead,
    pay: owedKobo > 0 ? { text: b.money.label, tone: 'owes' } : { text: 'Paid', tone: 'paid' },
    owes:
      owedKobo > 0
        ? {
            title: `They still owe ${formatNaira(owedKobo)}`,
            detail: [
              paid > 0 ? `Deposit of ${formatNaira(paid)} paid.` : 'Nothing paid yet.',
              `Balance ${localDate(now, tz) > due ? 'was due' : 'due'} ${dueText}.`,
            ].join(' '),
          }
        : null,
    // Someone on the booking already in: the money question was answered then.
    owesAsked: b.travellers.some(
      (/** @type {any} */ t) => t.checkInStatus === 'present' || t.checkInStatus === 'late',
    ),
    people: b.travellers.map((/** @type {any} */ t) => ({
      id: t.id,
      name: t.displayName,
      meta: [t.category?.name ?? 'Guest', t.age ?? null].filter((x) => x !== null).join(' · '),
      diet: t.dietaryNeeds || null,
      waiting: t.checkInStatus === 'pending',
      note:
        t.checkInStatus === 'present'
          ? `in at ${t.checkedInAt ? localTime(new Date(t.checkedInAt), tz) : '—'}`
          : t.checkInStatus === 'late'
            ? `late ${t.checkedInAt ? localTime(new Date(t.checkedInAt), tz) : ''}`.trim()
            : t.checkInStatus === 'no_show'
              ? 'marked not here'
              : null,
    })),
    extras: (b.addOns ?? [])
      .map((/** @type {any} */ a) => `${a.quantity} × ${a.name.toLowerCase()}`)
      .join(' · '),
    started: now.getTime() >= Date.parse(m.departure.startsAt),
    lateAt: localTime(now, tz),
  };
}

/**
 * Checking in the ticked travellers: one change. `seen`: they were "Not yet" on this phone.
 * @param {any} m @param {any} b @param {string[]} ids @param {'present' | 'late'} status
 * @param {{ confirmOwed?: boolean }} [o]
 */
export function scanCheckIn(m, b, ids, status, { confirmOwed = false } = {}) {
  return {
    kind: /** @type {const} */ ('check_in'),
    departureId: m.departure.id,
    bookingId: b.id,
    travellerIds: ids,
    status,
    seen: Object.fromEntries(ids.map((id) => [id, 'pending'])),
    ...(confirmOwed ? { confirmOwed: true } : {}),
  };
}

/**
 * Undo (on the scanner, until the next scan): the same travellers back to "Not yet".
 * @param {any} change  the check-in being undone
 */
export function undoOf(change) {
  return {
    kind: /** @type {const} */ ('check_in'),
    departureId: change.departureId,
    bookingId: change.bookingId,
    travellerIds: change.travellerIds,
    status: /** @type {const} */ ('pending'),
    seen: Object.fromEntries(
      change.travellerIds.map((/** @type {string} */ id) => [id, change.status]),
    ),
  };
}

/**
 * The note on the scanner after a check-in: "2 checked in · Okafor · Kamsi not yet".
 * @param {any} b @param {string[]} ids @param {'present' | 'late'} status
 */
export function afterNote(b, ids, status) {
  const surname = b.lead.name.trim().split(/\s+/).at(-1);
  const left = b.travellers.filter(
    (/** @type {any} */ t) => t.checkInStatus === 'pending' && !ids.includes(t.id),
  );
  return [
    `${ids.length} ${status === 'late' ? 'marked late' : 'checked in'}`,
    surname,
    left.length
      ? `${left.map((/** @type {any} */ t) => t.displayName.split(/\s+/)[0]).join(', ')} not yet`
      : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

// --- Search by name (instead of scanning) ----------------------------------------------------

/** One character, folded for search: "Ì" → "i". @param {string} c */
const foldChar = (c) => c.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/**
 * Where `query` appears in `text`, ignoring accents and case: [start, end) in `text`, or null.
 * @param {string} text @param {string} query
 */
export function findIn(text, query) {
  const q = [...query.trim()].map(foldChar).join('');
  if (!q) return null;
  // Fold character by character, remembering where each folded letter came from.
  let folded = '';
  /** @type {number[]} */
  const from = [];
  [...text].forEach((c, i) => {
    for (const f of foldChar(c)) {
      folded += f;
      from.push(i);
    }
  });
  const at = folded.indexOf(q);
  if (at === -1) return null;
  const chars = [...text];
  const start = from[at];
  const end = from[at + q.length - 1] + 1;
  return {
    start,
    end,
    pre: chars.slice(0, start).join(''),
    match: chars.slice(start, end).join(''),
    post: chars.slice(end).join(''),
  };
}

/**
 * "okaf" → every traveller on the trip it matches, with the matched letters (designs: Search
 * and check-in). A reference or the last digits of a phone find the booking's lead.
 * @param {any} m @param {string} query
 */
export function searchTravellers(m, query) {
  const q = query.trim();
  if (!q) return [];
  const digits = q.replace(/\D/g, '');
  /** @type {any[]} */
  const hits = [];
  for (const b of m.bookings) {
    if (!CAN_CHECK_IN.includes(b.status)) continue;
    const byRef = b.reference.toLowerCase().includes(q.toLowerCase());
    const byPhone = digits.length >= 3 && (b.lead.phone ?? '').replace(/\D/g, '').endsWith(digits);
    for (const t of b.travellers) {
      const hit = findIn(t.displayName, q);
      const lead = t.position === 1;
      if (!hit && !(lead && (byRef || byPhone))) continue;
      const diet = t.dietaryNeeds ? t.dietaryNeeds.toLowerCase() : null;
      hits.push({
        booking: b,
        traveller: t,
        pre: hit ? hit.pre : t.displayName,
        match: hit ? hit.match : '',
        post: hit ? hit.post : '',
        meta: [
          [t.category?.name ?? 'Guest', t.age ?? null].filter((x) => x !== null).join(' · '),
          ...(lead
            ? ['lead', b.reference, b.money.owedKobo > 0 ? b.money.label : 'Paid']
            : [`${b.lead.name}’s booking`]),
          diet,
        ]
          .filter(Boolean)
          .join(' · '),
        state: t.checkInStatus,
      });
    }
  }
  return hits;
}
