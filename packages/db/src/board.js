// @ts-check
/**
 * board.js — the office's schedule and a departure's page (stage 16b; designs O6, O7).
 *
 *   weekSchedule()        seven days of departures, Monday first: time, tour, seats sold of
 *                         what it can sell, guide, van or boat, and a tag: SOLD OUT · NEEDS
 *                         GUIDE · CANCELLED
 *   departureOverview()   one departure: its numbers, who's booked, extras and dietary needs,
 *                         the guide's notes, and what cancelling would mean
 *   assignmentOptions()   who can guide it and which vans or boats fit, each saying why not
 *                         ("Busy: on the Badagry trip until 17:00", "Too small: 12 are booked")
 *
 * Changing things goes through the rules already there: assignDeparture (15a, + 16b's
 * transport and size rules), cancelDeparture (session 9).
 */
import { addDays, dayOfWeek, localDate, localTime, zonedTimeToUtc } from '@okapigo/shared/time';
import { formatNaira } from '@okapigo/shared/money';
import { formatAt } from '@okapigo/shared/tour-facts';
import { BookingError } from './booking-lifecycle.js';
import { seatsOf } from './seats.js';

const SOLD = ['confirmed', 'part_paid', 'paid', 'amended', 'completed'];
const TRANSPORT_WORD = /** @type {Record<string, string>} */ ({
  van: 'road trips',
  boat: 'boat trips',
});

/** "Kemi Adeyemi" → "Kemi". @param {string} name */
export const firstName = (name) => name.trim().split(/\s+/)[0] ?? name;
/** @param {any} p */
export const shortOf = (p) => p.shortTitle || p.title;
/** "Van 1 · 14" / "On foot" / "" @param {any} d */
const vehicleLine = (d) =>
  d.resource
    ? `${d.resource.name} · ${d.resource.seats}`
    : d.product.transport === 'on_foot'
      ? 'On foot'
      : '';

/**
 * The Monday of the week holding `date`. @param {string} date YYYY-MM-DD
 */
export const mondayOf = (date) => addDays(date, -((dayOfWeek(date) + 6) % 7));

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ operatorId: string, start?: string, now?: Date }} q  start: any day of the week
 */
export async function weekSchedule(prisma, { operatorId, start, now = new Date() }) {
  const operator = await prisma.operator.findUniqueOrThrow({ where: { id: operatorId } });
  const tz = operator.timeZone;
  const today = localDate(now, tz);
  const monday = mondayOf(start ?? today);
  const departures = await prisma.departure.findMany({
    where: {
      operatorId,
      startsAt: {
        gte: zonedTimeToUtc(monday, '00:00', tz),
        lt: zonedTimeToUtc(addDays(monday, 7), '00:00', tz),
      },
    },
    orderBy: { startsAt: 'asc' },
    include: { product: true, guide: true, resource: true },
  });
  const tours = await prisma.product.findMany({
    where: { operatorId, status: 'published' },
    orderBy: { title: 'asc' },
    select: { id: true, slug: true, title: true, shortTitle: true },
  });

  const days = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(monday, i);
    const label = formatAt(Date.parse(`${date}T12:00:00Z`), 'UTC').split(',')[0]; // "Sat 5 Dec"
    const cards = departures
      .filter((d) => localDate(d.startsAt, tz) === date)
      .map((d) => {
        const seats = seatsOf(d);
        const cancelled = d.status === 'cancelled';
        const full = !cancelled && d.seatsSold + d.seatsHeld >= seats;
        const needsGuide = !cancelled && !d.guide && d.seatsSold > 0;
        return {
          id: d.id,
          time: localTime(d.startsAt, tz),
          tour: shortOf(d.product),
          tourSlug: d.product.slug,
          sold: d.seatsSold,
          seats,
          pct: seats ? Math.round((d.seatsSold / seats) * 100) : 0,
          guide: d.guide ? firstName(d.guide.name) : null,
          vehicle: vehicleLine(d),
          status: d.status,
          cancelReason: d.cancelReason,
          tag: cancelled ? 'CANCELLED' : full ? 'SOLD OUT' : needsGuide ? 'NEEDS GUIDE' : null,
          needsGuide,
          full,
        };
      });
    return {
      date,
      dow: label.split(' ')[0],
      day: label.split(' ').slice(1).join(' '),
      long: new Intl.DateTimeFormat('en-GB', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        timeZone: 'UTC',
      }).format(new Date(`${date}T12:00:00Z`)),
      isToday: date === today,
      flag: cards.some((c) => c.needsGuide),
      cards,
    };
  });
  const sunday = addDays(monday, 6);
  return {
    start: monday,
    previous: addDays(monday, -7),
    next: addDays(monday, 7),
    thisWeek: mondayOf(today),
    today,
    label: `${days[0].dow} ${days[0].day} – ${days[6].dow} ${days[6].day}`,
    days,
    tours: tours.map((t) => ({ slug: t.slug, name: shortOf(t) })),
    withoutGuide: days.reduce((n, d) => n + d.cards.filter((c) => c.needsGuide).length, 0),
    // (Sunday's date for "Mon 30 Nov – Sun 6 Dec": the label has it.)
    end: sunday,
  };
}

/**
 * "3 adults, 1 child" from a booking's travellers. @param {any[]} travellers @param {Map<string, any>} cats
 */
export function peopleLine(travellers, cats) {
  /** @type {Map<string, number>} */
  const n = new Map();
  for (const t of travellers) {
    const name = (cats.get(t.categoryKey)?.name ?? t.categoryKey)
      .replace(/\s*\(.*\)\s*$/, '')
      .toLowerCase();
    n.set(name, (n.get(name) ?? 0) + 1);
  }
  return [...n]
    .map(([name, k]) => `${k} ${k === 1 ? name : name === 'child' ? 'children' : `${name}s`}`)
    .join(', ');
}

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ operatorId: string, departureId: string, now?: Date }} q
 */
export async function departureOverview(prisma, { operatorId, departureId, now = new Date() }) {
  const d = await prisma.departure.findFirst({
    where: { id: departureId, operatorId },
    include: {
      product: { include: { operator: true, priceCategories: true } },
      guide: true,
      resource: true,
      bookings: {
        where: { status: { in: SOLD } },
        orderBy: { createdAt: 'asc' },
        include: {
          travellers: true,
          addOns: { include: { addOn: true } },
          channelBooking: { include: { channel: { select: { name: true } } } },
        },
      },
    },
  });
  if (!d) throw new BookingError('NOT_FOUND', 'Departure not found.');
  const tz = d.product.operator.timeZone;
  const cats = new Map(d.product.priceCategories.map((c) => [c.key, c]));
  const seats = seatsOf(d);
  /** @type {Map<string, number>} */
  const extras = new Map();
  /** @type {Map<string, number>} */
  const diets = new Map();
  const rows = d.bookings.map((b) => {
    for (const a of b.addOns)
      extras.set(a.addOn.name, (extras.get(a.addOn.name) ?? 0) + a.quantity);
    const ownDiets = b.travellers.map((t) => t.dietaryNeeds.trim()).filter(Boolean);
    for (const x of ownDiets) diets.set(x.toLowerCase(), (diets.get(x.toLowerCase()) ?? 0) + 1);
    const owed = b.totalKobo - b.amountPaidKobo;
    return {
      id: b.id,
      lead: b.leadName,
      people: peopleLine(b.travellers, cats),
      extras: [
        ...b.addOns.map((a) => `${a.quantity} × ${a.addOn.name.toLowerCase()}`),
        ...ownDiets,
      ].join(' · '),
      // An OTA's guest paid the OTA (17c): "Paid by Sojourna".
      via: b.channelBooking ? `via ${b.channelBooking.channel.name}` : null,
      pay:
        owed > 0
          ? `${formatNaira(owed)} to pay`
          : b.channelBooking
            ? `Paid by ${b.channelBooking.channel.name}`
            : 'Paid',
      payTone: owed > 0 ? 'owes' : 'paid',
    };
  });
  const guests = d.bookings.reduce((n, b) => n + b.travellers.length, 0);
  const refundKobo = d.bookings.reduce((n, b) => n + b.amountPaidKobo, 0);
  const vehicleWord = d.resource
    ? `${d.resource.kind} seats`
    : d.product.transport === 'on_foot'
      ? 'places'
      : 'seats';
  return {
    id: d.id,
    title: d.product.title,
    short: shortOf(d.product),
    transport: d.product.transport,
    status: d.status,
    cancelReason: d.cancelReason,
    started: d.startsAt <= now,
    dayLabel: formatAt(d.startsAt.getTime(), tz).split(',')[0],
    when: `${formatAt(d.startsAt.getTime(), tz).split(',')[0]} · ${localTime(d.startsAt, tz)}–${localTime(d.endsAt, tz)}`,
    times: `${localTime(d.startsAt, tz)}–${localTime(d.endsAt, tz)}`,
    meetingPoint: /** @type {any} */ (d.product.meetingPoint)?.name ?? '',
    numbers: {
      booked: d.seatsSold,
      held: d.seatsHeld,
      left: Math.max(0, seats - d.seatsSold - d.seatsHeld),
      seats,
      seatsLabel: vehicleWord,
    },
    rows,
    extrasLine: [
      extras.size
        ? `Extras: ${[...extras].map(([n, k]) => `${k} × ${n.toLowerCase()}`).join(' · ')}`
        : null,
      diets.size ? `Dietary: ${[...diets].map(([x, k]) => `${k} ${x}`).join(', ')}` : null,
    ]
      .filter(Boolean)
      .join(' · '),
    notes: d.notes,
    guide: d.guide ? { id: d.guide.id, name: d.guide.name } : null,
    resource: d.resource
      ? { id: d.resource.id, name: d.resource.name, seats: d.resource.seats, kind: d.resource.kind }
      : null,
    // "Cancel Tarkwa Bay on Sat 5 Dec?" (O7): who's affected, and what goes back.
    cancel: {
      bookings: d.bookings.length,
      guests,
      refundKobo,
      refundText: formatNaira(refundKobo),
    },
  };
}

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ operatorId: string, departureId: string }} q
 */
export async function assignmentOptions(prisma, { operatorId, departureId }) {
  const d = await prisma.departure.findFirst({
    where: { id: departureId, operatorId },
    include: { product: { include: { operator: true } } },
  });
  if (!d) throw new BookingError('NOT_FOUND', 'Departure not found.');
  const tz = d.product.operator.timeZone;
  const day = localDate(d.startsAt, tz);
  // Everything else scheduled that day or overlapping: who's where.
  const others = await prisma.departure.findMany({
    where: {
      operatorId,
      status: 'scheduled',
      id: { not: d.id },
      startsAt: { lt: zonedTimeToUtc(addDays(day, 1), '00:00', tz) },
      endsAt: { gt: zonedTimeToUtc(day, '00:00', tz) },
    },
    include: { product: true },
    orderBy: { startsAt: 'asc' },
  });
  const overlaps = (/** @type {any} */ o) => o.startsAt < d.endsAt && o.endsAt > d.startsAt;
  /** "on the Badagry trip until 17:00" @param {any} o */
  const where = (o) => `on the ${shortOf(o.product)} until ${localTime(o.endsAt, tz)}`;

  const guides = await prisma.user.findMany({
    where: { operatorId, isActive: true, role: { key: 'guide' } },
    orderBy: { name: 'asc' },
  });
  const guideOptions = guides
    .map((g) => {
      const busy = others.find((o) => o.guideId === g.id && overlaps(o));
      const later = others.filter((o) => o.guideId === g.id && !overlaps(o));
      const current = d.guideId === g.id;
      return {
        id: g.id,
        name: firstName(g.name),
        fullName: g.name,
        state: current ? 'assigned' : busy ? 'busy' : 'free',
        why: current
          ? 'Assigned'
          : busy
            ? `Busy: ${where(busy)}`
            : [
                `Free ${localTime(d.startsAt, tz)}–${localTime(d.endsAt, tz)}`,
                ...later.map(
                  (o) =>
                    `${shortOf(o.product)} at ${localTime(o.startsAt, tz)} ${o.startsAt > d.startsAt ? 'later' : 'earlier'}`,
                ),
              ].join(' · '),
      };
    })
    .sort((a, b) => rank[a.state] - rank[b.state]);

  const need = d.product.transport;
  const booked = d.seatsSold + d.seatsHeld;
  const resources =
    need === 'on_foot'
      ? []
      : (
          await prisma.resource.findMany({
            where: { operatorId, isActive: true },
            orderBy: [{ kind: 'asc' }, { name: 'asc' }],
          })
        )
          .map((r) => {
            const busy = others.find((o) => o.resourceId === r.id && overlaps(o));
            const current = d.resourceId === r.id;
            const state = current
              ? 'assigned'
              : r.kind !== need
                ? 'wrong'
                : busy
                  ? 'busy'
                  : r.seats < booked
                    ? 'small'
                    : 'free';
            const label = `${r.name} · ${r.seats} seats`;
            return {
              id: r.id,
              label,
              name: r.name,
              seats: r.seats,
              state,
              why:
                state === 'assigned'
                  ? `Assigned · ${booked} booked ${booked <= r.seats ? 'fit' : 'don’t fit'}`
                  : state === 'wrong'
                    ? `not for ${TRANSPORT_WORD[need]}`
                    : state === 'busy'
                      ? `Busy: ${where(busy)}`
                      : state === 'small'
                        ? `Too small: ${booked} are booked. Choose a bigger one, or move ${booked - r.seats} ${booked - r.seats === 1 ? 'guest' : 'guests'} to another date first.`
                        : `Free · fits ${booked}`,
            };
          })
          .sort((a, b) => rank[a.state] - rank[b.state]);
  return {
    title: `${shortOf(d.product)}, ${localTime(d.startsAt, tz)}–${localTime(d.endsAt, tz)}`,
    vehicleTitle: `${need === 'boat' ? 'Boat' : 'Van'} for ${shortOf(d.product)}, ${formatAt(d.startsAt.getTime(), tz).split(',')[0]} · ${booked} booked`,
    transport: need,
    guides: guideOptions,
    resources,
  };
}

/** Choosable first: assigned, free; then the ones that say why not. */
const rank = /** @type {Record<string, number>} */ ({
  assigned: 0,
  free: 1,
  busy: 2,
  small: 3,
  wrong: 4,
});
