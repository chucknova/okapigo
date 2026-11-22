// @ts-check
/**
 * app.js — Sojourna's own server: its pages' API, in front of the supplier's OCTO API.
 *
 * Why a server at all, when the pages could call OCTO themselves? The API key. A supplier's
 * key lets whoever holds it hold seats and make bookings, so it must never reach a browser:
 * it stays here, and the pages ask this server (like any real travel website).
 *
 *   GET  /api/supplier                      the business: name, phone, where it is
 *   GET  /api/experiences                   its tours (OCTO products, with prices and content)
 *   GET  /api/experiences/:id               one
 *   GET  /api/experiences/:id/calendar      ?from=&to=  day by day: open, seats, sold out
 *   GET  /api/experiences/:id/times         ?date=      the departures that day, seats left
 *   POST /api/holds                         hold seats for 15 minutes (OCTO reserve)
 *   GET  /api/holds/:uuid                   the hold, while the guest pays
 *   POST /api/holds/:uuid/confirm           the guest paid (a test site: nothing is charged)
 *   GET  /api/bookings/:ref                 "You're booked": the booking, its ticket, the tour
 *
 * When something goes wrong, the answer says which of the designs' states to show:
 *   { problem: 'offline' }        the supplier isn't answering (M1, "Try again")
 *   { problem: 'taken', vacancies }   seats went while choosing (M2 → M3)
 *   { problem: 'expired' }        the hold ran out (M3)
 *   { problem: 'not_confirmed' }  the supplier didn't confirm (M3): nothing charged
 *   { problem: 'refused', message }   anything else the supplier refused, in its words
 */
import express from 'express';
import { randomInt, randomUUID } from 'node:crypto';
import { OctoClientError } from './octo-client.js';

export const OPTION_ID = 'DEFAULT';
/** How long seats are held while the guest pays (designs: "Continue holds your seats for 15 minutes"). */
export const HOLD_MINUTES = 15;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

class Problem extends Error {
  /** @param {number} status @param {string} problem @param {string} message @param {object} [more] */
  constructor(status, problem, message, more = {}) {
    super(message);
    this.status = status;
    this.problem = problem;
    this.more = more;
  }
}

/**
 * @param {{
 *   octo: ReturnType<typeof import('./octo-client.js').createOctoClient>,
 *   store: ReturnType<typeof import('./store.js').createStore>,
 *   newRef?: () => string,
 *   pages?: import('express').RequestHandler | null,   the pages (Vite in development, dist/ when built)
 * }} deps
 */
export function createApp({ octo, store, newRef, pages = null }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '20kb' }));

  /** "SJ-48213": five digits, not used before. */
  const makeRef =
    newRef ??
    (() => {
      for (;;) {
        const ref = `SJ-${randomInt(10_000, 100_000)}`;
        if (!store.has(ref)) return ref;
      }
    });

  /** @param {unknown} v */
  const text = (v) => (typeof v === 'string' ? v.trim() : '');

  app.get('/api/supplier', async (req, res) => {
    res.json({ supplier: await octo.get('/supplier') });
  });

  app.get('/api/experiences', async (req, res) => {
    res.json({ experiences: await octo.get('/products') });
  });

  app.get('/api/experiences/:id', async (req, res) => {
    res.json({ experience: await octo.get(`/products/${encodeURIComponent(req.params.id)}`) });
  });

  app.get('/api/experiences/:id/calendar', async (req, res) => {
    const from = text(req.query.from);
    const to = text(req.query.to);
    if (!DATE.test(from) || !DATE.test(to)) {
      throw new Problem(400, 'refused', 'Send from and to, like 2026-12-01.');
    }
    const days = await octo.post('/availability/calendar', {
      productId: req.params.id,
      optionId: OPTION_ID,
      localDateStart: from,
      localDateEnd: to,
    });
    res.json({ days });
  });

  app.get('/api/experiences/:id/times', async (req, res) => {
    const date = text(req.query.date);
    if (!DATE.test(date)) throw new Problem(400, 'refused', 'Send a date, like 2026-12-12.');
    const times = await octo.post('/availability', {
      productId: req.params.id,
      optionId: OPTION_ID,
      localDateStart: date,
      localDateEnd: date,
    });
    res.json({ times });
  });

  app.post('/api/holds', async (req, res) => {
    const b = req.body ?? {};
    /** @type {Array<{ unitId: string }>} */
    const unitItems = [];
    for (const [unitId, n] of Object.entries(b.units ?? {})) {
      const count = Number(n);
      if (!Number.isInteger(count) || count < 0 || count > 20) {
        throw new Problem(400, 'refused', 'Choose how many are coming.');
      }
      for (let i = 0; i < count; i++) unitItems.push({ unitId });
    }
    if (unitItems.length === 0) throw new Problem(400, 'refused', 'Choose who’s coming.');
    try {
      const booking = await octo.post('/bookings', {
        uuid: randomUUID(),
        productId: text(b.productId),
        optionId: OPTION_ID,
        availabilityId: text(b.availabilityId),
        unitItems,
        expirationMinutes: HOLD_MINUTES,
        ...(b.pickupLocationId && {
          pickupRequested: true,
          pickupLocationId: text(b.pickupLocationId),
        }),
      });
      res.status(201).json({ booking });
    } catch (err) {
      // Seats went while the guest was choosing (perhaps on the supplier's own website): the
      // supplier says how many are left (only a refusal for want of seats carries that).
      if (err instanceof OctoClientError && err.body?.vacancies !== undefined) {
        throw new Problem(409, 'taken', err.message, { vacancies: err.body.vacancies });
      }
      throw err;
    }
  });

  app.get('/api/holds/:uuid', async (req, res) => {
    try {
      const booking = await octo.get(`/bookings/${encodeURIComponent(req.params.uuid)}`);
      const experience = await octo.get(`/products/${encodeURIComponent(booking.productId)}`);
      res.json({ booking, experience });
    } catch (err) {
      if (err instanceof OctoClientError && err.code === 'INVALID_BOOKING_UUID') {
        throw new Problem(404, 'refused', 'We can’t find that booking.');
      }
      throw err;
    }
  });

  app.post('/api/holds/:uuid/confirm', async (req, res) => {
    const b = req.body ?? {};
    const lead = { name: text(b.fullName), email: text(b.email), phone: text(b.phone) || null };
    if (lead.name.length < 2) throw new Problem(400, 'refused', 'Type the lead guest’s full name.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email)) {
      throw new Problem(400, 'refused', 'Type an email address, like name@example.com.');
    }
    const ref = makeRef();
    let booking;
    try {
      booking = await octo.post(`/bookings/${encodeURIComponent(req.params.uuid)}/confirm`, {
        resellerReference: ref,
        contact: { fullName: lead.name, emailAddress: lead.email, phoneNumber: lead.phone },
      });
    } catch (err) {
      if (err instanceof OctoClientError && err.code === 'INVALID_BOOKING_UUID') {
        throw new Problem(410, 'expired', 'Your seats were released.');
      }
      if (err instanceof OctoClientError && err.kind === 'offline') {
        throw new Problem(502, 'not_confirmed', 'The supplier didn’t confirm in time.');
      }
      throw err;
    }
    store.add({
      ref,
      uuid: booking.uuid,
      productId: booking.productId,
      supplierReference: booking.supplierReference,
      lead,
      createdAt: new Date().toISOString(),
    });
    res.status(201).json({ ref });
  });

  app.get('/api/bookings/:ref', async (req, res) => {
    const stored = store.byRef(req.params.ref);
    if (!stored) throw new Problem(404, 'refused', 'We can’t find that booking.');
    const [booking, supplier] = await Promise.all([
      octo.get(`/bookings/${encodeURIComponent(stored.uuid)}`),
      octo.get('/supplier'),
    ]);
    // The tour may have been taken off sale since: the booking still stands.
    const experience = await octo
      .get(`/products/${encodeURIComponent(stored.productId)}`)
      .catch(() => null);
    res.json({ stored, booking, experience, supplier });
  });

  app.use('/api', (req, res) => {
    res.status(404).json({ problem: 'refused', message: `No ${req.method} ${req.path} here.` });
  });

  if (pages) app.use(pages);

  app.use(
    /** @type {import('express').ErrorRequestHandler} */
    (err, req, res, _next) => {
      if (err instanceof Problem) {
        res.status(err.status).json({ problem: err.problem, message: err.message, ...err.more });
        return;
      }
      if (err instanceof OctoClientError) {
        if (err.kind === 'offline') {
          res.status(503).json({ problem: 'offline', message: err.message });
          return;
        }
        res.status(400).json({ problem: 'refused', message: err.message, code: err.code });
        return;
      }
      process.stderr.write(`Sojourna: ${/** @type {any} */ (err)?.stack ?? err}\n`);
      res.status(500).json({ problem: 'refused', message: 'Something went wrong on our side.' });
    },
  );
  return app;
}
