// @ts-check
/**
 * PRD journey 7, "Guest asks the AI companion" (GST-04, GST-16; stage 18a-2): "What should I
 * wear for the Heritage Walk?" is answered from Ìrìn's own content; an unclear question goes
 * to staff, who reply from the inbox, and the reply shows on the trip page.
 *
 * The companion runs on the FAKE model in e2e (playwright.config.js: AI_PROVIDER 'fake'):
 * it answers from the tour's FAQs by matching words, so the run never calls Claude.
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

test.afterAll(() => prisma.$disconnect());

test('a guest asks the companion: answered from Ìrìn’s notes, or passed to the team who reply', async ({
  page,
}) => {
  // 1 · A Heritage Walk booked and paid (as in journey 4), then the trip page.
  await page.goto(`/${slug()}/lagos-island-heritage-walk`);
  await page.getByRole('link', { name: /left$/ }).nth(2).click();
  await page.getByRole('button', { name: 'Continue' }).last().click();
  await page.getByLabel('Full name').first().fill('Tolu Bankole');
  await page.getByLabel('Email').fill('tolu.bankole@guest.example');
  await page.getByText('I’m travelling too').click();
  await page.getByLabel('Age', { exact: true }).fill('31');
  await page.getByText(/I accept the booking terms/).click();
  await page.getByRole('button', { name: 'Continue to payment' }).click();
  await page.getByRole('button', { name: 'Pay ₦25,000' }).click();
  await page.getByRole('button', { name: 'Pay ₦25,000' }).click(); // the simulator's page
  await expect(page.getByRole('heading', { name: 'Booking confirmed' })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole('link', { name: 'Open your trip page' }).click();

  // 2 · "Ask a question": the tour's own FAQs to tap. "What should I wear?" is answered
  //     from Ìrìn's notes, and says so.
  const ask = page.getByRole('region', { name: 'Ask a question' });
  await expect(ask).toBeVisible();
  await ask.getByRole('button', { name: 'What should I wear?' }).click();
  await expect(
    ask.getByText(/^Light, breathable clothes and comfortable walking shoes/),
  ).toBeVisible();
  await expect(ask.getByText('From Ìrìn’s notes: “What should I wear?”')).toBeVisible();

  // 3 · A question the notes don't cover goes to the team at once.
  await ask
    .getByLabel('Your question', { exact: true })
    .fill('Can I fly my drone over Freedom Park?');
  await ask.getByRole('button', { name: 'Send' }).click();
  await expect(ask.getByText('Passed to Ìrìn’s team')).toBeVisible();
  const req = await prisma.guestRequest.findFirstOrThrow({
    where: {
      kind: 'question',
      message: 'Can I fly my drone over Freedom Park?',
      operator: { slug: slug() },
      booking: { leadName: 'Tolu Bankole' },
    },
  });

  // 4 · The office (the owner, signed in with a code) sees it in the inbox and replies. The
  //     owner, not the manager: journey 3 asks for the manager's code in the same run, and
  //     a second code for one address within a minute is refused ("Too many codes").
  const manager = await prisma.user.findFirstOrThrow({
    where: { operator: { slug: slug() }, role: { key: 'owner' } },
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
      codeHash: createHmac('sha256', secret).update('246801').digest('hex'),
      expiresAt: new Date(Date.now() + 10 * 60_000),
    },
  });
  await office.getByLabel('Digit 1 of 6').fill('246801');
  await office.getByRole('button', { name: 'Not now' }).click();
  await expect(office.getByRole('heading', { name: 'You’re ready for no signal' })).toBeVisible({
    timeout: 30_000,
  });
  await office.getByRole('button', { name: 'Go to Today' }).click();
  // Today shows once "first run done" is saved; opening another page before that would
  // reload into first run (journey 3's trap).
  await expect(office.getByRole('heading', { name: /^Today, / })).toBeVisible({ timeout: 30_000 });
  await office.goto(`/app/inbox/requests/${req.id}`);
  await expect(office.getByText('“Can I fly my drone over Freedom Park?”')).toBeVisible();
  await expect(office.getByText('The assistant wasn’t sure')).toBeVisible();
  await expect(office.getByRole('link', { name: 'Add to the FAQs' })).toBeVisible();
  await office.getByLabel(/^Reply to Tolu/).fill('Freedom Park doesn’t allow drones, sorry.');
  await office.getByRole('button', { name: 'Send and mark answered' }).click();
  // Answered: the card turns into a done request ("Adaeze · 09:24 · replied by…"); the
  // short "Sent" note can be gone by then, so look for what stays.
  await expect(office.getByText(/ · replied by /)).toBeVisible();

  // 5 · The guest's trip page shows the reply under their question.
  await page.reload();
  await expect(ask.getByText('Freedom Park doesn’t allow drones, sorry.')).toBeVisible();
  await expect(ask.getByText(/^Reply from Ìrìn/)).toBeVisible();
});
