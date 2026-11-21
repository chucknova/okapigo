// @ts-check
/**
 * The channel manager (session 17c, DST-02): the OTAs that sell the business's tours through
 * OCTO. The screen is Settings › Channels (designed by you; brief 08). The API is here now.
 *
 *   GET   /api/channels            channels: view   each, in words: tours, sales, what it owes
 *   GET   /api/channels/:id        channels: view   one, with its tours and latest bookings
 *   POST  /api/channels            channels: edit   connect one: its key, shown ONCE
 *   PATCH /api/channels/:id        channels: edit   name, commission, tours, webhook, on/off
 *   POST  /api/channels/:id/key    channels: edit   a new key (the old one stops at once)
 *
 * Keys and the webhook's signing secret are shown once, when made (like WhatsApp's settings:
 * nothing secret is shown twice). The key itself is never stored (channels.js keeps its hash).
 *
 * What an OTA owes is worked out the way the ledger records it (17b): each sale's price less
 * its commission, less each refund less the commission on it, at the share frozen at the sale.
 */
import { Router } from 'express';
import {
  CreateChannelSchema,
  UpdateChannelSchema,
  percentToBasisPoints,
} from '@okapigo/shared/schemas/channels';
import { formatNaira } from '@okapigo/shared/money';
import { percentOf } from '@okapigo/shared/pricing';
import { localDate, localTime, zonedTimeToUtc } from '@okapigo/shared/time';
import { formatAt } from '@okapigo/shared/tour-facts';
import { createChannel, hashApiKey, keyHint, makeApiKey, webhookSecret } from '@okapigo/db';
import { requirePermission } from '../middleware/auth.js';
import { validate, IdParamsSchema } from '../middleware/validate.js';
import { HttpError } from '../middleware/errors.js';

/** "20%", "17.5%" @param {number} bp */
const percentWords = (bp) => `${bp / 100}%`;

/**
 * What a channel owes from its OCTO bookings: each sale's net, less each refund's net.
 * @param {Array<{ commissionBasisPoints: number, booking: { payments: any[], refunds: any[] } }>} bookings
 */
export function owedBy(bookings) {
  let owed = 0;
  for (const cb of bookings) {
    const bp = cb.commissionBasisPoints;
    for (const p of cb.booking.payments) {
      if (p.provider === 'ota' && p.status === 'succeeded')
        owed += p.amountKobo - percentOf(p.amountKobo, bp);
    }
    for (const r of cb.booking.refunds) {
      if (r.provider === 'ota' && r.status === 'processed')
        owed -= r.amountKobo - percentOf(r.amountKobo, bp);
    }
  }
  return owed;
}

/**
 * A webhook address we may call. In production: https, and not this machine or a private
 * network, so an address can't be used to reach our own insides (SSRF). In development,
 * http://localhost is fine (the mock OTA runs there).
 * @param {string | null} url @param {boolean} production
 * @returns {{ ok: true, url: string | null } | { ok: false, problem: string }}
 */
export function checkWebhookUrl(url, production) {
  if (url === null) return { ok: true, url: null };
  let u;
  try {
    u = new URL(url);
  } catch {
    return { ok: false, problem: 'That isn’t a web address.' };
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    return { ok: false, problem: 'An address starting with https://' };
  }
  if (production) {
    const host = u.hostname.toLowerCase();
    const privateHost =
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      host.endsWith('.internal') ||
      /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
      host.startsWith('[');
    if (u.protocol !== 'https:' || privateHost) {
      return { ok: false, problem: 'Use the OTA’s public https:// address.' };
    }
  }
  return { ok: true, url: u.toString() };
}

/**
 * @param {{
 *   prisma: import('@prisma/client').PrismaClient,
 *   apiPublicUrl: string,
 *   authSecret: string,
 *   production?: boolean,
 * }} deps
 */
export function channelsRouter({ prisma, apiPublicUrl, authSecret, production = false }) {
  const router = Router();
  /** @returns {import('../middleware/auth.js').AuthContext} */
  // @ts-ignore: req.auth is set by requireAuth
  const authOf = (req) => req.auth;
  const octoEndpoint = `${apiPublicUrl.replace(/\/+$/, '')}/octo`;

  /** @param {string | null} url */
  const checkWebhook = (url) => {
    const r = checkWebhookUrl(url, production);
    if (r.ok) return r.url;
    throw new HttpError(400, 'WEBHOOK_NOT_ALLOWED', r.problem);
  };

  /** Only this business's tours. @param {string} operatorId @param {string[]} ids */
  async function ownTours(operatorId, ids) {
    const found = await prisma.product.findMany({
      where: { operatorId, id: { in: ids } },
      select: { id: true },
    });
    if (found.length !== new Set(ids).size) {
      throw new HttpError(400, 'INVALID_TOUR', 'One of those tours doesn’t exist.');
    }
    return [...new Set(ids)];
  }

  /**
   * A channel in words, for the list and the screen. @param {any} c  with products, bookings
   * @param {{ tz: string, tourCount: number, now: Date }} o
   */
  function view(c, { tz, tourCount, now }) {
    const monthStart = zonedTimeToUtc(`${localDate(now, tz).slice(0, 8)}01`, '00:00', tz);
    // Sold this month (a hold not confirmed yet isn't a sale; it owes nothing either).
    const thisMonth = c.bookings.filter(
      (/** @type {any} */ cb) => cb.confirmedAt && cb.confirmedAt >= monthStart,
    );
    const monthKobo = thisMonth.reduce(
      (/** @type {number} */ n, /** @type {any} */ cb) => n + cb.booking.totalKobo,
      0,
    );
    const owed = owedBy(c.bookings);
    const last = c.bookings.reduce(
      (/** @type {Date | null} */ at, /** @type {any} */ cb) =>
        !at || cb.createdAt > at ? cb.createdAt : at,
      null,
    );
    const when = (/** @type {Date} */ at) =>
      localDate(at, tz) === localDate(now, tz) ? localTime(at, tz) : formatAt(at.getTime(), tz);
    return {
      id: c.id,
      name: c.name,
      isActive: c.isActive,
      status: c.isActive ? 'Connected' : 'Switched off',
      commissionBasisPoints: c.commissionBasisPoints,
      commission: percentWords(c.commissionBasisPoints),
      apiKeyHint: c.apiKeyHint,
      tourIds: c.products.map((/** @type {any} */ p) => p.productId),
      toursLine: `${c.products.length} of ${tourCount} ${tourCount === 1 ? 'tour' : 'tours'}`,
      salesLine:
        thisMonth.length === 0
          ? 'No sales this month'
          : `${thisMonth.length} ${thisMonth.length === 1 ? 'booking' : 'bookings'} · ${formatNaira(monthKobo)} this month`,
      owedKobo: owed,
      owedLine: owed > 0 ? `${formatNaira(owed)} owed` : 'Owes nothing',
      lastActivity: last ? `Last booking ${when(last)}` : 'No bookings yet',
      webhookUrl: c.webhookUrl,
      pushLine: !c.webhookUrl
        ? 'No webhook: it asks when it needs to.'
        : c.lastPushError
          ? `Updates aren’t reaching it: ${c.lastPushError}. Trying again every 30 seconds.`
          : c.lastPushAt
            ? `Updates sent · last ${when(c.lastPushAt)}`
            : 'Updates start within 30 seconds.',
    };
  }

  const withWhatViewNeeds = {
    products: true,
    bookings: { include: { booking: { include: { payments: true, refunds: true } } } },
  };

  /** @param {string} operatorId */
  const context = async (operatorId) => {
    const [operator, tourCount] = await Promise.all([
      prisma.operator.findUniqueOrThrow({ where: { id: operatorId } }),
      prisma.product.count({ where: { operatorId, status: { not: 'archived' } } }),
    ]);
    return { tz: operator.timeZone, tourCount, now: new Date() };
  };

  /** @param {string} operatorId @param {string} id */
  async function findOwn(operatorId, id) {
    const c = await prisma.channel.findFirst({
      where: { id, operatorId },
      include: withWhatViewNeeds,
    });
    if (!c) throw new HttpError(404, 'NOT_FOUND', 'Channel not found.');
    return c;
  }

  router.get('/channels', requirePermission('channels', 'view'), async (req, res) => {
    const { operatorId } = authOf(req);
    const [channels, o] = await Promise.all([
      prisma.channel.findMany({
        where: { operatorId },
        include: withWhatViewNeeds,
        orderBy: { name: 'asc' },
      }),
      context(operatorId),
    ]);
    res.json({ channels: channels.map((c) => view(c, o)), octoEndpoint });
  });

  router.get(
    '/channels/:id',
    requirePermission('channels', 'view'),
    validate({ params: IdParamsSchema }),
    async (req, res) => {
      const { operatorId } = authOf(req);
      const [c, o, tours, latest] = await Promise.all([
        findOwn(operatorId, req.params.id),
        context(operatorId),
        prisma.product.findMany({
          where: { operatorId, status: { not: 'archived' } },
          select: { id: true, title: true, status: true },
          orderBy: { title: 'asc' },
        }),
        prisma.channelBooking.findMany({
          where: { channelId: req.params.id, operatorId },
          include: { booking: { include: { product: true, departure: true } } },
          orderBy: { createdAt: 'desc' },
          take: 10,
        }),
      ]);
      const on = new Set(c.products.map((p) => p.productId));
      res.json({
        channel: {
          ...view(c, o),
          tours: tours.map((t) => ({
            id: t.id,
            title: t.title,
            on: on.has(t.id),
            // Only tours on sale are sold (OCTO lists published ones).
            note: t.status === 'published' ? null : 'Not on sale: the OTA won’t see it',
          })),
          bookings: latest.map((cb) => ({
            id: cb.booking.id,
            reference: cb.booking.reference,
            resellerReference: cb.resellerReference,
            lead: cb.confirmedAt ? cb.booking.leadName : 'Not confirmed yet',
            tour: cb.booking.product.shortTitle ?? cb.booking.product.title,
            when: formatAt(cb.booking.departure.startsAt.getTime(), o.tz),
            total: formatNaira(cb.booking.totalKobo),
            status: cb.booking.status,
          })),
        },
        octoEndpoint,
      });
    },
  );

  router.post(
    '/channels',
    requirePermission('channels', 'edit'),
    validate({ body: CreateChannelSchema }),
    async (req, res) => {
      const { operatorId } = authOf(req);
      const { name, commissionPercent, productIds, webhookUrl } = req.body;
      const tours = await ownTours(operatorId, productIds);
      const hook = checkWebhook(webhookUrl);
      try {
        const { channel, apiKey } = await prisma.$transaction(async (tx) => {
          const made = await createChannel(tx, {
            operatorId,
            name,
            commissionBasisPoints: percentToBasisPoints(commissionPercent),
            productIds: tours,
          });
          if (hook)
            await tx.channel.update({ where: { id: made.channel.id }, data: { webhookUrl: hook } });
          return made;
        });
        const c = await findOwn(operatorId, channel.id);
        res.status(201).json({
          channel: view(c, await context(operatorId)),
          // Shown ONCE: store them now (designs: "you won't see it again").
          apiKey,
          webhookSecret: webhookSecret(authSecret, channel.id),
          octoEndpoint,
        });
      } catch (err) {
        if (/** @type {any} */ (err)?.code === 'P2002') {
          throw new HttpError(409, 'NAME_TAKEN', 'You already have a channel with that name.');
        }
        throw err;
      }
    },
  );

  router.patch(
    '/channels/:id',
    requirePermission('channels', 'edit'),
    validate({ params: IdParamsSchema, body: UpdateChannelSchema }),
    async (req, res) => {
      const { operatorId } = authOf(req);
      const c = await findOwn(operatorId, req.params.id);
      const { name, commissionPercent, isActive, productIds, webhookUrl } = req.body;
      const tours = productIds ? await ownTours(operatorId, productIds) : null;
      const hook = webhookUrl === undefined ? undefined : checkWebhook(webhookUrl);
      try {
        await prisma.$transaction(async (tx) => {
          await tx.channel.update({
            where: { id: c.id },
            data: {
              name,
              isActive,
              // New sales only: each OTA booking froze its own (17b).
              commissionBasisPoints:
                commissionPercent === undefined
                  ? undefined
                  : percentToBasisPoints(commissionPercent),
              ...(hook !== undefined && { webhookUrl: hook, lastPushError: null }),
            },
          });
          if (tours) {
            await tx.channelProduct.deleteMany({
              where: { channelId: c.id, productId: { notIn: tours } },
            });
            await tx.channelProduct.createMany({
              data: tours.map((productId) => ({ channelId: c.id, productId, operatorId })),
              skipDuplicates: true,
            });
          }
        });
      } catch (err) {
        if (/** @type {any} */ (err)?.code === 'P2002') {
          throw new HttpError(409, 'NAME_TAKEN', 'You already have a channel with that name.');
        }
        throw err;
      }
      res.json({ channel: view(await findOwn(operatorId, c.id), await context(operatorId)) });
    },
  );

  router.post(
    '/channels/:id/key',
    requirePermission('channels', 'edit'),
    validate({ params: IdParamsSchema }),
    async (req, res) => {
      const { operatorId } = authOf(req);
      const c = await findOwn(operatorId, req.params.id);
      const apiKey = makeApiKey();
      await prisma.channel.update({
        where: { id: c.id },
        data: { apiKeyHash: hashApiKey(apiKey), apiKeyHint: keyHint(apiKey) },
      });
      res.json({
        apiKey,
        apiKeyHint: keyHint(apiKey),
        webhookSecret: webhookSecret(authSecret, c.id),
        octoEndpoint,
      });
    },
  );

  return router;
}
