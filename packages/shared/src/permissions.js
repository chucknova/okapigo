// @ts-check
/**
 * permissions.js — the modules of OkapiGo and the three PRESET staff roles (ACC-05).
 *
 * Why this lives in packages/shared:
 *   - the seed script uses it to create each operator's preset roles (session 2)
 *   - the API uses it to check permissions on every route (session 3)
 *   - the operator PWA uses it to hide screens a user can't open (session 14)
 * One definition, imported everywhere, so they can never disagree.
 *
 * The model is deliberately simple: each role gives every MODULE one ACCESS LEVEL.
 *   none < view < edit
 * "edit" includes "view". Custom roles (e.g. "front desk") pick their own levels per module.
 */

/** Every area of the product that permissions can be set on. */
export const MODULES = /** @type {const} */ ([
  'products', // tours, prices, add-ons, schedules (INV-*)
  'bookings', // bookings, travellers, cancellations (BKG-*)
  'payments', // payments, refunds, payment links, the ledger (PAY-*)
  'operations', // resources, manifests, check-in (OPS-*)
  'channels', // OCTO / channel manager / mock OTA (DST-*)
  'marketing', // website styles, posters (MKT-*)
  'reports', // dashboard (RPT-*)
  'settings', // staff, roles, business settings (ACC-*)
]);

/** Access levels, lowest to highest. The array order IS the ranking. */
export const ACCESS_LEVELS = /** @type {const} */ (['none', 'view', 'edit']);

/** @typedef {typeof MODULES[number]} Module */
/** @typedef {typeof ACCESS_LEVELS[number]} AccessLevel */
/** @typedef {Record<Module, AccessLevel>} Permissions */

/**
 * Builds a full permissions object: every module set to `fallback`, then `overrides` applied.
 * Always returning every module means code never has to handle a "missing" module.
 * @param {AccessLevel} fallback
 * @param {Partial<Permissions>} [overrides]
 * @returns {Permissions}
 */
export function buildPermissions(fallback, overrides = {}) {
  const all = /** @type {Permissions} */ (Object.fromEntries(MODULES.map((m) => [m, fallback])));
  return { ...all, ...overrides };
}

/**
 * Does `granted` access satisfy what a route `required`s? e.g. hasAccess('edit', 'view') → true
 * @param {AccessLevel} granted
 * @param {AccessLevel} required
 */
export function hasAccess(granted, required) {
  return ACCESS_LEVELS.indexOf(granted) >= ACCESS_LEVELS.indexOf(required);
}

/**
 * The three roles every operator starts with. `key` is the stable machine name.
 * Based on the PRD's Users table:
 *   Owner   — sets up products, prices, policies; dashboard; posters → everything
 *   Manager — runs the daily schedule, changes, cancellations, refunds
 *   Guide   — opens manifests, checks guests in, marks no-shows
 */
export const PRESET_ROLES = /** @type {const} */ ([
  {
    key: 'owner',
    name: 'Owner',
    permissions: buildPermissions('edit'),
  },
  {
    key: 'manager',
    name: 'Operations manager',
    permissions: buildPermissions('edit', {
      // Can see products and reports but not change prices; can't manage staff or channels.
      products: 'view',
      channels: 'view',
      marketing: 'view',
      settings: 'none',
    }),
  },
  {
    key: 'guide',
    name: 'Guide',
    permissions: buildPermissions('none', {
      // Guides see what they need on tour day, and check-in is an "edit" in operations.
      products: 'view',
      bookings: 'view',
      operations: 'edit',
    }),
  },
]);
