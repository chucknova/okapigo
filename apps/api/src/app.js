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
import { notFound, errorHandler } from './middleware/errors.js';

/**
 * @param {{
 *   logger: import('pino').Logger,
 *   db: { query: (sql: string) => Promise<unknown> },
 *   redis: { ping: () => Promise<unknown> },
 * }} deps
 */
export function createApp({ logger, db, redis }) {
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

  // --- Routes ---------------------------------------------------------------
  app.use(healthRouter({ db, redis }));
  // Future sessions mount more routers here (auth, products, bookings, ...).

  // --- Errors (must come after all routes) -----------------------------------
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
