// @ts-check
/**
 * channel-sync.js — telling connected OTAs what changed (sessions 17c and 17c-2; DST-02: "a
 * sale anywhere updates every channel within 60 seconds").
 *
 * OCTO OTAs ASK for tours and seats when they need them (17a). Many also keep their own copy
 * for their pages; for those, OCTO's "notifications" capability lets an OTA SUBSCRIBE an
 * address of its own (channel_subscriptions, made through POST /octo/notifications/
 * subscriptions), and we tell it there when something changed. The notification only says
 * WHAT changed; the OTA fetches it again (OCTO keeps the messages small):
 *
 *   PRODUCT_UPDATE        a tour's prices, or it went off sale or off the channel
 *                         data: { productId }
 *   AVAILABILITY_UPDATE   departures' seats or status (a sale anywhere, a hold, a cancellation,
 *                         a schedule change, a departure called off or removed)
 *                         data: { productId, optionId, localDateStart, localDateEnd }
 *   BOOKING_UPDATE        one of its bookings changed (e.g. the business cancelled it for
 *                         weather)            data: { uuid }
 *
 * How we know what changed, without touching every piece of code that changes seats: we keep
 * a FINGERPRINT of what each subscription was last told about each departure, tour and booking
 * (notification_states), and a job every 30 seconds compares them with how things are now.
 * Whatever differs is told, and remembered only once the OTA accepted it (an OTA that's down
 * is simply told again on the next run).
 *
 *   pushChannelUpdates(prisma, { send })   one run over every subscription
 *
 * `send(subscription, notification)` does the HTTP (the workers app gives it): this file
 * decides WHAT to tell, not how it travels.
 */
import { randomUUID } from 'node:crypto';
import { localDate } from '@okapigo/shared/time';
import { seatsLeft } from './seats.js';
import { octoStatusOf } from './channel-bookings.js';

/** How far ahead we keep OTAs told: the same 60 days that are on sale (HORIZON_DAYS). */
export const PUSH_HORIZON_DAYS = 60;

const DAY = 86_400_000;

/**
 * What a departure looks like to an OTA, as a fingerprint: its tour, whether it runs, seats
 * left, how many in all, when. The tour comes first and the start last, so a departure that's
 * gone can still be told about (which tour, which day). @param {any} d  with its resource
 */
export const departureFingerprint = (d) =>
  [d.productId, d.status, seatsLeft(d), d.capacity, d.startsAt.toISOString()].join('|');

/** A departure of a tour that's off sale: closed, whatever its seats. @param {any} d */
const offSaleFingerprint = (d) => [d.productId, 'off', 0, 0, d.startsAt.toISOString()].join('|');

/** The tour and the start, back out of a fingerprint. @param {string} f */
const tourAndStart = (f) => {
  const parts = f.split('|');
  return { productId: parts[0], startsAt: new Date(parts[parts.length - 1]) };
};

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
 * What a booking looks like to an OTA: its OCTO status, and its departure.
 * @param {any} cb with booking.hold @param {Date} now
 */
const bookingFingerprint = (cb, now) =>
  [octoStatusOf(cb.booking, cb.booking.hold, now), cb.booking.departureId].join('|');

/**
 * @typedef {{ type: string, data: any, remember: Array<{ subject: string, fingerprint: string | null }> }} Update
 *   fingerprint null: forget it (something that's gone, told once)
 */

/**
 * What to tell one subscription now.
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {any} sub  with its channel and the channel's business
 * @param {Date} now
 * @returns {Promise<Update[]>}
 */
export async function subscriptionUpdates(prisma, sub, now) {
  const channel = sub.channel;
  const tz = channel.operator.timeZone;
  const wants = new Set(sub.notificationTypes);
  const until = new Date(now.getTime() + PUSH_HORIZON_DAYS * DAY);
  const [products, bookings, told] = await Promise.all([
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
    wants.has('BOOKING_UPDATE')
      ? prisma.channelBooking.findMany({
          // Its bookings whose day hasn't passed (a day's grace: a no-show, a late refund).
          where: {
            channelId: channel.id,
            booking: { departure: { startsAt: { gt: new Date(now.getTime() - DAY) } } },
          },
          include: { booking: { include: { hold: true } } },
          orderBy: { createdAt: 'asc' },
        })
      : [],
    prisma.notificationState.findMany({ where: { subscriptionId: sub.id } }),
  ]);
  const before = new Map(told.map((t) => [t.subject, t.fingerprint]));
  /** @type {Set<string>} */
  const seen = new Set();
  /** @type {Update[]} */
  const updates = [];
  /** Changed departures, by tour. @type {Map<string, Array<{ subject: string, fingerprint: string | null, startsAt: Date }>>} */
  const changedByTour = new Map();
  /** @param {string} productId @param {{ subject: string, fingerprint: string | null, startsAt: Date }} c */
  const changed = (productId, c) =>
    changedByTour.set(productId, [...(changedByTour.get(productId) ?? []), c]);

  for (const p of products) {
    if (wants.has('PRODUCT_UPDATE')) {
      const subject = `product:${p.id}`;
      const fingerprint = productFingerprint(p);
      seen.add(subject);
      if (before.get(subject) !== fingerprint) {
        updates.push({
          type: 'PRODUCT_UPDATE',
          data: { productId: p.id },
          remember: [{ subject, fingerprint }],
        });
      }
    }
    if (wants.has('AVAILABILITY_UPDATE')) {
      const onSale = p.status === 'published';
      for (const d of p.departures) {
        const subject = `departure:${d.id}`;
        // A tour off sale: every departure closed.
        const fingerprint = onSale ? departureFingerprint(d) : offSaleFingerprint(d);
        seen.add(subject);
        if (before.get(subject) !== fingerprint) {
          changed(p.id, { subject, fingerprint, startsAt: d.startsAt });
        }
      }
    }
  }
  for (const cb of bookings) {
    const subject = `booking:${cb.id}`;
    const fingerprint = bookingFingerprint(cb, now);
    seen.add(subject);
    if (before.get(subject) !== fingerprint) {
      updates.push({
        type: 'BOOKING_UPDATE',
        data: { uuid: cb.uuid },
        remember: [{ subject, fingerprint }],
      });
    }
  }

  // Told before, gone now:
  //   a departure removed from the schedule, or of a tour taken off the channel: its day is
  //     told once more, then forgotten (one in the past: just forgotten)
  //   a tour taken off the channel: told once (fetching it now says it isn't there), forgotten
  //   a booking whose day has passed: just forgotten
  /** @type {string[]} */
  const forget = [];
  for (const t of told) {
    if (seen.has(t.subject)) continue;
    if (t.subject.startsWith('departure:')) {
      const { productId, startsAt } = tourAndStart(t.fingerprint);
      if (startsAt > now) changed(productId, { subject: t.subject, fingerprint: null, startsAt });
      else forget.push(t.subject);
    } else if (t.subject.startsWith('product:')) {
      updates.push({
        type: 'PRODUCT_UPDATE',
        data: { productId: t.subject.slice('product:'.length) },
        remember: [{ subject: t.subject, fingerprint: null }],
      });
    } else {
      forget.push(t.subject);
    }
  }

  // One AVAILABILITY_UPDATE per tour: the days to fetch again, first to last.
  for (const [productId, list] of changedByTour) {
    const days = list.map((c) => localDate(c.startsAt, tz)).sort();
    updates.push({
      type: 'AVAILABILITY_UPDATE',
      data: {
        productId,
        optionId: 'DEFAULT',
        localDateStart: days[0],
        localDateEnd: days[days.length - 1],
      },
      remember: list.map((c) => ({ subject: c.subject, fingerprint: c.fingerprint })),
    });
  }

  if (forget.length) {
    await prisma.notificationState.deleteMany({
      where: { subscriptionId: sub.id, subject: { in: forget } },
    });
  }
  return updates;
}

/**
 * Remembers what a subscription accepted. @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} subscriptionId @param {Update['remember']} items @param {Date} now
 */
async function remember(prisma, subscriptionId, items, now) {
  const keep = items.filter((i) => i.fingerprint !== null);
  const drop = items.filter((i) => i.fingerprint === null).map((i) => i.subject);
  await prisma.$transaction([
    ...keep.map((i) =>
      prisma.notificationState.upsert({
        where: { subscriptionId_subject: { subscriptionId, subject: i.subject } },
        create: {
          subscriptionId,
          subject: i.subject,
          fingerprint: /** @type {string} */ (i.fingerprint),
          pushedAt: now,
        },
        update: { fingerprint: /** @type {string} */ (i.fingerprint), pushedAt: now },
      }),
    ),
    prisma.notificationState.deleteMany({ where: { subscriptionId, subject: { in: drop } } }),
  ]);
}

/**
 * One run: every subscription of an active channel is told what changed since it was last
 * told. One whose OTA refuses or doesn't answer keeps its last error, and is told again next
 * time; the others carry on.
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{
 *   send: (subscription: any, notification: any) => Promise<void>,   throws when not accepted
 *   now?: Date,
 *   operatorId?: string,    only this business's (tests)
 * }} o
 * @returns {Promise<{ subscriptions: number, sent: number, failed: number }>}
 */
export async function pushChannelUpdates(prisma, { send, now = new Date(), operatorId }) {
  const subs = await prisma.channelSubscription.findMany({
    where: { channel: { isActive: true }, ...(operatorId && { operatorId }) },
    include: { channel: { include: { operator: true } } },
    orderBy: { createdAt: 'asc' },
  });
  let sent = 0;
  let failed = 0;
  for (const sub of subs) {
    const updates = await subscriptionUpdates(prisma, sub, now);
    let error = null;
    let any = false;
    for (const u of updates) {
      try {
        // OCTO's envelope: which subscription, what kind, what to fetch again.
        await send(sub, {
          id: randomUUID(),
          subscriptionId: sub.id,
          notificationType: u.type,
          utcCreatedAt: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
          data: u.data,
        });
        await remember(prisma, sub.id, u.remember, now);
        sent += 1;
        any = true;
      } catch (err) {
        error = String(/** @type {any} */ (err)?.message ?? err).slice(0, 300);
        failed += 1;
        break; // in order: the next run starts from here
      }
    }
    if (any || error) {
      await prisma.channelSubscription.update({
        where: { id: sub.id },
        data: { ...(any && { lastPushAt: now }), lastPushError: error },
      });
    }
  }
  return { subscriptions: subs.length, sent, failed };
}
