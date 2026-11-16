// @ts-check
/**
 * demo-operator.js — creates one complete copy of the demo business, Ìrìn Lagos Tours.
 *
 * It's a FUNCTION (not just a script) because the PRD needs copies of the demo business
 * in three places:
 *   - `pnpm db:seed` / `pnpm db:reset` during development (this session)
 *   - the nightly demo reset (session 18)
 *   - a throwaway "visitor sandbox" per demo visitor (session 18)
 * Each copy gets its own `slug`, and staff emails are derived from it, so copies never
 * clash on the unique email column.
 *
 * Everything here is FICTIONAL (PRD portfolio rule): names, emails and phone numbers.
 * Emails use the reserved `.example` domain, which can never receive real mail.
 *
 * Later sessions extend this file with products, schedules, bookings and resources.
 */
import { PRESET_ROLES } from '@okapigo/shared/permissions';

export const DEFAULT_SLUG = 'irin-lagos-tours';

/**
 * The staff from the PRD: an owner, an operations manager and four guides.
 * `local` becomes the email's local part: adaeze@irin-lagos-tours.example
 */
const STAFF = [
  { name: 'Adaeze Okafor', local: 'adaeze', role: 'owner', phone: '+2348030000001' },
  { name: 'Tunde Bakare', local: 'tunde', role: 'manager', phone: '+2348030000002' },
  { name: 'Kemi Adeyemi', local: 'kemi', role: 'guide', phone: '+2348030000003' },
  { name: 'Chinedu Eze', local: 'chinedu', role: 'guide', phone: '+2348030000004' },
  { name: 'Halima Bello', local: 'halima', role: 'guide', phone: '+2348030000005' },
  { name: 'Femi Ogunleye', local: 'femi', role: 'guide', phone: '+2348030000006' },
];

/**
 * Creates the operator, its preset roles and its staff, all-or-nothing.
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ slug?: string }} [options]
 */
export async function seedDemoOperator(prisma, { slug = DEFAULT_SLUG } = {}) {
  // $transaction: either EVERY row below is written, or (on any error) NONE are.
  // A half-created business (operator but no staff) would be worse than nothing.
  return prisma.$transaction(async (tx) => {
    const operator = await tx.operator.create({
      data: { name: 'Ìrìn Lagos Tours', slug, currency: 'NGN', timeZone: 'Africa/Lagos' },
    });

    // One role per preset (owner, manager, guide), remembered by key for the staff loop.
    /** @type {Record<string, string>} role key → role id */
    const roleIds = {};
    for (const preset of PRESET_ROLES) {
      const role = await tx.role.create({
        data: {
          operatorId: operator.id,
          key: preset.key,
          name: preset.name,
          isPreset: true,
          permissions: preset.permissions,
        },
      });
      roleIds[preset.key] = role.id;
    }

    // Phone numbers are unique platform-wide too, but we only have six fictional ones.
    // So only the main demo copy gets phones; extra copies (sandboxes) use email only.
    const withPhones = slug === DEFAULT_SLUG;

    await tx.user.createMany({
      data: STAFF.map((person) => ({
        operatorId: operator.id,
        roleId: roleIds[person.role],
        name: person.name,
        email: `${person.local}@${slug}.example`,
        phone: withPhones ? person.phone : null,
      })),
    });

    return operator;
  });
}
