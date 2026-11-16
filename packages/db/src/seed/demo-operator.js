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
 * Later sessions extend this file with schedules, bookings and resources.
 */
import { createOperatorWithPresetRoles } from '../operators.js';
import { TOURS } from './tours.js';
import { syncScheduleDepartures } from '../departures.js';
import { localDate, stringToDate } from '@okapigo/shared/time';

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
 * @param {{ slug?: string, now?: Date }} [options] `now` lets tests pin the calendar
 */
export async function seedDemoOperator(prisma, { slug = DEFAULT_SLUG, now = new Date() } = {}) {
  // $transaction: either EVERY row below is written, or (on any error) NONE are.
  // A half-created business (operator but no staff) would be worse than nothing.
  const { operator, scheduleIds } = await prisma.$transaction(async (tx) => {
    // The operator and its owner/manager/guide roles (shared with real sign-ups).
    const { operator, roleIds } = await createOperatorWithPresetRoles(tx, {
      name: 'Ìrìn Lagos Tours',
      slug,
    });

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

    // Schedules start "today" in Lagos, so the demo always has upcoming departures.
    const today = localDate(now, operator.timeZone);
    const christmas = nextChristmas(today);
    /** @type {string[]} */
    const scheduleIds = [];

    // The five tours, each with its price categories, add-ons and schedule (nested create).
    for (const { prices, addOns, schedule, ...product } of TOURS) {
      const created = await tx.product.create({
        data: {
          ...product,
          // With nested writes, Prisma wants relations written as `connect`, not raw ids.
          operator: { connect: { id: operator.id } },
          // Nested writes: Prisma creates the children and fills in BOTH parts of their
          // composite key (productId and operatorId) from the parent product itself.
          priceCategories: { create: prices },
          addOns: { create: addOns },
          schedules: {
            // (No operatorId here: nested children inherit it from the product.)
            create: {
              startDate: stringToDate(today),
              daysOfWeek: schedule.daysOfWeek,
              times: schedule.times,
              skipDates: schedule.skipChristmas ? [stringToDate(christmas)] : [],
            },
          },
        },
        include: { schedules: true },
      });
      scheduleIds.push(created.schedules[0].id);
    }

    return { operator, scheduleIds };
  });

  // Turn each schedule into departures for the next 60 days. (Each sync runs in its own
  // transaction; if one failed, re-running the seed after a reset fixes it.)
  for (const id of scheduleIds) await syncScheduleDepartures(prisma, id, { now });

  return operator;
}

/**
 * The next 25 December on or after `today` ('YYYY-MM-DD'), e.g. '2026-12-25'.
 * @param {string} today
 */
function nextChristmas(today) {
  const thisYear = `${today.slice(0, 4)}-12-25`;
  return today <= thisYear ? thisYear : `${Number(today.slice(0, 4)) + 1}-12-25`;
}
