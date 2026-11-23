/**
 * Stage 18c: the dashboard's words (design D1).
 */
import { describe, it, expect } from 'vitest';
import {
  barHeights,
  bookingsLine,
  changeWords,
  channelName,
  checkInsLine,
  dashboardView,
  departuresLine,
  moneyLine,
  shortDate,
} from '../src/dashboard.js';

describe('the lines under the numbers', () => {
  it('departures: under way, to come, ended; none today', () => {
    expect(departuresLine({ total: 3, underWay: 1, toCome: 2, ended: 0 })).toBe(
      '1 under way · 2 to come',
    );
    expect(departuresLine({ total: 2, underWay: 0, toCome: 0, ended: 2 })).toBe('2 ended');
    expect(departuresLine({ total: 0, underWay: 0, toCome: 0, ended: 0 })).toBe('None today');
  });

  it('bookings by channel, most first; an OTA by its name; none yet', () => {
    expect(
      bookingsLine([
        { name: 'whatsapp', count: 2 },
        { name: 'web', count: 4 },
        { name: 'Sojourna', count: 1 },
        { name: 'staff', count: 1 },
      ]),
    ).toBe('4 website · 2 WhatsApp · 1 Sojourna · 1 desk');
    expect(bookingsLine([])).toBe('None yet');
  });

  it('money: paid, and refunded when there were refunds; nothing yet', () => {
    expect(moneyLine({ in: 43_750_000, out: 2_500_000 })).toBe('₦437,500 paid · ₦25,000 refunded');
    expect(moneyLine({ in: 2_500_000, out: 0 })).toBe('₦25,000 paid');
    expect(moneyLine({ in: 0, out: 0 })).toBe('Nothing yet');
    expect(moneyLine({ in: 0, out: 500_000 })).toBe('₦0 paid · ₦5,000 refunded');
  });

  it('check-ins: how many not yet; everyone; no travellers', () => {
    expect(checkInsLine({ done: 38, total: 41 })).toBe('3 not yet');
    expect(checkInsLine({ done: 41, total: 41 })).toBe('Everyone’s in');
    expect(checkInsLine({ done: 0, total: 0 })).toBe('No travellers today');
  });
});

describe('the trend', () => {
  it('the change on the 30 days before; none when there was nothing before', () => {
    expect(changeWords(112, 100)).toEqual({ text: '+12%', tone: 'up' });
    expect(changeWords(91, 100)).toEqual({ text: '-9%', tone: 'down' });
    expect(changeWords(100, 100)).toEqual({ text: 'Same', tone: 'flat' });
    expect(changeWords(100.4, 100)).toEqual({ text: 'Same', tone: 'flat' });
    expect(changeWords(50, 0)).toBeNull();
    expect(changeWords(50, -10)).toBeNull();
  });

  it('bars: a share of the tallest day; a day of more refunds than money draws nothing', () => {
    expect(barHeights([50, 100, 25, -10])).toEqual(['50%', '100%', '25%', '0%']);
    expect(barHeights([0, 0])).toEqual(['0%', '0%']);
    expect(barHeights([-5])).toEqual(['0%']);
  });

  it('dates and channel names', () => {
    expect(shortDate('2026-10-25')).toBe('25 Oct');
    expect(channelName('web')).toBe('Website and widget');
    expect(channelName('whatsapp')).toBe('WhatsApp');
    expect(channelName('staff')).toBe('Booked at the desk');
    expect(channelName('Sojourna')).toBe('Sojourna');
  });
});

describe('dashboardView', () => {
  const days = Array.from({ length: 30 }, (_, i) => ({
    date: `2026-11-${String(i + 1).padStart(2, '0')}`,
    moneyIn: i === 29 ? 4_000_000 : 1_000_000,
    bookings: i % 2,
  }));
  const view = dashboardView({
    today: {
      date: '2026-11-30',
      departures: { total: 3, underWay: 1, toCome: 2, ended: 0 },
      bookings: { total: 7, byChannel: [{ name: 'web', count: 7 }] },
      money: { in: 4_375_000, out: 375_000 },
      checkIns: { done: 38, total: 41 },
    },
    days,
    previous: { moneyIn: 30_000_000, bookings: 20 },
    channels: [
      { name: 'whatsapp', bookings: 3, kobo: 100 },
      { name: 'web', bookings: 9, kobo: 200 },
      { name: 'Sojourna', bookings: 3, kobo: 900 },
    ],
    tours: [
      { title: 'Walk', sold: 9, capacity: 12 },
      { title: 'Boat', sold: 10, capacity: 10 },
      { title: 'Nothing yet', sold: 0, capacity: 0 },
    ],
  });

  it('the four tiles, in the design’s order', () => {
    expect(view.today).toEqual([
      { key: 'departures', label: 'Departures today', value: '3', note: '1 under way · 2 to come' },
      { key: 'bookings', label: 'Bookings today', value: '7', note: '7 website' },
      {
        key: 'money',
        label: 'Money in today',
        value: '₦40,000',
        note: '₦43,750 paid · ₦3,750 refunded',
      },
      { key: 'checkins', label: 'Checked in today', value: '38 of 41', note: '3 not yet' },
    ]);
  });

  it('the trend: totals, the change, 30 bars, the dates under them', () => {
    expect(view.money).toMatchObject({ total: '₦330,000', change: { text: '+10%', tone: 'up' } });
    expect(view.money.bars).toHaveLength(30);
    expect(view.money.bars.at(-1)).toBe('100%');
    expect(view.money.bars[0]).toBe('25%');
    expect(view.bookings).toMatchObject({ total: '15', change: { text: '-25%', tone: 'down' } });
    expect(view.range).toEqual({
      from: '1 Nov',
      middle: '16 Nov',
      to: 'Today',
      words: '1 Nov – 30 Nov',
    });
  });

  it('channels by bookings (then money); tours by how full, never one without seats', () => {
    expect(view.channels.map((c) => c.name)).toEqual([
      'Website and widget',
      'Sojourna',
      'WhatsApp',
    ]);
    expect(view.channels[0]).toEqual({ name: 'Website and widget', bookings: '9', money: '₦2' });
    expect(view.tours).toEqual([
      { title: 'Boat', fill: '100%' },
      { title: 'Walk', fill: '75%' },
    ]);
  });
});
