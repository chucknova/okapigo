/** Money on the day and pickup stops (15c-4): the logic. */
import { describe, it, expect } from 'vitest';
import {
  cashAmount,
  nairaField,
  payChip,
  cashToday,
  qrSquares,
  cashChange,
} from '../src/lib/money.js';
import { stopsView, everyoneHere } from '../src/lib/stops.js';
import { withChanges, describeChange } from '../src/lib/outbox.js';
import { makePackage, TZ } from './fixtures.js';

describe('cash', () => {
  it('the amount: naira with commas; up to what’s owed; less is fine', () => {
    expect(cashAmount('45,500', 4_550_000)).toEqual({ ok: true, kobo: 4_550_000 });
    expect(cashAmount('₦20,000', 4_550_000)).toEqual({ ok: true, kobo: 2_000_000 });
    expect(cashAmount('45,501', 4_550_000)).toEqual({
      ok: false,
      error: 'That’s more than they owe.',
    });
    expect(cashAmount('0', 4_550_000).ok).toBe(false);
    expect(cashAmount('lots', 4_550_000).ok).toBe(false);
    expect(nairaField(4_550_000)).toBe('45,500');
  });

  it('on this phone at once: the chip, Sync’s row, and today’s cash; still owing', () => {
    const pkg = makePackage();
    const m = pkg.departures[0];
    m.bookings[0].money = { owedKobo: 4_550_000, paidKobo: 0, label: '₦45,500 still to pay' };
    const outbox = [
      { id: 'c1', at: '2026-12-05T06:12:00.000Z', ...cashChange(m, m.bookings[0], 4_550_000) },
    ];
    const shown = withChanges(pkg, outbox);
    const b = shown.departures[0].bookings[0];
    expect(payChip(b)).toEqual({ text: 'Cash ₦45,500 reported · office to confirm', tone: 'cash' });
    expect(b.money.owedKobo).toBe(4_550_000);
    expect(describeChange(outbox[0], pkg, TZ)).toEqual({
      who: 'Adaeze Okafor · cash ₦45,500',
      what: 'cash reported',
      time: '07:12',
    });
    expect(cashToday(shown, outbox)).toBe('₦45,500 from 1 booking · hand in to the office');
    // The package's own (sent earlier) and this phone's add up, per booking.
    expect(
      cashToday(
        { myCash: [{ bookingId: 'b-x', amountKobo: 1_000_000, status: 'reported' }] },
        outbox,
      ),
    ).toBe('₦55,500 from 2 bookings · hand in to the office');
    expect(cashToday({ myCash: [] }, [])).toBeNull();
  });

  it('paid by the QR: "Paid by link · confirming" until the server knows', () => {
    const pkg = makePackage();
    pkg.departures[0].bookings[0].money = { owedKobo: 4_550_000, label: '₦45,500 still to pay' };
    const shown = withChanges(pkg, [
      {
        id: 'c1',
        at: '2026-12-05T06:12:00.000Z',
        kind: 'check_in',
        departureId: 'dep-badagry',
        bookingId: 'b-okafor',
        status: 'present',
        paidBy: 'link',
        confirmOwed: true,
      },
    ]);
    expect(payChip(shown.departures[0].bookings[0]).text).toBe('Paid by link · confirming');
  });

  it('the QR: squares for the link, with a quiet border', () => {
    const q = qrSquares('https://okapigo.example/pay/' + 'a'.repeat(32));
    expect(q.length).toBe(q[0].length);
    expect(q.length).toBeGreaterThanOrEqual(25);
    expect(q[0].every((x) => x === false)).toBe(true);
  });
});

describe('pickup stops', () => {
  function lekki() {
    const pkg = makePackage();
    const m = pkg.departures[0];
    m.tour.pickupPoints = [
      { name: 'Victoria Island', address: 'Eko Hotel main gate', time: '07:15' },
      { name: 'Ikoyi', address: 'Falomo roundabout', time: '07:30' },
      { name: 'Lekki Phase 1', address: 'Admiralty Way gate', time: '07:45' },
    ];
    m.bookings[0].pickupPoint = { name: 'Ikoyi' };
    m.bookings[1].pickupPoint = { name: 'Victoria Island' };
    return m;
  }

  it('in the van’s order; done, next, later; the next stop has directions', () => {
    const m = lekki();
    for (const t of m.bookings[1].travellers) {
      t.checkInStatus = 'present';
      t.checkedInAt = '2026-12-05T06:16:00.000Z';
    }
    const v = stopsView(m, TZ);
    expect(v?.stops.map((s) => [s.tag, s.time, s.area, s.count])).toEqual([
      ['DONE · 07:16', '07:15', 'Victoria Island', '2 of 2'],
      ['NEXT STOP', '07:30', 'Ikoyi', '0 of 3'],
    ]);
    expect(v).toMatchObject({ pickedUp: 2, total: 5 });
    expect(v?.next?.directions).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=Falomo%20roundabout%2C%20Ikoyi',
    );
  });

  it('nobody waiting at a stop is done even with a no-show; someone missing keeps it open', () => {
    const m = lekki();
    m.bookings[1].travellers[0].checkInStatus = 'present';
    m.bookings[1].travellers[1].checkInStatus = 'no_show';
    m.bookings[0].travellers[0].checkInStatus = 'present';
    const v = stopsView(m, TZ);
    expect(v?.stops.map((s) => s.state)).toEqual(['done', 'next']);
  });

  it('a tour without pickup points: no stops (the plain manifest)', () => {
    expect(stopsView(makePackage().departures[0], TZ)).toBeNull();
  });

  it('"Everyone here": one check-in per booking; a booking that owes is left out', () => {
    const m = lekki();
    m.bookings[0].pickupPoint = { name: 'Victoria Island' };
    m.bookings[0].money = { owedKobo: 4_550_000, label: '₦45,500 still to pay' };
    const stop = stopsView(m, TZ)?.next;
    const r = everyoneHere(m, /** @type {any} */ (stop));
    expect(r.count).toBe(2);
    expect(r.owing.map((b) => b.id)).toEqual(['b-okafor']);
    expect(r.changes).toEqual([
      {
        kind: 'check_in',
        departureId: 'dep-badagry',
        bookingId: 'b-nwosu',
        travellerIds: ['t-emeka', 't-guest2'],
        status: 'present',
        seen: { 't-emeka': 'pending', 't-guest2': 'pending' },
      },
    ]);
  });
});
