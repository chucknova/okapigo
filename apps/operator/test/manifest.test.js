/**
 * The manifest's logic (O3, 15c-2): pills, what a tap changes to, search, and the change
 * each action records.
 */
import { describe, it, expect } from 'vitest';
import {
  manifestView,
  nextState,
  stateChange,
  needsOweQuestion,
  restNoShowChange,
  nameChange,
  noShowQuestion,
  matcher,
} from '../src/lib/manifest.js';
import { withChanges } from '../src/lib/outbox.js';
import { makePackage, TZ } from './fixtures.js';

const before = new Date('2026-12-05T06:52:00+01:00');
const after = new Date('2026-12-05T07:12:00+01:00');
const m = () => makePackage().departures[0];

describe('a tap on a traveller', () => {
  it('cycles Not yet → Present → Late → No-show → Not yet once started; before, only Present', () => {
    expect(
      ['pending', 'present', 'late', 'no_show'].map((s) => nextState(/** @type {any} */ (s), true)),
    ).toEqual(['present', 'late', 'no_show', 'pending']);
    expect(nextState('pending', false)).toBe('present');
    expect(nextState('present', false)).toBe('pending');
  });

  it('records what the phone saw; money owed asks once, then not again on that booking', () => {
    const d = m();
    const b = d.bookings[0];
    b.money = { owedKobo: 4_550_000, label: '₦45,500 still to pay' };
    const [adaeze, chidi] = b.travellers;
    expect(needsOweQuestion(b, adaeze, 'present')).toBe(true);
    expect(needsOweQuestion(b, adaeze, 'pending')).toBe(false);
    expect(stateChange(d, b, adaeze, 'present', { confirmOwed: true })).toEqual({
      kind: 'check_in',
      departureId: 'dep-badagry',
      bookingId: 'b-okafor',
      travellerIds: ['t-adaeze'],
      status: 'present',
      seen: { 't-adaeze': 'pending' },
      confirmOwed: true,
    });
    adaeze.checkInStatus = 'present';
    expect(needsOweQuestion(b, chidi, 'present')).toBe(false);
    expect(stateChange(d, b, chidi, 'present').confirmOwed).toBe(true);
  });
});

describe('mark the rest no-show', () => {
  it('nobody came: the whole booking (the policy applies)', () => {
    const d = m();
    expect(restNoShowChange(d, d.bookings[0])).toEqual({
      kind: 'no_show',
      departureId: 'dep-badagry',
      bookingId: 'b-okafor',
    });
  });

  it('someone came: just the ones still “Not yet”, as travellers', () => {
    const d = m();
    d.bookings[0].travellers[0].checkInStatus = 'present';
    expect(restNoShowChange(d, d.bookings[0])).toEqual({
      kind: 'check_in',
      departureId: 'dep-badagry',
      bookingId: 'b-okafor',
      travellerIds: ['t-chidi', 't-kamsi'],
      status: 'no_show',
      seen: { 't-chidi': 'pending', 't-kamsi': 'pending' },
    });
  });

  it('on this phone at once: the whole booking shows as a no-show, its pills locked', () => {
    const shown = withChanges(makePackage(), [
      {
        id: 'c1',
        at: after.toISOString(),
        kind: 'no_show',
        departureId: 'dep-badagry',
        bookingId: 'b-nwosu',
      },
    ]);
    const v = manifestView(shown.departures[0], { now: after, tz: TZ });
    const nwosu = v.bookings.find((b) => b.id === 'b-nwosu');
    expect(nwosu?.pay).toEqual({ text: 'No-show', tone: 'no_show' });
    expect(nwosu?.locked).toBe(true);
    expect(nwosu?.people.map((p) => p.pill.label)).toEqual(['✕ No-show', '✕ No-show']);
  });

  it('the office’s notes for the guide, under their booking (16c)', () => {
    const d = m();
    d.bookings[0] = { ...d.bookings[0], notes: ['Halal lunch for Yemi and Tobi.'] };
    const v = manifestView(d, { now: after, tz: TZ });
    expect(v.bookings[0].notes).toEqual(['Halal lunch for Yemi and Tobi.']);
    // A package from before 16c has none.
    expect(manifestView(m(), { now: after, tz: TZ }).bookings[0].notes).toEqual([]);
  });

  it('the question, with the policy and the balance', () => {
    const v = manifestView(m(), { now: after, tz: TZ });
    const b = { ...v.bookings[0], noShowRefundPercent: 0, owesKobo: 4_550_000 };
    expect(noShowQuestion(b, 'Ìrìn Lagos Tours')).toEqual({
      title: 'Mark Adaeze Okafor’s booking no-show?',
      body: '3 travellers. Under Ìrìn Lagos Tours’s policy a no-show gets no refund, and the balance of ₦45,500 stays unpaid. The office can change this later.',
    });
    expect(noShowQuestion({ ...b, noShowRefundPercent: 25, owesKobo: 0 }, 'Ìrìn').body).toBe(
      '3 travellers. Under Ìrìn’s policy a no-show gets 25% back. The office can change this later.',
    );
  });
});

describe('the view', () => {
  it('header, chips, pills; the cancelled booking struck through apart; rest-no-show only after the start', () => {
    const d = m();
    d.bookings[0].travellers[1].checkInStatus = 'late';
    d.bookings[0].travellers[1].checkedInAt = '2026-12-05T06:04:00.000Z';
    d.bookings[0].addOns = [{ name: 'Lunch', quantity: 3 }];
    d.bookings[0].channel = 'web';
    d.bookings[2].endedAt = '2026-12-04T15:00:00.000Z';
    d.counts = { travellers: 5, pending: 4, present: 0, late: 1, noShow: 0, unsent: 0 };
    const v = manifestView(d, { now: after, tz: TZ });
    expect(v).toMatchObject({
      dateLine: 'Sat 5 Dec · started 07:00',
      title: 'Badagry Heritage Day Trip',
      sub: 'Ìrìn office, Yaba · Femi · Van 1 (14 seats) · Driver: Sola',
      checkedIn: 1,
      total: 5,
      pct: 20,
    });
    const [okafor, nwosu] = v.bookings;
    expect(okafor).toMatchObject({
      lead: 'Adaeze Okafor',
      ref: 'ILT-7Q2LKD',
      via: 'web',
      extras: '3 × lunch',
      pay: { text: 'Paid' },
    });
    expect(okafor.people.map((p) => [p.name, p.meta, p.pill.label, p.diet])).toEqual([
      ['Adaeze Okafor', 'Adult', 'Not yet', null],
      ['Chidi Okafor', 'Adult', 'Late 07:04', null],
      ['Kamsi Okafor', 'Adult', 'Not yet', 'No peanuts'],
    ]);
    expect(okafor).toMatchObject({ canMarkRest: true, restIsWholeBooking: false, pendingCount: 2 });
    expect(nwosu.people[1]).toMatchObject({
      name: 'Guest 2 of Emeka Nwosu’s booking',
      unnamed: true,
    });
    expect(v.cancelled).toEqual([
      {
        id: 'b-bayo',
        line: 'Bayo Adewale · 1 guest',
        sub: 'ILT-9GT4VA · Cancelled yesterday · don’t check in',
      },
    ]);
    expect(manifestView(d, { now: before, tz: TZ }).bookings[0].canMarkRest).toBe(false);
    expect(manifestView(d, { now: before, tz: TZ }).dateLine).toBe('Sat 5 Dec · starts 07:00');
  });

  it('search: names (any traveller, no accents), the reference, the last digits of the phone', () => {
    const [okafor, nwosu] = m().bookings;
    expect(matcher('okaf')(okafor)).toBe(true);
    expect(matcher('KAMSI')(okafor)).toBe(true);
    expect(matcher('okaf')(nwosu)).toBe(false);
    expect(matcher('ilt-5px')(nwosu)).toBe(true);
    expect(matcher('7781')(nwosu)).toBe(true);
    expect(matcher('')(nwosu)).toBe(true);
    expect(manifestView(m(), { now: after, tz: TZ, query: 'okaf' }).matches).toBe(1);
  });
});

describe('a name typed at check-in', () => {
  it('cleaned, with what the phone saw; too short refused here', () => {
    const d = m();
    const guest = d.bookings[1].travellers[1];
    expect(nameChange(d, guest, '  Obinna   Nwosu ')).toEqual({
      ok: true,
      change: {
        kind: 'name',
        departureId: 'dep-badagry',
        travellerId: 't-guest2',
        name: 'Obinna Nwosu',
        seen: '',
      },
    });
    expect(nameChange(d, guest, 'O')).toEqual({
      ok: false,
      error: 'A name of 2 to 80 characters, please.',
    });
  });
});
