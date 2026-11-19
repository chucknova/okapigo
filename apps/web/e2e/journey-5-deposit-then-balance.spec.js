// @ts-check
/**
 * PRD journey 5, "Deposit and balance": a Badagry guest pays a 30% deposit, gets a balance
 * link, and pays the rest by link. (Reminder messages themselves are sent from session 14.)
 */
import { test, expect } from '@playwright/test';
import { waitForChat } from './messages.js';
import { existsSync } from 'node:fs';
import { createPrismaClient, createPaymentLink } from '@okapigo/db';

const slug = () => /** @type {string} */ (process.env.E2E_OPERATOR_SLUG);

test('deposit now, then the balance through a payment link', async ({ page, request }) => {
  // Step 1: a Saturday at least two weeks away, so the balance isn't due yet (a deposit is
  // only offered more than 7 days before the trip).
  await page.goto(`/${slug()}/badagry-heritage-day-trip`);
  await page.getByRole('link', { name: /left$/ }).nth(2).click();

  // Steps 2–3: one adult (the default), details.
  await expect(page.getByText('₦65,000').first()).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).last().click();
  await page.getByLabel('Full name').first().fill('Funmi Adeyemi');
  await page.getByLabel('Phone (WhatsApp)').fill('0805 987 6543');
  await page.getByText('I’m travelling too').click();
  // exact: "Age" also appears inside other labels ("...see the tour page").
  await page.getByLabel('Age', { exact: true }).fill('41');
  await page.getByText(/I accept the booking terms/).click();
  await page.getByRole('button', { name: 'Continue to payment' }).click();

  // Step 4: the deposit.
  await page.getByRole('radio', { name: /30% deposit now: ₦19,500/ }).check();
  await expect(page.getByText('Deposits are non-refundable.')).toBeVisible();
  await page.getByRole('button', { name: 'Pay deposit ₦19,500' }).click();
  await page.getByRole('button', { name: 'Pay ₦19,500' }).click(); // the simulator's page

  // Back: confirmed, with the balance to pay.
  await expect(page.getByRole('heading', { name: 'Booking confirmed' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText('Balance due')).toBeVisible();
  const reference = await page.locator('.okg-confirmed-band__code').textContent();
  const tripToken = new URL(page.url()).pathname.split('/')[2];

  // "Deposit received" reaches the guest's chat (stage 14c): what was paid, the balance, its
  // due date and the page to pay it. (This guest gave a phone only: no email.)
  const chat = await waitForChat(
    request,
    slug(),
    '0805 987 6543',
    /we got your deposit of ₦19,500/,
  );
  const deposit = /** @type {string} */ (chat.find((t) => /we got your deposit/.test(t)));
  expect(deposit).toMatch(/Balance: ₦45,500, due by \w{3} \d+ \w{3}\./);
  expect(deposit).toContain(`/trip/${tripToken}/pay`);

  // Staff send a payment link for the balance (as they would from the operator app).
  const rootEnv = new URL('../../../.env', import.meta.url);
  if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
  const prisma = createPrismaClient(process.env.DATABASE_URL);
  const operator = await prisma.operator.findUniqueOrThrow({ where: { slug: slug() } });
  const booking = await prisma.booking.findFirstOrThrow({
    where: { operatorId: operator.id, reference: /** @type {string} */ (reference) },
  });
  const { token } = await createPaymentLink(prisma, {
    operatorId: booking.operatorId,
    bookingId: booking.id,
    actor: { type: 'system' },
  });
  await prisma.$disconnect();

  // The guest opens the link and pays the rest.
  await page.goto(`/pay/${token}`);
  await expect(page.getByRole('heading', { name: 'Pay your balance' })).toBeVisible();
  await page.getByRole('button', { name: 'Pay ₦45,500' }).click();
  await page.getByRole('button', { name: 'Pay ₦45,500' }).click(); // the simulator's page

  // The link says it's paid, and offers the trip page (this phone has opened the trip).
  await expect(page.getByText('This link has been paid. Thank you!')).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole('link', { name: 'Open your trip page' })).toHaveAttribute(
    'href',
    `/trip/${tripToken}`,
  );

  const final = await (await request.get(`/public/bookings/${tripToken}`)).json();
  expect(final.booking).toMatchObject({ status: 'paid', balanceKobo: 0 });
});
