// @ts-check
/**
 * PRD journey 1, "Guest books on the website": picks the Heritage Walk and a date, adds
 * travellers, seats are held, pays by (test) card, the payment webhook confirms the booking.
 * (The QR ticket and trip hub link arrive with stages 12e–12f.)
 *
 * Every step is done the way a guest does it: by visible labels and buttons on a phone.
 */
import { test, expect } from '@playwright/test';

const slug = () => /** @type {string} */ (process.env.E2E_OPERATOR_SLUG);

test('a guest books the Heritage Walk for an adult and a child, and pays', async ({
  page,
  request,
}) => {
  // The catalogue → the tour.
  await page.goto(`/${slug()}`);
  await expect(page.getByRole('heading', { name: 'Tours in Lagos' })).toBeVisible();
  await page.getByRole('link', { name: /Lagos Island Heritage Walk/ }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Lagos Island Heritage Walk' }),
  ).toBeVisible();

  // Step 1: the first date with seats (from the tour page's date tiles).
  await page.getByRole('link', { name: /left$/ }).first().click();

  // Step 2: one adult (the default) and one child; wait for the server's price.
  await expect(page.getByText('Who’s coming?', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Add one Child (3–12)' }).click();
  await expect(page.getByText('₦37,500').first()).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).last().click();

  // Step 3: details.
  await page.getByLabel('Full name').first().fill('Adaeze Okafor');
  await page.getByLabel('Email').fill('adaeze.okafor@guest.example');
  await page.getByLabel('Phone (WhatsApp)').fill('0803 123 4567');
  await page.getByText('I’m travelling too').click();
  const ages = page.getByLabel('Age');
  await ages.nth(0).fill('34');
  await page.getByLabel('Full name').nth(2).fill('Kamsi Okafor');
  await ages.nth(1).fill('8');
  await page.getByLabel('Dietary needs').nth(1).fill('No peanuts');
  await page.getByText(/I accept the booking terms/).click();
  await page.getByRole('button', { name: 'Continue to payment' }).click();

  // Step 4: the held booking, then Pay.
  await expect(page.getByText('Seats held').first()).toBeVisible();
  await expect(page.getByText('Kamsi Okafor')).toBeVisible();
  const token = await page.evaluate(
    (s) =>
      JSON.parse(sessionStorage.getItem(`okg-checkout:${s}/lagos-island-heritage-walk`) ?? '{}')
        .booking?.token,
    slug(),
  );
  expect(token).toMatch(/^[A-Za-z0-9_-]{44}$/);
  await page.getByRole('button', { name: 'Pay ₦37,500' }).click();

  // The payment page (the simulator, standing in for Paystack in test mode).
  await expect(page.getByText('Simulated checkout')).toBeVisible();
  await page.getByRole('button', { name: 'Pay ₦37,500' }).click();
  await expect(page).toHaveURL(/\/payments\/callback\?reference=OKG-/);

  // The webhook, processed by the worker, confirms the booking: paid in full.
  await expect
    .poll(
      async () => (await (await request.get(`/public/bookings/${token}`)).json()).booking.status,
      {
        timeout: 30_000,
      },
    )
    .toBe('paid');
});
