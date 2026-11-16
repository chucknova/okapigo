import { describe, it, expect } from 'vitest';
import { zonedTimeToUtc, localDate, addDays, dayOfWeek } from '../src/time.js';
import { expandSchedule } from '../src/schedule.js';

describe('zonedTimeToUtc', () => {
  it('09:00 in Lagos (UTC+1, no daylight saving) is 08:00 UTC', () => {
    expect(zonedTimeToUtc('2026-12-01', '09:00', 'Africa/Lagos').toISOString()).toBe(
      '2026-12-01T08:00:00.000Z',
    );
    // Same offset in July: Lagos never changes its clocks.
    expect(zonedTimeToUtc('2026-07-01', '09:00', 'Africa/Lagos').toISOString()).toBe(
      '2026-07-01T08:00:00.000Z',
    );
  });

  it('handles zones with daylight saving (London: UTC+0 in winter, UTC+1 in summer)', () => {
    expect(zonedTimeToUtc('2026-01-15', '09:00', 'Europe/London').toISOString()).toBe(
      '2026-01-15T09:00:00.000Z',
    );
    expect(zonedTimeToUtc('2026-07-15', '09:00', 'Europe/London').toISOString()).toBe(
      '2026-07-15T08:00:00.000Z',
    );
  });

  it('crosses midnight correctly (00:30 in Lagos is the previous day in UTC)', () => {
    expect(zonedTimeToUtc('2026-12-01', '00:30', 'Africa/Lagos').toISOString()).toBe(
      '2026-11-30T23:30:00.000Z',
    );
  });
});

describe('localDate', () => {
  it('gives the Lagos calendar date for an instant', () => {
    expect(localDate(new Date('2026-12-01T23:30:00Z'), 'Africa/Lagos')).toBe('2026-12-02');
    expect(localDate(new Date('2026-12-01T22:30:00Z'), 'Africa/Lagos')).toBe('2026-12-01');
  });
});

describe('calendar helpers', () => {
  it('adds days across month and year ends', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29'); // leap year
  });

  it('knows the day of the week', () => {
    expect(dayOfWeek('2026-11-16')).toBe(1); // a Monday
  });
});

const LAGOS = { timeZone: 'Africa/Lagos', durationMinutes: 180 };
const DAILY = [0, 1, 2, 3, 4, 5, 6];

describe('expandSchedule', () => {
  it('daily at 09:00 for a week gives 7 departures, each 3 hours long', () => {
    const deps = expandSchedule(
      {
        startDate: '2026-12-01',
        endDate: null,
        daysOfWeek: DAILY,
        times: ['09:00'],
        skipDates: [],
      },
      { from: '2026-12-01', to: '2026-12-07', ...LAGOS },
    );

    expect(deps).toHaveLength(7);
    expect(deps[0].startsAt.toISOString()).toBe('2026-12-01T08:00:00.000Z');
    expect(deps[0].endsAt.toISOString()).toBe('2026-12-01T11:00:00.000Z');
  });

  it('Thursday to Saturday only (the Street Food Crawl)', () => {
    const deps = expandSchedule(
      {
        startDate: '2026-11-16',
        endDate: null,
        daysOfWeek: [4, 5, 6],
        times: ['18:30'],
        skipDates: [],
      },
      { from: '2026-11-16', to: '2026-11-29', ...LAGOS },
    );

    // Two weeks → 6 departures, all on Thu/Fri/Sat in Lagos.
    expect(deps).toHaveLength(6);
    expect(deps.map((d) => dayOfWeek(localDate(d.startsAt, 'Africa/Lagos')))).toEqual([
      4, 5, 6, 4, 5, 6,
    ]);
  });

  it('skips exception dates', () => {
    const deps = expandSchedule(
      {
        startDate: '2026-12-23',
        endDate: null,
        daysOfWeek: DAILY,
        times: ['09:00'],
        skipDates: ['2026-12-25'],
      },
      { from: '2026-12-23', to: '2026-12-27', ...LAGOS },
    );

    const dates = deps.map((d) => localDate(d.startsAt, 'Africa/Lagos'));
    expect(dates).toEqual(['2026-12-23', '2026-12-24', '2026-12-26', '2026-12-27']);
  });

  it('respects the rule start and end dates inside a wider window', () => {
    const deps = expandSchedule(
      {
        startDate: '2026-12-05',
        endDate: '2026-12-06',
        daysOfWeek: DAILY,
        times: ['09:00'],
        skipDates: [],
      },
      { from: '2026-12-01', to: '2026-12-31', ...LAGOS },
    );
    expect(deps).toHaveLength(2);
  });

  it('several times a day come out in time order', () => {
    const deps = expandSchedule(
      {
        startDate: '2026-12-01',
        endDate: null,
        daysOfWeek: DAILY,
        times: ['15:00', '09:00'],
        skipDates: [],
      },
      { from: '2026-12-01', to: '2026-12-01', ...LAGOS },
    );
    expect(deps.map((d) => d.startsAt.toISOString())).toEqual([
      '2026-12-01T08:00:00.000Z',
      '2026-12-01T14:00:00.000Z',
    ]);
  });

  it('produces nothing when the window is before the rule starts', () => {
    const deps = expandSchedule(
      {
        startDate: '2027-01-01',
        endDate: null,
        daysOfWeek: DAILY,
        times: ['09:00'],
        skipDates: [],
      },
      { from: '2026-12-01', to: '2026-12-31', ...LAGOS },
    );
    expect(deps).toEqual([]);
  });
});
