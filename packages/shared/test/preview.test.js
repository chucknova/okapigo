import { describe, it, expect } from 'vitest';
import { formatDuration, formatDay, truncate, tourPreviewDescription } from '../src/preview.js';

describe('formatDuration', () => {
  it('says hours and minutes the way people do', () => {
    expect(formatDuration(180)).toBe('3 hours');
    expect(formatDuration(60)).toBe('1 hour');
    expect(formatDuration(210)).toBe('3 h 30 min');
    expect(formatDuration(45)).toBe('45 min');
    expect(formatDuration(600)).toBe('10 hours');
  });
});

describe('formatDay', () => {
  it('shows the Lagos day, even when it is another day in UTC', () => {
    // 23:30 UTC on Fri 4 Dec is 00:30 on Sat 5 Dec in Lagos (UTC+1).
    expect(formatDay(new Date('2026-12-04T23:30:00Z'), 'Africa/Lagos')).toBe('Sat 5 Dec');
  });
});

describe('truncate', () => {
  it('leaves short text alone and tidies spaces', () => {
    expect(truncate('  Walk   Lagos  ', 50)).toBe('Walk Lagos');
  });

  it('cuts at a word, without a dangling comma, and adds an ellipsis', () => {
    const text = 'Walk the old city, meet its traders, and eat well along the way';
    const short = truncate(text, 40);
    expect(short).toBe('Walk the old city, meet its traders…');
    expect(short.length).toBeLessThanOrEqual(40);
  });
});

describe('tourPreviewDescription', () => {
  it('puts the summary first, then price, duration and the next date', () => {
    expect(
      tourPreviewDescription({
        summary: 'A full day in Badagry.',
        fromPriceKobo: 6_500_000,
        durationMinutes: 600,
        nextDay: 'Sat 5 Dec',
      }),
    ).toBe('A full day in Badagry. · From ₦65,000 · 10 hours · Next: Sat 5 Dec');
  });

  it('leaves out what is unknown (no price, no upcoming date)', () => {
    expect(
      tourPreviewDescription({
        summary: 'Coming soon.',
        fromPriceKobo: null,
        durationMinutes: 180,
        nextDay: null,
      }),
    ).toBe('Coming soon. · 3 hours');
  });
});
