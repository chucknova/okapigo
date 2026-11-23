// @ts-check
/**
 * PRD journey 8, "Owner makes a poster and checks the day" (MKT-01, MKT-02, RPT-01; stages
 * 18b–18c): picks a tour, gets an auto-filled poster to download, then reviews today's
 * bookings and revenue on the dashboard.
 *
 * A guest books and pays first, so today has a booking and money to show. The office person is
 * a manager made for this journey: journeys 3 and 7 sign the business's manager and owner in,
 * and one address gets one sign-in code a minute.
 */
import { test, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { createHmac, randomUUID } from 'node:crypto';
import { createPrismaClient, dashboardFigures } from '@okapigo/db';
import { formatNaira } from '@okapigo/shared/money';

const rootEnv = new URL('../../../.env', import.meta.url);
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
const prisma = createPrismaClient(process.env.DATABASE_URL);
const secret = /** @type {string} */ (process.env.AUTH_SECRET);
const slug = () => /** @type {string} */ (process.env.E2E_OPERATOR_SLUG);

test.afterAll(() => prisma.$disconnect());

test('the office makes a poster, downloads it, and sees today on the dashboard', async ({
  page,
}) => {
  const op = await prisma.operator.findUniqueOrThrow({ where: { slug: slug() } });
  const figures = () => dashboardFigures(prisma, { operatorId: op.id, timeZone: op.timeZone });
  const before = (await figures()).today;

  // 1 · A guest books a Heritage Walk and pays (as in journey 4).
  await page.goto(`/${slug()}/lagos-island-heritage-walk`);
  await page.getByRole('link', { name: /left$/ }).nth(1).click();
  await page.getByRole('button', { name: 'Continue' }).last().click();
  await page.getByLabel('Full name').first().fill('Kemi Lawal');
  await page.getByLabel('Email').fill('kemi.lawal@guest.example');
  await page.getByText('I’m travelling too').click();
  await page.getByLabel('Age', { exact: true }).fill('27');
  await page.getByText(/I accept the booking terms/).click();
  await page.getByRole('button', { name: 'Continue to payment' }).click();
  await page.getByRole('button', { name: 'Pay ₦25,000' }).click();
  await page.getByRole('button', { name: 'Pay ₦25,000' }).click(); // the simulator's page
  await expect(page.getByRole('heading', { name: 'Booking confirmed' })).toBeVisible({
    timeout: 30_000,
  });
  // Booked and paid today: one more booking, ₦25,000 more in.
  await expect
    .poll(async () => (await figures()).today.money.in - before.money.in, { timeout: 30_000 })
    .toBeGreaterThanOrEqual(2_500_000);
  expect((await figures()).today.bookings.total).toBe(before.bookings.total + 1);

  // 2 · A manager of the business signs in with a code (their first run done).
  const role = await prisma.role.findFirstOrThrow({ where: { operatorId: op.id, key: 'manager' } });
  const email = `ade.${randomUUID().slice(0, 8)}@irin.example`;
  await prisma.user.create({
    data: { operatorId: op.id, roleId: role.id, name: 'Ade Coker', email },
  });
  const office = await page.context().newPage();
  await office.goto('/app/');
  await office.getByLabel('Email or phone number').fill(email);
  await office.getByRole('button', { name: 'Send me a code' }).click();
  await expect(office.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  await prisma.otpChallenge.create({
    data: {
      purpose: 'login',
      channel: 'email',
      destination: email,
      codeHash: createHmac('sha256', secret).update('802468').digest('hex'),
      expiresAt: new Date(Date.now() + 10 * 60_000),
    },
  });
  await office.getByLabel('Digit 1 of 6').fill('802468');
  await office.getByRole('button', { name: 'Not now' }).click();
  await expect(office.getByRole('heading', { name: 'You’re ready for no signal' })).toBeVisible({
    timeout: 30_000,
  });
  await office.getByRole('button', { name: 'Go to Today' }).click();
  // Today shows once "first run done" is saved (journey 3's trap).
  await expect(office.getByRole('heading', { name: /^Today, / })).toBeVisible({ timeout: 30_000 });

  // 3 · Posters: the Heritage Walk, "Seats left", its first departure; the preview, Download.
  await office.goto('/app/posters');
  await office.getByRole('radio', { name: /Lagos Island Heritage Walk/ }).check();
  await office.getByRole('radio', { name: /Seats left/ }).check();
  await expect(office.getByRole('combobox', { name: 'Departure' })).toBeVisible();
  await expect(
    office.getByRole('img', { name: /^Poster preview: Lagos Island Heritage Walk/ }),
  ).toBeVisible({
    timeout: 30_000,
  });
  // The picture really shows (not just its frame): the page may show images it made itself
  // (blob:), which the first build's security policy didn't allow (found in 18c).
  await expect
    .poll(() =>
      office
        .getByRole('img', { name: /^Poster preview/ })
        .evaluate((img) => /** @type {HTMLImageElement} */ (img).naturalWidth),
    )
    .toBe(1080);
  const [download] = await Promise.all([
    office.waitForEvent('download'),
    office.getByRole('link', { name: 'Download PNG · 1080 × 1080' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('lagos-island-heritage-walk-seats-left.png');
  const png = readFileSync(/** @type {string} */ (await download.path()));
  expect(png.subarray(1, 4).toString()).toBe('PNG');
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1080, 1080]);
  await expect(office.getByRole('status')).toContainText(
    'Saved: lagos-island-heritage-walk-seats-left.png (1080 × 1080)',
  );

  // 4 · The dashboard: today's bookings and money, as the books say.
  await office.goto('/app/dashboard');
  const today = office.getByRole('region', { name: 'Today' });
  const now = (await figures()).today;
  await expect(today.getByText('Bookings today')).toBeVisible();
  await expect(today.getByText(String(now.bookings.total), { exact: true }).first()).toBeVisible();
  await expect(
    today.getByText(formatNaira(now.money.in - now.money.out), { exact: true }),
  ).toBeVisible();
  await expect(today.getByText(/ website/)).toBeVisible();
  await expect(office.getByRole('region', { name: 'The last 30 days' })).toBeVisible();
  await expect(
    office
      .getByRole('region', { name: 'Where bookings came from · 30 days' })
      .getByText('Website and widget'),
  ).toBeVisible();
});
