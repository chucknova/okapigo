/** The connection strip's words (designs: tokens v1, O2 states, Sync edge cases). */
import { describe, it, expect } from 'vitest';
import { stripFor, goodUntil, isStale } from '../src/lib/status.js';
import { TZ } from './fixtures.js';

const now = new Date('2026-12-05T07:06:00+01:00');
/** @param {Partial<import('../src/lib/sync.js').SyncState>} o */
const state = (o = {}) => ({
  ready: true,
  session: { token: 't' },
  signedOut: false,
  pkg: null,
  etag: null,
  savedAt: '2026-12-05T05:40:00.000Z',
  outbox: [],
  sending: null,
  sent: [],
  conflicts: [],
  lastSentAt: null,
  lastTriedAt: null,
  connection: 'online',
  retryAt: null,
  ...o,
});
const three = [{}, {}, {}];

describe('stripFor', () => {
  it('each state, in the designs’ words', () => {
    const t = (/** @type {any} */ o) => stripFor(state(o), now, TZ);
    expect(t({})).toEqual({ tone: 'online', icon: 'dot', text: 'Online · up to date 06:40' });
    expect(t({ connection: 'offline', outbox: three })).toEqual({
      tone: 'offline',
      icon: 'wifi-off',
      text: 'Offline · saved 06:40 · 3 changes waiting',
    });
    expect(t({ connection: 'offline' }).text).toBe('Offline · saved 06:40');
    expect(t({ sending: { total: 3, done: 1 } })).toEqual({
      tone: 'sending',
      icon: 'sync',
      text: 'Sending 2 changes…',
    });
    expect(t({ conflicts: [{}] })).toEqual({
      tone: 'conflict',
      icon: 'alert',
      text: '1 change needs a look · tap',
    });
    expect(t({ conflicts: [{}, {}] }).text).toBe('2 changes need a look · tap');
    expect(t({ signedOut: true, outbox: [...three, ...three] }).text).toBe(
      'Online · 6 changes waiting to send',
    );
    expect(t({ connection: 'unreachable', retryAt: '2026-12-05T06:06:30.000Z' }).text).toBe(
      'Can’t reach OkapiGo · trying again in 30 s',
    );
    expect(t({ connection: 'server' }).text).toBe(
      'OkapiGo is having trouble · your changes are safe',
    );
  });

  it('most urgent first: sending, then a conflict, then offline', () => {
    expect(stripFor(state({ sending: { total: 1, done: 0 }, conflicts: [{}] }), now, TZ).tone).toBe(
      'sending',
    );
    expect(stripFor(state({ conflicts: [{}], connection: 'offline' }), now, TZ).tone).toBe(
      'conflict',
    );
  });

  it('offline with a copy older than 72 hours: out of date, in red', () => {
    const later = new Date('2026-12-08T09:00:00+01:00');
    expect(stripFor(state({ connection: 'offline' }), later, TZ)).toEqual({
      tone: 'conflict',
      icon: 'wifi-off',
      text: 'Offline for 3 days · saved copy is out of date',
    });
    expect(isStale(state(), new Date('2026-12-08T06:39:00+01:00'))).toBe(false);
    expect(isStale(state(), new Date('2026-12-08T06:41:00+01:00'))).toBe(true);
  });

  it('good until: 72 hours after it was saved', () => {
    expect(goodUntil('2026-12-05T05:40:00.000Z', TZ)).toBe('Tue 8 Dec, 06:40');
  });
});
