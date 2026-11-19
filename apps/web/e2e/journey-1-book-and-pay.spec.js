// @ts-check
/**
 * PRD journey 1, "Guest books on the website": picks the Heritage Walk and a date, adds
 * travellers, seats are held, pays by (test) card, the payment webhook confirms the booking,
 * and the guest sees the confirmation. (The QR ticket arrives with the trip hub, stage 12f.)
 * And the confirmation reaches them, in their chat and by email (stage 14c).
 *
 * Every step is done the way a guest does it: by visible labels and buttons on a phone.
 */
import { test, expect } from '@playwright/test';
import { waitForChat, emailTo } from './messages.js';

const slug = () => /** @type {string} */ (process.env.E2E_OPERATOR_SLUG);

test('a guest books the Heritage Walk for an adult and a child, and pays', async ({
  page,
  request,
}) => {
  await page.goto(`/${slug()}`);
  // The operator's site (stage 12g-2): the hero, then the tours.
  await expect(
    page.getByRole('heading', { level: 1, name: 'Walk Lagos with people who love it' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Our tours' })).toBeVisible();
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
  // Back to "Confirming your payment...", which becomes the confirmation once the webhook
  // (processed by the worker) confirms the money (stage 12e).
  await expect(page).toHaveURL(new RegExp(`/trip/${token}/confirm\\?reference=OKG-`));
  await expect(page.getByRole('heading', { name: 'Booking confirmed' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText('Paid in full')).toBeVisible();
  await expect(page.getByText('Kamsi Okafor')).toBeVisible();

  const final = await (await request.get(`/public/bookings/${token}`)).json();
  expect(final.booking.status).toBe('paid');

  // The confirmation arrives (stage 14c, OPS-11): in the guest's chat (the simulator) and by
  // email (the local mailbox), in your wording, with the trip page.
  const ref = final.booking.reference;
  const chat = await waitForChat(
    request,
    slug(),
    '0803 123 4567',
    /^Hi Adaeze, your booking is confirmed!/,
  );
  expect(chat.find((t) => t.startsWith('Hi Adaeze'))).toContain(`Ref ${ref}`);
  const email = await emailTo(request, 'adaeze.okafor@guest.example', ref);
  expect(email.subject).toMatch(/^Booking confirmed: Heritage Walk, /);
  expect(email.from).toMatch(/^Ìrìn Lagos Tours </);
  expect(email.text).toContain('Hi Adaeze, your booking is confirmed!');
  expect(email.text).toContain(`/trip/${token}`);

  // The trip hub (stage 12f): the QR ticket, the meeting point, the route.
  await page.getByRole('link', { name: 'Open your trip page' }).click();
  await expect(page).toHaveURL(new RegExp(`/trip/${token}$`));
  await expect(
    page.getByRole('img', { name: `QR ticket for booking ${final.booking.reference}` }),
  ).toBeVisible();
  await expect(page.getByText('Tinubu Square').first()).toBeVisible();
  await expect(page.getByText(/Saved on this phone · last updated/)).toBeVisible();
});
