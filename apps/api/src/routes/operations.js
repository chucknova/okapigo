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
import { localTime } from '@okapigo/shared/time';
import { formatAt } from '@okapigo/shared/tour-facts';
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
    status: z.enum(['present', 'late', 'no_show', 'pending']).default('present'),
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
 * The manifest as a page to print, or "Save as PDF" from the browser's print dialog (OPS-07;
 * designs: "Printed manifest — A4", stage 15c-4). Black on white, no images.
 *
 *   header      the business · MANIFEST; the tour; date, time, back about, meeting point;
 *               guide, van or boat (and the note: "Driver: Sola"); when it was printed
 *   four boxes  travellers (adults, children) · add-ons · dietary needs · still owed
 *   the table   In (a box to tick) · traveller · group · notes · booking · lead and phone ·
 *               payment; a pickup tour's rows grouped by stop, in order, with their times
 *   below       cancelled bookings (don't check in); how to fill the boxes
 *
 * Every value is escaped (names are typed by guests).
 * @param {any} m  manifest() @param {Date} [now]
 */
export function printableManifest(m, now = new Date()) {
  const tz = m.business?.timeZone ?? 'Africa/Lagos';
  const live = m.bookings.filter((/** @type {any} */ b) => !b.endedAt || b.status === 'no_show');
  const gone = m.bookings.filter((/** @type {any} */ b) => b.endedAt && b.status !== 'no_show');
  const travellers = live.flatMap((/** @type {any} */ b) => b.travellers);

  // The four boxes.
  /** @type {Map<string, number>} */
  const groups = new Map();
  for (const t of travellers) {
    const g = groupName(t.category.name);
    groups.set(g, (groups.get(g) ?? 0) + 1);
  }
  const groupText = [...groups].map(([g, n]) => `${n} ${n === 1 ? g : plural(g)}`).join(', ');
  /** @type {Map<string, number>} */
  const extras = new Map();
  for (const b of live)
    for (const a of b.addOns) extras.set(a.name, (extras.get(a.name) ?? 0) + a.quantity);
  const diets = travellers.map((/** @type {any} */ t) => t.dietaryNeeds.trim()).filter(Boolean);
  const owing = live.filter((/** @type {any} */ b) => b.money.owedKobo > 0);
  const owedKobo = owing.reduce(
    (/** @type {number} */ n, /** @type {any} */ b) => n + b.money.owedKobo,
    0,
  );
  const boxes = [
    [String(travellers.length), `travellers${groupText ? ` · ${groupText}` : ''}`],
    ...[...extras].map(([name, n]) => [
      String(n),
      n === 1 ? name.toLowerCase() : plural(name.toLowerCase()),
    ]),
    [
      String(diets.length),
      `dietary${diets.length ? `: ${[...new Set(diets.map((d) => d.toLowerCase()))].join(', ')}` : ''}`,
    ],
    [
      formatNaira(owedKobo),
      `still owed (${owing.length} ${owing.length === 1 ? 'booking' : 'bookings'})`,
    ],
  ];

  /** One booking's rows: the booking's columns on its first row only. @param {any} b */
  const rowsOf = (b) =>
    b.travellers
      .map((/** @type {any} */ t, /** @type {number} */ i) => {
        const first = i === 0;
        const name = t.name ? esc(t.name) : `Guest ${t.position} (name: ____________)`;
        const notes = [
          first && b.addOns.length
            ? b.addOns.map((/** @type {any} */ a) => `${a.quantity} × ${a.name}`).join(', ')
            : '',
          t.dietaryNeeds ? t.dietaryNeeds.toUpperCase() : '',
          // The office's notes for the guide (16c), on the booking's first row.
          ...(first ? (b.notes ?? []) : []),
        ]
          .filter(Boolean)
          .join(' · ');
        const box =
          t.checkInStatus === 'present'
            ? '✓'
            : t.checkInStatus === 'late'
              ? esc(t.checkedInAt ? localTime(new Date(t.checkedInAt), tz) : 'Late')
              : t.checkInStatus === 'no_show'
                ? 'NS'
                : '';
        const pay =
          b.status === 'no_show'
            ? 'No-show'
            : b.money.owedKobo > 0
              ? `owes ${formatNaira(b.money.owedKobo)}`
              : 'Paid';
        return `<tr${first ? ' class="first"' : ''}>
<td><span class="box">${box}</span></td>
<td class="name">${name}</td>
<td>${esc(groupName(t.category.name, true))}${t.age !== null ? ` · ${t.age}` : ''}</td>
<td>${esc(notes)}</td>
<td class="ref">${first ? esc(b.reference) : ''}</td>
<td>${first ? esc([b.lead.name, b.lead.phone].filter(Boolean).join(' · ')) : ''}</td>
<td class="${first && b.money.owedKobo > 0 ? 'owes' : ''}">${first ? esc(pay) : ''}</td>
</tr>`;
      })
      .join('\n');

  // A pickup tour: the rows grouped by stop, in the van's order, with their times.
  const stops = /** @type {any[]} */ (m.tour.pickupPoints ?? []);
  const body = stops.length
    ? stops
        .map((p) => {
          const here = live.filter((/** @type {any} */ b) => b.pickupPoint?.name === p.name);
          if (!here.length) return '';
          return `<tr class="stop"><td colspan="7">${esc([p.time, p.name, p.address].filter(Boolean).join(' · '))}</td></tr>\n${here.map(rowsOf).join('\n')}`;
        })
        .concat(
          live
            .filter((/** @type {any} */ b) => !stops.some((p) => p.name === b.pickupPoint?.name))
            .map(rowsOf),
        )
        .join('\n')
    : live.map(rowsOf).join('\n');

  // "Sat 5 Dec 2026" (the design: no comma after the day).
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: tz,
    })
      .formatToParts(new Date(m.departure.startsAt))
      .map((x) => [x.type, x.value]),
  );
  const date = `${parts.weekday} ${parts.day} ${parts.month} ${parts.year}`;
  const head = [
    date,
    m.departure.localTime,
    `back about ${localTime(new Date(m.departure.endsAt), tz)}`,
    m.tour.meetingPoint?.name,
  ]
    .filter(Boolean)
    .join(' · ');
  const vehicle = m.resource
    ? `<div><strong>${esc(m.resource.name)}</strong> · ${m.resource.seats} seats${m.departure.notes ? ` · ${esc(m.departure.notes)}` : ''}</div>`
    : m.departure.notes
      ? `<div>${esc(m.departure.notes)}</div>`
      : '';
  const cancelled = gone.length
    ? `<p class="gone"><strong>Cancelled, don’t check in:</strong> ${gone
        .map(
          (/** @type {any} */ b) =>
            `${esc(b.lead.name)} · ${esc(b.reference)} · ${b.travellers.length} ${b.travellers.length === 1 ? 'guest' : 'guests'}${b.endedAt ? ` (cancelled ${esc(formatAt(Date.parse(b.endedAt), tz).split(',')[0])})` : ''}`,
        )
        .join('; ')}</p>`
    : '';

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Manifest · ${esc(m.tour.title)} · ${esc(m.departure.localDate)} ${esc(m.departure.localTime)}</title>
<style>
  @page { size: A4; margin: 14mm 12mm; }
  body { font: 12px/1.35 system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif; color: #111511; margin: 24px; }
  .top { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; border-bottom: 2px solid #111511; padding-bottom: 10px; }
  .eyebrow { font-size: 11px; font-weight: 700; color: #4A5349; text-transform: uppercase; }
  h1 { font-size: 22px; font-weight: 800; margin: 2px 0; }
  .right { text-align: right; }
  .muted { color: #4A5349; }
  .boxes { display: grid; grid-template-columns: repeat(${Math.min(boxes.length, 4)}, minmax(0, 1fr)); gap: 8px; margin: 14px 0; }
  .boxes div { border: 1px solid #111511; border-radius: 6px; padding: 8px; }
  .boxes strong { display: block; font-size: 20px; font-weight: 800; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; padding: 6px 4px; border-bottom: 1.5px solid #111511; }
  td { padding: 7px 4px; border-bottom: 1px solid #C9CFC7; vertical-align: top; }
  tr.first td { border-top: 1.5px solid #6E786D; }
  tr.stop td { font-weight: 800; background: #F4F6F3; border-top: 1.5px solid #111511; }
  td.name { font-weight: 700; }
  td.ref { font-family: ui-monospace, Menlo, monospace; }
  td.owes { font-weight: 800; }
  .box { display: inline-block; min-width: 14px; height: 14px; border: 1.5px solid #111511; border-radius: 3px; font-size: 10px; text-align: center; line-height: 14px; padding: 0 1px; }
  .gone { color: #4A5349; border-top: 1px solid #C9CFC7; padding-top: 8px; margin-top: 12px; }
  .gone strong { color: #111511; }
  .foot { display: flex; justify-content: space-between; font-size: 11px; color: #4A5349; border-top: 1px solid #C9CFC7; padding-top: 8px; margin-top: 16px; }
  tr { break-inside: avoid; }
  @media print { body { margin: 0; } }
</style></head>
<body>
<div class="top">
  <div>
    <div class="eyebrow">${esc(m.business?.name ?? '')} · Manifest</div>
    <h1>${esc(m.tour.title)}</h1>
    <div>${esc(head)}</div>
  </div>
  <div class="right">
    <div><strong>Guide</strong> ${esc(m.guide?.name ?? 'not assigned')}</div>
    ${vehicle}
    <div class="muted">Printed ${esc(formatAt(now.getTime(), tz))}</div>
  </div>
</div>
<div class="boxes">
${boxes.map(([n, label]) => `<div><strong>${esc(n)}</strong>${esc(label)}</div>`).join('\n')}
</div>
<table>
<thead><tr><th>In</th><th>Traveller</th><th>Group</th><th>Notes</th><th>Booking</th><th>Lead · phone</th><th>Payment</th></tr></thead>
<tbody>
${body}
</tbody></table>
${cancelled}
<div class="foot"><span>No-show: write NS in the box. Late: write the time.</span><span>Bookings by OkapiGo</span></div>
</body></html>`;
}

/** "Adult (13+)" → "adult" (for counting); with `keep`, "Adult" (for a row). @param {string} name @param {boolean} [keep] */
function groupName(name, keep = false) {
  const plain = name.replace(/\s*\(.*\)\s*$/, '');
  return keep ? plain : plain.toLowerCase();
}

/** "adult" → "adults", "child" → "children", "lunch" → "lunches". @param {string} word */
function plural(word) {
  if (word === 'child') return 'children';
  if (word === 'infant') return 'infants';
  return /(s|x|ch|sh)$/.test(word) ? `${word}es` : `${word}s`;
}
