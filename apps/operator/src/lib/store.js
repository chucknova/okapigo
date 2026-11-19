// @ts-check
/**
 * store.js — what the phone keeps between visits, with or without signal.
 *
 * IndexedDB, the browser's database: unlike localStorage it holds megabytes, survives the app
 * being closed, and can be asked to stay (navigator.storage.persist(), "the phone may clear
 * saved manifests" otherwise: designs, First run).
 *
 * Just a few keys, each holding one value:
 *   session     { token, user, contact }              who's signed in (30 days)
 *   package     { data, etag, savedAt }               today's and tomorrow's departures (15b)
 *   outbox      [change, …]                           done here, not sent yet: oldest first
 *   conflicts   [conflict, …]                         sent, couldn't be applied: to look at
 *   sent        [change, …]                           the last few sent (O5's "sent" rows)
 *   meta        { lastSentAt, firstRun, … }
 *
 * Tests use createMemoryStore(): the same four methods, kept in a Map.
 */

/**
 * @typedef {{
 *   get: (key: string) => Promise<any>,
 *   set: (key: string, value: any) => Promise<void>,
 *   del: (key: string) => Promise<void>,
 *   clear: () => Promise<void>,
 * }} Store
 */

/** @returns {Store} */
export function createMemoryStore(initial = {}) {
  const map = new Map(Object.entries(initial));
  // structuredClone: like IndexedDB, a stored value is a copy (changing it later changes nothing).
  return {
    get: async (key) => (map.has(key) ? structuredClone(map.get(key)) : undefined),
    set: async (key, value) => void map.set(key, structuredClone(value)),
    del: async (key) => void map.delete(key),
    clear: async () => map.clear(),
  };
}

const DB = 'okapigo';
const TABLE = 'kv';

/** @returns {Promise<IDBDatabase>} */
function open() {
  return new Promise((resolve, reject) => {
    const req = globalThis.indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(TABLE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * @template T
 * @param {Promise<IDBDatabase>} db
 * @param {IDBTransactionMode} mode
 * @param {(t: IDBObjectStore) => IDBRequest<T>} fn
 * @returns {Promise<T>}
 */
async function run(db, mode, fn) {
  const t = (await db).transaction(TABLE, mode);
  const req = fn(t.objectStore(TABLE));
  return new Promise((resolve, reject) => {
    // Resolve when the transaction COMMITS, not when the request succeeds: only then is it
    // really on disk (a crash in between would lose a check-in otherwise).
    t.oncomplete = () => resolve(req.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

/** @returns {Store} */
export function createIdbStore() {
  const db = open();
  return {
    get: (key) => run(db, 'readonly', (t) => t.get(key)),
    set: async (key, value) => void (await run(db, 'readwrite', (t) => t.put(value, key))),
    del: async (key) => void (await run(db, 'readwrite', (t) => t.delete(key))),
    clear: async () => void (await run(db, 'readwrite', (t) => t.clear())),
  };
}

/**
 * Asks the browser to keep our data even when the phone is short of space. Installed apps
 * usually get it; in a plain browser tab it may say no (then First run asks to install).
 * @returns {Promise<boolean>}
 */
export async function askToKeepData() {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
