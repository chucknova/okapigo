// @ts-check
/**
 * channel-sync.js — the channel manager's "push" (session 17c, DST-02: "a sale anywhere
 * updates every channel within 60 seconds").
 *
 * OCTO OTAs ASK for availability when they need it (17a). Many also keep their own copy for
 * their pages; for those, we TELL them when something changes, at their webhook address:
 *
 *   availability_update   a departure's seats or status changed (a sale anywhere, a hold, a
 *                         cancellation, a schedule change, a departure called off)
 *   product_update        a tour's prices changed, or it went off sale: fetch it again
 *
 * How we know what changed, without touching every piece of code that changes seats: we keep
 * a FINGERPRINT of what we last told each channel about each departure and tour
 * (channel_sync_states), and a job every 30 seconds compares them with how things are now.
 * Whatever differs is told, and remembered only once the OTA accepted it (an OTA that's down
 * is simply told again on the next run).
 *
 *   pushChannelUpdates(prisma, { send })   one run over every channel with a webhook
 *   webhookSecret(authSecret, channelId)   the key the OTA checks our signature with
 *   signWebhook(secret, timestamp, body)   "t=…,v1=…" for the Octo-Webhook-Signature header
 *
 * `send(channel, payload)` does the HTTP (the workers app gives it): this file decides WHAT
 * to tell, not how it travels.
 */
import { createHmac } from 'node:crypto';
import { localIso, statusOf } from '@okapigo/shared/octo';
import { seatsLeft } from './seats.js';

/** How far ahead we keep OTAs told: the same 60 days that are on sale (HORIZON_DAYS). */
export const PUSH_HORIZON_DAYS = 60;
/** At most this many departures in one update (an OTA's first update can be long). */
const BATCH = 100;

/**
 * The key a channel checks our webhook signature with: derived from the server's secret, so
 * nothing new is stored, and it can be shown again when the owner connects the OTA.
 * @param {string} authSecret @param {string} channelId
 */
export const webhookSecret = (authSecret, channelId) =>
  createHmac('sha256', authSecret).update(`channel-webhook:${channelId}`).digest('hex');

/**
 * The signature header's value: "t=<unix seconds>,v1=<hex HMAC-SHA256 of `${t}.${body}`>".
 * The timestamp inside the signed text stops an old message being replayed later.
 * @param {string} secret @param {number} timestamp @param {string} body
 */
export const signWebhook = (secret, timestamp, body) =>
  `t=${timestamp},v1=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;

/**
 * What a departure looks like to an OTA, as a fingerprint: seats left, how many in all,
 * whether it runs, when. @param {any} d  with its resource
 */
export const departureFingerprint = (d) =>
  [d.status, seatsLeft(d), d.capacity, d.startsAt.toISOString()].join('|');

/**
 * What a tour's prices look like to an OTA: its active price categories, and whether it's on
 * sale. @param {any} p with priceCategories
 */
export const productFingerprint = (p) =>
  JSON.stringify([
    p.status,
    p.priceCategories
      .filter((/** @type {any} */ c) => c.isActive)
      .map((/** @type {any} */ c) => [c.key, c.amountKobo, c.minAge, c.maxAge])
      .sort((/** @type {any} */ a, /** @type {any} */ b) =>
        String(a[0]).localeCompare(String(b[0])),
      ),
  ]);

/**
 * One departure as the update says it (a slimmed OCTO Availability).
 * @param {any} d @param {string} tz
 */
function availabilityLine(d, tz) {
  const open = d.status === 'scheduled';
  const left = open ? Math.max(0, seatsLeft(d)) : 0;
  return {
    id: d.id,
    localDateTimeStart: localIso(d.startsAt, tz),
    status: open ? statusOf(left, d.capacity) : 'CLOSED',
    available: open && left > 0,
    vacancies: left,
    capacity: d.capacity,
  };
}

/**
 * What to tell one channel now: the updates, each with the fingerprints to remember once it's
 * accepted.
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {any} channel  with its operator
 * @param {Date} now
 * @returns {Promise<Array<{ payload: any, remember: Array<{ subject: string, fingerprint: string | null }> }>>}
 *   fingerprint null: forget it (a departure that's gone)
 */
export async function channelUpdates(prisma, channel, now) {
  const tz = channel.operator.timeZone;
  const until = new Date(now.getTime() + PUSH_HORIZON_DAYS * 86_400_000);
  const [products, told] = await Promise.all([
    prisma.product.findMany({
      where: { operatorId: channel.operatorId, channels: { some: { channelId: channel.id } } },
      include: {
        priceCategories: true,
        departures: {
          where: { startsAt: { gt: now, lt: until } },
          include: { resource: true },
          orderBy: { startsAt: 'asc' },
        },
      },
      orderBy: { id: 'asc' },
    }),
    prisma.channelSyncState.findMany({ where: { channelId: channel.id } }),
  ]);
  const before = new Map(told.map((t) => [t.subject, t.fingerprint]));
  const seen = new Set();
  /** @type {Array<{ payload: any, remember: Array<{ subject: string, fingerprint: string | null }> }>} */
  const updates = [];
  const base = { supplierId: channel.operatorId, sentAt: now.toISOString() };

  for (const p of products) {
    const onSale = p.status === 'published';
    // The tour: its prices, or that it went off sale.
    const ps = `product:${p.id}`;
    const pf = productFingerprint(p);
    seen.add(ps);
    if (before.get(ps) !== pf) {
      updates.push({
        payload: { event: 'product_update', ...base, productId: p.id, available: onSale },
        remember: [{ subject: ps, fingerprint: pf }],
      });
    }
    // Its departures: what changed (a tour off sale: every departure closed).
    const changed = [];
    for (const d of p.departures) {
      const subject = `departure:${d.id}`;
      const fingerprint = onSale ? departureFingerprint(d) : `off|${d.id}`;
      seen.add(subject);
      if (before.get(subject) !== fingerprint) {
        const line = availabilityLine(onSale ? d : { ...d, status: 'off' }, tz);
        changed.push({ line, subject, fingerprint });
      }
    }
    for (let i = 0; i < changed.length; i += BATCH) {
      const part = changed.slice(i, i + BATCH);
      updates.push({
        payload: {
          event: 'availability_update',
          ...base,
          productId: p.id,
          optionId: 'DEFAULT',
          availabilities: part.map((c) => c.line),
        },
        remember: part.map((c) => ({ subject: c.subject, fingerprint: c.fingerprint })),
      });
    }
  }

  // Told before, gone now (a departure removed from the schedule, a tour taken off the
  // channel): closed, then forgotten. A departure simply in the past is just forgotten.
  const gone = told.filter((t) => !seen.has(t.subject));
  const goneDepartures = gone.filter((t) => t.subject.startsWith('departure:'));
  if (goneDepartures.length) {
    const ids = goneDepartures.map((t) => t.subject.slice('departure:'.length));
    const still = await prisma.departure.findMany({
      where: { id: { in: ids } },
      select: { id: true, productId: true, startsAt: true, capacity: true },
    });
    const byId = new Map(still.map((d) => [d.id, d]));
    /** @type {Map<string, Array<any>>} */
    const closedBy = new Map();
    for (const t of goneDepartures) {
      const id = t.subject.slice('departure:'.length);
      const d = byId.get(id);
      if (d && d.startsAt <= now) continue; // past: just forgotten, below
      const productId = d?.productId ?? null;
      const list = closedBy.get(productId ?? '') ?? [];
      list.push({
        id,
        ...(d && { localDateTimeStart: localIso(d.startsAt, tz) }),
        status: 'CLOSED',
        available: false,
        vacancies: 0,
        capacity: d?.capacity ?? 0,
      });
      closedBy.set(productId ?? '', list);
    }
    for (const [productId, lines] of closedBy) {
      updates.push({
        payload: {
          event: 'availability_update',
          ...base,
          productId: productId || null,
          optionId: 'DEFAULT',
          availabilities: lines,
        },
        remember: lines.map((l) => ({ subject: `departure:${l.id}`, fingerprint: null })),
      });
    }
  }
  // Forget the rest: the past, and tours no longer on the channel (nothing to tell about them).
  const closing = new Set(updates.flatMap((u) => u.remember.map((r) => r.subject)));
  const forget = gone.filter((t) => !closing.has(t.subject)).map((t) => t.subject);
  if (forget.length) {
    await prisma.channelSyncState.deleteMany({
      where: { channelId: channel.id, subject: { in: forget } },
    });
  }
  return updates;
}

/**
 * Remembers what a channel accepted. @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} channelId @param {Array<{ subject: string, fingerprint: string | null }>} items @param {Date} now
 */
async function remember(prisma, channelId, items, now) {
  const keep = items.filter((i) => i.fingerprint !== null);
  const drop = items.filter((i) => i.fingerprint === null).map((i) => i.subject);
  await prisma.$transaction([
    ...keep.map((i) =>
      prisma.channelSyncState.upsert({
        where: { channelId_subject: { channelId, subject: i.subject } },
        create: {
          channelId,
          subject: i.subject,
          fingerprint: /** @type {string} */ (i.fingerprint),
          pushedAt: now,
        },
        update: { fingerprint: /** @type {string} */ (i.fingerprint), pushedAt: now },
      }),
    ),
    prisma.channelSyncState.deleteMany({ where: { channelId, subject: { in: drop } } }),
  ]);
}

/**
 * One run: every active channel with a webhook is told what changed since it was last told.
 * A channel whose OTA refuses or doesn't answer keeps its last error, and is told again next
 * time; the others carry on.
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{
 *   send: (channel: any, payload: any) => Promise<void>,   throws when the OTA didn't accept it
 *   now?: Date,
 *   operatorId?: string,    only this business's channels (tests)
 * }} o
 * @returns {Promise<{ channels: number, sent: number, failed: number }>}
 */
export async function pushChannelUpdates(prisma, { send, now = new Date(), operatorId }) {
  const channels = await prisma.channel.findMany({
    where: { isActive: true, webhookUrl: { not: null }, ...(operatorId && { operatorId }) },
    include: { operator: true },
  });
  let sent = 0;
  let failed = 0;
  for (const channel of channels) {
    const updates = await channelUpdates(prisma, channel, now);
    let error = null;
    let any = false;
    for (const u of updates) {
      try {
        await send(channel, u.payload);
        await remember(prisma, channel.id, u.remember, now);
        sent += 1;
        any = true;
      } catch (err) {
        error = String(/** @type {any} */ (err)?.message ?? err).slice(0, 300);
        failed += 1;
        break; // in order: the next run starts from here
      }
    }
    if (any || error) {
      await prisma.channel.update({
        where: { id: channel.id },
        data: { ...(any && { lastPushAt: now }), lastPushError: error },
      });
    }
  }
  return { channels: channels.length, sent, failed };
}
