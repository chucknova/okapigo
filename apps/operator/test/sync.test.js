/**
 * The sync engine (15c-1): the phone's outbox and saved package, against a fake server.
 *   - a change is in the store before anything is sent; then sent by itself, oldest first
 *   - the signal drops halfway: what was answered is kept, the rest goes next time
 *   - conflicts and a fresh package after sending; 304 keeps the saved copy
 *   - offline, can't reach us, our server broken, signed out: each remembered, nothing lost
 *   - "OK" and "Use mine" on a conflict
 */
import { describe, it, expect } from 'vitest';
import { ApiError } from '../src/lib/api.js';
import { createMemoryStore } from '../src/lib/store.js';
import { createSyncEngine, BATCH, RETRY_UNREACHABLE_MS } from '../src/lib/sync.js';
import { makePackage } from './fixtures.js';

/** A fake API: records what it was sent; `mode` makes it fail. */
function fakeServer() {
  const server = {
    /** @type {'ok' | 'offline' | 'unreachable' | 'server' | 'signed-out'} */
    mode: 'ok',
    /** Answer this many changes in all, then drop the connection (signal lost mid-send). */
    answerOnly: Infinity,
    /** @type {any[]} */
    received: [],
    /** @type {any[]} */
    conflicts: [],
    pkg: makePackage(),
    etag: 'W/"v1"',
    /** @type {string[]} */
    calls: [],
    /** @type {string[]} */
    dismissed: [],
    /** @type {Record<string, string>} */
    outcomes: {},
  };
  /** @type {typeof import('../src/lib/api.js').request} */
  const request = async (path, o = {}) => {
    server.calls.push(`${o.method ?? 'GET'} ${path}`);
    if (o.online && !o.online()) throw new ApiError('offline', 'Offline');
    if (server.mode === 'offline') throw new ApiError('offline', 'Offline');
    if (server.mode === 'unreachable') throw new ApiError('unreachable', 'Can’t reach OkapiGo');
    if (server.mode === 'server') throw new ApiError('server', 'trouble', { status: 503 });
    if (server.mode === 'signed-out')
      throw new ApiError('signed-out', 'Sign in again', { status: 401 });
    if (o.token !== 'tok') throw new Error('no token sent');
    if (path === '/api/sync/changes') {
      const { changes } = /** @type {any} */ (o.body);
      if (server.answerOnly <= 0) throw new ApiError('unreachable', 'dropped');
      const answered = changes.slice(0, server.answerOnly);
      server.answerOnly -= answered.length;
      server.received.push(...answered);
      return {
        status: 200,
        etag: null,
        body: {
          results: answered.map((/** @type {any} */ c) => ({
            id: c.id,
            outcome: server.outcomes[c.id] ?? 'applied',
          })),
        },
      };
    }
    if (path === '/api/sync/conflicts')
      return { status: 200, etag: null, body: { conflicts: server.conflicts } };
    if (path.startsWith('/api/sync/conflicts/')) {
      server.dismissed.push(path.split('/')[4]);
      return { status: 204, etag: null, body: null };
    }
    if (path === '/api/sync/package') {
      if (o.etag === server.etag) return { status: 304, etag: server.etag, body: null };
      return { status: 200, etag: server.etag, body: { package: server.pkg } };
    }
    throw new Error(`unexpected ${path}`);
  };
  return { server, request };
}

async function setup({ outbox = /** @type {any[]} */ ([]), online = true } = {}) {
  const { server, request } = fakeServer();
  const store = createMemoryStore({
    session: { token: 'tok', user: { name: 'Femi' }, contact: 'femi@irin.example' },
    outbox,
  });
  let clock = new Date('2026-12-05T07:00:00+01:00');
  const net = { online };
  /** @type {Array<{ fn: () => void, ms: number }>} */
  const timers = [];
  const engine = createSyncEngine({
    request,
    store,
    now: () => clock,
    online: () => net.online,
    setTimer: (fn, ms) => timers.push({ fn, ms }),
    clearTimer: () => {},
  });
  await engine.load();
  return {
    server,
    store,
    engine,
    net,
    timers,
    tick: (/** @type {number} */ ms) => (clock = new Date(clock.getTime() + ms)),
  };
}

const checkIn = (/** @type {string} */ t) => ({
  kind: /** @type {const} */ ('check_in'),
  departureId: 'dep-badagry',
  bookingId: 'b-okafor',
  travellerIds: [t],
  status: 'present',
  seen: { [t]: 'pending' },
});

describe('record: saved first, sent by itself', () => {
  it('offline: kept in the store and the outbox, nothing sent; sent when signal returns', async () => {
    const s = await setup({ online: false });
    const change = await s.engine.record(checkIn('t-adaeze'));
    expect(change).toMatchObject({ id: expect.any(String), at: '2026-12-05T06:00:00.000Z' });
    expect(await s.store.get('outbox')).toEqual([change]);
    await s.engine.sync();
    expect(s.server.calls).toEqual([]);
    expect(s.engine.getState()).toMatchObject({ connection: 'offline', outbox: [change] });

    s.net.online = true;
    s.engine.connectionChanged();
    await s.engine.sync();
    expect(s.server.received).toEqual([change]);
    expect(s.engine.getState()).toMatchObject({ connection: 'online', outbox: [], sending: null });
    expect(await s.store.get('outbox')).toEqual([]);
    expect(s.engine.getState().sent.at(-1)).toMatchObject({ id: change.id, outcome: 'applied' });
    expect(s.engine.getState().lastSentAt).toBe('2026-12-05T06:00:00.000Z');
  });

  it('online: sent, then conflicts, then the package, in that order; the package saved with its time', async () => {
    const s = await setup();
    await s.engine.record(checkIn('t-adaeze'));
    await s.engine.sync();
    expect(s.server.calls).toEqual([
      'POST /api/sync/changes',
      'GET /api/sync/conflicts',
      'GET /api/sync/package',
    ]);
    expect(await s.store.get('package')).toEqual({
      data: s.server.pkg,
      etag: 'W/"v1"',
      savedAt: '2026-12-05T06:00:00.000Z',
    });
  });
});

describe('two quick taps', () => {
  it('both kept, in order (each waits for the one before to be saved)', async () => {
    const s = await setup({ online: false });
    const [a, b, c] = await Promise.all([
      s.engine.record(checkIn('t-adaeze')),
      s.engine.record(checkIn('t-chidi')),
      s.engine.record(checkIn('t-kamsi')),
    ]);
    expect(s.engine.getState().outbox.map((x) => x.id)).toEqual([a.id, b.id, c.id]);
    expect((await s.store.get('outbox')).map((/** @type {any} */ x) => x.id)).toEqual([
      a.id,
      b.id,
      c.id,
    ]);
  });
});

describe('sending', () => {
  it('oldest first, in batches; every change once', async () => {
    const outbox = Array.from({ length: BATCH + 5 }, (_, i) => ({
      ...checkIn('t-adaeze'),
      id: `c${i}`,
      at: new Date(Date.UTC(2026, 11, 5, 6, 0, i)).toISOString(),
    }));
    const s = await setup({ outbox });
    await s.engine.sync();
    expect(s.server.calls.filter((c) => c.startsWith('POST'))).toHaveLength(2);
    expect(s.server.received.map((c) => c.id)).toEqual(outbox.map((c) => c.id));
  });

  it('the signal drops halfway: answered ones leave the outbox, the rest go next time', async () => {
    const outbox = ['c1', 'c2', 'c3'].map((id) => ({
      ...checkIn('t-adaeze'),
      id,
      at: '2026-12-05T06:00:00.000Z',
    }));
    const s = await setup({ outbox });
    s.server.answerOnly = 2;
    await s.engine.sync();
    // Two answered; the third request got nothing back: "can't reach OkapiGo", try again in 30 s.
    expect(s.engine.getState().outbox.map((c) => c.id)).toEqual(['c3']);
    expect(await s.store.get('outbox')).toHaveLength(1);
    expect(s.engine.getState()).toMatchObject({
      connection: 'unreachable',
      retryAt: '2026-12-05T06:00:30.000Z',
    });
    expect(s.timers.at(-1)?.ms).toBe(RETRY_UNREACHABLE_MS);

    s.server.answerOnly = Infinity;
    s.timers.at(-1)?.fn();
    await s.engine.sync();
    expect(s.server.received.map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
    expect(s.engine.getState().outbox).toEqual([]);
  });

  it('a conflict leaves the outbox too, and comes back with its reason from the server', async () => {
    const s = await setup();
    const c = await s.engine.record(checkIn('t-adaeze'));
    s.server.outcomes[c.id] = 'conflict';
    s.server.conflicts = [
      { id: 'srv-1', changeId: c.id, code: 'BOOKING_CANCELLED', explanation: { title: 'x' } },
    ];
    await s.engine.sync();
    expect(s.engine.getState().outbox).toEqual([]);
    expect(s.engine.getState().conflicts).toEqual(s.server.conflicts);
    expect(await s.store.get('conflicts')).toEqual(s.server.conflicts);
  });

  it('a change made while sending goes out too, in the same run', async () => {
    const s = await setup();
    const first = s.engine.record(checkIn('t-adaeze'));
    const second = s.engine.record(checkIn('t-chidi'));
    await Promise.all([first, second]);
    await s.engine.sync();
    expect(s.server.received.map((c) => c.travellerIds[0])).toEqual(['t-adaeze', 't-chidi']);
  });
});

describe('the package', () => {
  it('304 Not Modified: the saved copy stays, confirmed up to date now', async () => {
    const s = await setup();
    await s.engine.sync();
    s.tick(5 * 60_000);
    await s.engine.sync();
    expect(s.engine.getState().savedAt).toBe('2026-12-05T06:05:00.000Z');
    expect(s.engine.getState().pkg).toEqual(s.server.pkg);
  });
});

describe('when it can’t sync: remembered, nothing lost', () => {
  it('our server broken: "having trouble", retried in a minute; the outbox kept', async () => {
    const s = await setup();
    s.server.mode = 'server';
    await s.engine.record(checkIn('t-adaeze'));
    await s.engine.sync();
    expect(s.engine.getState()).toMatchObject({ connection: 'server' });
    expect(s.engine.getState().outbox).toHaveLength(1);
    expect(s.timers.at(-1)?.ms).toBe(60_000);
  });

  it('the sign-in ran out: changes wait; after signing in again they go, as that person', async () => {
    const s = await setup();
    s.server.mode = 'signed-out';
    const c = await s.engine.record(checkIn('t-adaeze'));
    await s.engine.sync();
    expect(s.engine.getState()).toMatchObject({ signedOut: true, outbox: [c] });
    expect((await s.store.get('meta')).signedOut).toBe(true);
    // Nothing is tried while signed out.
    const before = s.server.calls.length;
    await s.engine.sync();
    expect(s.server.calls.length).toBe(before);

    s.server.mode = 'ok';
    await s.engine.signedIn({ token: 'tok', user: { name: 'Femi' }, contact: 'femi@irin.example' });
    expect(s.engine.getState()).toMatchObject({ signedOut: false, outbox: [] });
    expect(s.server.received).toEqual([c]);
  });

  it('everything survives the app being closed and opened again', async () => {
    const s = await setup({ online: false });
    const c = await s.engine.record(checkIn('t-adaeze'));
    const reopened = createSyncEngine({
      request: async () => ({ status: 200, body: null, etag: null }),
      store: s.store,
    });
    await reopened.load();
    expect(reopened.getState()).toMatchObject({
      ready: true,
      outbox: [c],
      session: { token: 'tok' },
    });
  });
});

describe('conflicts: OK and Use mine', () => {
  it('OK: dismissed on the server, gone here', async () => {
    const s = await setup();
    s.server.conflicts = [{ id: 'srv-1' }, { id: 'srv-2' }];
    await s.engine.sync();
    s.server.conflicts = [{ id: 'srv-2' }];
    await s.engine.dismiss('srv-1');
    expect(s.server.dismissed).toEqual(['srv-1']);
    expect(s.engine.getState().conflicts).toEqual([{ id: 'srv-2' }]);
  });

  it('Use mine: my change again, now knowing theirs ("seen" = what the server has), then dismissed', async () => {
    const s = await setup();
    const conflict = {
      id: 'srv-1',
      departureId: 'dep-badagry',
      payload: {
        bookingId: 'b-okafor',
        travellerIds: ['t-adaeze'],
        status: 'present',
        seen: { 't-adaeze': 'pending' },
      },
      data: { travellerId: 't-adaeze', status: 'late' },
    };
    s.server.conflicts = [conflict];
    await s.engine.sync();
    s.server.conflicts = [];
    await s.engine.useMine(conflict);
    await s.engine.sync();
    expect(s.server.received.at(-1)).toMatchObject({
      kind: 'check_in',
      departureId: 'dep-badagry',
      bookingId: 'b-okafor',
      status: 'present',
      seen: { 't-adaeze': 'late' },
    });
    expect(s.server.dismissed).toEqual(['srv-1']);
  });
});
