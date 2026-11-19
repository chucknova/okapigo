// @ts-check
/**
 * PRD journey 4, "Guest cancels": a Heritage Walk guest books a few days ahead, opens the trip
 * page, chooses Change or cancel → Cancel now, sees the refund FIRST, confirms, and the
 * booking is cancelled with the refund sent to the provider (the simulator in test mode).
 */
import { test, expect } from '@playwright/test';
import { emailTo } from './messages.js';

const slug = () => /** @type {string} */ (process.env.E2E_OPERATOR_SLUG);

test('a guest cancels from the trip page and gets the policy’s refund', async ({
  page,
  request,
}) => {
  await page.goto(`/${slug()}/lagos-island-heritage-walk`);
  // The fourth date tile: at least three days away, so the full-refund tier (48 h or more).
  await page.getByRole('link', { name: /left$/ }).nth(3).click();

  await expect(page.getByText('₦25,000').first()).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).last().click();
  await page.getByLabel('Full name').first().fill('Bola Ade');
  await page.getByLabel('Email').fill('bola.ade@guest.example');
  await page.getByText('I’m travelling too').click();
  await page.getByLabel('Age', { exact: true }).fill('29');
  await page.getByText(/I accept the booking terms/).click();
  await page.getByRole('button', { name: 'Continue to payment' }).click();
  await page.getByRole('button', { name: 'Pay ₦25,000' }).click();
  await page.getByRole('button', { name: 'Pay ₦25,000' }).click(); // the simulator's page
  await expect(page.getByRole('heading', { name: 'Booking confirmed' })).toBeVisible({
    timeout: 30_000,
  });
  const token = new URL(page.url()).pathname.split('/')[2];

  // The trip page → Change or cancel → the two choices.
  await page.getByRole('link', { name: 'Open your trip page' }).click();
  await page.getByRole('link', { name: 'Change or cancel this booking' }).click();
  await expect(page.getByRole('link', { name: /Cancel now/ })).toContainText(
    'You get ₦25,000 back.',
  );
  await page.getByRole('link', { name: /Cancel now/ }).click();

  // The refund first, then confirm.
  await expect(page.getByText('You’ll get back')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel and get ₦25,000 back' }).click();
  await expect(page.getByRole('heading', { name: 'Cancelled' })).toBeVisible();
  await expect(page.getByText('Your ₦25,000 refund is on its way.')).toBeVisible();

  // The refund really completes: the provider (the simulator, which finishes refunds by
  // itself after a moment) sends refund.processed, the worker settles it, and the booking
  // becomes "refunded" with the money recorded as gone. Not just "asked for".
  await expect
    .poll(
      async () => (await (await request.get(`/public/bookings/${token}`)).json()).booking.status,
      {
        timeout: 30_000,
      },
    )
    .toBe('refunded');
  const final = (await (await request.get(`/public/bookings/${token}`)).json()).booking;
  expect(final.cancellation).toMatchObject({ by: 'guest', refundKobo: 2_500_000 });
  expect(final.refunds).toEqual([{ amountKobo: 2_500_000, processedAt: expect.any(String) }]);

  // And the trip page says so, with no ticket.
  await page.getByRole('link', { name: 'Back to your trip page' }).click();
  await expect(page.getByText(/^Refunded ₦25,000 on /)).toBeVisible();

  // …and the guest is told (stage 14c): the cancellation with the policy's refund, then
  // "refund sent" once it has left, both by email.
  const cancelled = await emailTo(
    request,
    'bola.ade@guest.example',
    `${final.reference} is cancelled`,
  );
  expect(cancelled.text).toMatch(/Refund: ₦25,000 \(100%, cancelled \d+ (days|hours) before\)\./);
  const refunded = await emailTo(
    request,
    'bola.ade@guest.example',
    'Your refund of ₦25,000',
    final.reference,
  );
  expect(refunded.text).toContain('It may take 5–10 working days to show in your account');
  await expect(page.getByRole('img', { name: /QR ticket/ })).toHaveCount(0);
});
