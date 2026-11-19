/**
 * What a scanned ticket means, on the phone (O4, 15c-3): fingerprints, every kind of result
 * in the designs' words, the "Ticket OK" sheet, undo, and search with the matched letters.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  fingerprint,
  classify,
  problemOf,
  goodScan,
  scanCheckIn,
  undoOf,
  afterNote,
  currentDeparture,
  findIn,
  searchTravellers,
  TICKET_PATTERN,
} from '../src/lib/scan.js';
import { makePackage, TZ } from './fixtures.js';

const at = (/** @type {string} */ t, d = '05') => new Date(`2026-12-${d}T${t}:00+01:00`);
const CODE = `OKG1${'A'.repeat(38)}`;
const sha = (/** @type {string} */ s) => createHash('sha256').update(s).digest('hex');

/** The fixture with a second departure (the Heritage Walk, 09:00) and ticket fingerprints. */
function pkgWithTickets() {
  const pkg = makePackage();
  const [badagry] = pkg.departures;
  badagry.bookings.forEach((/** @type {any} */ b, i) => (b.ticketFingerprint = sha(`code-${i}`)));
  const walk = structuredClone(badagry);
  walk.departure = {
    ...walk.departure,
    id: 'dep-walk',
    startsAt: '2026-12-05T08:00:00.000Z',
    endsAt: '2026-12-05T11:00:00.000Z',
    localTime: '09:00',
  };
  walk.tour = {
    title: 'Lagos Island Heritage Walk',
    shortTitle: 'Heritage Walk',
    meetingPoint: { name: 'Tinubu Square' },
  };
  walk.bookings = [
    {
      ...walk.bookings[0],
      id: 'b-walk',
      reference: 'ILT-7K4Q2M',
      ticketFingerprint: sha('code-walk'),
    },
  ];
  pkg.departures.push(walk);
  return pkg;
}
const run = (/** @type {string} */ code, /** @type {any} */ pkg) =>
  classify({ code, fp: sha(code), pkg, departureId: 'dep-badagry' });

describe('fingerprint', () => {
  it('SHA-256 of the code, in hex: the same as the server’s (15b)', async () => {
    expect(await fingerprint(CODE)).toBe(sha(CODE));
    expect(TICKET_PATTERN.test(CODE)).toBe(true);
  });
});

describe('classify, and the words for each problem', () => {
  const pkg = pkgWithTickets();
  const o = { current: pkg.departures[0], business: 'Ìrìn', now: at('07:12'), tz: TZ };

  it('on this trip, someone still to come: ok', () => {
    expect(run('code-0', pkg).kind).toBe('ok');
  });

  it('another saved trip: "Not this trip", which one, where', () => {
    const r = run('code-walk', pkg);
    expect(r.kind).toBe('other-trip');
    expect(problemOf(r, o)).toMatchObject({
      title: 'Not this trip',
      sub: 'ILT-7K4Q2M · Lagos Island Heritage Walk',
      body: 'This ticket is for the Heritage Walk, Sat 5 Dec, 09:00, at Tinubu Square. It isn’t on your Badagry Heritage Day Trip trip.',
    });
  });

  it('cancelled (and refunded): don’t check in, call the office', () => {
    pkg.departures[0].bookings[2].status = 'refunded';
    pkg.departures[0].bookings[2].endedAt = '2026-12-04T15:00:00.000Z';
    const r = run('code-2', pkg);
    expect(r.kind).toBe('cancelled');
    expect(problemOf(r, o)).toMatchObject({
      tone: 'danger',
      title: 'Cancelled: don’t check in',
      sub: 'ILT-9GT4VA · Bayo Adewale',
      body: 'This booking was cancelled on Fri 4 Dec and refunded. If the guest says otherwise, ask them to call the office.',
      call: true,
    });
  });

  it('everyone already in: "Already checked in at 06:52", nothing changed', () => {
    const p = pkgWithTickets();
    for (const t of p.departures[0].bookings[1].travellers) {
      t.checkInStatus = 'present';
      t.checkedInAt = '2026-12-05T05:52:00.000Z';
    }
    const r = run('code-1', p);
    expect(r.kind).toBe('already');
    expect(problemOf(r, o).body).toBe(
      'Checked in at 06:52: Emeka Nwosu, Guest 2 of Emeka Nwosu’s booking. Nothing changed.',
    );
  });

  it('a whole-booking no-show, and a booking not confirmed', () => {
    const p = pkgWithTickets();
    p.departures[0].bookings[0].status = 'no_show';
    p.departures[0].bookings[1].status = 'held';
    expect(run('code-0', p).kind).toBe('no-show');
    expect(run('code-1', p).kind).toBe('not-booked');
  });

  it('an OkapiGo ticket not saved here, and not a ticket at all', () => {
    const r1 = run(CODE, pkg);
    expect(r1.kind).toBe('unknown-trip');
    expect(problemOf(r1, o)).toMatchObject({
      title: 'Not on your saved trips',
      call: true,
      search: true,
    });
    const r2 = run('https://example.com/menu', pkg);
    expect(r2.kind).toBe('not-ours');
    expect(problemOf(r2, o)).toMatchObject({
      title: 'Not an Ìrìn ticket',
      search: true,
      call: false,
    });
    expect(problemOf(r2, { ...o, business: 'Lagos Bikes' }).title).toBe('Not a Lagos Bikes ticket');
  });
});

describe('the "Ticket OK" sheet', () => {
  it('who’s still to come is ticked; who’s in says when; money owed in words', () => {
    const pkg = pkgWithTickets();
    const m = pkg.departures[0];
    const b = m.bookings[0];
    b.travellers[0].checkInStatus = 'present';
    b.travellers[0].checkedInAt = '2026-12-05T05:58:00.000Z';
    b.money = { owedKobo: 4_550_000, paidKobo: 1_950_000, label: '₦45,500 still to pay' };
    b.addOns = [{ name: 'Lunch', quantity: 3 }];
    const v = goodScan(m, b, { now: at('07:12'), tz: TZ });
    expect(v.people.map((p) => [p.name, p.waiting, p.note, p.diet])).toEqual([
      ['Adaeze Okafor', false, 'in at 06:58', null],
      ['Chidi Okafor', true, null, null],
      ['Kamsi Okafor', true, null, 'No peanuts'],
    ]);
    expect(v.owes).toEqual({
      title: 'They still owe ₦45,500',
      detail: 'Deposit of ₦19,500 paid. Balance was due Sat 28 Nov.',
    });
    expect(v.owesAsked).toBe(true); // someone's in: the question was answered then
    expect(v).toMatchObject({ extras: '3 × lunch', started: true, lateAt: '07:12' });
    expect(
      goodScan(m, b, { now: new Date('2026-11-20T09:00:00+01:00'), tz: TZ }).owes?.detail,
    ).toBe('Deposit of ₦19,500 paid. Balance due Sat 28 Nov.');
  });

  it('checking in records one change; Undo puts the same people back; the note after', () => {
    const m = pkgWithTickets().departures[0];
    const b = m.bookings[0];
    const c = scanCheckIn(m, b, ['t-adaeze', 't-chidi'], 'present', { confirmOwed: true });
    expect(c).toEqual({
      kind: 'check_in',
      departureId: 'dep-badagry',
      bookingId: 'b-okafor',
      travellerIds: ['t-adaeze', 't-chidi'],
      status: 'present',
      seen: { 't-adaeze': 'pending', 't-chidi': 'pending' },
      confirmOwed: true,
    });
    expect(undoOf(c)).toEqual({
      kind: 'check_in',
      departureId: 'dep-badagry',
      bookingId: 'b-okafor',
      travellerIds: ['t-adaeze', 't-chidi'],
      status: 'pending',
      seen: { 't-adaeze': 'present', 't-chidi': 'present' },
    });
    expect(afterNote(b, ['t-adaeze', 't-chidi'], 'present')).toBe(
      '2 checked in · Okafor · Kamsi not yet',
    );
    expect(afterNote(b, ['t-adaeze', 't-chidi', 't-kamsi'], 'late')).toBe('3 marked late · Okafor');
  });
});

describe('which departure the Scan tab is for', () => {
  it('the one under way, else today’s next, else tomorrow’s first', () => {
    const pkg = pkgWithTickets();
    expect(currentDeparture(pkg, at('07:30'))?.departure.id).toBe('dep-badagry');
    expect(currentDeparture(pkg, at('06:30'))?.departure.id).toBe('dep-badagry');
    pkg.departures[0].departure.endsAt = '2026-12-05T07:00:00.000Z';
    expect(currentDeparture(pkg, at('08:30'))?.departure.id).toBe('dep-walk');
    expect(currentDeparture({ ...pkg, departures: [] }, at('08:30'))).toBeNull();
  });
});

describe('search instead of scanning', () => {
  it('the matched letters, accents and case ignored', () => {
    expect(findIn('Adaeze Okafor', 'okaf')).toMatchObject({
      pre: 'Adaeze ',
      match: 'Okaf',
      post: 'or',
    });
    expect(findIn('Ìrìn Lagos', 'irin')).toMatchObject({ pre: '', match: 'Ìrìn', post: ' Lagos' });
    expect(findIn('Ìrìn Lagos', 'zz')).toBeNull();
  });

  it('every traveller it matches; a reference or phone finds the lead; cancelled left out', () => {
    const m = pkgWithTickets().departures[0];
    m.bookings[0].travellers[2].age = 8;
    m.bookings[0].travellers[2].category = { key: 'child', name: 'Child' };
    const hits = searchTravellers(m, 'okaf');
    expect(hits.map((h) => [h.pre + h.match + h.post, h.match, h.meta])).toEqual([
      ['Adaeze Okafor', 'Okaf', 'Adult · lead · ILT-7Q2LKD · Paid'],
      ['Chidi Okafor', 'Okaf', 'Adult · Adaeze Okafor’s booking'],
      ['Kamsi Okafor', 'Okaf', 'Child · 8 · Adaeze Okafor’s booking · no peanuts'],
    ]);
    expect(searchTravellers(m, 'ilt-5px').map((h) => h.traveller.id)).toEqual(['t-emeka']);
    expect(searchTravellers(m, '7781').map((h) => h.traveller.id)).toEqual(['t-emeka']);
    expect(searchTravellers(m, 'bayo')).toEqual([]);
    expect(searchTravellers(m, '  ')).toEqual([]);
  });
});
