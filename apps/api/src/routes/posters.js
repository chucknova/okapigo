// @ts-check
/**
 * Posters (MKT-01/02, stage 18b; designs P1–P2): pick a tour and a template, get a PNG.
 *
 *   GET /api/posters            marketing: view   the tours to choose from, each with its
 *                                                 departures in the next 14 days that have
 *                                                 seats, and how many this weekend
 *   GET /api/posters/png?…      marketing: view   the poster itself (lib/poster.js)
 *       template   new_tour · offer · seats_left · weekend
 *       size       square · story
 *       productId  the tour (not for "This weekend")
 *       departureId  "Seats left": which departure
 *       words      the headline (up to 30 characters); left out: the template's own
 *
 * Making a poster changes nothing, so "view" is enough: the owner and the manager both can.
 * The price, the seats and the dates are always read fresh, so a poster never shows a price
 * the business has changed. The same picture is drawn once and kept for a minute (drawing
 * takes a second or two), then drawn again with the latest seats.
 */
import { Router } from 'express';
import { z } from 'zod';
import { seatsLeft } from '@okapigo/db';
import { formatNaira } from '@okapigo/shared/money';
import { fromPriceKobo } from '@okapigo/shared/catalogue';
import { formatAt, formatDurationShort, scheduleSummary } from '@okapigo/shared/tour-facts';
import { formatDay, formatDuration } from '@okapigo/shared/preview';
import { addDays, localDate, localTime, zonedTimeToUtc } from '@okapigo/shared/time';
import {
  POSTER_TEMPLATES,
  POSTER_WORDS_MAX,
  SEATS_LEFT_DAYS,
  dayTag,
  posterFileName,
  posterTitle,
  weekendDays,
  weekendDayLabel,
} from '@okapigo/shared/posters';
import { requirePermission } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { HttpError } from '../middleware/errors.js';
import { renderPoster } from '../lib/poster.js';
import { pictureReader, noPictures } from '../lib/pictures.js';
import { readSite } from '@okapigo/shared/schemas/website';

const PngQuery = z.object({
  template: z.enum(['new_tour', 'offer', 'seats_left', 'weekend']),
  size: z.enum(['square', 'story']).default('square'),
  productId: z.uuid().optional(),
  departureId: z.uuid().optional(),
  words: z
    .string()
    .trim()
    .max(POSTER_WORDS_MAX, `Up to ${POSTER_WORDS_MAX} characters.`)
    .optional(),
});

/** A picture is kept this long: long enough for preview → download, short for live seats. */
const KEEP_MS = 60_000;

/**
 * @param {{ prisma: import('@prisma/client').PrismaClient, webPublicUrl: string, now?: () => Date,
 *   media?: import('@okapigo/media').Storage }} deps  media: where the logo and photos are
 */
export function postersRouter({ prisma, webPublicUrl, media, now = () => new Date() }) {
  // The logo and the cover photo, read from our own storage when drawing (19b-2b).
  const readPicture = media ? pictureReader(media) : noPictures;
  const router = Router();
  /** @type {Map<string, { at: number, png: Promise<Buffer> }>} */
  const kept = new Map();

  // @ts-ignore: req.auth is set by requireAuth
  const authOf = (req) => /** @type {import('../middleware/auth.js').AuthContext} */ (req.auth);

  /** The business's tours on sale, with what posters need. @param {string} operatorId */
  const tours = (operatorId) =>
    prisma.product.findMany({
      where: { operatorId, status: 'published' },
      include: { priceCategories: true, schedules: true },
      orderBy: { title: 'asc' },
    });

  /**
   * Departures with seats, between two local dates (inclusive), in the business's time zone.
   * @param {{ operatorId: string, productId?: string, from: string, to: string, tz: string }} q
   */
  async function withSeats({ operatorId, productId, from, to, tz }) {
    const start = zonedTimeToUtc(from, '00:00', tz);
    const at = now();
    const rows = await prisma.departure.findMany({
      where: {
        operatorId,
        ...(productId && { productId }),
        status: 'scheduled',
        startsAt: { gte: start > at ? start : at, lt: zonedTimeToUtc(addDays(to, 1), '00:00', tz) },
      },
      include: { resource: true, product: { include: { priceCategories: true } } },
      orderBy: { startsAt: 'asc' },
      take: 60,
    });
    return rows
      .map((d) => ({ d, seats: seatsLeft(/** @type {any} */ (d)) }))
      .filter((x) => x.seats > 0);
  }

  router.get('/posters', requirePermission('marketing', 'view'), async (req, res) => {
    const { operatorId, timeZone: tz } = authOf(req);
    const today = localDate(now(), tz);
    const list = await tours(operatorId);
    const soon = await withSeats({
      operatorId,
      from: today,
      to: addDays(today, SEATS_LEFT_DAYS),
      tz,
    });
    const weekend = weekendDays(today);
    res.json({
      tours: list.map((p) => {
        const from = fromPriceKobo(p.priceCategories);
        const runs = scheduleSummary(p.schedules);
        return {
          id: p.id,
          slug: p.slug,
          title: p.title,
          posterTitle: posterTitle(p),
          // Has a cover photo (19b-2b): Seats left and Offer show it.
          hasPhoto: /** @type {unknown[]} */ (p.photos ?? []).length > 0,
          meta: [
            from !== null && `From ${formatNaira(from)}`,
            formatDurationShort(p.durationMinutes),
            runs, // as the tour pages say it: "Daily 09:00", "Thu–Sat 18:30"
          ]
            .filter(Boolean)
            .join(' · '),
          departures: soon
            .filter((x) => x.d.productId === p.id)
            .slice(0, 10)
            .map((x) => ({
              id: x.d.id,
              when: formatAt(x.d.startsAt.getTime(), tz),
              seatsLeft: x.seats,
            })),
        };
      }),
      weekend: {
        days: weekend,
        count: soon.filter((x) => weekend.includes(localDate(x.d.startsAt, tz))).length,
      },
    });
  });

  router.get(
    '/posters/png',
    requirePermission('marketing', 'view'),
    validate({ query: PngQuery }),
    async (req, res) => {
      const { operatorId, timeZone: tz } = authOf(req);
      const q = /** @type {z.infer<typeof PngQuery>} */ (/** @type {any} */ (req).query);
      const op = await prisma.operator.findUniqueOrThrow({ where: { id: operatorId } });
      const today = localDate(now(), tz);
      const site = `${new URL(webPublicUrl).host}/${op.slug}`;
      const template = POSTER_TEMPLATES.find((t) => t.key === q.template);
      /** @type {import('../lib/poster.js').PosterData} */
      const data = {
        template: q.template,
        size: q.size,
        words: q.words || template?.words || '',
        business: { name: op.name, site, logo: readSite(op.site).logo?.url ?? null },
        url: `${webPublicUrl}/${op.slug}`,
      };
      let slug = op.slug;

      if (q.template === 'weekend') {
        const days = weekendDays(today);
        const found = await withSeats({
          operatorId,
          from: days[0],
          to: days.at(-1) ?? days[0],
          tz,
        });
        if (found.length === 0) {
          throw new HttpError(409, 'NOTHING_THIS_WEEKEND', 'Nothing on this weekend.');
        }
        data.weekend = days
          .map((day) => ({
            day: weekendDayLabel(day),
            trips: found
              .filter((x) => localDate(x.d.startsAt, tz) === day)
              .map((x) => {
                const from = fromPriceKobo(x.d.product.priceCategories);
                return {
                  time: localTime(x.d.startsAt, tz),
                  title: posterTitle(x.d.product),
                  price: from === null ? null : formatNaira(from),
                  seats: x.seats,
                };
              }),
          }))
          .filter((d) => d.trips.length > 0);
      } else {
        const p = q.productId
          ? await prisma.product.findFirst({
              where: { id: q.productId, operatorId, status: 'published' },
              include: { priceCategories: true, schedules: true },
            })
          : null;
        if (!p) throw new HttpError(404, 'NOT_FOUND', 'Tour not found.');
        slug = p.slug;
        const from = fromPriceKobo(p.priceCategories);
        const child = p.priceCategories
          .filter((c) => c.isActive && c.maxAge !== null && c.amountKobo > 0)
          .sort((a, b) => b.maxAge - a.maxAge)[0];
        data.url = `${webPublicUrl}/${op.slug}/${p.slug}`;
        data.tour = {
          title: posterTitle(p),
          summary: p.summary,
          stops: /** @type {Array<{ name: string }>} */ (p.stops ?? []).map((s) => s.name),
          meetingPoint: /** @type {any} */ (p.meetingPoint)?.name ?? '',
          price: from === null ? null : formatNaira(from),
          childPrice: child ? formatNaira(child.amountKobo) : null,
          duration: formatDuration(p.durationMinutes),
          runs: scheduleSummary(p.schedules),
          // The cover (19b-2b): Seats left's panel and Offer's circle show it.
          photo: (() => {
            const cover = /** @type {any[]} */ (p.photos ?? [])[0];
            return cover ? { url: cover.url, credit: cover.credit ?? null } : null;
          })(),
        };
        if (q.template === 'seats_left') {
          const d = q.departureId
            ? await prisma.departure.findFirst({
                where: { id: q.departureId, productId: p.id, operatorId, status: 'scheduled' },
                include: { resource: true },
              })
            : null;
          if (!d || d.startsAt <= now())
            throw new HttpError(404, 'NOT_FOUND', 'Departure not found.');
          const seats = seatsLeft(/** @type {any} */ (d));
          if (seats === 0) throw new HttpError(409, 'SOLD_OUT', 'That departure is full.');
          data.departure = {
            when: `${formatDay(d.startsAt, tz)} at ${localTime(d.startsAt, tz)}`,
            seats,
          };
          data.words = q.words || dayTag(localDate(d.startsAt, tz), today);
        }
      }

      const key = JSON.stringify(data);
      const at = Date.now();
      let entry = kept.get(key);
      if (!entry || at - entry.at > KEEP_MS) {
        entry = { at, png: renderPoster(data, { readPicture }) };
        // A failed drawing mustn't stay kept: the next request tries again.
        entry.png.catch(() => kept.delete(key));
        kept.set(key, entry);
        for (const [k, v] of kept) if (at - v.at > KEEP_MS) kept.delete(k);
      }
      const png = await entry.png;
      res
        .set('Content-Type', 'image/png')
        .set('Cache-Control', 'private, no-store')
        .set(
          'Content-Disposition',
          `attachment; filename="${posterFileName(slug, q.template, q.size)}"`,
        )
        .send(png);
    },
  );

  return router;
}
