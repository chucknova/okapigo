import { describe, it, expect } from 'vitest';
import {
  monthTabs,
  initialMonth,
  groupByWeek,
  seatsChip,
  travellersFromCounts,
  addOnSelections,
  addOnStockLabel,
  seatsNote,
  continueState,
  lineLabel,
} from '../src/lib/checkout.js';

const dep = (localDate, seatsAvailable, localTime = '09:00') => ({
  id: localDate,
  localDate,
  localTime,
  seatsAvailable,
  soldOut: seatsAvailable === 0,
});

describe('step 1: months and weeks', () => {
  it('offers this month and the next two, across a year end', () => {
    expect(monthTabs('2026-11-17').map((t) => t.label)).toEqual(['Nov', 'Dec', 'Jan']);
    expect(monthTabs('2026-12-03').map((t) => t.key)).toEqual(['2026-12', '2027-01', '2027-02']);
  });

  it('opens on the first month with seats', () => {
    const tabs = monthTabs('2026-11-17');
    expect(initialMonth([dep('2026-11-28', 0), dep('2026-12-05', 4)], tabs)).toBe('2026-12');
    expect(initialMonth([], tabs)).toBe('2026-11');
  });

  it('groups Monday to Sunday, naming both months only when a week crosses one', () => {
    const weeks = groupByWeek([
      dep('2026-11-30', 15),
      dep('2026-12-06', 11),
      dep('2026-12-07', 15),
      dep('2026-12-13', 9),
    ]);
    expect(weeks.map((w) => [w.label, w.departures.length])).toEqual([
      ['Mon 30 Nov – Sun 6 Dec', 2],
      ['Mon 7 – Sun 13 Dec', 2],
    ]);
  });

  it('chips: "15 left", "Only 2 left", "Sold out"', () => {
    expect(seatsChip(dep('2026-12-01', 15))).toEqual({ text: '15 left', tone: 'primary' });
    expect(seatsChip(dep('2026-12-01', 2))).toEqual({ text: 'Only 2 left', tone: 'warning' });
    expect(seatsChip(dep('2026-12-01', 0)).tone).toBe('soldOut');
  });
});

describe('step 2: building the quote request', () => {
  const categories = [{ key: 'adult' }, { key: 'child' }, { key: 'infant' }];

  it('turns counters into travellers in the tour’s category order', () => {
    expect(travellersFromCounts({ child: 1, adult: 2 }, categories)).toEqual([
      { categoryKey: 'adult' },
      { categoryKey: 'adult' },
      { categoryKey: 'child' },
    ]);
  });

  it('sends only the extras actually chosen', () => {
    expect(addOnSelections({ a: 2, b: 0, c: 1 })).toEqual([
      { addOnId: 'a', quantity: 2 },
      { addOnId: 'c', quantity: 1 },
    ]);
  });
});

describe('step 2: words', () => {
  it('says add-on stock only when it runs low: "tonight" for evening tours', () => {
    expect(addOnStockLabel(null, '18:30')).toBeNull(); // unlimited
    expect(addOnStockLabel(8, '18:30')).toBeNull();
    expect(addOnStockLabel(4, '18:30')).toEqual({ text: '4 left tonight', soldOut: false });
    expect(addOnStockLabel(1, '18:30')).toEqual({ text: 'Last 1 tonight', soldOut: false });
    expect(addOnStockLabel(0, '18:30')).toEqual({ text: 'Sold out tonight', soldOut: true });
    expect(addOnStockLabel(3, '10:00').text).toBe('3 left on this trip');
  });

  it('notes seats left, and that free travellers still need one', () => {
    const cats = [
      { name: 'Adult (13+)', amountKobo: 2_500_000 },
      { name: 'Infant (0–2)', amountKobo: 0 },
    ];
    expect(
      seatsNote({ seatsAvailable: 7, localDate: '2026-12-05', localTime: '09:00' }, cats),
    ).toBe('Infants (0–2) are free but need a seat. 7 seats left on Sat 5 Dec.');
    expect(
      seatsNote({ seatsAvailable: 6, localDate: '2026-12-04', localTime: '18:30' }, [cats[0]]),
    ).toBe('6 seats left tonight.');
  });

  it('labels price lines without age ranges', () => {
    expect(lineLabel({ type: 'ticket', label: 'Adult (13+)', quantity: 2 })).toBe('2 × Adult');
    expect(lineLabel({ type: 'addOn', label: 'Palm wine sampler', quantity: 1 })).toBe(
      '1 × Palm wine sampler',
    );
  });
});

describe('continueState: when Continue works, and why not', () => {
  const ok = {
    travellers: 2,
    seatsAvailable: 7,
    blocker: null,
    pickupRequired: false,
    pickup: null,
    updating: false,
    quoteError: false,
  };

  it('allows it when everything is in place', () => {
    expect(continueState(ok)).toEqual({ disabled: false, reason: null });
  });

  it('gives the first problem, in words', () => {
    expect(continueState({ ...ok, travellers: 0 }).reason).toBe('Add at least one traveller');
    expect(continueState({ ...ok, travellers: 9 }).reason).toBe('Only 7 seats left on this date');
    expect(continueState({ ...ok, blocker: { code: 'ADULT_REQUIRED', message: 'x' } }).reason).toBe(
      'Add an adult to continue',
    );
    expect(continueState({ ...ok, pickupRequired: true }).reason).toBe('Choose a pickup point');
  });

  it('waits for the newest price, silently', () => {
    expect(continueState({ ...ok, updating: true })).toEqual({ disabled: true, reason: null });
  });
});
