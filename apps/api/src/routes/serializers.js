// @ts-check
/**
 * serializers.js — turn database rows into the JSON we send to clients.
 *
 * Why not send rows as they are? Rows can contain things clients must never see (in later
 * sessions: payment references, internal notes) and their shape would change every time a
 * column is added. A serializer is an explicit whitelist: only these fields leave the API.
 */

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
