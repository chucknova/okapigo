// @ts-check
/**
 * Accessibility (stage 19c-1; PRD: "guest pages meet WCAG 2.1 AA"). axe checks every guest
 * page in a real browser, against WCAG 2.0 and 2.1, levels A and AA: contrast (in every
 * style, light and dark), names for buttons, links and fields, headings, landmarks, alt text,
 * language, and more.
 *
 * What axe can't judge (whether a description is GOOD, whether the order of things makes
 * sense to a screen reader, keyboard traps it doesn't reach) still needs a person; this
 * catches the mechanical problems, every run.
 *
 * Its own business with the demo's photos and logo (the shared journeys' business has none),
 * so the pictures, their alt text and credits are checked too. Deleted afterwards.
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import {
  createPrismaClient,
  seedDemoOperator,
  seedDemoPhotos,
  createPaymentLink,
} from '@okapigo/db';
import { localStorage } from '@okapigo/media';
import { E2E_MEDIA_DIR, E2E_PORT } from '../playwright.config.js';

const rootEnv = new URL('../../../.env', import.meta.url);
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

/** WCAG 2.0 and 2.1, levels A and AA: what the PRD asks for. */
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const STYLES = ['lagoon', 'classic', 'earth'];
const MODES = ['light', 'dark'];

/** @type {import('@prisma/client').PrismaClient} */
let prisma;
const slug = `test-a11y-${randomUUID().slice(0, 8)}`;
const TOUR = 'lagos-island-heritage-walk';

test.beforeAll(async () => {
  prisma = createPrismaClient(process.env.DATABASE_URL);
  const operator = await seedDemoOperator(prisma, { slug });
  await prisma.operator.update({
    where: { id: operator.id },
    data: { embedDomains: ['localhost:4200'] },
  });
  await seedDemoPhotos(prisma, operator, {
    media: localStorage({ dir: E2E_MEDIA_DIR, publicUrl: `http://localhost:${E2E_PORT}/media` }),
  });
});
test.afterAll(async () => {
  await prisma.operator.deleteMany({ where: { slug } });
  await prisma.$disconnect();
});

/**
 * Runs axe on the page as it is now and expects nothing wrong. A failure lists each problem
 * with where it is, so it can be fixed without guessing.
 * @param {import('@playwright/test').Page} page
 * @param {string} what  for the failure message ("the website, earth dark")
 */
async function check(page, what) {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  const found = violations.map((v) => ({
    rule: v.id,
    impact: v.impact,
    help: v.help,
    where: v.nodes
      .slice(0, 4)
      .map((n) => `${n.target.join(' ')}: ${n.failureSummary?.split('\n')[1]?.trim() ?? ''}`),
  }));
  expect(found, `accessibility problems on ${what}`).toEqual([]);
}

/** Waits until every picture on screen has loaded (contrast is measured over what's drawn). */
const pictures = (/** @type {import('@playwright/test').Page} */ page) =>
  page.waitForFunction(() =>
    [...document.images]
      .filter((i) => i.loading !== 'lazy')
      .every((i) => i.complete && i.naturalWidth > 0),
  );

test('the website and a tour page: every style, light and dark, phone and desk', async ({
  page,
}) => {
  for (const style of STYLES) {
    for (const mode of MODES) {
      const look = `?style=${style}&mode=${mode}`;
      await page.goto(`/${slug}${look}`);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await pictures(page);
      await check(page, `the website, ${style} ${mode}`);
      await page.goto(`/${slug}/${TOUR}${look}`);
      await expect(page.getByRole('heading', { level: 1, name: /Heritage Walk/ })).toBeVisible();
      await expect(page.getByRole('link', { name: /left$/ }).first()).toBeVisible();
      await check(page, `a tour page, ${style} ${mode}`);
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/${slug}`);
  await pictures(page);
  await check(page, 'the website on a desk');
  await page.goto(`/${slug}/${TOUR}`);
  await expect(page.getByRole('link', { name: /left$/ }).first()).toBeVisible();
  await check(page, 'a tour page on a desk');
});

test('checkout, each step (with a form showing its errors), then the paid trip page', async ({
  page,
}) => {
  await page.goto(`/${slug}/${TOUR}`);
  await page.getByRole('link', { name: /left$/ }).first().click();
  await expect(page.getByText('Who’s coming?', { exact: true }).first()).toBeVisible();
  await check(page, 'checkout: who’s coming');
  await page.getByRole('button', { name: 'Continue' }).last().click();

  await expect(page.getByLabel('Email')).toBeVisible();
  await page.getByRole('button', { name: 'Continue to payment' }).click(); // empty: errors
  await expect(page.getByText(/Add your name|Enter/).first()).toBeVisible();
  await check(page, 'checkout: details, with errors');
  await page.getByLabel('Full name').first().fill('Adaeze Okafor');
  await page.getByLabel('Email').fill('adaeze.okafor@guest.example');
  await page.getByLabel('Phone (WhatsApp)').fill('0803 123 4567');
  await page.getByText('I’m travelling too').click();
  await page.getByLabel('Age').first().fill('34');
  await page.getByText(/I accept the booking terms/).click();
  await page.getByRole('button', { name: 'Continue to payment' }).click();

  await expect(page.getByText('Seats held').first()).toBeVisible();
  await check(page, 'checkout: review and pay');
  await page.getByRole('button', { name: /^Pay ₦/ }).click();
  await page.getByRole('button', { name: /^Pay ₦/ }).click(); // the simulator's page
  await expect(page.getByRole('heading', { name: 'Booking confirmed' })).toBeVisible({
    timeout: 30_000,
  });
  await check(page, 'booking confirmed');

  const token = new URL(page.url()).pathname.split('/')[2];
  await page.goto(`/trip/${token}`);
  await expect(page.getByRole('heading', { level: 1, name: /Heritage Walk/ })).toBeVisible();
  await pictures(page);
  await check(page, 'the trip page (paid: ticket, map, companion)');
  await page.goto(`/trip/${token}/change`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await check(page, 'change or cancel');
  await page.goto(`/trip/${token}/ask`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await check(page, 'ask the business');

  await page.goto(`/${slug}/${TOUR}/book`);
  await expect(page.getByText(/Step 1 of 4/).first()).toBeVisible();
  await check(page, 'checkout: choose a date');
});

test('a payment link, the booking widget, and a page that isn’t there', async ({
  page,
  request,
}) => {
  // A held booking owes its total: staff send a link for it.
  const deps = (await (await request.get(`/public/${slug}/tours/${TOUR}/departures`)).json())
    .departures;
  const made = await (
    await request.post(`/public/${slug}/bookings`, {
      data: {
        lead: { name: 'Kamsi Okafor', email: 'kamsi@guest.example', acceptTerms: true },
        departureId: deps[0].id,
        travellers: [{ name: 'Kamsi Okafor', age: 29 }],
        addOns: [],
      },
    })
  ).json();
  expect(made.token).toBeTruthy();
  const booking = await prisma.booking.findFirstOrThrow({
    where: { leadEmail: 'kamsi@guest.example', product: { operator: { slug } } },
  });
  const { token } = await createPaymentLink(prisma, {
    operatorId: booking.operatorId,
    bookingId: booking.id,
    actor: { type: 'system' },
  });
  await page.goto(`/pay/${token}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await check(page, 'a payment link');

  // The widget's own pages (what shows inside the frame on someone else's site).
  await page.goto(`/embed/${slug}`);
  await expect(page.getByRole('link', { name: /Heritage Walk/ }).first()).toBeVisible();
  await check(page, 'the widget: all tours');
  await page.goto(`/embed/${slug}/${TOUR}`);
  await expect(page.getByRole('heading', { name: /Heritage Walk/ }).first()).toBeVisible();
  await check(page, 'the widget: one tour');

  await page.goto(`/${slug}/no-such-tour`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await check(page, 'not found');
});
