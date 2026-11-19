/**
 * The outbox on top of the saved package (15c-1): what the screens show before anything is
 * sent. Counts include changes not sent yet; changed rows say when ("Not sent yet · 07:08").
 */
import { describe, it, expect } from 'vitest';
import { makeChange, withChanges, countsOf, describeChange } from '../src/lib/outbox.js';
import { makePackage, TZ } from './fixtures.js';

const at = (/** @type {string} */ hhmm) => new Date(`2026-12-05T${hhmm}:00+01:00`);

describe('withChanges: the saved package, with this phone’s changes on top', () => {
  it('check-ins, a name and a no-show, oldest first; counts recomputed; the saved copy untouched', () => {
    const pkg = makePackage();
    const outbox = [
      makeChange(
        {
          kind: 'check_in',
          departureId: 'dep-badagry',
          bookingId: 'b-okafor',
          travellerIds: ['t-adaeze', 't-chidi'],
          status: 'present',
        },
        { now: at('07:05'), id: 'c1' },
      ),
      makeChange(
        {
          kind: 'name',
          departureId: 'dep-badagry',
          travellerId: 't-guest2',
          name: ' Obinna  Nwosu ',
          seen: '',
        },
        { now: at('07:06'), id: 'c2' },
      ),
      makeChange(
        { kind: 'no_show', departureId: 'dep-badagry', bookingId: 'b-nwosu' },
        { now: at('07:20'), id: 'c3' },
      ),
    ];
    const shown = withChanges(pkg, outbox);
    const [okafor, nwosu] = shown.departures[0].bookings;
    expect(okafor.travellers.map((/** @type {any} */ t) => t.checkInStatus)).toEqual([
      'present',
      'present',
      'pending',
    ]);
    expect(okafor.travellers[0].unsent).toBe(at('07:05').toISOString());
    expect(okafor.travellers[2].unsent).toBeUndefined();
    expect(nwosu.travellers[1]).toMatchObject({
      name: 'Obinna Nwosu',
      displayName: 'Obinna Nwosu',
      checkInStatus: 'no_show',
    });
    // The cancelled booking isn't counted.
    expect(shown.departures[0].counts).toEqual({
      travellers: 5,
      pending: 1,
      present: 2,
      late: 0,
      noShow: 2,
      unsent: 4,
    });
    expect(pkg.departures[0].bookings[0].travellers[0].checkInStatus).toBe('pending');
  });

  it('a later change wins over an earlier one (present, then undo, then late)', () => {
    const base = {
      kind: 'check_in',
      departureId: 'dep-badagry',
      bookingId: 'b-okafor',
      travellerIds: ['t-kamsi'],
    };
    const shown = withChanges(makePackage(), [
      makeChange({ ...base, status: 'present' }, { now: at('07:01') }),
      makeChange({ ...base, status: 'pending' }, { now: at('07:02') }),
      makeChange({ ...base, status: 'late' }, { now: at('07:12') }),
    ]);
    const kamsi = shown.departures[0].bookings[0].travellers[2];
    expect(kamsi).toMatchObject({ checkInStatus: 'late', checkedInAt: at('07:12').toISOString() });
  });

  it('a cancelled booking isn’t changed here (the server will say why)', () => {
    const shown = withChanges(makePackage(), [
      makeChange({
        kind: 'check_in',
        departureId: 'dep-badagry',
        bookingId: 'b-bayo',
        status: 'present',
      }),
    ]);
    expect(shown.departures[0].bookings[2].travellers[0].checkInStatus).toBe('pending');
  });

  it('no package yet: nothing to show', () => {
    expect(withChanges(null, [])).toBeNull();
  });
});

describe('countsOf', () => {
  it('as the server counts: a no-show booking’s guests count, a cancelled one’s don’t', () => {
    expect(countsOf(makePackage().departures[0])).toMatchObject({ travellers: 5, pending: 5 });
  });
});

describe('describeChange: Sync’s list (O5)', () => {
  const pkg = makePackage();
  it('“Adaeze Okafor +1 · present · 07:05”, names, no-shows, undo', () => {
    expect(
      describeChange(
        {
          kind: 'check_in',
          at: at('07:05').toISOString(),
          bookingId: 'b-okafor',
          travellerIds: ['t-adaeze', 't-chidi'],
          status: 'present',
        },
        pkg,
        TZ,
      ),
    ).toEqual({ who: 'Adaeze Okafor +1', what: 'present', time: '07:05' });
    expect(
      describeChange(
        {
          kind: 'name',
          at: at('07:06').toISOString(),
          travellerId: 't-guest2',
          name: 'Obinna Nwosu',
          seen: '',
        },
        pkg,
        TZ,
      ),
    ).toEqual({ who: 'Guest 2 → Obinna Nwosu', what: 'name added', time: '07:06' });
    expect(
      describeChange(
        { kind: 'no_show', at: at('07:30').toISOString(), bookingId: 'b-nwosu' },
        pkg,
        TZ,
      ),
    ).toEqual({
      who: 'Emeka Nwosu’s booking',
      what: 'no-show',
      time: '07:30',
    });
    expect(
      describeChange(
        {
          kind: 'check_in',
          at: at('07:31').toISOString(),
          bookingId: 'b-okafor',
          travellerIds: ['t-kamsi'],
          status: 'pending',
        },
        pkg,
        TZ,
      ).what,
    ).toBe('check-in undone');
  });
});
