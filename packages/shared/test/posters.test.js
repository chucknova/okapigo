/**
 * Stage 18b: the poster maker's rules and words (designs P1–P2).
 */
import { describe, it, expect } from 'vitest';
import {
  POSTER_SIZES,
  POSTER_TEMPLATES,
  dayTag,
  posterFileName,
  posterTitle,
  seatsWords,
  templateState,
  weekendDayLabel,
  weekendDays,
} from '../src/posters.js';

describe('templates and sizes', () => {
  it('four templates, in the designs’ order, with their words', () => {
    expect(POSTER_TEMPLATES.map((t) => [t.key, t.name, t.words])).toEqual([
      ['new_tour', 'New tour', 'NEW TOUR'],
      ['offer', 'Offer', 'A day out in Lagos'],
      ['seats_left', 'Seats left', ''],
      ['weekend', 'This weekend', 'This weekend'],
    ]);
    expect(POSTER_SIZES.square).toMatchObject({ width: 1080, height: 1080 });
    expect(POSTER_SIZES.story).toMatchObject({ width: 1080, height: 1920 });
  });

  it('when a template can’t be used, and why', () => {
    const none = { departures: [] };
    const some = { departures: [{}] };
    expect(templateState('seats_left', none, 3)).toEqual({
      available: false,
      why: 'No departures in the next 14 days',
    });
    expect(templateState('seats_left', some, 0)).toEqual({ available: true, why: null });
    expect(templateState('weekend', some, 0)).toEqual({
      available: false,
      why: 'Nothing on this weekend',
    });
    expect(templateState('weekend', none, 1).available).toBe(true);
    expect(templateState('new_tour', none, 0).available).toBe(true);
    expect(templateState('offer', none, 0).available).toBe(true);
  });
});

describe('dates', () => {
  it('the coming weekend: from a weekday, a Saturday, a Sunday', () => {
    expect(weekendDays('2026-11-23')).toEqual(['2026-11-28', '2026-11-29']); // Monday
    expect(weekendDays('2026-11-27')).toEqual(['2026-11-28', '2026-11-29']); // Friday
    expect(weekendDays('2026-11-28')).toEqual(['2026-11-28', '2026-11-29']); // Saturday
    expect(weekendDays('2026-11-29')).toEqual(['2026-11-29']); // Sunday: just today
  });

  it('the Seats left tag: today, tomorrow, this week, then the date', () => {
    const mon = '2026-11-23';
    expect(dayTag('2026-11-23', mon)).toBe('TODAY');
    expect(dayTag('2026-11-24', mon)).toBe('TOMORROW');
    expect(dayTag('2026-11-28', mon)).toBe('THIS SATURDAY');
    expect(dayTag('2026-11-29', mon)).toBe('THIS SUNDAY');
    expect(dayTag('2026-11-30', mon)).toBe('MON 30 NOV');
    expect(dayTag('2026-12-05', mon)).toBe('SAT 5 DEC');
  });

  it('a day on This weekend', () => {
    expect(weekendDayLabel('2026-11-28')).toBe('SATURDAY 28 NOV');
    expect(weekendDayLabel('2027-01-03')).toBe('SUNDAY 3 JAN');
  });
});

describe('words', () => {
  it('a long name uses the short name, if there is one', () => {
    expect(posterTitle({ title: 'Lagos Island Heritage Walk', shortTitle: 'Heritage Walk' })).toBe(
      'Lagos Island Heritage Walk',
    );
    const long = 'Lekki Nature and Craft Half-Day with Hotel Pickup and Lunch';
    expect(posterTitle({ title: long, shortTitle: 'Lekki Nature & Craft' })).toBe(
      'Lekki Nature & Craft',
    );
    expect(posterTitle({ title: long, shortTitle: null })).toBe(long);
    // 48 characters exactly still fits.
    expect(posterTitle({ title: 'x'.repeat(48), shortTitle: 'y' })).toBe('x'.repeat(48));
  });

  it('seats, and the file name', () => {
    expect(seatsWords(4)).toBe('4 seats left');
    expect(seatsWords(1)).toBe('1 seat left');
    expect(posterFileName('heritage-walk', 'new_tour', 'square')).toBe(
      'heritage-walk-new-tour.png',
    );
    expect(posterFileName('irin', 'seats_left', 'story')).toBe('irin-seats-left-story.png');
  });
});
