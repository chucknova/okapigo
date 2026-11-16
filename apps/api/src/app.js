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
 * }} deps
 */
export function createApp({ logger, prisma, redis, otpSender, authSecret }) {
  // Services hold the business logic; routes stay thin (parse input → call service → reply).
  const sessions = createSessionService({ prisma });
  const otp = createOtpService({ prisma, otpSender, authSecret });
  const authenticate = requireAuth(sessions);
  const quotes = createQuoteService({ prisma });

  const app = express();

  // Don't advertise "X-Powered-By: Express" to the world.
  app.disable('x-powered-by');

  // Sets sensible security headers (no MIME sniffing, frame restrictions, etc.).
  app.use(helmet());

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

  // Parse JSON request bodies. The size limit stops someone sending a 1 GB body.
  app.use(express.json({ limit: '100kb' }));

  // --- Public routes (no sign-in needed) --------------------------------------
  app.use(healthRouter({ prisma, redis }));
  app.use(authRouter({ prisma, otp, sessions, requireAuth: authenticate }));

  // --- Staff API: everything under /api requires sign-in ----------------------
  // DEFAULT DENY: `authenticate` runs before every /api route, so a route added here later
  // can't be left open by accident. Each router then checks its module permission.
  const api = express.Router();
  api.use(authenticate);
  api.use(meRouter({ prisma }));
  api.use(rolesRouter({ prisma }));
  api.use(staffRouter({ prisma, sessions }));
  api.use(productsRouter({ prisma }));
  api.use(schedulesRouter({ prisma }));
  api.use(quotesRouter({ quotes }));
  // Future sessions mount more routers here (holds, bookings, payments, ...).
  app.use('/api', api);

  // --- Errors (must come after all routes) -----------------------------------
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
