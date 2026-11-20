// @ts-check
/**
 * sync.js — keeps this phone and the server in step (OPS-09; flow brief 07, section 4).
 *
 *   record(change)   a tap that changes something: saved in the outbox FIRST, then sent
 *   sync()           send the outbox (oldest first, in batches), then fetch conflicts and a
 *                    fresh package. Runs on its own: after each change, when signal comes
 *                    back, and every few minutes.
 *   dismiss(id)      "OK" on a conflict           useMine(c)  send mine again, after theirs
 *
 * Nothing waits for the network: a change is safe once it's in the store (IndexedDB), and
 * the screens show the outbox on top of the saved package (outbox.js). If the signal drops
 * halfway through sending, the answers that arrived are kept and the rest go next time;
 * a change sent twice is applied once (each carries its own id, 15b).
 *
 * The engine holds the state the screens read (connection, outbox, conflicts, saved time)
 * and tells subscribers when it changes. Every outside thing it uses is passed in (the
 * request function, the store, the clock, "am I online?", timers), so tests can drive it.
 */
import { ApiError } from './api.js';
import { makeChange } from './outbox.js';

/** Changes per request: the server takes up to 500 (15b); smaller batches mean less to resend. */
export const BATCH = 100;
/** How often to refresh while the app is open ("every few minutes", brief section 4). */
export const REFRESH_EVERY_MS = 3 * 60_000;
/** After "can't reach OkapiGo": try again in 30 s (designs: Sync edge cases). */
export const RETRY_UNREACHABLE_MS = 30_000;
/** After "OkapiGo is having trouble": a little longer. */
export const RETRY_SERVER_MS = 60_000;
/** How many sent changes O5 still lists ("present · sent"). */
const KEEP_SENT = 20;

/**
 * @typedef {'online' | 'offline' | 'unreachable' | 'server'} Connection
 * @typedef {{
 *   ready: boolean,
 *   session: any,                 // { token, user, contact } or null
 *   signedOut: boolean,           // the sign-in ran out; changes wait for a new one
 *   pkg: any,                     // the saved offline package, or null
 *   etag: string | null,
 *   savedAt: string | null,       // when the package last came from the server
 *   outbox: any[],
 *   sending: { total: number, done: number } | null,
 *   sent: any[],                  // the last few sent, newest last, with their outcome
 *   conflicts: any[],
 *   lastSentAt: string | null,
 *   lastTriedAt: string | null,
 *   connection: Connection,
 *   retryAt: string | null,
 *   firstRunDone: boolean,        // "You're ready for no signal" has been seen
 *   me: any,                      // /api/me: user, operator, permissions, owner (16a)
 * }} SyncState
 */

/**
 * @param {{
 *   request: typeof import('./api.js').request,
 *   store: import('./store.js').Store,
 *   now?: () => Date,
 *   online?: () => boolean,
 *   setTimer?: (fn: () => void, ms: number) => any,
 *   clearTimer?: (t: any) => void,
 * }} deps
 */
export function createSyncEngine({
  request,
  store,
  now = () => new Date(),
  online = () => globalThis.navigator?.onLine ?? true,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (t) => clearTimeout(t),
}) {
  /** @type {SyncState} */
  let state = {
    ready: false,
    session: null,
    signedOut: false,
    pkg: null,
    etag: null,
    savedAt: null,
    outbox: [],
    sending: null,
    sent: [],
    conflicts: [],
    lastSentAt: null,
    lastTriedAt: null,
    connection: online() ? 'online' : 'offline',
    retryAt: null,
    firstRunDone: false,
    me: null,
  };
  /** @type {Set<() => void>} */
  const listeners = new Set();
  /** @type {Promise<void> | null} */
  let running = null;
  let again = false;
  /** @type {any} */
  let retryTimer = null;

  /** @param {Partial<SyncState>} patch */
  const set = (patch) => {
    state = { ...state, ...patch };
    for (const fn of listeners) fn();
  };
  const token = () => state.session?.token ?? null;
  /** @param {string} path @param {any} [o] */
  const call = (path, o = {}) => request(path, { token: token(), online, ...o });

  async function load() {
    const [session, saved, outbox, conflicts, sent, meta, me] = await Promise.all([
      store.get('session'),
      store.get('package'),
      store.get('outbox'),
      store.get('conflicts'),
      store.get('sent'),
      store.get('meta'),
      store.get('me'),
    ]);
    set({
      ready: true,
      session: session ?? null,
      signedOut: Boolean(meta?.signedOut),
      pkg: saved?.data ?? null,
      etag: saved?.etag ?? null,
      savedAt: saved?.savedAt ?? null,
      outbox: outbox ?? [],
      conflicts: conflicts ?? [],
      sent: sent ?? [],
      lastSentAt: meta?.lastSentAt ?? null,
      firstRunDone: Boolean(meta?.firstRunDone),
      me: me ?? null,
    });
  }

  /** @param {Partial<{ lastSentAt: string | null, signedOut: boolean, firstRunDone: boolean }>} patch */
  async function saveMeta(patch) {
    const meta = { ...((await store.get('meta')) ?? {}), ...patch };
    await store.set('meta', meta);
  }

  /**
   * A tap that changes something. In the store before anything else happens: once this
   * resolves, the change survives the phone being switched off.
   * @param {Parameters<typeof makeChange>[0]} what
   */
  async function record(what) {
    const change = makeChange(what, { now: now() });
    // Change the outbox in memory in ONE step (nothing can run in between), then save what
    // it holds now. Reading it, waiting to save, then writing it back would lose whatever
    // changed during the wait: a second quick tap, or answers arriving (found in 15c-2).
    set({ outbox: [...state.outbox, change] });
    await store.set('outbox', state.outbox);
    // Send it now. If a sync is already running, it goes round once more.
    if (running) again = true;
    else void sync();
    return change;
  }

  /**
   * Sends the outbox and refreshes. One at a time: called while running, it returns the run
   * in progress (a change recorded meanwhile makes that run go round once more).
   */
  function sync() {
    if (running) return running;
    running = (async () => {
      try {
        do {
          again = false;
          await syncOnce();
        } while (again);
      } finally {
        running = null;
      }
    })();
    return running;
  }

  async function syncOnce() {
    if (!state.session || state.signedOut) return;
    if (!online()) return set({ connection: 'offline', sending: null });
    clearTimer(retryTimer);
    set({ lastTriedAt: now().toISOString(), retryAt: null });
    try {
      await sendOutbox();
      await fetchConflicts();
      await refreshPackage();
      await refreshMe();
      set({ connection: 'online' });
    } catch (err) {
      failed(err);
    } finally {
      set({ sending: null });
    }
  }

  async function sendOutbox() {
    const total = state.outbox.length;
    if (total === 0) return;
    set({ sending: { total, done: 0 } });
    while (state.outbox.length > 0) {
      const batch = state.outbox.slice(0, BATCH);
      const { body } = await call('/api/sync/changes', {
        method: 'POST',
        body: { changes: batch },
      });
      // Every change that got an answer leaves the outbox: applied, rejected, or a conflict
      // (conflicts are fetched next, with their reasons). Only unanswered ones stay.
      const answers = new Map(body.results.map((/** @type {any} */ r) => [r.id, r]));
      const answered = batch.filter((c) => answers.has(c.id));
      const lastSentAt = now().toISOString();
      // In memory first, in one step; then saved (see record: no update lost in between).
      set({
        outbox: state.outbox.filter((c) => !answers.has(c.id)),
        sent: [
          ...state.sent,
          ...answered.map((c) => ({ ...c, outcome: answers.get(c.id).outcome })),
        ].slice(-KEEP_SENT),
        lastSentAt,
      });
      // Sent so far, and so far + still waiting (a tap meanwhile joins the count).
      const done = (state.sending?.done ?? 0) + answered.length;
      set({ sending: { done, total: done + state.outbox.length } });
      await store.set('outbox', state.outbox);
      await store.set('sent', state.sent);
      await saveMeta({ lastSentAt });
      if (answered.length === 0) break; // nothing answered: don't loop forever
    }
  }

  async function fetchConflicts() {
    const { body } = await call('/api/sync/conflicts');
    await store.set('conflicts', body.conflicts);
    set({ conflicts: body.conflicts });
  }

  /**
   * Who's signed in, their role's permissions, and the business's owner (16a): which screens
   * this person may open. Saved, so the right tabs show offline too.
   */
  async function refreshMe() {
    const { body } = await call('/api/me');
    await store.set('me', body);
    set({ me: body });
  }

  async function refreshPackage() {
    // The phone says how many changes are still waiting (the manager's "Guides’ phones", 16a).
    const res = await call('/api/sync/package', {
      etag: state.etag,
      headers: { 'X-Outbox-Waiting': String(state.outbox.length) },
    });
    const savedAt = now().toISOString();
    if (res.status === 304) {
      // Nothing changed since our copy: it's confirmed up to date as of now.
      await store.set('package', { data: state.pkg, etag: state.etag, savedAt });
      return set({ savedAt });
    }
    await store.set('package', { data: res.body.package, etag: res.etag, savedAt });
    set({ pkg: res.body.package, etag: res.etag, savedAt });
  }

  /** @param {unknown} err */
  function failed(err) {
    if (!(err instanceof ApiError)) throw err; // our own bug: let it show
    if (err.kind === 'offline') return set({ connection: 'offline' });
    if (err.kind === 'signed-out') {
      void saveMeta({ signedOut: true });
      return set({ signedOut: true, connection: 'online' });
    }
    const ms = err.kind === 'server' ? RETRY_SERVER_MS : RETRY_UNREACHABLE_MS;
    set({
      connection: err.kind === 'server' ? 'server' : 'unreachable',
      retryAt: new Date(now().getTime() + ms).toISOString(),
    });
    retryTimer = setTimer(() => void sync(), ms);
  }

  /**
   * "OK" on a conflict: it's been seen. Needs signal (it's the server's list).
   * `cashReturned`: "I gave the cash back" on a possible double payment (15c-4).
   * @param {string} id @param {{ cashReturned?: boolean }} [o]
   */
  async function dismiss(id, { cashReturned = false } = {}) {
    await call(`/api/sync/conflicts/${id}/dismiss`, {
      method: 'POST',
      ...(cashReturned ? { body: { cashReturned: true } } : {}),
    });
    const conflicts = state.conflicts.filter((c) => c.id !== id);
    await store.set('conflicts', conflicts);
    set({ conflicts });
  }

  /**
   * "Use mine" (someone else changed the traveller first): send my change again, now
   * knowing what the server has, so it goes in after theirs. Then the conflict is done.
   * @param {any} conflict
   */
  async function useMine(conflict) {
    const { payload, data, departureId } = conflict;
    /** @type {Record<string, string>} */
    const seen = { ...(payload.seen ?? {}) };
    if (data?.travellerId) seen[data.travellerId] = data.status;
    await record({ ...payload, kind: 'check_in', departureId, seen });
    await dismiss(conflict.id);
  }

  /**
   * Signed in (the first time, or again after the 30 days ran out offline). Changes made
   * before keep waiting and go out as this person.
   * @param {any} session
   */
  async function signedIn(session) {
    await store.set('session', session);
    await saveMeta({ signedOut: false });
    set({ session, signedOut: false });
    await sync();
  }

  /** First run finished ("Go to Today"): not shown again on this phone. */
  async function finishFirstRun() {
    await saveMeta({ firstRunDone: true });
    set({ firstRunDone: true });
  }

  /** The phone's connection changed (the browser's online / offline events). */
  function connectionChanged() {
    if (online()) void sync();
    else set({ connection: 'offline' });
  }

  return {
    getState: () => state,
    /** @param {() => void} fn */
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    load,
    record,
    sync,
    dismiss,
    useMine,
    signedIn,
    finishFirstRun,
    connectionChanged,
  };
}

/** @typedef {ReturnType<typeof createSyncEngine>} SyncEngine */
