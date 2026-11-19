// @ts-check
/**
 * PRD journey 6, "Guide check-in offline" (flow brief 07, stage 15d): a guide signs in on their
 * phone, loses signal, checks in a whole departure (scanning a real ticket with the camera,
 * tapping names, naming an unnamed guest, taking cash), marks a no-show, reopens the app with
 * no network at all, then reconnects, and everything syncs, each change once.
 *
 * The day, set up first (as the office and guests would have it):
 *   A · Adaeze Okafor, 2 guests, paid       → scanned (a fake camera playing their ticket's QR)
 *   B · Emeka Nwosu, 3 guests, paid         → tapped in; "Guest 2" named at check-in
 *   C · Funmi Adeyemi, 1 guest, owes        → "They paid me cash"
 *   D · Tola Bello, 1 guest, paid           → doesn't come: a no-show
 * The walk started 10 minutes ago, with Femi (a seeded guide) as its guide.
 */
import { test, expect, chromium, devices } from '@playwright/test';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { encode } from 'uqr';
import { createPrismaClient, ticketCode } from '@okapigo/db';

const BASE = 'http://localhost:4100';
const slug = () => /** @type {string} */ (process.env.E2E_OPERATOR_SLUG);
const rootEnv = new URL('../../../.env', import.meta.url);
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
const prisma = createPrismaClient(process.env.DATABASE_URL);
const secret = /** @type {string} */ (process.env.AUTH_SECRET);

test.afterAll(() => prisma.$disconnect());

/**
 * A fake camera: a short video (y4m, Chrome's fake-camera format) of a QR code on a grey
 * background, for --use-file-for-fake-video-capture.
 * @param {string} text @param {string} path
 */
function qrVideo(text, path) {
  const { data } = encode(text, { border: 4 });
  const W = 640;
  const H = 480;
  const cell = Math.floor(400 / data.length);
  const size = cell * data.length;
  const x0 = (W - size) / 2;
  const y0 = (H - size) / 2;
  const Y = Buffer.alloc(W * H, 200);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      Y[(y0 + y) * W + x0 + x] = data[Math.floor(y / cell)][Math.floor(x / cell)] ? 16 : 235;
    }
  }
  const UV = Buffer.alloc((W / 2) * (H / 2), 128);
  const frames = [];
  for (let i = 0; i < 10; i++) frames.push(Buffer.from('FRAME\n'), Y, UV, UV);
  writeFileSync(
    path,
    Buffer.concat([Buffer.from(`YUV4MPEG2 W${W} H${H} F10:1 Ip A1:1 C420jpeg\n`), ...frames]),
  );
}

/** @param {import('@playwright/test').APIRequestContext} request */
async function setUpTheDay(request) {
  const operator = await prisma.operator.findUniqueOrThrow({ where: { slug: slug() } });
  const staff = await prisma.user.findMany({
    where: { operatorId: operator.id },
    include: { role: true },
  });
  const femi = /** @type {any} */ (staff.find((u) => u.name === 'Femi Ogunleye'));
  const manager = /** @type {any} */ (staff.find((u) => u.role.key === 'manager'));
  const product = await prisma.product.findFirstOrThrow({
    where: { operatorId: operator.id, slug: 'lagos-island-heritage-walk' },
  });
  const walk = await prisma.departure.findFirstOrThrow({
    where: { productId: product.id, startsAt: { gt: new Date(Date.now() + 3 * 86_400_000) } },
    orderBy: { startsAt: 'asc' },
  });

  /** A guest books on the website and pays in full (the simulated checkout). */
  const bookPaid = async (/** @type {string} */ name, /** @type {any[]} */ travellers) => {
    const made = await request.post(`/public/${slug()}/bookings`, {
      data: {
        lead: {
          name,
          email: `${name.split(' ')[0].toLowerCase()}@guest.example`,
          phone: '0803 123 4567',
          acceptTerms: true,
        },
        departureId: walk.id,
        travellers,
        addOns: [],
      },
    });
    expect(made.status(), await made.text()).toBe(201);
    const { token } = await made.json();
    const pay = await request.post(`/public/bookings/${token}/pay`, { data: { option: 'full' } });
    const reference = (await pay.json()).payment.authorizationUrl.split('/').pop();
    await request.post(`/simulator/checkout/${reference}/pay`);
    // The simulator's webhook, processed by the worker; asking the provider settles it too.
    await expect
      .poll(
        async () => {
          await request.post(`/public/bookings/${token}/payments/${reference}/check`);
          const row = await prisma.booking.findFirst({
            where: { departureId: walk.id, leadName: name },
          });
          return row?.status ?? '';
        },
        { timeout: 30_000 },
      )
      .toBe('paid');
    const row = await prisma.booking.findFirstOrThrow({
      where: { departureId: walk.id, leadName: name },
      include: { travellers: { orderBy: { position: 'asc' } } },
    });
    return row;
  };

  const a = await bookPaid('Adaeze Okafor', [
    { name: 'Adaeze Okafor', age: 34 },
    { name: 'Chidi Okafor', age: 36 },
  ]);
  const b = await bookPaid('Emeka Nwosu', [
    { name: 'Emeka Nwosu', age: 40 },
    { name: 'Obi Nwosu', age: 38 },
    { name: 'Ada Nwosu', age: 12 },
  ]);
  const d = await bookPaid('Tola Bello', [{ name: 'Tola Bello', age: 30 }]);
  // As a WhatsApp booking would have it: Emeka's second guest has no name yet.
  await prisma.traveller.update({ where: { id: b.travellers[1].id }, data: { name: '' } });

  // The office books Funmi, who'll pay on the day (signed in as the manager).
  const managerToken = randomBytes(32).toString('base64url');
  await prisma.session.create({
    data: {
      userId: manager.id,
      tokenHash: createHash('sha256').update(managerToken).digest('hex'),
      expiresAt: new Date(Date.now() + 3_600_000),
    },
  });
  const auth = { Authorization: `Bearer ${managerToken}` };
  const owing = await request.post('/api/bookings', {
    headers: auth,
    data: {
      departureId: walk.id,
      lead: { name: 'Funmi Adeyemi', phone: '0805 987 6543', acceptTerms: true },
      travellers: [{ name: 'Funmi Adeyemi', age: 41 }],
    },
  });
  expect(owing.status(), await owing.text()).toBe(201);
  const cId = (await owing.json()).booking.id;
  await request.post(`/api/bookings/${cId}/confirm`, { headers: auth, data: {} });

  // Tour time: the walk started 10 minutes ago, Femi guiding.
  await prisma.departure.update({
    where: { id: walk.id },
    data: {
      startsAt: new Date(Date.now() - 10 * 60_000),
      endsAt: new Date(Date.now() + 3 * 3_600_000),
      guideId: femi.id,
    },
  });
  return { operator, femi, walk, a, b, cId, d };
}

test('a guide checks in a whole departure with no signal, then everything syncs', async ({
  request,
}) => {
  test.setTimeout(180_000);
  const day = await setUpTheDay(request);

  // The phone's camera sees Adaeze's ticket (its real QR code).
  const dir = mkdtempSync(join(tmpdir(), 'okg-journey6-'));
  const video = join(dir, 'ticket.y4m');
  qrVideo(ticketCode(secret, day.a.id), video);
  const browser = await chromium.launch({
    channel: process.env.CI ? undefined : 'chrome',
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-video-capture=${video}`,
    ],
  });
  const context = await browser.newContext({
    ...devices['Pixel 7'],
    baseURL: BASE,
    permissions: ['camera'],
  });
  const page = await context.newPage();
  const offline = async (/** @type {boolean} */ yes) => {
    await context.setOffline(yes);
    await page.evaluate((y) => window.dispatchEvent(new Event(y ? 'offline' : 'online')), yes);
  };

  try {
    // 1 · Femi signs in on the phone, with a code (O1).
    await page.goto('/app/');
    await page.getByLabel('Email or phone number').fill(day.femi.email);
    await page.getByRole('button', { name: 'Send me a code' }).click();
    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
    // The code went to Femi's email (the API's log, here). The test plays the inbox: a code
    // it knows, made as the server makes them, newest so it's the one that counts.
    await prisma.otpChallenge.create({
      data: {
        purpose: 'login',
        channel: 'email',
        destination: day.femi.email,
        codeHash: createHmac('sha256', secret).update('246810').digest('hex'),
        expiresAt: new Date(Date.now() + 10 * 60_000),
      },
    });
    await page.getByLabel('Digit 1 of 6').fill('246810'); // pasted: fills every box, signs in

    // 2 · First run: not installed (a test browser), saved for no signal.
    await page.getByRole('button', { name: 'Not now' }).click();
    await expect(page.getByRole('heading', { name: 'You’re ready for no signal' })).toBeVisible({
      timeout: 30_000,
    });
    // The app itself saved for offline too (the service worker), before the signal goes.
    await page.waitForFunction(async () => {
      const r = await navigator.serviceWorker.getRegistration('/app/');
      return r?.active?.state === 'activated' && (await caches.keys()).includes('okapigo-app');
    });
    await page.getByRole('button', { name: 'Go to Today' }).click();
    await expect(page.getByText('Lagos Island Heritage Walk')).toBeVisible();
    await expect(page.getByText('0 of 7 checked in')).toBeVisible();

    // 3 · The signal goes. Everything from here works on the phone alone.
    await offline(true);
    await expect(page.getByText(/^Offline · saved \d\d:\d\d$/)).toBeVisible();
    await page.getByText('Lagos Island Heritage Walk').click();
    await expect(page.getByRole('heading', { name: 'Lagos Island Heritage Walk' })).toBeVisible();

    // A · Scan Adaeze's ticket: matched on the phone, both checked in.
    await page.getByRole('link', { name: 'Scan a ticket' }).click();
    await expect(page.locator('.result-title')).toHaveText('Ticket OK', { timeout: 30_000 });
    await page.getByRole('button', { name: 'Check in 2' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: '2 checked in · Okafor' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Close scanner' }).click();

    // B · Emeka's party: Guest 2 named at check-in, the others tapped in.
    await page.getByRole('button', { name: 'Add a name (optional)' }).click();
    await page.getByLabel('Name', { exact: true }).fill('Obinna Nwosu');
    await page.getByRole('button', { name: 'Save and mark present' }).click();
    await page.getByRole('button', { name: 'Emeka Nwosu: Not yet. Tap to change.' }).click();
    await page.getByRole('button', { name: 'Ada Nwosu: Not yet. Tap to change.' }).click();

    // C · Funmi still owes, and pays the guide in cash.
    await page.getByRole('button', { name: 'Funmi Adeyemi: Not yet. Tap to change.' }).click();
    await page.getByRole('button', { name: 'They paid me cash' }).click();
    await page.getByRole('button', { name: /^Record ₦[\d,]+ and check in$/ }).click();
    await expect(page.getByText(/^Cash ₦[\d,]+ reported · office to confirm$/)).toBeVisible();

    // D · Tola doesn't come: the whole booking a no-show, with the policy said first.
    await page
      .locator('section.booking', { hasText: 'Tola Bello' })
      .getByRole('button', { name: 'Mark the rest of this booking no-show' })
      .click();
    await expect(
      page.getByRole('heading', { name: 'Mark Tola Bello’s booking no-show?' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Mark no-show' }).click();

    await expect(page.locator('.count-line')).toHaveText(/6\s*of 7 checked in/);
    await expect(page.getByText(/^Offline · saved \d\d:\d\d · 8 changes waiting$/)).toBeVisible();
    expect(await page.getByText(/^Not sent yet · \d\d:\d\d$/).count()).toBeGreaterThanOrEqual(6);

    // 4 · The phone is put away and the app opened again, still with no network at all.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Lagos Island Heritage Walk' })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Obinna Nwosu: ✓ Present. Tap to change.' }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Sync' }).click();
    await expect(
      page.getByText(/8 changes waiting\. They send by themselves when there’s signal\./),
    ).toBeVisible();
    await expect(page.getByText('Guest 2 → Obinna Nwosu')).toBeVisible();

    // Nothing reached the server while offline.
    expect(await prisma.syncChange.count({ where: { userId: day.femi.id } })).toBe(0);

    // 5 · Signal back: the outbox sends itself, oldest first.
    await offline(false);
    await expect(page.getByRole('heading', { name: 'Everything is sent' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText(/^Online · up to date \d\d:\d\d$/)).toBeVisible();
  } finally {
    await browser.close();
  }

  // 6 · On the server: every change, once, at the time it was made.
  const changes = await prisma.syncChange.findMany({
    where: { userId: day.femi.id },
    orderBy: { happenedAt: 'asc' },
  });
  expect(changes.map((c) => c.outcome)).toEqual(Array(8).fill('applied'));
  expect(changes.every((c) => c.happenedAt < c.receivedAt)).toBe(true);
  const status = async (/** @type {string} */ bookingId) =>
    (await prisma.traveller.findMany({ where: { bookingId }, orderBy: { position: 'asc' } })).map(
      (t) => [t.name, t.checkInStatus, t.checkedInById === day.femi.id],
    );
  expect(await status(day.a.id)).toEqual([
    ['Adaeze Okafor', 'present', true],
    ['Chidi Okafor', 'present', true],
  ]);
  expect(await status(day.b.id)).toEqual([
    ['Emeka Nwosu', 'present', true],
    ['Obinna Nwosu', 'present', true],
    ['Ada Nwosu', 'present', true],
  ]);
  expect(await status(day.cId)).toEqual([['Funmi Adeyemi', 'present', true]]);
  expect(await status(day.d.id)).toEqual([['Tola Bello', 'no_show', true]]);
  // The no-show is the whole booking's, with the policy; the cash is reported, not paid.
  expect((await prisma.booking.findUniqueOrThrow({ where: { id: day.d.id } })).status).toBe(
    'no_show',
  );
  const funmi = await prisma.booking.findUniqueOrThrow({ where: { id: day.cId } });
  expect(funmi.amountPaidKobo).toBe(0);
  expect(await prisma.cashReport.findMany({ where: { bookingId: day.cId } })).toEqual([
    expect.objectContaining({
      status: 'reported',
      amountKobo: funmi.totalKobo,
      reportedById: day.femi.id,
    }),
  ]);
});
