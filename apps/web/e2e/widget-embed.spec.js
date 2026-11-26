// @ts-check
/**
 * The booking widget (BKG-01, stage 12h-1) on a real second website: e2e/host-server.js on
 * :4200 is a different origin from OkapiGo's :4100, so the frame is cross-site, as it will be
 * on an operator's own site.
 *
 *   approved site   the frame grows to fit; a date tile starts checkout INSIDE the frame;
 *                   Pay opens Paystack (the simulator) in a new tab, where the booking is confirmed
 *   other site      nothing shows, and the browser itself refuses to load the frame
 *   all tours       the list, on a dark host page
 */
import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { createPrismaClient } from '@okapigo/db';

const slug = () => /** @type {string} */ (process.env.E2E_OPERATOR_SLUG);
const host = (/** @type {string} */ origin, /** @type {string} */ extra = '') =>
  `${origin}/?op=${slug()}&base=http://localhost:4100${extra}`;
const frameHeight = (/** @type {import('@playwright/test').Page} */ page) =>
  page.locator('#slot iframe').evaluate((f) => f.getBoundingClientRect().height);

test('on an approved website: book a tour inside the widget, pay in a new tab', async ({
  page,
  context,
}) => {
  await page.goto(host('http://localhost:4200', '&tour=lagos-island-heritage-walk'));
  const widget = page.frameLocator('#slot iframe');

  // The one-tour start: title, from price, date tiles.
  await expect(widget.getByRole('heading', { name: 'Lagos Island Heritage Walk' })).toBeVisible();
  await expect(widget.getByText('₦25,000')).toBeVisible();
  // The frame reported its height: it fits the content (not the 240 px it reserved).
  await expect.poll(() => frameHeight(page)).not.toBe(240);
  const startHeight = await frameHeight(page);

  // A date → checkout step 2, still inside the frame, which grows.
  await widget.getByRole('link', { name: /left$/ }).nth(3).click();
  await expect(widget.getByText('Who’s coming?', { exact: true }).first()).toBeVisible();
  await expect.poll(() => frameHeight(page)).toBeGreaterThan(startHeight);
  expect(new URL(page.url()).port).toBe('4200'); // the guest never left the host site

  await widget.getByRole('button', { name: 'Continue' }).last().click();
  await widget.getByLabel('Full name').first().fill('Tola Bello');
  await widget.getByLabel('Email').fill('tola.bello@guest.example');
  await widget.getByText('I’m travelling too').click();
  await widget.getByLabel('Age', { exact: true }).fill('30');
  await widget.getByText(/I accept the booking terms/).click();
  await widget.getByRole('button', { name: 'Continue to payment' }).click();
  await expect(widget.getByText(/Paystack in a new tab/)).toBeVisible();

  // Pay: Paystack (the simulator) opens in a NEW TAB; the host page stays where it is.
  const [tab] = await Promise.all([
    context.waitForEvent('page'),
    widget.getByRole('button', { name: 'Pay ₦25,000' }).click(),
  ]);
  await expect(tab.getByText('Simulated checkout')).toBeVisible();
  await tab.getByRole('button', { name: 'Pay ₦25,000' }).click();
  await expect(tab.getByRole('heading', { name: 'Booking confirmed' })).toBeVisible({
    timeout: 30_000,
  });
  // The frame followed the payment (stage 12h-2), and the host page heard about it.
  await expect(widget.getByRole('heading', { name: 'Booking confirmed' })).toBeVisible({
    timeout: 30_000,
  });
  await expect
    .poll(() => page.evaluate(() => /** @type {any} */ (window).okgEvents.length))
    .toBe(1);
  expect(new URL(page.url()).port).toBe('4200');
});

test('on a website that isn’t approved, guests see nothing', async ({ page }) => {
  // The same page, but at 127.0.0.1: another origin, not on Ìrìn's list.
  const blocked = [];
  page.on('console', (m) => {
    if (/frame-ancestors|Refused to frame/i.test(m.text())) blocked.push(m.text());
  });
  await page.goto(host('http://127.0.0.1:4200', '&tour=lagos-island-heritage-walk'));

  // embed.js asked and was told no: the frame collapses to nothing between the paragraphs.
  await expect.poll(() => frameHeight(page)).toBe(0);
  const gap = await page.evaluate(
    () =>
      /** @type {HTMLElement} */ (document.getElementById('below')).getBoundingClientRect().top -
      /** @type {HTMLElement} */ (document.getElementById('above')).getBoundingClientRect().bottom,
  );
  expect(gap).toBeLessThan(40); // just the paragraphs' own spacing
  // And the real guard: the browser refused to show the frame at all.
  await expect.poll(() => blocked.length).toBeGreaterThan(0);
});

test('all tours, on a dark host site', async ({ page }) => {
  await page.goto(host('http://localhost:4200', '&dark=1'));
  const widget = page.frameLocator('#slot iframe');
  await expect(widget.getByRole('link', { name: /Book$/ })).toHaveCount(5);
  await expect(widget.getByText('Bookings by OkapiGo')).toBeVisible();
  // A row goes straight into that tour's checkout, inside the frame.
  await widget.getByRole('link', { name: /Lagos Street Food Crawl/ }).click();
  await expect(widget.getByText('Choose a date').first()).toBeVisible();
  await expect(widget.getByText('Lagos Street Food Crawl · Step 1 of 4')).toBeVisible();
});

test('the "Book now" button: checkout in an overlay, paid in a new tab, confirmed in the overlay', async ({
  page,
  context,
}) => {
  // The host page arrived from a newsletter: the code reaches the booking.
  await page.goto(
    host(
      'http://localhost:4200',
      '&tour=lagos-island-heritage-walk&widget=button&colour=%230F4C5C&utm_source=newsletter',
    ),
  );
  const button = page.locator('#slot button');
  await expect(button).toHaveText('Book now');
  await expect(button).toBeVisible(); // shown once the site was approved

  // Open, and close with Escape: focus comes back to the button.
  await button.click();
  const overlay = page.frameLocator('[data-okapigo-overlay] iframe');
  await expect(overlay.getByText('Choose a date').first()).toBeVisible();
  await expect(overlay.getByRole('button', { name: 'Close' })).toBeVisible();
  // Key down, then key up, as two steps. Escape closes the overlay on key DOWN, and the host
  // page then removes the frame at once, so a one-call press() sent its key UP to a frame
  // that no longer existed and waited for it forever (the "flaky" timeout: a real browser just
  // drops that key-up). After the close, the key-up goes to the host page, as it would.
  await page.keyboard.down('Escape');
  await expect(page.locator('[data-okapigo-overlay]')).toHaveCount(0);
  await page.keyboard.up('Escape');
  await expect(button).toBeFocused();

  // Open again and book: a date, one adult, details, review.
  await button.click();
  // The last date listed: near a month's end its first tab may hold only two or three
  // (on Thu 26 Nov it held three, and the fourth this test used to pick didn't exist).
  await overlay.getByRole('button', { name: /left$/ }).last().click();
  await expect(overlay.getByText('Who’s coming?', { exact: true }).first()).toBeVisible();
  await expect(overlay.getByRole('link', { name: 'Back' })).toBeVisible(); // beside Close now
  await overlay.getByRole('button', { name: 'Continue' }).last().click();
  await overlay.getByLabel('Full name').first().fill('Ngozi Eze');
  await overlay.getByLabel('Email').fill('ngozi.eze@guest.example');
  await overlay.getByText('I’m travelling too').click();
  await overlay.getByLabel('Age', { exact: true }).fill('27');
  await overlay.getByText(/I accept the booking terms/).click();
  await overlay.getByRole('button', { name: 'Continue to payment' }).click();

  const [tab] = await Promise.all([
    context.waitForEvent('page'),
    overlay.getByRole('button', { name: 'Pay ₦25,000' }).click(),
  ]);
  await tab.getByRole('button', { name: 'Pay ₦25,000' }).click(); // the simulator's page
  await expect(tab.getByRole('heading', { name: 'Booking confirmed' })).toBeVisible({
    timeout: 30_000,
  });

  // Back on the operator's site: the overlay followed the payment…
  await expect(overlay.getByRole('heading', { name: 'Booking confirmed' })).toBeVisible({
    timeout: 30_000,
  });
  // …and the host page heard about it, with nothing personal.
  await expect
    .poll(() => page.evaluate(() => /** @type {any} */ (window).okgEvents.length))
    .toBe(1);
  const [event] = await page.evaluate(() => /** @type {any} */ (window).okgEvents);
  expect(event).toMatchObject({
    operator: slug(),
    tour: 'lagos-island-heritage-walk',
    amountPaidKobo: 2_500_000,
    currency: 'NGN',
  });
  expect(JSON.stringify(event)).not.toContain('Ngozi');

  // The booking says where it came from: the widget, on this site, from the newsletter.
  const rootEnv = new URL('../../../.env', import.meta.url);
  if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
  const prisma = createPrismaClient(process.env.DATABASE_URL);
  const booking = await prisma.booking.findFirstOrThrow({ where: { reference: event.reference } });
  await prisma.$disconnect();
  expect(booking.attribution).toEqual({
    via: 'widget',
    host: 'localhost:4200',
    utm_source: 'newsletter',
  });
});
