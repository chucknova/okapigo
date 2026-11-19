// @ts-check
/**
 * PRD journey 2, "Guest books on WhatsApp" (stage 13c-2): chats in the simulator, picks the
 * Street Food Crawl, gets a payment link, pays, and the ticket arrives in the chat by itself.
 * Done the way a guest does it: typing, tapping buttons, choosing from list sheets.
 *
 * The ticket comes from the API's notices pass (every 5 s) and the simulator's polling
 * (every 2 s), so the last step waits a little.
 */
import { test, expect } from '@playwright/test';

const slug = () => /** @type {string} */ (process.env.E2E_OPERATOR_SLUG);

test('a guest books the Street Food Crawl on WhatsApp, pays the link, and gets the ticket', async ({
  page,
  context,
}) => {
  await page.goto(`/simulator/whatsapp/?operator=${slug()}`);
  const phone = page.getByRole('region', { name: 'Chat with Ìrìn Lagos Tours' });
  await expect(phone.getByText('Booking assistant', { exact: true })).toBeVisible();
  await page.getByLabel('Chatting as').selectOption({ label: 'Ngozi Eze · 0809 444 2020' });

  /** Taps the newest button with that name (older messages keep theirs, as on WhatsApp). */
  const tap = (/** @type {string | RegExp} */ name) =>
    phone
      .getByRole('button', { name, exact: typeof name === 'string' })
      .last()
      .click();
  /** Opens the newest list and chooses a row. */
  const choose = async (/** @type {string} */ list, /** @type {string | RegExp} */ row) => {
    await tap(new RegExp(list));
    const sheet = page.getByRole('dialog', { name: list });
    await sheet.getByRole('button', { name: row }).first().click();
    await expect(sheet).toBeHidden();
  };
  const say = async (/** @type {string} */ text) => {
    await page.getByLabel('Message', { exact: true }).fill(text);
    await page.getByRole('button', { name: 'Send' }).click();
  };

  // 1–3: hello, tours, the tour, a date.
  await say('Hi');
  await expect(phone.getByText(/booking assistant\. I can show you our tours/)).toBeVisible();
  await tap('See tours');
  await choose('Choose a tour', /Street Food Crawl/);
  await expect(phone.getByText('Lagos Street Food Crawl', { exact: true }).first()).toBeVisible();
  await choose('Choose a date', /left$/);

  // 4–6: who's coming, an extra, the name and email.
  await expect(phone.getByText(/How many adults \(13 or over\)\?/)).toBeVisible();
  await tap('2');
  await tap('No');
  await choose('See extras', /Palm wine sampler/);
  await tap('1');
  await tap('No, that’s all');
  await say('Ngozi Eze');
  await expect(
    phone.getByText('Thanks, Ngozi. An email for your receipt?', { exact: false }),
  ).toBeVisible();
  await say('ngozi.eze@guest.example');

  // 7–8: the summary, seats held; Pay → the link, with its preview card.
  await expect(
    phone.getByText('Total ₦74,000 (includes ₦5,163 VAT)', { exact: false }),
  ).toBeVisible();
  await tap('Pay ₦74,000');
  const card = phone.getByRole('link', { name: /Pay ₦74,000 · Ìrìn Lagos Tours/ });
  await expect(card).toBeVisible();
  const href = /** @type {string} */ (await card.getAttribute('href'));
  expect(href).toMatch(/\/pay\/[\w-]+$/);

  // The guest opens the link (a new tab on a phone), and pays on the (simulated) checkout.
  const pay = await context.newPage();
  await pay.goto(href);
  await expect(pay.getByRole('heading', { name: 'Pay for your booking' })).toBeVisible();
  await pay.getByRole('button', { name: 'Pay ₦74,000' }).click();
  await pay.getByRole('button', { name: 'Pay ₦74,000' }).click(); // the simulator's page
  await expect(pay.getByText('This link has been paid. Thank you!')).toBeVisible({
    timeout: 30_000,
  });
  await pay.close();

  // 9: back in the chat, the ticket arrives by itself.
  await expect(phone.getByText('✓ Booking confirmed')).toBeVisible({ timeout: 30_000 });
  await expect(phone.getByText('Paid ₦74,000', { exact: false })).toBeVisible();
  const ticket = phone.getByRole('img', {
    name: 'Your ticket. Show it to the guide at the start.',
  });
  await expect(ticket).toBeVisible();
  // The picture really loaded (a PNG from the API, not a broken image).
  await expect
    .poll(() => ticket.evaluate((img) => /** @type {HTMLImageElement} */ (img).naturalWidth))
    .toBeGreaterThan(0);
  await expect(
    phone.getByRole('link', { name: /Your trip · Lagos Street Food Crawl/ }),
  ).toBeVisible();
  await expect(phone.getByRole('button', { name: 'Book another tour' })).toBeVisible();
});
