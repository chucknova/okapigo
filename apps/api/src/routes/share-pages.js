// @ts-check
/**
 * Share pages (BKG-32, stages 11e and 12b): the booking links people paste into WhatsApp,
 * Instagram, X, emails and QR codes. Each is server-made HTML that does three jobs:
 *
 *   1. LINK PREVIEWS: <meta> tags in the <head> (og:title, og:description, og:image…).
 *      Crawlers don't run JavaScript, so these must be in the HTML itself.
 *   2. A FAST FIRST PAINT: the page's title and summary are in the HTML too, styled with the
 *      app's own CSS, so a guest on slow 3G sees the right page before the app arrives.
 *   3. THE APP, WITH ITS DATA: the guest web (apps/web) loads into <div id="root">, and the
 *      same data the public API would return is EMBEDDED in the page
 *      (<script id="okg-data" type="application/json">), so the app draws the page at once
 *      instead of asking the API again. Live seat counts are still fetched (never cached).
 *
 *   GET /:operatorSlug                     the catalogue
 *   GET /:operatorSlug/:tourSlug           a tour page
 *   GET /:operatorSlug/:tourSlug/book      checkout (the app's screens arrive in 12c)
 *   GET /:operatorSlug/:tourSlug/card.png  the 1200×630 preview card (og:image)
 *   GET /:operatorSlug/card.png            the catalogue's card
 *
 * When the web app hasn't been built (tests, or an API deployed alone), the pages still
 * work: the stand-in body is readable on its own.
 *
 * Routing: these paths sit at the ROOT of the site, after every other route, so /api,
 * /health, /pay… always win. Reserved words (slug.js) are skipped with next(), and sign-up
 * never gives an operator one of them.
 */
import { Router } from 'express';
import { formatNaira } from '@okapigo/shared/money';
import {
  formatDay,
  formatDuration,
  tourPreviewDescription,
  truncate,
} from '@okapigo/shared/preview';
import { RESERVED_OPERATOR_SLUGS, RESERVED_TOUR_SLUGS } from '@okapigo/shared/slug';
import { escapeHtml } from './payments.js';
import { webAssetTags } from '../lib/web-assets.js';
import { createCardCache, CARD_WIDTH, CARD_HEIGHT } from '../lib/share-card.js';
import {
  loadCatalogueView,
  loadTourView,
  nextDeparturesWithSeats,
  withoutInternals,
} from '../lib/public-views.js';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Previews may be cached by crawlers and browsers for 5 minutes. */
const CACHE = 'public, max-age=300';

/**
 * JSON that is safe INSIDE a <script> tag. Plain JSON.stringify isn't: a tour title
 * containing "</script>" would end the tag early and let the rest run as HTML (XSS). Every
 * "<" becomes < (still the same character to JSON.parse), and so do the two Unicode
 * line separators that older JavaScript engines treat as line breaks.
 * @param {unknown} value
 */
export function jsonForScript(value) {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll(' ', '\\u2028')
    .replaceAll(' ', '\\u2029');
}

/**
 * @typedef {{
 *   title: string,            // og:title and <title>
 *   description: string,      // og:description and <meta name="description">
 *   url: string,              // og:url and <link rel="canonical">
 *   siteName: string,         // og:site_name: the operator's name
 *   image?: { url: string, alt: string, width?: number, height?: number } | null,
 *   price?: { kobo: number } | null,
 *   body: string,             // already-escaped HTML: the stand-in shown before the app
 *   data?: unknown,           // embedded for the app (see jsonForScript)
 * }} SharePage
 */

/**
 * The whole HTML document. EVERY value is escaped: tour titles and summaries are typed by
 * operators, and a title like  "><script>…  must show as text, never run (XSS).
 * @param {SharePage} p
 * @param {import('../lib/web-assets.js').WebAssets | null} assets
 */
function renderSharePage(p, assets) {
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
    if (p.image.width && p.image.height) {
      // Knowing the size lets apps draw the preview before the image arrives.
      meta.push(
        `<meta property="og:image:width" content="${p.image.width}">`,
        `<meta property="og:image:height" content="${p.image.height}">`,
      );
    }
  }
  if (p.price) {
    // Facebook/Instagram product price tags (shown by some apps under the title).
    meta.push(
      `<meta property="product:price:amount" content="${(p.price.kobo / 100).toFixed(2)}">`,
      `<meta property="product:price:currency" content="NGN">`,
    );
  }
  // With the built app: its CSS styles the stand-in, its script replaces it. Without it: a
  // few inline styles so the stand-in is readable on its own.
  const app = assets ? webAssetTags(assets) : '';
  const bodyStyle = assets
    ? ''
    : ' style="font-family: system-ui, sans-serif; max-width: 36rem; margin: 2rem auto; padding: 0 1rem; line-height: 1.5"';
  const data =
    p.data === undefined
      ? ''
      : `<script id="okg-data" type="application/json">${jsonForScript(p.data)}</script>\n`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(p.title)}</title>
<meta name="description" content="${e(p.description)}">
<link rel="canonical" href="${e(p.url)}">
${meta.join('\n')}
${app}
</head>
<body${bodyStyle}>
${data}<div id="root">${p.body}</div>
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
 * The header every guest page starts with, as plain HTML (the app draws the same).
 * @param {string} operatorName
 */
function standInHeader(operatorName) {
  const letter = [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(operatorName)][0]
    ?.segment;
  return `<header class="okg-header"><span class="okg-mark" aria-hidden="true">${escapeHtml(letter ?? '')}</span><span class="okg-header__name">${escapeHtml(operatorName)}</span></header>`;
}

/**
 * @param {{
 *   prisma: import('@prisma/client').PrismaClient,
 *   webPublicUrl: string,
 *   webAssets?: import('../lib/web-assets.js').WebAssets | null,
 * }} deps
 */
export function sharePagesRouter({ prisma, webPublicUrl, webAssets = null }) {
  const router = Router();
  const base = webPublicUrl.replace(/\/+$/, '');
  const cards = createCardCache();

  /**
   * What a tour's card says. Also hashed into the card's address (?v=…), so a changed title
   * or price gives a new address and apps that cached the old preview fetch the new one.
   * @param {NonNullable<Awaited<ReturnType<typeof loadTourView>>>} view
   */
  const tourCard = ({ operator, tour }) => ({
    operatorName: operator.name,
    facts: [formatDuration(tour.durationMinutes), scheduleSentence(tour.scheduleSummary)]
      .filter(Boolean)
      .join(' · '),
    title: tour.title,
    price: tour.fromPriceKobo !== null ? formatNaira(tour.fromPriceKobo) : null,
  });
  /** @param {NonNullable<Awaited<ReturnType<typeof loadCatalogueView>>>} view */
  const catalogueCard = ({ operator, tours }) => {
    const prices = tours.map((t) => t.fromPriceKobo).filter((p) => p !== null);
    return {
      operatorName: operator.name,
      facts: `${tours.length} ${tours.length === 1 ? 'tour' : 'tours'}`,
      title: operator.city ? `Tours in ${operator.city}` : `Tours by ${operator.name}`,
      price: prices.length > 0 ? formatNaira(Math.min(...prices)) : null,
      action: 'See tours',
    };
  };
  /** @param {import('../lib/share-card.js').CardInput} input @param {string} path */
  const cardImage = (input, path) => ({
    url: `${base}${path}/card.png?v=${cards.key(input)}`,
    alt: [input.title, input.operatorName, input.price && `from ${input.price}`]
      .filter(Boolean)
      .join(' · '),
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
  });
  /** @param {import('express').Response} res @param {Buffer} png */
  const sendPng = (res, png) =>
    // A day: the ?v= in the address changes whenever the card would.
    res.set('Cache-Control', 'public, max-age=86400').type('png').send(png);

  /** @param {import('express').Response} res */
  const sendNotFound = (res) => res.status(404).type('html').send(notFoundPage());

  /** Is this request ours? (Not a reserved word, and shaped like slugs.) */
  const isOperator = (/** @type {string} */ s) => SLUG.test(s) && !RESERVED_OPERATOR_SLUGS.has(s);
  const isTour = (/** @type {string} */ s) => SLUG.test(s) && !RESERVED_TOUR_SLUGS.has(s);

  // --- Preview cards (registered first: "card.png" isn't a slug, so the routes below would
  //     pass on it anyway, but being explicit is clearer) -------------------------------------
  router.get('/:operatorSlug/card.png', async (req, res, next) => {
    if (!isOperator(req.params.operatorSlug)) return next();
    const view = await loadCatalogueView(prisma, req.params.operatorSlug);
    if (!view) return sendNotFound(res);
    sendPng(res, await cards.get(catalogueCard(view)));
  });

  router.get('/:operatorSlug/:tourSlug/card.png', async (req, res, next) => {
    const { operatorSlug, tourSlug } = req.params;
    if (!isOperator(operatorSlug) || !isTour(tourSlug)) return next();
    const view = await loadTourView(prisma, operatorSlug, tourSlug);
    if (!view) return sendNotFound(res);
    sendPng(res, await cards.get(tourCard(view)));
  });

  // --- The catalogue: okapigo.app/irin-lagos-tours ------------------------------------------
  router.get('/:operatorSlug', async (req, res, next) => {
    const { operatorSlug } = req.params;
    // Not ours: a reserved word or not a slug at all → let the normal 404 answer.
    if (!isOperator(operatorSlug)) return next();

    const view = await loadCatalogueView(prisma, operatorSlug);
    if (!view) return sendNotFound(res);
    const { operator, tours } = view;

    const prices = tours.map((t) => t.fromPriceKobo).filter((p) => p !== null);
    const cheapest = prices.length > 0 ? Math.min(...prices) : null;
    const description =
      tours.length === 0
        ? 'New tours coming soon.'
        : truncate(
            `${tours.length} ${tours.length === 1 ? 'tour' : 'tours'}` +
              (cheapest !== null ? ` from ${formatNaira(cheapest)}` : '') +
              `: ${tours.map((t) => t.title).join(', ')}`,
            200,
          );
    const heading = operator.city ? `Tours in ${operator.city}` : 'Our tours';

    res
      .set('Cache-Control', CACHE)
      .type('html')
      .send(
        renderSharePage(
          {
            title: operator.name,
            description,
            url: `${base}/${operator.slug}`,
            siteName: operator.name,
            image: cardImage(catalogueCard(view), `/${operator.slug}`),
            data: { kind: 'catalogue', operatorSlug, view },
            body: `${standInHeader(operator.name)}
<main class="okg-page"><h1>${escapeHtml(heading)}</h1>
<ul>${tours
              .map(
                (t) =>
                  `<li><a href="/${escapeHtml(operator.slug)}/${escapeHtml(t.slug)}">${escapeHtml(t.title)}</a></li>`,
              )
              .join('')}</ul></main>`,
          },
          webAssets,
        ),
      );
  });

  /**
   * Loads a tour for its pages, or answers 404 / passes it on. Returns null when it answered.
   * @param {import('express').Request} req
   * @param {import('express').Response} res
   * @param {import('express').NextFunction} next
   */
  async function tourFor(req, res, next) {
    const { operatorSlug, tourSlug } = req.params;
    if (!isOperator(operatorSlug) || !isTour(tourSlug)) {
      next();
      return null;
    }
    const view = await loadTourView(prisma, operatorSlug, tourSlug);
    if (!view) {
      sendNotFound(res);
      return null;
    }
    const upcoming = (await nextDeparturesWithSeats(prisma, view.tour._operatorId)).get(
      view.tour._id,
    );
    return { view, nextStart: upcoming?.startsAt ?? null };
  }

  /**
   * The HTML for a tour's pages (the tour page itself, and checkout).
   * @param {NonNullable<Awaited<ReturnType<typeof tourFor>>>} found
   * @param {string} path  the page's own path, for og:url
   */
  function tourPage({ view, nextStart }, path) {
    const { operator, tour } = view;
    const nextDay = nextStart ? formatDay(nextStart, operator.timeZone) : null;
    const price = tour.fromPriceKobo;
    const description = tourPreviewDescription({
      summary: tour.summary,
      fromPriceKobo: price,
      durationMinutes: tour.durationMinutes,
      nextDay,
    });
    return renderSharePage(
      {
        title: `${tour.title} · ${operator.name}`,
        description,
        url: `${base}${path}`,
        siteName: operator.name,
        // The designed card (designs: "og:image (the 1200×630 card)"), not a raw photo.
        image: cardImage(tourCard(view), `/${operator.slug}/${tour.slug}`),
        price: price !== null ? { kobo: price } : null,
        data: {
          kind: 'tour',
          operatorSlug: operator.slug,
          tourSlug: tour.slug,
          view: withoutInternals(view),
        },
        // The first paint on a slow connection: the title and summary, as the designs ask.
        body: `${standInHeader(operator.name)}
<main class="okg-page"><h1>${escapeHtml(tour.title)}</h1>
<p>${escapeHtml(tour.summary)}</p>
<p>${escapeHtml(tourPreviewDescription({ summary: '', fromPriceKobo: price, durationMinutes: tour.durationMinutes, nextDay }))}</p></main>`,
      },
      webAssets,
    );
  }

  // --- One tour: okapigo.app/irin-lagos-tours/badagry-heritage-day-trip ---------------------
  router.get('/:operatorSlug/:tourSlug', async (req, res, next) => {
    const found = await tourFor(req, res, next);
    if (!found) return;
    res
      .set('Cache-Control', CACHE)
      .type('html')
      .send(tourPage(found, `/${found.view.operator.slug}/${found.view.tour.slug}`));
  });

  // --- Checkout: …/badagry-heritage-day-trip/book (screens in 12c) --------------------------
  router.get('/:operatorSlug/:tourSlug/book', async (req, res, next) => {
    const found = await tourFor(req, res, next);
    if (!found) return;
    // Previews of a checkout link should still describe the TOUR, so og:url is the tour.
    res
      .set('Cache-Control', CACHE)
      .type('html')
      .send(tourPage(found, `/${found.view.operator.slug}/${found.view.tour.slug}`));
  });

  return router;
}

/**
 * "Daily 09:00" → "daily at 09:00", "Thu–Sat 18:30" → "Thu–Sat at 18:30" (the card's facts
 * line reads as a sentence).
 * @param {string | null} summary  from scheduleSummary()
 */
function scheduleSentence(summary) {
  // Split before the FIRST time: "Mon, Sun 09:00, 15:00" has two.
  const match = summary?.match(/^(.*?) (\d\d:\d\d.*)$/);
  if (!match) return null;
  const [, days, times] = match;
  const lower = days === 'Daily' || days === 'Weekends' ? days.toLowerCase() : days;
  return `${lower} at ${times}`;
}
