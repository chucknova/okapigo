// @ts-check
/**
 * Share pages (BKG-32, stage 11e): the booking links people paste into WhatsApp, Instagram,
 * X, emails and QR codes, with PROPER LINK PREVIEWS.
 *
 *   GET /:operatorSlug               the operator's catalogue   okapigo.app/irin-lagos-tours
 *   GET /:operatorSlug/:tourSlug     one tour                    …/irin-lagos-tours/badagry-heritage-day-trip
 *
 * How previews work: when a link is pasted, the app's CRAWLER (WhatsApp, facebookexternalhit,
 * Twitterbot…) downloads the page and reads <meta> tags in its <head>:
 *
 *   og:title        "Badagry Heritage Day Trip · Ìrìn Lagos Tours"
 *   og:description  "A full day in Badagry… · From ₦65,000 · 10 hours · Next: Sat 5 Dec"
 *   og:image        a picture (when the tour has one)
 *   og:url          the one true address of the page
 *
 * Crawlers DON'T RUN JAVASCRIPT. A page that only fills itself in with React would preview
 * as an empty title. So the server writes these tags into the HTML itself. In session 12
 * the guest web app is served INSIDE this same page (the <body> below is the stand-in until
 * then); the head with the tags stays server-made.
 *
 * Routing: these paths sit at the ROOT of the site, after every other route, so /api,
 * /health, /pay… always win. Reserved words (slug.js) are skipped with next(), and sign-up
 * never gives an operator one of them.
 */
import { Router } from 'express';
import { fromPriceKobo } from '@okapigo/shared/catalogue';
import { formatNaira } from '@okapigo/shared/money';
import { formatDay, tourPreviewDescription, truncate } from '@okapigo/shared/preview';
import { RESERVED_OPERATOR_SLUGS, RESERVED_TOUR_SLUGS } from '@okapigo/shared/slug';
import { escapeHtml } from './payments.js';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Previews may be cached by crawlers and browsers for 5 minutes. */
const CACHE = 'public, max-age=300';

/**
 * @typedef {{
 *   title: string,            // og:title and <title>
 *   description: string,      // og:description and <meta name="description">
 *   url: string,              // og:url and <link rel="canonical">
 *   siteName: string,         // og:site_name: the operator's name
 *   image?: { url: string, alt: string } | null,
 *   price?: { kobo: number } | null,
 *   body: string,             // already-escaped HTML for the page body
 * }} SharePage
 */

/**
 * The whole HTML document. EVERY value is escaped: tour titles and summaries are typed by
 * operators, and a title like  "><script>…  must show as text, never run (XSS).
 * @param {SharePage} p
 */
function renderSharePage(p) {
  const e = escapeHtml;
  const meta = [
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="${e(p.siteName)}">`,
    `<meta property="og:title" content="${e(p.title)}">`,
    `<meta property="og:description" content="${e(p.description)}">`,
    `<meta property="og:url" content="${e(p.url)}">`,
    `<meta property="og:locale" content="en_NG">`,
    // X (Twitter) reads its own tags, falling back to og:* for title and description. A big
    // picture card when there's a picture, a small text card when there isn't.
    `<meta name="twitter:card" content="${p.image ? 'summary_large_image' : 'summary'}">`,
  ];
  if (p.image) {
    meta.push(
      `<meta property="og:image" content="${e(p.image.url)}">`,
      `<meta property="og:image:alt" content="${e(p.image.alt)}">`,
    );
  }
  if (p.price) {
    // Facebook/Instagram product price tags (shown by some apps under the title).
    meta.push(
      `<meta property="product:price:amount" content="${(p.price.kobo / 100).toFixed(2)}">`,
      `<meta property="product:price:currency" content="NGN">`,
    );
  }
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(p.title)}</title>
<meta name="description" content="${e(p.description)}">
<link rel="canonical" href="${e(p.url)}">
${meta.join('\n')}
</head>
<body style="font-family: system-ui, sans-serif; max-width: 36rem; margin: 2rem auto; padding: 0 1rem; line-height: 1.5">
${p.body}
</body>
</html>`;
}

/** A 404 page that search engines are told not to index. */
function notFoundPage() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Not found</title></head>
<body style="font-family: system-ui, sans-serif; max-width: 36rem; margin: 2rem auto; padding: 0 1rem">
<h1>We couldn't find that page</h1><p>The link may be old, or the tour is no longer on sale.</p>
</body></html>`;
}

/**
 * @param {{ prisma: import('@prisma/client').PrismaClient, webPublicUrl: string }} deps
 */
export function sharePagesRouter({ prisma, webPublicUrl }) {
  const router = Router();
  const base = webPublicUrl.replace(/\/+$/, '');

  /**
   * Each published tour's next departure with a free seat (the same rule as the catalogue's
   * cards in stage 11a), keyed by product id.
   * @param {string} operatorId
   */
  async function nextDepartures(operatorId) {
    /** @type {Array<{ product_id: string, starts_at: Date }>} */
    const rows = await prisma.$queryRaw`
      SELECT DISTINCT ON (product_id) product_id, starts_at
        FROM departures
       WHERE operator_id = ${operatorId}::uuid AND status = 'scheduled' AND starts_at > now()
         AND capacity - seats_sold - seats_held > 0
       ORDER BY product_id, starts_at`;
    return new Map(rows.map((r) => [r.product_id, r.starts_at]));
  }

  /** @param {import('express').Response} res */
  const sendNotFound = (res) => res.status(404).type('html').send(notFoundPage());

  // --- The catalogue: okapigo.app/irin-lagos-tours ------------------------------------------
  router.get('/:operatorSlug', async (req, res, next) => {
    const { operatorSlug } = req.params;
    // Not ours: a reserved word or not a slug at all → let the normal 404 answer.
    if (!SLUG.test(operatorSlug) || RESERVED_OPERATOR_SLUGS.has(operatorSlug)) return next();

    const operator = await prisma.operator.findUnique({ where: { slug: operatorSlug } });
    if (!operator) return sendNotFound(res);
    const tours = await prisma.product.findMany({
      where: { operatorId: operator.id, status: 'published' },
      include: { priceCategories: { where: { isActive: true } } },
      orderBy: { title: 'asc' },
    });
    const nextByTour = await nextDepartures(operator.id);
    const prices = tours.map((t) => fromPriceKobo(t.priceCategories)).filter((p) => p !== null);
    const cheapest = prices.length > 0 ? Math.min(...prices) : null;
    const photo = tours.map((t) => /** @type {any[]} */ (t.photos)[0]).find(Boolean) ?? null;

    const description =
      tours.length === 0
        ? 'New tours coming soon.'
        : truncate(
            `${tours.length} ${tours.length === 1 ? 'tour' : 'tours'}` +
              (cheapest !== null ? ` from ${formatNaira(cheapest)}` : '') +
              `: ${tours.map((t) => t.title).join(', ')}`,
            200,
          );

    res
      .set('Cache-Control', CACHE)
      .type('html')
      .send(
        renderSharePage({
          title: operator.name,
          description,
          url: `${base}/${operator.slug}`,
          siteName: operator.name,
          image: photo,
          body: `<h1>${escapeHtml(operator.name)}</h1>
<ul>${tours
            .map((t) => {
              const day = nextByTour.get(t.id);
              return `<li><a href="/${escapeHtml(operator.slug)}/${escapeHtml(t.slug)}">${escapeHtml(t.title)}</a>${
                day ? ` · next ${escapeHtml(formatDay(day, operator.timeZone))}` : ''
              }</li>`;
            })
            .join('')}</ul>`,
        }),
      );
  });

  // --- One tour: okapigo.app/irin-lagos-tours/badagry-heritage-day-trip ---------------------
  router.get('/:operatorSlug/:tourSlug', async (req, res, next) => {
    const { operatorSlug, tourSlug } = req.params;
    if (
      !SLUG.test(operatorSlug) ||
      !SLUG.test(tourSlug) ||
      RESERVED_OPERATOR_SLUGS.has(operatorSlug) ||
      RESERVED_TOUR_SLUGS.has(tourSlug)
    ) {
      return next();
    }

    const operator = await prisma.operator.findUnique({ where: { slug: operatorSlug } });
    const tour = operator
      ? await prisma.product.findFirst({
          // Published only: a draft's link previews as "not found", like the public API.
          where: { operatorId: operator.id, slug: tourSlug, status: 'published' },
          include: { priceCategories: { where: { isActive: true } } },
        })
      : null;
    if (!operator || !tour) return sendNotFound(res);

    const nextStart = (await nextDepartures(operator.id)).get(tour.id) ?? null;
    const nextDay = nextStart ? formatDay(nextStart, operator.timeZone) : null;
    const price = fromPriceKobo(tour.priceCategories);
    const photo = /** @type {Array<{ url: string, alt: string }>} */ (tour.photos)[0] ?? null;
    const description = tourPreviewDescription({
      summary: tour.summary,
      fromPriceKobo: price,
      durationMinutes: tour.durationMinutes,
      nextDay,
    });

    res
      .set('Cache-Control', CACHE)
      .type('html')
      .send(
        renderSharePage({
          title: `${tour.title} · ${operator.name}`,
          description,
          url: `${base}/${operator.slug}/${tour.slug}`,
          siteName: operator.name,
          image: photo,
          price: price !== null ? { kobo: price } : null,
          // Stand-in body until the guest web (session 12): enough to be useful on its own.
          body: `<p><a href="/${escapeHtml(operator.slug)}">${escapeHtml(operator.name)}</a></p>
<h1>${escapeHtml(tour.title)}</h1>
<p>${escapeHtml(tour.summary)}</p>
<p>${escapeHtml(tourPreviewDescription({ summary: '', fromPriceKobo: price, durationMinutes: tour.durationMinutes, nextDay }))}</p>`,
        }),
      );
  });

  return router;
}
