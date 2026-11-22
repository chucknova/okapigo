// @ts-check
/**
 * store.js — what Sojourna keeps of its own: its bookings (its reference "SJ-48213", the OCTO
 * booking's uuid, who booked). Everything else about a booking (its status, the ticket, the
 * date) is the supplier's, asked for through OCTO when a page needs it, so the two never
 * disagree.
 *
 * A JSON file is plenty for a pretend website: a handful of bookings, one process. It's
 * written whole each time, to a temporary file first and then renamed over the old one, so a
 * crash mid-write never leaves half a file.
 *
 *   createStore(file)   all(), byRef(ref), add(booking), update(ref, patch)
 *                       noteSync(at), lastSyncAt(): when the supplier last answered or told
 *                       Sojourna something (the back office's "last sync 10:42", 17d-2)
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * @typedef {{
 *   ref: string,             "SJ-48213": Sojourna's reference, what its guest sees
 *   uuid: string,            the OCTO booking's uuid (Sojourna made it, when it reserved)
 *   productId: string,
 *   supplierReference: string,   "ILT-6WQ3PZ": the supplier's reference
 *   lead: { name: string, email: string, phone: string | null },
 *   createdAt: string,
 *   cancelledAt?: string,        when Sojourna cancelled it (its guest asked): any other
 *                                cancellation was the supplier's (17d-2)
 * }} StoredBooking
 */

/** @param {string} file */
export function createStore(file) {
  /** @type {{ bookings: StoredBooking[], lastSyncAt?: string | null }} */
  let data = { bookings: [], lastSyncAt: null };
  try {
    data = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    // No file yet (or an unreadable one): start empty.
  }
  const save = () => {
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(data, null, 2));
    renameSync(tmp, file);
  };
  return {
    /** Newest first. */
    all: () => [...data.bookings].reverse(),
    /** @param {string} ref */
    byRef: (ref) => data.bookings.find((b) => b.ref === ref) ?? null,
    /** Is this reference taken already? @param {string} ref */
    has: (ref) => data.bookings.some((b) => b.ref === ref),
    /** @param {StoredBooking} b */
    add(b) {
      data.bookings.push(b);
      save();
      return b;
    },
    /** @param {string} ref @param {Partial<StoredBooking>} patch */
    update(ref, patch) {
      const b = data.bookings.find((x) => x.ref === ref);
      if (!b) return null;
      Object.assign(b, patch);
      save();
      return b;
    },
    /** The supplier answered (or told us something) just now. @param {Date} at */
    noteSync(at) {
      data.lastSyncAt = at.toISOString();
      save();
    },
    lastSyncAt: () => data.lastSyncAt ?? null,
  };
}
