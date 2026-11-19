// @ts-check
/**
 * Running tour days, for staff (OPS-01, OPS-07, OPS-08; stage 15a). The operator app's
 * screens come with your designs (flow brief 07); the API is here now.
 *
 *   GET   /api/resources                          operations: view   vans and the boat
 *   POST  /api/resources                          products: edit     { kind, name, seats }
 *   PATCH /api/resources/:id                      products: edit     { name?, seats?, isActive? }
 *   PUT   /api/departures/:id/assignment          bookings: edit     { guideId?, resourceId?, notes? }
 *   GET   /api/departures/:id/manifest            operations: view   screen O3's data
 *   GET   /api/departures/:id/manifest/print      operations: view   the same, as a page to print or save as PDF
 *   POST  /api/departures/:id/check-ins           operations: edit   { code | bookingId, travellerIds?, status, confirmOwed? }
 *   POST  /api/departures/:id/no-shows            operations: edit   { bookingId }
 *   PATCH /api/travellers/:id                     operations: edit   { name }   (a name typed at check-in)
 *
 * Who: the OWNER adds vans (products: edit); the MANAGER assigns (bookings: edit: guides only
 * view bookings); a GUIDE checks in (operations: edit), but only on departures they're
 * assigned to. Anyone who can edit bookings (manager, owner) may act on any departure.
 */
import { Router } from 'express';
import { z } from 'zod';
import {
  createResource,
  assignDeparture,
  manifest,
  checkIn,
  noShow,
  nameTraveller,
} from '@okapigo/db';
import { hasAccess } from '@okapigo/shared/permissions';
import { formatNaira } from '@okapigo/shared/money';
import { requirePermission } from '../middleware/auth.js';
import { validate, IdParamsSchema } from '../middleware/validate.js';
import { HttpError } from '../middleware/errors.js';
import { toHttp } from './bookings.js';
import { escapeHtml as esc } from './payments.js';

const ResourceBody = z.object({
  kind: z.enum(['van', 'boat']),
  name: z.string().trim().min(1).max(60),
  seats: z.number().int().min(1).max(200),
});
const ResourcePatch = z
  .object({
    name: z.string().trim().min(1).max(60),
    seats: z.number().int().min(1).max(200),
    isActive: z.boolean(),
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'Send at least one field to change');
const AssignBody = z
  .object({
    guideId: z.uuid().nullable(),
    resourceId: z.uuid().nullable(),
    notes: z.string().max(500),
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'Send at least one field to change');
const CheckInBody = z
  .object({
    code: z.string().trim().min(10).max(80).optional(),
    bookingId: z.uuid().optional(),
    travellerIds: z.array(z.uuid()).max(50).optional(),
    status: z.enum(['present', 'late', 'pending']).default('present'),
    confirmOwed: z.boolean().default(false),
  })
  .refine((b) => Boolean(b.code) !== Boolean(b.bookingId), 'Send a ticket code OR a booking');
const NoShowBody = z.object({ bookingId: z.uuid() });
const NameBody = z.object({ name: z.string().max(200) });

/**
 * @param {{ prisma: import('@prisma/client').PrismaClient, authSecret: string }} deps
 */
export function operationsRouter({ prisma, authSecret }) {
  const router = Router();
  /** @returns {import('../middleware/auth.js').AuthContext} */
  // @ts-ignore: req.auth is set by requireAuth
  const authOf = (req) => req.auth;

  /**
   * A guide may only work on departures they're assigned to; staff who can edit bookings,
   * on any. Anything else looks like "not found" (nothing to learn by guessing ids).
   * @param {any} req @param {string} departureId
   */
  async function ownDeparture(req, departureId) {
    const auth = authOf(req);
    const d = await prisma.departure.findFirst({
      where: { id: departureId, operatorId: auth.operatorId },
    });
    if (!d) throw new HttpError(404, 'NOT_FOUND', 'Departure not found.');
    if (!hasAccess(auth.permissions.bookings, 'edit') && d.guideId !== auth.userId) {
      throw new HttpError(404, 'NOT_FOUND', 'Departure not found.');
    }
    return d;
  }
  /** @param {() => Promise<any>} fn */
  const domain = async (fn) => {
    try {
      return await fn();
    } catch (err) {
      throw toHttp(err);
    }
  };

  // --- Resources ---------------------------------------------------------------------------

  router.get('/resources', requirePermission('operations', 'view'), async (req, res) => {
    const resources = await prisma.resource.findMany({
      where: { operatorId: authOf(req).operatorId },
      orderBy: [{ kind: 'asc' }, { name: 'asc' }],
    });
    res.json({ resources: resources.map(serializeResource) });
  });

  router.post(
    '/resources',
    requirePermission('products', 'edit'),
    validate({ body: ResourceBody }),
    async (req, res) => {
      const r = await domain(() =>
        createResource(prisma, { operatorId: authOf(req).operatorId, ...req.body }),
      );
      res.status(201).json({ resource: serializeResource(r) });
    },
  );

  router.patch(
    '/resources/:id',
    requirePermission('products', 'edit'),
    validate({ params: IdParamsSchema, body: ResourcePatch }),
    async (req, res) => {
      const { count } = await prisma.resource.updateMany({
        where: { id: req.params.id, operatorId: authOf(req).operatorId },
        data: req.body,
      });
      if (count === 0) throw new HttpError(404, 'NOT_FOUND', 'Resource not found.');
      const r = await prisma.resource.findUniqueOrThrow({ where: { id: req.params.id } });
      res.json({ resource: serializeResource(r) });
    },
  );

  // --- Assignment --------------------------------------------------------------------------

  router.put(
    '/departures/:id/assignment',
    requirePermission('bookings', 'edit'),
    validate({ params: IdParamsSchema, body: AssignBody }),
    async (req, res) => {
      const { departure, warnings } = await domain(() =>
        assignDeparture(prisma, {
          operatorId: authOf(req).operatorId,
          departureId: req.params.id,
          ...req.body,
        }),
      );
      res.json({
        assignment: {
          guide: departure.guide ? { id: departure.guide.id, name: departure.guide.name } : null,
          resource: departure.resource ? serializeResource(departure.resource) : null,
          notes: departure.notes,
        },
        warnings,
      });
    },
  );

  // --- The manifest ------------------------------------------------------------------------

  router.get(
    '/departures/:id/manifest',
    requirePermission('operations', 'view'),
    validate({ params: IdParamsSchema }),
    async (req, res) => {
      await ownDeparture(req, req.params.id);
      const m = await domain(() =>
        manifest(prisma, { operatorId: authOf(req).operatorId, departureId: req.params.id }),
      );
      res.set('Cache-Control', 'private, no-store').json({ manifest: m });
    },
  );

  router.get(
    '/departures/:id/manifest/print',
    requirePermission('operations', 'view'),
    validate({ params: IdParamsSchema }),
    async (req, res) => {
      await ownDeparture(req, req.params.id);
      const m = await domain(() =>
        manifest(prisma, { operatorId: authOf(req).operatorId, departureId: req.params.id }),
      );
      res.set('Cache-Control', 'private, no-store').type('html').send(printableManifest(m));
    },
  );

  // --- Check-in, no-shows, names -------------------------------------------------------------

  router.post(
    '/departures/:id/check-ins',
    requirePermission('operations', 'edit'),
    validate({ params: IdParamsSchema, body: CheckInBody }),
    async (req, res) => {
      await ownDeparture(req, req.params.id);
      const { operatorId, userId } = authOf(req);
      const result = await domain(() =>
        checkIn(prisma, {
          operatorId,
          departureId: req.params.id,
          secret: authSecret,
          userId,
          ...req.body,
        }),
      );
      res.json({ checkIn: result });
    },
  );

  router.post(
    '/departures/:id/no-shows',
    requirePermission('operations', 'edit'),
    validate({ params: IdParamsSchema, body: NoShowBody }),
    async (req, res) => {
      await ownDeparture(req, req.params.id);
      const { operatorId, userId } = authOf(req);
      const result = await domain(() =>
        noShow(prisma, {
          operatorId,
          departureId: req.params.id,
          bookingId: req.body.bookingId,
          userId,
        }),
      );
      res.json({ noShow: result });
    },
  );

  router.patch(
    '/travellers/:id',
    requirePermission('operations', 'edit'),
    validate({ params: IdParamsSchema, body: NameBody }),
    async (req, res) => {
      const { operatorId } = authOf(req);
      const t = await prisma.traveller.findFirst({
        where: { id: req.params.id, operatorId },
        include: { booking: true },
      });
      if (!t) throw new HttpError(404, 'NOT_FOUND', 'Traveller not found.');
      await ownDeparture(req, t.booking.departureId);
      const named = await domain(() =>
        nameTraveller(prisma, { operatorId, travellerId: t.id, name: req.body.name }),
      );
      res.json({ traveller: { id: named.id, name: named.name } });
    },
  );

  return router;
}

/** @param {any} r */
const serializeResource = (r) => ({
  id: r.id,
  kind: r.kind,
  name: r.name,
  seats: r.seats,
  isActive: r.isActive,
});

/**
 * The manifest as a plain page to print, or "Save as PDF" from the browser's print dialog
 * (OPS-07: "printable as PDF"): no images, black on white, one row per traveller. Every
 * value is escaped (names are typed by guests).
 * @param {any} m
 */
export function printableManifest(m) {
  const rows = m.bookings
    .flatMap((/** @type {any} */ b) =>
      b.travellers.map(
        (/** @type {any} */ t, /** @type {number} */ i) => `<tr${b.endedAt ? ' class="ended"' : ''}>
<td>${i === 0 ? esc(b.reference) : ''}</td>
<td>${esc(t.displayName)}</td>
<td>${esc(t.category.name)}${t.age !== null ? ` · ${t.age}` : ''}</td>
<td>${esc(t.dietaryNeeds)}</td>
<td>${i === 0 ? esc([b.lead.phone, b.addOns.map((/** @type {any} */ a) => `${a.quantity} × ${a.name}`).join(', '), b.pickupPoint ? `Pickup: ${b.pickupPoint.name}` : ''].filter(Boolean).join(' · ')) : ''}</td>
<td>${i === 0 ? esc(b.endedAt ? (b.status === 'no_show' ? 'No-show' : 'Cancelled') : b.money.label) : ''}</td>
<td class="box">${t.checkInStatus === 'present' ? '✓' : t.checkInStatus === 'late' ? 'Late' : t.checkInStatus === 'no_show' ? 'No-show' : ''}</td>
</tr>`,
      ),
    )
    .join('\n');
  const owed = m.bookings.filter((/** @type {any} */ b) => !b.endedAt && b.money.owedKobo > 0);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Manifest · ${esc(m.tour.title)} · ${esc(m.departure.localDate)} ${esc(m.departure.localTime)}</title>
<style>
  body { font: 13px/1.4 system-ui, sans-serif; color: #000; margin: 24px; }
  h1 { font-size: 20px; margin: 0 0 4px; } p { margin: 0 0 12px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; vertical-align: top; padding: 6px 8px; border-bottom: 1px solid #999; }
  th { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
  td.box { width: 64px; border: 1px solid #000; text-align: center; }
  tr.ended td { text-decoration: line-through; color: #555; }
  @media print { body { margin: 0; } }
</style></head>
<body>
<h1>${esc(m.tour.title)}</h1>
<p>${esc(m.departure.localDate)} · ${esc(m.departure.localTime)} · Meet at ${esc(m.tour.meetingPoint?.name ?? '')}<br>
Guide: ${esc(m.guide?.name ?? 'not assigned')}${m.resource ? ` · ${esc(m.resource.name)} (${m.resource.seats} seats)` : ''} · ${m.counts.travellers} travellers${owed.length ? ` · ${owed.length} still owe money (${esc(formatNaira(owed.reduce((n, /** @type {any} */ b) => n + b.money.owedKobo, 0)))})` : ''}${m.departure.notes ? `<br>Note: ${esc(m.departure.notes)}` : ''}</p>
<table>
<thead><tr><th>Booking</th><th>Traveller</th><th>Type</th><th>Dietary</th><th>Contact · extras · pickup</th><th>Payment</th><th>Here</th></tr></thead>
<tbody>
${rows}
</tbody></table>
</body></html>`;
}
