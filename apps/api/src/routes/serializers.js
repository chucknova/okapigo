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
    cancellationPolicyId: p.cancellationPolicyId,
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

/**
 * A booking for lists: enough to show a row, without travellers and timeline.
 * @param {import('@prisma/client').Booking & { departure?: import('@prisma/client').Departure, product?: import('@prisma/client').Product, _count?: { travellers: number } }} b
 * @param {string} timeZone
 */
export function serializeBookingSummary(b, timeZone) {
  return {
    id: b.id,
    reference: b.reference,
    status: b.status,
    channel: b.channel,
    totalKobo: b.totalKobo,
    amountPaidKobo: b.amountPaidKobo,
    // Derived, never stored: it can't disagree with the two numbers it comes from.
    balanceDueKobo: b.totalKobo - b.amountPaidKobo,
    // What goes back to the guest after a cancellation or no-show (paid out in session 10).
    refundDueKobo: b.refundDueKobo,
    lead: { name: b.leadName, email: b.leadEmail, phone: b.leadPhone },
    product: b.product ? { id: b.product.id, title: b.product.title } : undefined,
    departure: b.departure
      ? {
          id: b.departure.id,
          startsAt: b.departure.startsAt,
          localDate: localDate(b.departure.startsAt, timeZone),
          localTime: localTime(b.departure.startsAt, timeZone),
        }
      : undefined,
    travellerCount: b._count?.travellers,
    createdAt: b.createdAt,
  };
}

/**
 * A booking with everything: travellers, add-ons, the hold's expiry and the timeline.
 * @param {any} b booking with travellers, addOns (with addOn), events, hold, departure, product
 * @param {string} timeZone
 */
export function serializeBooking(b, timeZone) {
  return {
    ...serializeBookingSummary(b, timeZone),
    lead: {
      name: b.leadName,
      email: b.leadEmail,
      phone: b.leadPhone,
      marketingConsent: b.marketingConsent,
      termsAcceptedAt: b.termsAcceptedAt,
    },
    notes: b.notes,
    quote: b.quote,
    // While "held", the guest must pay or be confirmed before this time.
    holdExpiresAt: b.status === 'held' ? b.hold?.expiresAt : null,
    travellerCount: b.travellers.length,
    travellers: b.travellers.map((t) => ({
      id: t.id,
      position: t.position,
      name: t.name,
      age: t.age,
      categoryKey: t.categoryKey,
      dietaryNeeds: t.dietaryNeeds,
      email: t.email,
      phone: t.phone,
      checkInStatus: t.checkInStatus,
    })),
    addOns: b.addOns.map((a) => ({
      addOnId: a.addOnId,
      name: a.addOn?.name,
      quantity: a.quantity,
      unitKobo: a.unitKobo,
    })),
    timeline: b.events.map((e) => ({
      type: e.type,
      fromStatus: e.fromStatus,
      toStatus: e.toStatus,
      actor: { type: e.actorType, userId: e.actorUserId },
      data: e.data,
      at: e.createdAt,
    })),
  };
}

/** @param {import('@prisma/client').CancellationPolicyVersion} v */
export function serializePolicyVersion(v) {
  return {
    id: v.id,
    version: v.version,
    rules: v.rules,
    noShowRefundBasisPoints: v.noShowRefundBasisPoints,
    depositRefundable: v.depositRefundable,
    createdAt: v.createdAt,
  };
}

/** @param {import('@prisma/client').CancellationPolicy & { versions: import('@prisma/client').CancellationPolicyVersion[], _count?: { products: number } }} p versions newest first */
export function serializePolicy(p) {
  return {
    id: p.id,
    name: p.name,
    current: p.versions[0] ? serializePolicyVersion(p.versions[0]) : null,
    versions: p.versions.map(serializePolicyVersion),
    productCount: p._count?.products,
  };
}
