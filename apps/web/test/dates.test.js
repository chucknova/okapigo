import { describe, it, expect } from 'vitest';
import { summariseDates, seatsLabel } from '../src/lib/dates.js';

const dep = (localDate, seatsAvailable) => ({
  id: localDate,
  localDate,
  localTime: '09:00',
  seatsAvailable,
  soldOut: seatsAvailable === 0,
});

describe('summariseDates', () => {
  const today = '2026-11-17';

  it('shows the next 4 dates, sold-out ones included', () => {
    const deps = [
      dep('2026-11-18', 12),
      dep('2026-11-19', 3),
      dep('2026-11-20', 0),
      dep('2026-11-21', 15),
      dep('2026-11-22', 9),
    ];
    const s = summariseDates(deps, today);
    expect(s.kind).toBe('dates');
    expect(s.tiles.map((d) => d.localDate)).toEqual([
      '2026-11-18',
      '2026-11-19',
      '2026-11-20',
      '2026-11-21',
    ]);
  });

  it('says "sold out until" when every date in the next 2 weeks is full', () => {
    const deps = [
      dep('2026-11-21', 0),
      dep('2026-11-28', 0),
      dep('2026-12-05', 8),
      dep('2026-12-06', 12),
      dep('2026-12-12', 3),
    ];
    expect(summariseDates(deps, today)).toEqual({
      kind: 'soldOutUntil',
      until: '2026-12-05',
      next: [deps[2], deps[3]],
    });
  });

  it('a full first date with seats soon after is just a normal list', () => {
    const deps = [dep('2026-11-21', 0), dep('2026-11-28', 4)];
    expect(summariseDates(deps, today).kind).toBe('dates');
  });

  it('nothing bookable at all is "none"', () => {
    expect(summariseDates([], today)).toEqual({ kind: 'none' });
    expect(summariseDates([dep('2026-11-21', 0)], today)).toEqual({ kind: 'none' });
  });
});

describe('seatsLabel', () => {
  it('says "Only N left" from 3 down, "Sold out" at 0', () => {
    expect(seatsLabel(dep('2026-11-18', 12))).toEqual({ text: '12 left', tone: 'normal' });
    expect(seatsLabel(dep('2026-11-18', 3))).toEqual({ text: 'Only 3 left', tone: 'few' });
    expect(seatsLabel(dep('2026-11-18', 0))).toEqual({ text: 'Sold out', tone: 'soldOut' });
  });
});
