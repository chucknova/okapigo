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
  await expect(widget.getByText('Paystack is open in a new tab')).toBeVisible();
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
