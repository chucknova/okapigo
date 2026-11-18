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
import { createPolicy } from '../policies.js';
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
 * Ìrìn's website words, from the designs (file 04). Fictional, like everything here. No
 * social links: made-up handles could belong to real accounts.
 */
export const IRIN_SITE = {
  kind: 'City and food tours',
  tagline: 'Walk Lagos with people who love it',
  intro: 'Small groups, local guides, free cancellation up to 48 hours before.',
  about:
    'Ìrìn means “walk” in Yoruba. We’re a small team from Yaba who grew up on these streets. We show visitors and Lagosians alike the city’s history, food and people, at walking pace.',
  whyUs: [
    {
      title: 'Free cancellation up to 48 hours',
      text: 'Plans change. Cancel online, refund straight back.',
    },
    { title: 'Small groups', text: 'Never more than 15 on a walk, so you can hear and ask.' },
    { title: 'Guides from the neighbourhood', text: 'People who live here, not a script.' },
  ],
  faqs: [
    {
      question: 'How do I pay?',
      answer: 'By card or bank transfer when you book, through Paystack.',
    },
    {
      question: 'Can I book a private tour?',
      answer: 'Yes. Message us on WhatsApp with your dates and group size.',
    },
    {
      question: 'What if I need to cancel?',
      answer: 'Free up to 48 hours before; 50% back from 24 to 48 hours.',
    },
  ],
  email: 'hello@irinlagostours.example',
  address: 'Yaba, Lagos',
  socials: [],
};

/**
 * Creates the operator, its preset roles and its staff, all-or-nothing.
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ slug?: string, now?: Date }} [options] `now` lets tests pin the calendar
 */
export async function seedDemoOperator(prisma, { slug = DEFAULT_SLUG, now = new Date() } = {}) {
  // $transaction: either EVERY row below is written, or (on any error) NONE are.
  // A half-created business (operator but no staff) would be worse than nothing.
  const { operator, scheduleIds } = await prisma.$transaction(
    async (tx) => {
      // The operator and its owner/manager/guide roles (shared with real sign-ups).
      const created = await createOperatorWithPresetRoles(tx, {
        name: 'Ìrìn Lagos Tours',
        slug,
      });
      const { roleIds } = created;
      // "Tours in Lagos" on the catalogue (stage 12b).
      const operator = await tx.operator.update({
        where: { id: created.operator.id },
        // Call and WhatsApp on the trip hub (stage 12f). Fictional numbers.
        data: {
          city: 'Lagos',
          phone: '+2348090000123',
          whatsapp: '+2348090000123',
          site: IRIN_SITE, // the one-page website's words (stage 12g-2)
        },
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

      // Ìrìn's cancellation policy, as in the PRD: full refund 48 h or more before, 50% from
      // 24 to 48 h, nothing after (or for no-shows); deposits are non-refundable.
      const { policy } = await createPolicy(tx, {
        operatorId: operator.id,
        name: 'Standard',
        terms: {
          rules: [
            { hoursBefore: 48, refundBasisPoints: 10_000 },
            { hoursBefore: 24, refundBasisPoints: 5_000 },
            { hoursBefore: 0, refundBasisPoints: 0 },
          ],
          noShowRefundBasisPoints: 0,
          depositRefundable: false,
        },
      });
      await tx.product.updateMany({
        where: { operatorId: operator.id },
        data: { cancellationPolicyId: policy.id },
      });

      return { operator, scheduleIds };
      // Time limits: Prisma's default is 5 s. When many seeds run at once (the start of a full
      // test run, or several demo sandboxes), one can take longer; Prisma then rolls back and a
      // query already on its way runs OUTSIDE the transaction, failing with a confusing
      // foreign-key error. That was the "open issue" from session 8, found in stage 10d.
    },
    { maxWait: 15_000, timeout: 30_000 },
  );

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
