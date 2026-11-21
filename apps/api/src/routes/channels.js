// @ts-check
/**
 * The channel manager (sessions 17c and 17c-2, DST-02): the OTAs that sell the business's tours
 * through OCTO. The screen is Settings › Channels (designs: "O11 · Settings › Channels").
 *
 *   GET   /api/channels                       channels: view   each as a card, in words
 *   GET   /api/channels/:id                   channels: view   one: tours, latest bookings, money,
 *                                                              connection
 *   POST  /api/channels                       channels: edit   connect one: its key, shown ONCE
 *   PATCH /api/channels/:id                   channels: edit   name, commission, on/off
 *   PUT   /api/channels/:id/tours/:productId  channels: edit   one tour on it, or off it
 *   POST  /api/channels/:id/key               channels: edit   a new key (the old one stops)
 *   POST  /api/channels/:id/payments          channels: edit   money it sent: pays off its oldest
 *                                                              bookings first
 *
 * The key is shown once, when made (it's never stored: channels.js keeps its hash). An OTA
 * tells us where to send updates itself, through OCTO (notifications), so nothing about that is
 * set here.
 *
 * What an OTA owes is worked out booking by booking (channel-money.js): each sale's net, less
 * each refund's, less what its payments paid off, at the commission frozen at the sale.
 */
import { Router } from 'express';
import { z } from 'zod';
import {
  ChannelPaymentSchema,
  ChannelTourSchema,
  CreateChannelSchema,
  UpdateChannelSchema,
  percentToBasisPoints,
} from '@okapigo/shared/schemas/channels';
import { formatNaira } from '@okapigo/shared/money';
import { percentOf } from '@okapigo/shared/pricing';
import { localDate, localTime, zonedTimeToUtc } from '@okapigo/shared/time';
import { formatAt } from '@okapigo/shared/tour-facts';
import {
  ChannelPaymentError,
  WITH_MONEY,
  createChannel,
  hashApiKey,
  keyHint,
  makeApiKey,
  owedFor,
  recordChannelPayment,
} from '@okapigo/db';
import { requirePermission } from '../middleware/auth.js';
import { validate, IdParamsSchema } from '../middleware/validate.js';
import { HttpError } from '../middleware/errors.js';

/** "20%", "17.5%" @param {number} bp */
const percentWords = (bp) => `${bp / 100}%`;

/** "Sat 14 Nov" @param {Date} at @param {string} tz */
const dayWords = (at, tz) => formatAt(at.getTime(), tz).split(', ')[0];

/** "Thu 3 Dec" from a date column (midnight UTC). @param {Date} d */
const dateWords = (d) => dayWords(new Date(d.getTime() + 12 * 3_600_000), 'UTC');

/**
 * Today: its time ("10:42"); another day: the day ("Sat 14 Nov").
 * @param {Date} at @param {string} tz @param {Date} now
 */
const whenWords = (at, tz, now) =>
  localDate(at, tz) === localDate(now, tz) ? localTime(at, tz) : dayWords(at, tz);

/** "6 bookings", "1 booking"; with a word between: "2 past bookings". @param {number} n */
const bookingsWord = (n, between = '') =>
  `${n} ${between ? `${between} ` : ''}${n === 1 ? 'booking' : 'bookings'}`;

const ENDED = ['cancelled', 'refunded'];

/** "2A 1C": who's coming, in short (the designs' latest bookings). @param {any[]} travellers */
export function whoShort(travellers) {
  /** @type {Map<string, number>} */
  const n = new Map();
  for (const t of travellers) {
    const k = String(t.categoryKey)[0].toUpperCase();
    n.set(k, (n.get(k) ?? 0) + 1);
  }
  return [...n].map(([k, count]) => `${count}${k}`).join(' ');
}

/**
 * What a channel owes in all, in words: "₦329,600 owed", "₦0 owed", or what's owed back to it
 * (a refund after it had paid). @param {number} kobo
 */
export const owedWords = (kobo) =>
  kobo < 0 ? `You owe ${formatNaira(-kobo)} back` : `${formatNaira(kobo)} owed`;

/**
 * A tour on a channel, in words (designs: "On sale · pickup points shared").
 * @param {{ status: string, pickupPoints?: unknown, depositBasisPoints?: number | null }} t
 * @param {boolean} on @param {string} channelName
 */
export function tourNote(t, on, channelName) {
  if (t.status !== 'published') return 'Draft: only published tours can be on';
  if (!on) return `Not on ${channelName}`;
  if (Array.isArray(t.pickupPoints) && t.pickupPoints.length > 0)
    return 'On sale · pickup points shared';
  if (t.depositBasisPoints) return 'On sale · full price only (no deposit on OTAs)';
  return `On sale on ${channelName}`;
}

/**
 * What one OTA booking still owes, in words, and how it reads.
 * @param {any} cb with WITH_MONEY @returns {{ text: string, tone: 'owes' | 'muted' | 'ok' }}
 */
export function bookingMoney(cb) {
  const owed = owedFor(cb);
  if (owed > 0) return { text: `Owes ${formatNaira(owed)}`, tone: 'owes' };
  if (owed < 0)
    return { text: `Refunded after paying: owed ${formatNaira(-owed)} back`, tone: 'owes' };
  if (ENDED.includes(cb.booking.status)) return { text: 'Cancelled · owes ₦0', tone: 'muted' };
  return { text: 'Settled', tone: 'ok' };
}

/**
 * @param {{
 *   prisma: import('@prisma/client').PrismaClient,
 *   apiPublicUrl: string,
 * }} deps
 */
export function channelsRouter({ prisma, apiPublicUrl }) {
  const router = Router();
  /** @returns {import('../middleware/auth.js').AuthContext} */
  // @ts-ignore: req.auth is set by requireAuth
  const authOf = (req) => req.auth;
  const octoEndpoint = `${apiPublicUrl.replace(/\/+$/, '')}/octo`;

  const withWhatCardsNeed = {
    products: { include: { product: { select: { status: true } } } },
    bookings: {
      include: {
        allocations: true,
        booking: { include: { payments: true, refunds: true, departure: true } },
      },
    },
  };

  /** @param {string} operatorId */
  const context = async (operatorId) => {
    const [operator, tourCount] = await Promise.all([
      prisma.operator.findUniqueOrThrow({ where: { id: operatorId } }),
      prisma.product.count({ where: { operatorId, status: 'published' } }),
    ]);
    return { tz: operator.timeZone, business: operator.name, tourCount, now: new Date() };
  };

  /**
   * A channel as a card, in words (designs: the cards at the top), and this month's sales.
   * @param {any} c with withWhatCardsNeed @param {{ tz: string, tourCount: number, now: Date }} o
   */
  function card(c, { tz, tourCount, now }) {
    const monthStart = zonedTimeToUtc(`${localDate(now, tz).slice(0, 8)}01`, '00:00', tz);
    const sold = c.bookings.filter((/** @type {any} */ cb) => cb.confirmedAt);
    // This month's sales: sold this month and not cancelled since (what it owes is worked out
    // apart, refunds and all).
    const thisMonth = sold.filter(
      (/** @type {any} */ cb) => cb.confirmedAt >= monthStart && !ENDED.includes(cb.booking.status),
    );
    const monthKobo = thisMonth.reduce(
      (/** @type {number} */ n, /** @type {any} */ cb) => n + cb.booking.totalKobo,
      0,
    );
    const owed = sold.reduce(
      (/** @type {number} */ n, /** @type {any} */ cb) => n + owedFor(cb),
      0,
    );
    const last = sold.reduce(
      (/** @type {Date | null} */ at, /** @type {any} */ cb) =>
        !at || cb.confirmedAt > at ? cb.confirmedAt : at,
      null,
    );
    // Tours it can actually sell: on it AND on sale.
    const selling = c.products.filter((/** @type {any} */ p) => p.product.status === 'published');
    const upcoming = sold.filter(
      (/** @type {any} */ cb) =>
        cb.booking.departure.startsAt > now && !ENDED.includes(cb.booking.status),
    ).length;
    return {
      view: {
        id: c.id,
        name: c.name,
        isActive: c.isActive,
        status: c.isActive ? 'Connected' : 'Switched off',
        commissionBasisPoints: c.commissionBasisPoints,
        commission: percentWords(c.commissionBasisPoints),
        summary: c.isActive
          ? [
              `${percentWords(c.commissionBasisPoints)} commission`,
              `${selling.length} of ${tourCount} ${tourCount === 1 ? 'tour' : 'tours'}`,
              last ? `last booking ${whenWords(last, tz, now)}` : 'no bookings yet',
            ].join(' · ')
          : `${percentWords(c.commissionBasisPoints)} · can’t see or sell anything`,
        // "This month: 6 bookings · ₦412,000" (the second part bold); switched off, what's kept.
        month: c.isActive
          ? {
              lead: 'This month:',
              strong:
                thisMonth.length === 0
                  ? 'no sales yet'
                  : `${bookingsWord(thisMonth.length)} · ${formatNaira(monthKobo)}`,
            }
          : {
              lead:
                sold.length === 0
                  ? 'No past bookings'
                  : `${bookingsWord(sold.length, 'past')} kept`,
              strong: null,
            },
        owedKobo: owed,
        owedLine: owedWords(owed),
      },
      thisMonth,
      monthKobo,
      upcoming,
    };
  }

  /** @param {string} operatorId @param {string} id */
  async function findOwn(operatorId, id) {
    const c = await prisma.channel.findFirst({
      where: { id, operatorId },
      include: withWhatCardsNeed,
    });
    if (!c) throw new HttpError(404, 'NOT_FOUND', 'Channel not found.');
    return c;
  }

  /** One channel: everything its page shows. @param {string} operatorId @param {string} id */
  async function detail(operatorId, id) {
    const [c, o] = await Promise.all([findOwn(operatorId, id), context(operatorId)]);
    const [tours, latest, lastPayment] = await Promise.all([
      prisma.product.findMany({
        where: { operatorId, status: { not: 'archived' } },
        select: {
          id: true,
          title: true,
          status: true,
          pickupPoints: true,
          depositBasisPoints: true,
        },
        orderBy: { title: 'asc' },
      }),
      prisma.channelBooking.findMany({
        where: { channelId: c.id, operatorId, confirmedAt: { not: null } },
        include: {
          ...WITH_MONEY,
          booking: {
            include: {
              payments: true,
              refunds: true,
              product: true,
              departure: true,
              travellers: { select: { categoryKey: true } },
            },
          },
        },
        orderBy: { confirmedAt: 'desc' },
        take: 10,
      }),
      prisma.channelPayment.findFirst({
        where: { channelId: c.id },
        include: {
          allocations: { include: { channelBooking: { select: { confirmedAt: true } } } },
        },
        orderBy: [{ receivedOn: 'desc' }, { createdAt: 'desc' }],
      }),
    ]);
    const k = card(c, o);
    const on = new Set(c.products.map((p) => p.productId));
    // This month's commission, at each sale's own share; "Sojourna’s 20%" when it's one share.
    const shareKobo = k.thisMonth.reduce(
      (/** @type {number} */ n, /** @type {any} */ cb) =>
        n + percentOf(cb.booking.totalKobo, cb.commissionBasisPoints),
      0,
    );
    const shares = [
      ...new Set(k.thisMonth.map((/** @type {any} */ cb) => cb.commissionBasisPoints)),
    ];
    const share =
      shares.length === 0 ? c.commissionBasisPoints : shares.length === 1 ? shares[0] : null;
    // "(October’s sales)": when everything a payment paid off was sold in one month.
    const months = new Set(
      (lastPayment?.allocations ?? []).map((a) =>
        new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: o.tz }).format(
          /** @type {Date} */ (a.channelBooking.confirmedAt),
        ),
      ),
    );
    const hint = c.apiKeyHint.replace(/^…/, '');
    return {
      ...k.view,
      tours: tours.map((t) => ({
        id: t.id,
        title: t.title,
        on: on.has(t.id) && t.status === 'published',
        canSwitch: t.status === 'published',
        note: tourNote(t, on.has(t.id), c.name),
      })),
      bookings: latest.map((cb) => {
        const money = bookingMoney(cb);
        const b = cb.booking;
        return {
          id: b.id,
          reference: b.reference,
          who: `${b.leadName} · ${whoShort(b.travellers)}`,
          tour: `${b.product.shortTitle ?? b.product.title} · ${dayWords(b.departure.startsAt, o.tz)}`,
          price: formatNaira(b.totalKobo),
          state: money.text,
          tone: money.tone,
        };
      }),
      money: {
        salesLabel: `Sales this month (${k.thisMonth.length})`,
        sales: formatNaira(k.monthKobo),
        shareLabel:
          share === null ? `${c.name}’s commission` : `${c.name}’s ${percentWords(share)}`,
        share: `− ${formatNaira(shareKobo)}`,
        owedLabel:
          k.view.owedKobo < 0 ? `${o.business} owes ${c.name}` : `${c.name} owes ${o.business}`,
        owed: formatNaira(Math.abs(k.view.owedKobo)),
        lastPayment: lastPayment
          ? `Last payment from ${c.name}: ${formatNaira(lastPayment.amountKobo)} on ${dateWords(
              lastPayment.receivedOn,
            )}${months.size === 1 ? ` (${[...months][0]}’s sales)` : ''}.`
          : null,
      },
      connection: {
        octoEndpoint,
        keyHint: hint,
        keyLine: [
          `ending ••••${hint}`,
          `made ${dayWords(c.apiKeyCreatedAt, o.tz)}`,
          c.apiKeyLastUsedAt
            ? `last used ${whenWords(c.apiKeyLastUsedAt, o.tz, o.now)}`
            : 'not used yet',
        ].join(' · '),
      },
      // Switched off: what stays (designs: "3 upcoming bookings from Sojourna stay as they are").
      keptLine: [
        k.upcoming === 0
          ? `No upcoming bookings from ${c.name}.`
          : k.upcoming === 1
            ? `1 upcoming booking from ${c.name} stays as it is; its guests can still come.`
            : `${k.upcoming} upcoming bookings from ${c.name} stay as they are; their guests can still come.`,
        k.view.owedKobo > 0 ? `${c.name} still owes ${formatNaira(k.view.owedKobo)}.` : null,
      ]
        .filter(Boolean)
        .join(' '),
    };
  }

  /** A name already used: 409. @template T @param {() => Promise<T>} fn */
  const named = async (fn) => {
    try {
      return await fn();
    } catch (err) {
      if (/** @type {any} */ (err)?.code === 'P2002') {
        throw new HttpError(409, 'NAME_TAKEN', 'You already have a channel with that name.');
      }
      throw err;
    }
  };

  router.get('/channels', requirePermission('channels', 'view'), async (req, res) => {
    const { operatorId } = authOf(req);
    const [channels, o] = await Promise.all([
      prisma.channel.findMany({
        where: { operatorId },
        include: withWhatCardsNeed,
        // Connected first, then by name.
        orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      }),
      context(operatorId),
    ]);
    res.json({ channels: channels.map((c) => card(c, o).view), octoEndpoint });
  });

  router.get(
    '/channels/:id',
    requirePermission('channels', 'view'),
    validate({ params: IdParamsSchema }),
    async (req, res) => {
      res.json({ channel: await detail(authOf(req).operatorId, req.params.id) });
    },
  );

  router.post(
    '/channels',
    requirePermission('channels', 'edit'),
    validate({ body: CreateChannelSchema }),
    async (req, res) => {
      const { operatorId } = authOf(req);
      const { name, commissionPercent } = req.body;
      // Every published tour starts switched on (designs: "You can change that after").
      const published = await prisma.product.findMany({
        where: { operatorId, status: 'published' },
        select: { id: true },
      });
      const { channel, apiKey } = await named(() =>
        createChannel(prisma, {
          operatorId,
          name,
          commissionBasisPoints: percentToBasisPoints(commissionPercent),
          productIds: published.map((p) => p.id),
        }),
      );
      res.status(201).json({
        channel: await detail(operatorId, channel.id),
        // Shown ONCE: store it now (designs: "you won’t see it again").
        apiKey,
        octoEndpoint,
      });
    },
  );

  router.patch(
    '/channels/:id',
    requirePermission('channels', 'edit'),
    validate({ params: IdParamsSchema, body: UpdateChannelSchema }),
    async (req, res) => {
      const { operatorId } = authOf(req);
      const c = await findOwn(operatorId, req.params.id);
      const { name, commissionPercent, isActive } = req.body;
      await named(() =>
        prisma.channel.update({
          where: { id: c.id },
          data: {
            name,
            isActive,
            // New sales only: each OTA booking froze its own (17b).
            commissionBasisPoints:
              commissionPercent === undefined ? undefined : percentToBasisPoints(commissionPercent),
          },
        }),
      );
      res.json({ channel: await detail(operatorId, c.id) });
    },
  );

  router.put(
    '/channels/:id/tours/:productId',
    requirePermission('channels', 'edit'),
    validate({
      params: z.object({ id: z.uuid(), productId: z.uuid() }),
      body: ChannelTourSchema,
    }),
    async (req, res) => {
      const { operatorId } = authOf(req);
      const c = await findOwn(operatorId, req.params.id);
      const tour = await prisma.product.findFirst({
        where: { id: req.params.productId, operatorId, status: { not: 'archived' } },
      });
      if (!tour) throw new HttpError(404, 'NOT_FOUND', 'Tour not found.');
      if (req.body.on) {
        if (tour.status !== 'published') {
          throw new HttpError(409, 'NOT_ON_SALE', 'Only published tours can be on a channel.');
        }
        await prisma.channelProduct.upsert({
          where: { channelId_productId: { channelId: c.id, productId: tour.id } },
          create: { channelId: c.id, productId: tour.id, operatorId },
          update: {},
        });
      } else {
        await prisma.channelProduct.deleteMany({ where: { channelId: c.id, productId: tour.id } });
      }
      res.json({ channel: await detail(operatorId, c.id) });
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
        data: {
          apiKeyHash: hashApiKey(apiKey),
          apiKeyHint: keyHint(apiKey),
          apiKeyCreatedAt: new Date(),
          apiKeyLastUsedAt: null,
        },
      });
      res.json({ apiKey, octoEndpoint, channel: await detail(operatorId, c.id) });
    },
  );

  router.post(
    '/channels/:id/payments',
    requirePermission('channels', 'edit'),
    validate({ params: IdParamsSchema, body: ChannelPaymentSchema }),
    async (req, res) => {
      const { operatorId, userId } = authOf(req);
      const o = await context(operatorId);
      if (req.body.receivedOn > localDate(o.now, o.tz)) {
        throw new HttpError(400, 'IN_THE_FUTURE', 'That day hasn’t come yet.');
      }
      try {
        await recordChannelPayment(prisma, {
          operatorId,
          channelId: req.params.id,
          amountKobo: req.body.amountKobo,
          receivedOn: req.body.receivedOn,
          reference: req.body.reference,
          recordedById: userId,
        });
      } catch (err) {
        if (err instanceof ChannelPaymentError) {
          throw new HttpError(err.code === 'NOT_FOUND' ? 404 : 409, err.code, err.message);
        }
        throw err;
      }
      res.status(201).json({ channel: await detail(operatorId, req.params.id) });
    },
  );

  return router;
}
