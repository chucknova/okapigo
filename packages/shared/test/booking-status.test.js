import { describe, it, expect } from 'vitest';
import {
  BOOKING_STATUSES,
  TRANSITIONS,
  SEAT_CONSUMING_STATUSES,
  FINAL_STATUSES,
  canTransition,
} from '../src/booking-status.js';
import { generateReference, referencePrefix } from '../src/reference.js';

describe('booking lifecycle', () => {
  it.each([
    ['held', 'confirmed'],
    ['held', 'paid'],
    ['held', 'cancelled'],
    ['confirmed', 'part_paid'],
    ['part_paid', 'paid'],
    ['paid', 'completed'],
    ['paid', 'no_show'],
    ['cancelled', 'refunded'],
    ['amended', 'paid'],
  ])('allows %s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it.each([
    ['held', 'completed'], // can't complete a tour nobody paid for or confirmed
    ['held', 'no_show'],
    ['paid', 'held'], // no going backwards
    ['cancelled', 'paid'], // a cancelled booking stays cancelled
    ['refunded', 'paid'],
    ['completed', 'cancelled'],
    ['paid', 'paid'], // "changing" to the same status isn't a transition
    ['held', 'nonsense'],
  ])('forbids %s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });

  it('only lists known statuses as targets', () => {
    for (const targets of Object.values(TRANSITIONS)) {
      for (const to of targets) expect(BOOKING_STATUSES).toContain(to);
    }
  });

  it('every status can be reached from "held" (no dead definitions)', () => {
    const reached = new Set(['held']);
    const queue = ['held'];
    while (queue.length) {
      for (const next of TRANSITIONS[queue.shift()]) {
        if (!reached.has(next)) reached.add(next) && queue.push(next);
      }
    }
    expect([...reached].sort()).toEqual([...BOOKING_STATUSES].sort());
  });

  it('completed and refunded are final', () => {
    expect(FINAL_STATUSES).toEqual(['completed', 'refunded']);
  });

  it('held and cancelled bookings do not occupy sold seats', () => {
    expect(SEAT_CONSUMING_STATUSES).not.toContain('held');
    expect(SEAT_CONSUMING_STATUSES).not.toContain('cancelled');
    expect(SEAT_CONSUMING_STATUSES).toContain('no_show'); // the tour ran with their seat empty
  });
});

describe('booking references', () => {
  it('uses initials of the operator slug as the prefix', () => {
    expect(referencePrefix('irin-lagos-tours')).toBe('ILT');
    expect(referencePrefix('osun-trails')).toBe('OT');
  });

  it('skips words that start with a digit (references are letters-dash-code)', () => {
    expect(referencePrefix('lagos-360-tours')).toBe('LT');
    expect(referencePrefix('test-3f9a1c2b')).toBe('T');
    expect(referencePrefix('360-degrees')).toBe('D');
    expect(referencePrefix('2024')).toBe('BK'); // nothing usable: a safe default
  });

  it('looks like ILT-7K4Q2M and never uses I, L, O or U in the code', () => {
    for (let i = 0; i < 200; i++) {
      const ref = generateReference('ILT');
      expect(ref).toMatch(/^ILT-[0-9A-HJKMNP-TV-Z]{6}$/);
    }
  });
});
