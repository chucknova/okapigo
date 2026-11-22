// @ts-check
/**
 * notifications.js — Sojourna asking the supplier to tell it when something changes (OCTO's
 * notifications capability, 17d-2): its bookings (BOOKING_UPDATE: e.g. the business cancelled
 * for weather), seats (AVAILABILITY_UPDATE) and tours (PRODUCT_UPDATE).
 *
 * At each start: any old subscription to the same address is removed (its key belonged to the
 * last run), and a new one made with a fresh key. If the supplier isn't answering, it tries
 * again every 30 seconds.
 */
import { randomBytes } from 'node:crypto';

export const NOTIFICATION_TYPES = ['BOOKING_UPDATE', 'AVAILABILITY_UPDATE', 'PRODUCT_UPDATE'];
const SUBSCRIPTIONS = '/notifications/subscriptions';

/** A fresh key for the supplier to send back. */
export const makeNotifyKey = () => randomBytes(24).toString('base64url');

/**
 * @param {{ octo: ReturnType<typeof import('./octo-client.js').createOctoClient>, url: string, key: string }} o
 * @returns {Promise<{ id: string }>}
 */
export async function subscribe({ octo, url, key }) {
  const existing = /** @type {Array<{ id: string, url: string }>} */ (
    await octo.get(SUBSCRIPTIONS)
  );
  for (const s of existing.filter((x) => x.url === url)) {
    await octo.del(`${SUBSCRIPTIONS}/${encodeURIComponent(s.id)}`);
  }
  return octo.post(SUBSCRIPTIONS, {
    url,
    notificationTypes: NOTIFICATION_TYPES,
    headers: { 'X-Sojourna-Key': key },
  });
}

/**
 * Subscribes, trying again every 30 seconds until the supplier answers.
 * @param {Parameters<typeof subscribe>[0] & { log?: (line: string) => void, every?: number }} o
 */
export function keepSubscribing({ log = () => {}, every = 30_000, ...o }) {
  const attempt = () =>
    subscribe(o)
      .then(() => log(`Sojourna: subscribed to updates at ${o.url}`))
      .catch((err) => {
        log(`Sojourna: couldn’t subscribe yet (${err.message}); trying again in 30 seconds`);
        setTimeout(attempt, every).unref();
      });
  attempt();
}
