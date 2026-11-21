/**
 * Stage 14b: the guest messages as emails, in your layout (design file 02), against a fake
 * mailer, plus the two real mailers' requests (Mailpit, Resend) against a fake network.
 *   - the card: the coloured line, the headline, the template's words, the reference box,
 *     the details table, the button, the notes, the footer; a plain-text copy too
 *   - from the business, replies to the business; sent once; a refusal recorded with why
 *   - everything a guest or staff typed is escaped
 */
import { describe, it, expect, afterAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import { bookingIdFromGuestToken, IRIN_SITE } from '@okapigo/db';
import { addDays, localDate } from '@okapigo/shared/time';
import { createTestContext, TEST_AUTH_SECRET } from './helpers.js';
import { sendGuestMessages } from '../src/messages/send.js';
import { createChannels } from '../src/whatsapp/channels.js';
import { MailError, mailpitMailer, resendMailer, createMailer } from '../src/messages/mailers.js';
import { loadConfig } from '../src/config.js';

const ctx = createTestContext();
afterEach(() => ctx.cleanup());
afterAll(() => ctx.close());
// Senders only look at THIS test's business: other test files run at the same time on the
// same database, and their messages are theirs to send.
/** @type {string | undefined} */
let scope;
afterEach(() => {
  scope = undefined;
});
const seedOperator = async () => {
  const seeded = await ctx.seedOperator();
  scope ??= seeded.operator.id;
  return seeded;
};
vi.setConfig({ testTimeout: 60_000, hookTimeout: 30_000 });

const today = () => localDate(new Date(), 'Africa/Lagos');

/** A mailer that keeps what it's given (or refuses, as told). */
function fakeMailer() {
  /** @type {any[]} */
  const sent = [];
  /** @type {Error | null} */
  let refuse = null;
  return {
    sent,
    refuse: (/** @type {Error} */ e) => (refuse = e),
    mailer: {
      name: 'fake',
      async send(/** @type {any} */ e) {
        if (refuse) throw refuse;
        sent.push(e);
        return { id: `mail-${sent.length}` };
      },
    },
  };
}

const send = (/** @type {any} */ mailer) =>
  sendGuestMessages({
    operatorId: scope,
    prisma: ctx.prisma,
    authSecret: TEST_AUTH_SECRET,
    webPublicUrl: 'http://localhost:4000',
    channels: createChannels(),
    mailer,
    emailFrom: 'bookings@okapigo.example',
  });

/** A booking, paid (in full or a deposit), the guest's way. */
async function paidBooking(
  /** @type {string} */ slug,
  {
    tour = 'lagos-island-heritage-walk',
    daysAhead = 6,
    option = 'full',
    lead,
  } = /** @type {any} */ ({}),
) {
  const deps = (
    await request(ctx.app).get(
      `/public/${slug}/tours/${tour}/departures?to=${addDays(today(), 40)}`,
    )
  ).body.departures;
  const departure = deps.find((/** @type {any} */ d) => d.localDate >= addDays(today(), daysAhead));
  const res = await request(ctx.app)
    .post(`/public/${slug}/bookings`)
    .send({
      lead: lead ?? { name: 'Adaeze Okafor', email: 'adaeze@guest.example', acceptTerms: true },
      departureId: departure.id,
      travellers: [{ name: lead?.name ?? 'Adaeze Okafor', age: 34 }],
      addOns: [],
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const { token } = res.body;
  const payRes = await request(ctx.app).post(`/public/bookings/${token}/pay`).send({ option });
  const { reference } = payRes.body.payment;
  await ctx.provider.complete(reference);
  await request(ctx.app).post(`/public/bookings/${token}/payments/${reference}/check`);
  const bookingId = /** @type {string} */ (bookingIdFromGuestToken(TEST_AUTH_SECRET, token));
  return { token, bookingId };
}

describe('the confirmation email (your layout)', () => {
  it('from the business, to the guest, replies to the business; the card, the words, a text copy', async () => {
    const { operator } = await seedOperator();
    const { token, bookingId } = await paidBooking(operator.slug);
    const fake = fakeMailer();
    expect(await send(fake.mailer)).toMatchObject({ sent: 1, failed: 0 });
    expect(await send(fake.mailer)).toMatchObject({ sent: 0 }); // once

    const [e] = fake.sent;
    const booking = await ctx.prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(e.from).toEqual({ name: 'Ìrìn Lagos Tours', email: 'bookings@okapigo.example' });
    expect(e.to).toEqual({ name: 'Adaeze Okafor', email: 'adaeze@guest.example' });
    expect(e.replyTo).toBe(IRIN_SITE.email);
    expect(e.subject).toMatch(
      new RegExp(
        `^Booking confirmed: Heritage Walk, \\w{3} \\d+ \\w{3} \\(${booking.reference}\\)$`,
      ),
    );

    const trip = `http://localhost:4000/trip/${token}`;
    for (const part of [
      '>Booking confirmed</div>',
      /See you on \w{3} \d+ \w{3}, Adaeze!<\/h1>/,
      'Hi Adaeze, your booking is confirmed!', // the template's words
      `>${booking.reference}</div>`,
      '>₦25,000 paid</div>',
      /includes ₦[\d,]+ VAT/,
      '<strong>Lagos Island Heritage Walk</strong>',
      /, 09:00 · 3 hours<\/strong>/,
      '<strong>Tinubu Square</strong>',
      `href="${trip}"`,
      '>Open your trip page</a>',
      /Free cancellation until \w{3} \d+ \w{3}, 09:00\./,
      'Bookings by OkapiGo',
    ]) {
      if (typeof part === 'string') expect(e.html).toContain(part);
      else expect(e.html).toMatch(part);
    }
    // The button carries the trip link: the words don't repeat it (nor its "…map:" line).
    expect(e.html.split(trip)).toHaveLength(2);
    expect(e.html).not.toContain('Your ticket and map:');
    expect(e.text).toContain('Hi Adaeze, your booking is confirmed!');
    expect(e.text).toContain(`Booking reference: ${booking.reference}`);
    expect(e.text).toContain(trip);

    const row = await ctx.prisma.notification.findFirstOrThrow({
      where: { bookingId, channel: 'email' },
    });
    expect(row).toMatchObject({ status: 'sent', data: { emailId: 'mail-1' } });
  });

  it('a deposit: what was paid, what’s left and by when, and a Pay button to the balance page', async () => {
    const { operator } = await seedOperator();
    const { token } = await paidBooking(operator.slug, {
      tour: 'badagry-heritage-day-trip',
      daysAhead: 15,
      option: 'deposit',
    });
    const fake = fakeMailer();
    await send(fake.mailer);
    const [e] = fake.sent;
    expect(e.subject).toMatch(/^Deposit received: balance due \w{3} \d+ \w{3}$/);
    expect(e.html).toContain('>₦19,500 paid</div>');
    expect(e.html).toMatch(/₦45,500 still to pay by \w{3} \d+ \w{3}/);
    // The BUTTON goes to the balance page (not just a link somewhere in the words).
    expect(e.html).toMatch(
      new RegExp(
        `<a href="http://localhost:4000/trip/${token}/pay" style="display:block[^>]*>Pay ₦45,500</a>`,
      ),
    );
  });

  it('a cancellation: the red line, the refund in the box, no button', async () => {
    const { operator } = await seedOperator();
    const { token } = await paidBooking(operator.slug);
    const fake = fakeMailer();
    await send(fake.mailer);
    await request(ctx.app)
      .post(`/public/bookings/${token}/cancel`)
      .send({ expectRefundKobo: 2_500_000 });
    await send(fake.mailer);
    const e = fake.sent.at(-1);
    expect(e.subject).toMatch(/^Your booking [A-Z]+-[A-Z0-9]+ is cancelled$/);
    expect(e.html).toContain('>Booking cancelled</div>');
    expect(e.html).toContain('>₦25,000 refund</div>');
    expect(e.html).toContain('Refund: ₦25,000 (100%, cancelled');
    expect(e.html).not.toContain('Open your trip page');
  });
});

describe('a travel website’s guest (17c-3)', () => {
  it('the trip page link: from the business, by email only; the confirmation is the website’s', async () => {
    const { operator } = await seedOperator();
    const tarkwa = await ctx.prisma.product.findFirstOrThrow({
      where: { operatorId: operator.id, slug: 'tarkwa-bay-beach-and-lagoon' },
    });
    const d = await ctx.prisma.departure.findFirstOrThrow({
      where: { productId: tarkwa.id, startsAt: { gt: new Date(Date.now() + 4 * 86_400_000) } },
      orderBy: { startsAt: 'asc' },
    });
    const octo = (/** @type {string} */ path) =>
      request(ctx.app).post(path).set('Authorization', `Bearer octo_dev_${operator.slug}`);
    await octo('/octo/bookings').send({
      uuid: 'mail-1',
      productId: tarkwa.id,
      optionId: 'DEFAULT',
      availabilityId: d.id,
      unitItems: [{ unitId: 'adult' }],
    });
    const c = await octo('/octo/bookings/mail-1/confirm').send({
      contact: {
        fullName: 'Hannah Weber',
        emailAddress: 'hannah@guest.example',
        phoneNumber: '+4915123456789',
      },
    });
    expect(c.status, JSON.stringify(c.body)).toBe(200);
    const fake = fakeMailer();
    expect(await send(fake.mailer)).toMatchObject({ sent: 1, failed: 0 });
    const e = fake.sent[0];
    expect(e.to).toEqual({ name: 'Hannah Weber', email: 'hannah@guest.example' });
    expect(e.subject).toMatch(
      /^Your trip page: Tarkwa Bay Beach Day, \w{3} \d{1,2} \w{3} \([A-Z]+-[A-Z0-9]+\)$/,
    );
    expect(e.html).toContain('>Your trip page</div>');
    expect(e.html).toContain('Open your trip page');
    expect(e.text).toContain(
      'You booked through Sojourna: changes and cancellations go through them.',
    );
    // No WhatsApp, though the guest gave a phone: the trip link goes by email only.
    const rows = await ctx.prisma.notification.findMany({
      where: { booking: { channelBooking: { uuid: 'mail-1' } }, audience: 'guest' },
    });
    expect(rows.map((n) => [n.kind, n.channel])).toEqual([['trip_link', 'email']]);
  });
});

describe('what can go wrong', () => {
  it('what guests and staff type is text, never HTML', async () => {
    const { operator, owner } = await seedOperator();
    const staff = await ctx.tokenFor(owner.id);
    await request(ctx.app)
      .put('/api/message-templates/booking_confirmed')
      .set('Authorization', `Bearer ${staff}`)
      .send({
        subject: 'Hi',
        body: '<script>alert(1)</script> {first_name} {reference} {trip_url}',
      });
    await paidBooking(operator.slug, {
      lead: { name: '<b>Ada</b> & Co', email: 'ada@guest.example', acceptTerms: true },
    });
    const fake = fakeMailer();
    await send(fake.mailer);
    const [e] = fake.sent;
    expect(e.html).not.toContain('<script>');
    expect(e.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(e.html).not.toContain('<b>Ada</b>');
    expect(e.html).toContain('&lt;b&gt;Ada&lt;/b&gt; &amp; Co');
  });

  it('the mailer refuses: failed, in its own words; our own bug says ERROR', async () => {
    const { operator } = await seedOperator();
    const { bookingId } = await paidBooking(operator.slug);
    const fake = fakeMailer();
    fake.refuse(
      new MailError('RESEND_403: You can only send testing emails to your own email address'),
    );
    expect(await send(fake.mailer)).toMatchObject({ failed: 1 });
    const row = await ctx.prisma.notification.findFirstOrThrow({
      where: { bookingId, channel: 'email' },
    });
    expect(row).toMatchObject({ status: 'failed', sentAt: null });
    expect(/** @type {any} */ (row.data).error).toBe(
      'RESEND_403: You can only send testing emails to your own email address',
    );

    const other = await paidBooking(operator.slug, {
      lead: { name: 'Tunde Bakare', email: 'tunde@guest.example', acceptTerms: true },
    });
    fake.refuse(new TypeError('x is undefined'));
    await send(fake.mailer);
    const bug = await ctx.prisma.notification.findFirstOrThrow({
      where: { bookingId: other.bookingId, channel: 'email' },
    });
    expect(/** @type {any} */ (bug.data).error).toBe('ERROR: x is undefined');
  });
});

describe('the mailers', () => {
  const email = {
    from: { name: 'Ìrìn "Lagos" Tours', email: 'bookings@okapigo.example' },
    to: { name: 'Adaeze', email: 'adaeze@guest.example' },
    replyTo: 'hello@irin.example',
    subject: 'Booking confirmed',
    html: '<p>Hi</p>',
    text: 'Hi',
  };
  /** @param {number} status @param {any} json */
  const network = (status, json) => {
    /** @type {any[]} */
    const calls = [];
    const fetch = async (/** @type {string} */ url, /** @type {any} */ init) => {
      calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
      return { ok: status < 400, status, json: async () => json };
    };
    return { calls, fetch: /** @type {any} */ (fetch) };
  };

  it('Mailpit: its own send API, into the local mailbox', async () => {
    const n = network(200, { ID: 'abc123' });
    const m = mailpitMailer({ url: 'http://localhost:8025/', fetch: n.fetch });
    expect(await m.send(email)).toEqual({ id: 'abc123' });
    expect(n.calls[0]).toMatchObject({
      url: 'http://localhost:8025/api/v1/send',
      body: {
        From: { Email: 'bookings@okapigo.example', Name: 'Ìrìn "Lagos" Tours' },
        To: [{ Email: 'adaeze@guest.example', Name: 'Adaeze' }],
        ReplyTo: [{ Email: 'hello@irin.example' }],
        Subject: 'Booking confirmed',
        HTML: '<p>Hi</p>',
        Text: 'Hi',
      },
    });
    const down = mailpitMailer({
      url: 'http://localhost:8025',
      fetch: /** @type {any} */ (async () => Promise.reject(new TypeError('fetch failed'))),
    });
    await expect(down.send(email)).rejects.toThrow(/^MAILPIT_DOWN/);
  });

  it('Resend: the API key as a bearer token; the sender name can’t break the address', async () => {
    const n = network(200, { id: 're-1' });
    const m = resendMailer({ apiKey: 're_test_key', fetch: n.fetch });
    expect(await m.send(email)).toEqual({ id: 're-1' });
    expect(n.calls[0].url).toBe('https://api.resend.com/emails');
    expect(n.calls[0].headers.authorization).toBe('Bearer re_test_key');
    expect(n.calls[0].body).toEqual({
      from: '"Ìrìn Lagos Tours" <bookings@okapigo.example>',
      to: ['adaeze@guest.example'],
      reply_to: 'hello@irin.example',
      subject: 'Booking confirmed',
      html: '<p>Hi</p>',
      text: 'Hi',
    });
    const refused = resendMailer({
      apiKey: 're_test_key',
      fetch: network(403, { statusCode: 403, message: 'Not allowed' }).fetch,
    });
    await expect(refused.send(email)).rejects.toThrow('RESEND_403: Not allowed');
  });

  it('the settings choose one: none by default; Resend needs its key', () => {
    const base = {
      DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
      REDIS_URL: 'redis://localhost:6379',
      AUTH_SECRET: 'x'.repeat(32),
    };
    expect(createMailer(loadConfig(base))).toBeNull();
    expect(createMailer(loadConfig({ ...base, EMAIL_PROVIDER: 'mailpit' }))?.name).toBe('mailpit');
    expect(() => loadConfig({ ...base, EMAIL_PROVIDER: 'resend' })).toThrow(/needs RESEND_API_KEY/);
    expect(() => loadConfig({ ...base, EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 'sk_x' })).toThrow(
      /must be a Resend API key/,
    );
    expect(
      createMailer(loadConfig({ ...base, EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_abc123' }))
        ?.name,
    ).toBe('resend');
  });
});

describe('the cancellation note', () => {
  it('only deadlines still ahead; none left: no note', async () => {
    const { policyNote } = await import('../src/messages/email.js');
    const version = {
      rules: [
        { hoursBefore: 48, refundBasisPoints: 10_000 },
        { hoursBefore: 24, refundBasisPoints: 5_000 },
        { hoursBefore: 0, refundBasisPoints: 0 },
      ],
    };
    const start = new Date('2026-12-05T08:00:00Z'); // 09:00 in Lagos
    expect(policyNote(version, start, 'Africa/Lagos', new Date('2026-11-20T08:00:00Z'))).toBe(
      'Free cancellation until Thu 3 Dec, 09:00. After that, 50% back until Fri 4 Dec, 09:00.',
    );
    expect(policyNote(version, start, 'Africa/Lagos', new Date('2026-12-03T20:00:00Z'))).toBe(
      '50% back until Fri 4 Dec, 09:00.',
    );
    expect(policyNote(version, start, 'Africa/Lagos', new Date('2026-12-05T07:00:00Z'))).toBeNull();
  });
});
