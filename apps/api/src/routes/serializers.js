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
