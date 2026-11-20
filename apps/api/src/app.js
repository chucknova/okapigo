// @ts-check
/**
 * app.js — builds the Express application, but does NOT start listening.
 *
 * Why split app.js from server.js?
 *  - app.js: "what the API does" (middleware + routes). Pure setup, no side effects.
 *  - server.js: "run it for real" (open DB connections, listen on a port, shut down cleanly).
 * Tests import createApp() and fire requests at it with Supertest. No port, no real
 * server, and they can pass in fake dependencies.
 */
import express from 'express';
import { join } from 'node:path';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { randomUUID } from 'node:crypto';
import { healthRouter } from './routes/health.js';
import { authRouter } from './routes/auth.js';
import { meRouter } from './routes/me.js';
import { rolesRouter } from './routes/roles.js';
import { staffRouter } from './routes/staff.js';
import { productsRouter } from './routes/products.js';
import { schedulesRouter } from './routes/schedules.js';
import { quotesRouter } from './routes/quotes.js';
import { holdsRouter } from './routes/holds.js';
import { bookingsRouter } from './routes/bookings.js';
import { policiesRouter } from './routes/policies.js';
import { ledgerRouter } from './routes/ledger.js';
import { paymentsRouters } from './routes/payments.js';
import { webhooksRouter } from './routes/webhooks.js';
import { paymentLinksRouters } from './routes/payment-links.js';
import { refundsRouter } from './routes/refunds.js';
import { alertsRouter } from './routes/alerts.js';
import { guestRequestsRouter } from './routes/guest-requests.js';
import { websiteRouter } from './routes/website.js';
import { whatsappSimulatorRouter } from './routes/whatsapp-simulator.js';
import { conversationsRouter } from './routes/conversations.js';
import { whatsappWebhookRouter } from './routes/whatsapp-webhook.js';
import { whatsappSettingsRouter } from './routes/whatsapp-settings.js';
import { messageTemplatesRouter } from './routes/message-templates.js';
import { operationsRouter } from './routes/operations.js';
import { syncRouter } from './routes/sync.js';
import { todayRouter } from './routes/today.js';
import { boardRouter } from './routes/board.js';
import { deskRouter } from './routes/desk.js';
import { inboxRouter } from './routes/inbox.js';
import { createChannels } from './whatsapp/channels.js';
import { sharePagesRouter } from './routes/share-pages.js';
import { publicCatalogueRouter } from './routes/public-catalogue.js';
import { publicCheckoutRouter } from './routes/public-checkout.js';
import { createQuoteService } from './pricing/quote-service.js';
import { notFound, errorHandler } from './middleware/errors.js';
import { requireAuth } from './middleware/auth.js';
import { createOtpService } from './auth/otp-service.js';
import { createSessionService } from './auth/session-service.js';

/**
 * @param {{
 *   logger: import('pino').Logger,
 *   prisma: import('@prisma/client').PrismaClient,
 *   redis: { ping: () => Promise<unknown> },
 *   otpSender: import('./auth/otp-sender.js').OtpSender,
 *   authSecret: string,
 *   jobs: {
 *     scheduleHoldExpiry: (holdId: string, expiresAt: Date) => Promise<void>,
 *     enqueueWebhook: (eventId: string) => Promise<void>,
 *   },
 *   provider: import('@okapigo/payments').PaymentProvider,
 *   apiPublicUrl: string,
 *   rateLimitStore: import('./middleware/rate-limit.js').RateLimitStore,
 *   publicLimits?: typeof import('./routes/public-checkout.js').DEFAULT_PUBLIC_LIMITS,
 *   simulatorLimit?: number, // WhatsApp simulator messages per minute per IP (default 120)
 *   whatsapp?: {             // the WhatsApp Cloud API (13c-3); null = the simulator only
 *     accessToken: string, appSecret: string, verifyToken: string, graphVersion: string,
 *     templateLanguage?: string,
 *     fetch?: typeof fetch,  // tests pass a fake Meta
 *   } | null,
 *   webPublicUrl?: string,   // where guests see booking links; default: apiPublicUrl
 *   webAssets?: import('./lib/web-assets.js').WebAssets | null,  // the built guest web, if any
 *   simulatorDir?: string | null, // the built WhatsApp simulator app (apps/simulators/dist), if any
 *   operatorDir?: string | null,  // the built operator app (apps/operator/dist), if any
 * }} deps
 */
export function createApp({
  logger,
  prisma,
  redis,
  otpSender,
  authSecret,
  jobs,
  provider,
  apiPublicUrl,
  rateLimitStore,
  publicLimits,
  simulatorLimit,
  whatsapp = null,
  webPublicUrl = apiPublicUrl,
  webAssets = null,
  simulatorDir = null,
  operatorDir = null,
}) {
  // Services hold the business logic; routes stay thin (parse input → call service → reply).
  const sessions = createSessionService({ prisma });
  const otp = createOtpService({ prisma, otpSender, authSecret });
  // Where chat messages are delivered (the simulator now; WhatsApp in 13c).
  const channels = createChannels({
    whatsapp: whatsapp && {
      accessToken: whatsapp.accessToken,
      graphVersion: whatsapp.graphVersion,
      templateLanguage: whatsapp.templateLanguage,
      fetch: whatsapp.fetch,
      log: logger,
    },
  });
  const authenticate = requireAuth(sessions);
  const quotes = createQuoteService({ prisma });
  const payments = paymentsRouters({ prisma, provider, apiPublicUrl });
  const paymentLinks = paymentLinksRouters({ prisma, provider, apiPublicUrl, webPublicUrl });

  const app = express();

  // Don't advertise "X-Powered-By: Express" to the world.
  app.disable('x-powered-by');

  // Sets sensible security headers (no MIME sniffing, frame restrictions, etc.). The one
  // change to helmet's default Content-Security-Policy: the trip hub's small map shows
  // OpenStreetMap tiles (stage 12f), so images may also come from their tile server.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: { 'img-src': ["'self'", 'data:', 'https://tile.openstreetmap.org'] },
      },
    }),
  );

  // Logs one line per request and gives every request an ID (also sent back as the
  // X-Request-Id header). When a guest reports a problem, that ID finds the exact logs.
  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const id = req.headers['x-request-id']?.toString() ?? randomUUID();
        res.setHeader('X-Request-Id', id);
        return id;
      },
      // Health checks run every few seconds in production; don't flood the logs with them.
      autoLogging: { ignore: (req) => req.url === '/health' },
      // Log only what helps debugging. Full header dumps are noise (and can hold secrets).
      serializers: {
        req: (req) => ({ id: req.id, method: req.method, url: req.url }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    }),
  );

  // Webhooks FIRST: they need the raw request bytes to check the signature, and the JSON
  // parser below would consume them. (See routes/webhooks.js.)
  app.use(webhooksRouter({ prisma, provider, jobs }));
  // WhatsApp's webhook (13c-3), only when this server is connected to WhatsApp.
  if (whatsapp) {
    app.use(
      whatsappWebhookRouter({
        prisma,
        quotes,
        jobs,
        webPublicUrl,
        channels,
        appSecret: whatsapp.appSecret,
        verifyToken: whatsapp.verifyToken,
      }),
    );
  }

  // Parse JSON request bodies. The size limit stops someone sending a 1 GB body.
  // Except a phone's outbox after a long day offline: up to 500 changes (stage 15b), which
  // need more room. Parsed here first; the general parser then leaves it alone.
  app.use('/api/sync/changes', express.json({ limit: '1mb' }));
  app.use(express.json({ limit: '100kb' }));

  // --- Public routes (no sign-in needed) --------------------------------------
  app.use(healthRouter({ prisma, redis }));
  app.use(authRouter({ prisma, otp, sessions, requireAuth: authenticate }));
  app.use(payments.publicRouter); // the guest's browser lands on these after paying
  app.use(paymentLinks.publicRouter); // /pay/:token
  app.use(publicCatalogueRouter({ prisma })); // /public/:operatorSlug/… (tours, dates)
  app.use(
    // quote, hold + book, the guest's booking (rate-limited per IP)
    publicCheckoutRouter({
      prisma,
      quotes,
      jobs,
      authSecret,
      rateLimitStore,
      limits: publicLimits,
      provider,
      apiPublicUrl,
      webPublicUrl,
    }),
  );

  // The WhatsApp simulator (BKG-09, session 13): a guest's chat, the same booking engine as
  // the real WhatsApp will use. Public like the website's checkout, and rate-limited.
  app.use(
    whatsappSimulatorRouter({
      prisma,
      quotes,
      jobs,
      authSecret,
      webPublicUrl,
      rateLimitStore,
      channels,
      limit: simulatorLimit,
    }),
  );

  // The simulator APP (13c-2), built by apps/simulators: /simulator/whatsapp/ in a browser.
  // After the simulator's API routes above, so those always win; only real files are served.
  if (simulatorDir) {
    app.use(
      '/simulator/whatsapp/assets',
      express.static(join(simulatorDir, 'assets'), {
        immutable: true,
        maxAge: '365d',
        index: false,
      }),
    );
    app.use(
      '/simulator/whatsapp',
      express.static(simulatorDir, { index: 'index.html', maxAge: 0 }),
    );
  }

  // The operator app (session 15), built by apps/operator: /app/ on a staff phone.
  //   /app/assets/*   hashed names: kept for a year
  //   /app/sw.js      the service worker: never cached, so a new version is picked up
  //   /app/<any page> the app's index.html: its pages are drawn in the browser
  if (operatorDir) {
    app.use(
      '/app/assets',
      express.static(join(operatorDir, 'assets'), {
        immutable: true,
        maxAge: '365d',
        index: false,
      }),
    );
    app.use(
      '/app',
      express.static(operatorDir, {
        index: false,
        maxAge: 0,
        setHeaders: (res, path) => {
          if (path.endsWith('.webmanifest'))
            res.setHeader('Content-Type', 'application/manifest+json');
          if (path.endsWith('sw.js') || path.endsWith('precache.json')) {
            res.setHeader('Cache-Control', 'no-cache');
          }
        },
      }),
    );
    app.get(/^\/app(\/.*)?$/, (req, res, next) => {
      if (req.path.startsWith('/app/assets/')) return next(); // a missing asset is a 404
      res.set('Cache-Control', 'no-cache').sendFile(join(operatorDir, 'index.html'));
    });
  }

  // --- Staff API: everything under /api requires sign-in ----------------------
  // DEFAULT DENY: `authenticate` runs before every /api route, so a route added here later
  // can't be left open by accident. Each router then checks its module permission.
  const api = express.Router();
  api.use(authenticate);
  api.use(meRouter({ prisma }));
  api.use(rolesRouter({ prisma }));
  api.use(staffRouter({ prisma, sessions }));
  api.use(productsRouter({ prisma }));
  api.use(schedulesRouter({ prisma, provider }));
  api.use(quotesRouter({ quotes }));
  api.use(holdsRouter({ prisma, quotes, jobs }));
  api.use(bookingsRouter({ prisma, quotes, jobs, provider }));
  api.use(policiesRouter({ prisma }));
  api.use(ledgerRouter({ prisma }));
  api.use(payments.apiRouter);
  api.use(paymentLinks.apiRouter);
  api.use(refundsRouter({ prisma, provider }));
  api.use(alertsRouter({ prisma }));
  api.use(guestRequestsRouter({ prisma })); // "Ask Ìrìn" from the trip hub (12f-2)
  api.use(websiteRouter({ prisma })); // the website's style and mode (12g)
  api.use(messageTemplatesRouter({ prisma })); // the guest messages' wording (14a)
  api.use(operationsRouter({ prisma, authSecret })); // resources, manifests, check-in (15a)
  api.use(syncRouter({ prisma, authSecret, webPublicUrl })); // the operator app offline: package, outbox (15b)
  api.use(todayRouter({ prisma })); // the manager's Today (16a)
  api.use(boardRouter({ prisma })); // the schedule and a departure's page (16b)
  api.use(deskRouter({ prisma, provider, webPublicUrl })); // the bookings desk (16c)
  api.use(inboxRouter({ prisma })); // the inbox (16d)
  api.use(whatsappSettingsRouter({ prisma, connected: Boolean(whatsapp), apiPublicUrl })); // 13c-3
  api.use(conversationsRouter({ prisma, quotes, jobs, webPublicUrl, channels })); // WhatsApp chats: take over, reply (13b)
  // Future sessions mount more routers here (holds, bookings, payments, ...).
  app.use('/api', api);

  // --- The built guest web's files (production) ---------------------------------------
  // Hashed names (index-BSGQF.js) change whenever the content does, so browsers may keep
  // them for a year without ever running stale code. ("assets" is a reserved slug.)
  if (webAssets) {
    app.use(
      '/assets',
      express.static(join(webAssets.dir, 'assets'), {
        immutable: true,
        maxAge: '365d',
        index: false,
      }),
    );
  }

  // --- Share pages with link previews: /:operatorSlug and /:operatorSlug/:tourSlug ------
  // LAST, so every route above wins; reserved words are skipped (see share-pages.js).
  app.use(sharePagesRouter({ prisma, webPublicUrl, webAssets }));

  // --- Errors (must come after all routes) -----------------------------------
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
