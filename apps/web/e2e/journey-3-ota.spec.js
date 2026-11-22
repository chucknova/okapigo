// @ts-check
/**
 * PRD journey 3, "an OTA booking via OCTO" (session 17, DST-01–03): a guest books on Sojourna,
 * a travel website selling the business's tours through OCTO; the seats are one stock (the
 * business's own website has them gone at once); the office sees the booking "via Sojourna",
 * paid by Sojourna; the guest cancels on Sojourna; both sides agree it's cancelled, and the
 * seats are back everywhere.
 *
 * Sojourna runs on :4500 (e2e/global-setup.js) with this run's operator's OCTO key.
 */
import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { createPrismaClient } from '@okapigo/db';

const rootEnv = new URL('../../../.env', import.meta.url);
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
const prisma = createPrismaClient(process.env.DATABASE_URL);
const secret = /** @type {string} */ (process.env.AUTH_SECRET);
const slug = () => /** @type {string} */ (process.env.E2E_OPERATOR_SLUG);
const sojourna = () => /** @type {string} */ (process.env.SOJOURNA_URL);

test.afterAll(() => prisma.$disconnect());
// The longest journey: two websites, a staff sign-in, and the staff app saving for no signal.
// The 90 seconds the others get is too tight on a busy machine (it ran out once at the desk).
test.setTimeout(180_000);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A day in Lagos `days` from today: "2026-11-27". @param {number} days */
const lagosDay = (days) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(
    new Date(Date.now() + days * 86_400_000),
  );

test('a guest books on Sojourna; the office sees it via Sojourna; cancelled on Sojourna, both agree', async ({
  page,
  request,
}) => {
  // Five days ahead: a full refund under Ìrìn's policy (48 hours or more).
  const day = lagosDay(5);
  const seatsOn = async () => {
    const r = await request.get(
      `/public/${slug()}/tours/lagos-island-heritage-walk/departures?from=${day}&to=${day}`,
    );
    const d = (await r.json()).departures.find((/** @type {any} */ x) => x.localDate === day);
    return /** @type {number} */ (d.seatsAvailable);
  };
  const before = await seatsOn();

  // 1 · On Sojourna: the business's tours, live through OCTO.
  await page.goto(sojourna());
  await expect(
    page.getByRole('heading', { name: 'Experiences by Ìrìn Lagos Tours' }),
  ).toBeVisible();
  await page.getByRole('link', { name: /Lagos Island Heritage Walk/ }).click();
  await expect(page.getByRole('heading', { name: 'Lagos Island Heritage Walk' })).toBeVisible();

  // 2 · Five days ahead (next month, if it falls there); two adults; Continue holds the seats.
  const [, month, dd] = day.split('-').map(Number);
  const thisMonth = Number(lagosDay(0).split('-')[1]);
  if (month !== thisMonth) await page.getByRole('button', { name: 'Next month' }).click();
  await page.getByRole('button', { name: `${MONTHS[month - 1]} ${dd}, open` }).click();
  await expect(page.getByText('2 adults', { exact: true })).toBeVisible();
  await expect(page.getByText('₦50,000')).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();

  // 3 · Checkout: the seats are held; the lead guest; "pay" (a test site).
  await expect(page.getByRole('timer', { name: 'Seats held' })).toBeVisible();
  // Held on Sojourna = gone from the business's own website, at once (one stock of seats).
  expect(await seatsOn()).toBe(before - 2);
  await page.getByLabel('Full name').fill('Hannah Weber');
  await page.getByLabel('Email').fill('hannah@guest.example');
  await page.getByRole('button', { name: 'Pay ₦50,000 (test)' }).click();

  // 4 · Booked: Sojourna's reference and the business's, and the business's own ticket.
  await expect(page.getByRole('heading', { name: 'You’re booked, Hannah' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'QR ticket from Ìrìn Lagos Tours' })).toBeVisible();
  const sjRef = (await page.getByText(/^SJ-\d{5}$/).textContent())?.trim() ?? '';
  const booking = await prisma.booking.findFirstOrThrow({
    where: { channelBooking: { resellerReference: sjRef } },
  });
  expect(booking).toMatchObject({ status: 'paid', leadName: 'Hannah Weber', channel: 'ota' });
  expect(await seatsOn()).toBe(before - 2);

  // 5 · The office (the manager, signed in with a code) sees it "via Sojourna".
  const manager = await prisma.user.findFirstOrThrow({
    where: { operator: { slug: slug() }, role: { key: 'manager' } },
  });
  const office = await page.context().newPage();
  await office.goto('/app/');
  await office.getByLabel('Email or phone number').fill(/** @type {string} */ (manager.email));
  await office.getByRole('button', { name: 'Send me a code' }).click();
  await expect(office.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  await prisma.otpChallenge.create({
    data: {
      purpose: 'login',
      channel: 'email',
      destination: /** @type {string} */ (manager.email),
      codeHash: createHmac('sha256', secret).update('135790').digest('hex'),
      expiresAt: new Date(Date.now() + 10 * 60_000),
    },
  });
  await office.getByLabel('Digit 1 of 6').fill('135790');
  // Signed in; the first run: the home screen, not now; saved for no signal; then Today.
  await office.getByRole('button', { name: 'Not now' }).click();
  await expect(office.getByRole('heading', { name: 'You’re ready for no signal' })).toBeVisible({
    timeout: 30_000,
  });
  await office.getByRole('button', { name: 'Go to Today' }).click();
  /** Opens the booking from the bookings desk: search its reference, open its row. */
  const openOnDesk = async () => {
    await office.goto('/app/bookings');
    await office.getByRole('button', { name: 'All', exact: true }).click();
    await office.getByLabel('Search').fill(booking.reference);
    const row = office.getByRole('link', { name: new RegExp(booking.reference) });
    await expect(row).toContainText('via Sojourna');
    await row.click();
  };
  await openOnDesk();
  const page2 = office.getByRole('region', { name: 'Booking' });
  await expect(page2.getByText(new RegExp(`VIA SOJOURNA \\(${sjRef}\\)`))).toBeVisible();
  await expect(page2.getByText('Paid by Sojourna')).toBeVisible();
  await expect(page2.getByText(/^Sojourna owes /)).toBeVisible();
  await expect(page2.getByText('Not sent: Sojourna sends its own')).toBeVisible();

  // 6 · The guest cancels on Sojourna: the refund shown first, then done.
  await page.getByRole('link', { name: 'My bookings' }).first().click();
  await expect(page.getByRole('heading', { name: 'Bookings · Ìrìn Lagos Tours' })).toBeVisible();
  await page.getByRole('button', { name: `Cancel ${sjRef}` }).click();
  const ask = page.getByRole('alertdialog', { name: `Cancel ${sjRef}?` });
  await expect(ask.getByText(/before: full refund$/)).toBeVisible();
  await expect(
    ask.getByText(/₦50,000 back to the guest, under Ìrìn Lagos Tours’ policy\./),
  ).toBeVisible();
  await ask.getByRole('button', { name: 'Cancel and refund ₦50,000' }).click();
  await expect(page.getByText('Cancelled · ₦50,000 refunded')).toBeVisible();

  // 7 · Both sides agree: cancelled, refunded by Sojourna (never "Refund to send"); the seats back.
  await openOnDesk();
  await expect(page2.getByText('Cancelled · refunded')).toBeVisible();
  await expect(page2.getByText(/^Refunded to the guest by Sojourna · /)).toBeVisible();
  expect(await seatsOn()).toBe(before);
});
