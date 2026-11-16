// @ts-check
/**
 * serializers.js — turn database rows into the JSON we send to clients.
 *
 * Why not send rows as they are? Rows can contain things clients must never see (in later
 * sessions: payment references, internal notes) and their shape would change every time a
 * column is added. A serializer is an explicit whitelist: only these fields leave the API.
 */
import { dateToString, localDate, localTime } from '@okapigo/shared/time';

/**
 * @param {import('@prisma/client').User & { role: import('@prisma/client').Role }} user
 */
export function serializeUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    isActive: user.isActive,
    role: { id: user.role.id, key: user.role.key, name: user.role.name },
  };
}

/** @param {import('@prisma/client').Role} role */
export function serializeRole(role) {
  return {
    id: role.id,
    key: role.key,
    name: role.name,
    isPreset: role.isPreset,
    permissions: role.permissions,
  };
}

/** @param {import('@prisma/client').PriceCategory} c */
export function serializePriceCategory(c) {
  return {
    id: c.id,
    key: c.key,
    name: c.name,
    minAge: c.minAge,
    maxAge: c.maxAge,
    amountKobo: c.amountKobo,
    sortOrder: c.sortOrder,
    isActive: c.isActive,
  };
}

/** @param {import('@prisma/client').AddOn} a */
export function serializeAddOn(a) {
  return {
    id: a.id,
    name: a.name,
    description: a.description,
    priceKobo: a.priceKobo,
    stockPerDeparture: a.stockPerDeparture,
    sortOrder: a.sortOrder,
    isActive: a.isActive,
  };
}

/**
 * @param {import('@prisma/client').Product & {
 *   priceCategories?: import('@prisma/client').PriceCategory[],
 *   addOns?: import('@prisma/client').AddOn[],
 * }} p
 */
export function serializeProduct(p) {
  return {
    id: p.id,
    slug: p.slug,
    title: p.title,
    summary: p.summary,
    description: p.description,
    status: p.status,
    durationMinutes: p.durationMinutes,
    defaultCapacity: p.defaultCapacity,
    meetingPoint: p.meetingPoint,
    stops: p.stops,
    photos: p.photos,
    pickupPoints: p.pickupPoints,
    faqs: p.faqs,
    inclusions: p.inclusions,
    exclusions: p.exclusions,
    whatToBring: p.whatToBring,
    priceCategories: p.priceCategories?.map(serializePriceCategory) ?? [],
    addOns: p.addOns?.map(serializeAddOn) ?? [],
    updatedAt: p.updatedAt,
  };
}

/** @param {import('@prisma/client').Schedule} s */
export function serializeSchedule(s) {
  return {
    id: s.id,
    productId: s.productId,
    // @db.Date columns come back as midnight-UTC Dates; send them as plain 'YYYY-MM-DD'.
    startDate: dateToString(s.startDate),
    endDate: s.endDate ? dateToString(s.endDate) : null,
    daysOfWeek: s.daysOfWeek,
    times: s.times,
    capacity: s.capacity,
    skipDates: s.skipDates.map(dateToString),
    isActive: s.isActive,
  };
}

/**
 * Departures carry both the exact instant (UTC, for machines) and the local date and time
 * (for people), so clients never have to do time-zone maths themselves.
 * @param {import('@prisma/client').Departure} d
 * @param {string} timeZone
 */
export function serializeDeparture(d, timeZone) {
  return {
    id: d.id,
    productId: d.productId,
    scheduleId: d.scheduleId,
    startsAt: d.startsAt,
    endsAt: d.endsAt,
    localDate: localDate(d.startsAt, timeZone),
    localTime: localTime(d.startsAt, timeZone),
    capacity: d.capacity,
    seatsSold: d.seatsSold,
    seatsHeld: d.seatsHeld,
    seatsAvailable: d.capacity - d.seatsSold - d.seatsHeld,
    status: d.status,
  };
}

/** @param {import('@prisma/client').Hold & { addOns?: import('@prisma/client').HoldAddOn[] }} h */
export function serializeHold(h) {
  return {
    id: h.id,
    departureId: h.departureId,
    seats: h.seats,
    status: h.status,
    channel: h.channel,
    travellers: h.travellers,
    addOns: h.addOns?.map((a) => ({ addOnId: a.addOnId, quantity: a.quantity })) ?? [],
    // The price snapshot: what the guest was shown and will pay.
    quote: h.quote,
    totalKobo: h.totalKobo,
    expiresAt: h.expiresAt,
    endedAt: h.endedAt,
  };
}
