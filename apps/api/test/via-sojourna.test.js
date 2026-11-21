/**
 * Session 17c-3: "via Sojourna" everywhere else (designs: "via Sojourna — everywhere else").
 *   - the bookings desk: a tag on OTA bookings, "Paid by Sojourna", a channel filter
 *   - an OTA booking's page: its header (with Sojourna's reference), the money (what the guest
 *     paid Sojourna, its share, what it still owes), the messages (the confirmation is
 *     Sojourna's; the trip page link is ours), the actions (no payment link, no changing who or
 *     when), and cancelling (everything back, from Sojourna; settled, never "Refund to send")
 *   - a departure: counts by channel, and a channel per booking; the guide's manifest
 *   - the guest's trip page: changes and cancellations go through Sojourna
 */
import { describe, it, expect, afterAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import { guestToken, secureBookingInTx, toldLine } from '@okapigo/db';
import { createTestContext, TEST_AUTH_SECRET } from './helpers.js';

const ctx = createTestContext();
afterEach(() => ctx.cleanup());
afterAll(() => ctx.close());
vi.setConfig({ testTimeout: 60_000, hookTimeout: 30_000 });

/** @param {string} token */
const as = (token) => {
  /** @param {'get' | 'post'} m @param {string} url */
  const call = (m, url) => request(ctx.app)[m](url).set('Authorization', `Bearer ${token}`);
  return {
    get: (/** @type {string} */ u) => call('get', u),
    post: (/** @type {string} */ u) => call('post', u),
  };
};

async function setup() {
  const s = await ctx.seedOperator();
  const owner = as(await ctx.tokenFor(s.owner.id));
  const guide = as(await ctx.tokenFor(s.guides[0].id));
  const sojourna = await ctx.prisma.channel.findFirstOrThrow({
    where: { operatorId: s.operator.id },
  });
  const key = `octo_dev_${s.operator.slug}`;
  /** @param {'get' | 'post'} m @param {string} url */
  const octo = (m, url) => request(ctx.app)[m](url).set('Authorization', `Bearer ${key}`);
  const tarkwa = await ctx.prisma.product.findFirstOrThrow({
    where: { operatorId: s.operator.id, slug: 'tarkwa-bay-beach-and-lagoon' },
  });
  const departure = await ctx.prisma.departure.findFirstOrThrow({
    where: { productId: tarkwa.id, startsAt: { gt: new Date(Date.now() + 4 * 86_400_000) } },
    orderBy: { startsAt: 'asc' },
  });
  /** Sojourna sells two adults and a child, with its own reference. @param {string} uuid */
  const sale = async (uuid) => {
    const r = await octo('post', '/octo/bookings').send({
      uuid,
      productId: tarkwa.id,
      optionId: 'DEFAULT',
      availabilityId: departure.id,
      unitItems: [{ unitId: 'adult' }, { unitId: 'adult' }, { unitId: 'child' }],
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const c = await octo('post', `/octo/bookings/${uuid}/confirm`).send({
      resellerReference: `SJ-${uuid}`,
      contact: { fullName: 'Hannah Weber', emailAddress: 'hannah@guest.example' },
    });
    expect(c.status, JSON.stringify(c.body)).toBe(200);
    return ctx.prisma.booking.findFirstOrThrow({ where: { channelBooking: { uuid } } });
  };
  /** A website booking on the same departure (two adults), paid. */
  const websiteBooking = async () => {
    const { booking } = (
      await owner.post('/api/bookings').send({
        departureId: departure.id,
        lead: { name: 'Bisi Lawal', email: 'bisi@guest.example', acceptTerms: true },
        travellers: [
          { name: 'Bisi Lawal', age: 34 },
          { name: 'Tayo Lawal', age: 36 },
        ],
      })
    ).body;
    const row = await ctx.prisma.booking.update({
      where: { id: booking.id },
      data: { channel: 'web' },
    });
    await ctx.prisma.$transaction((tx) =>
      secureBookingInTx(tx, { booking: row, to: 'paid', actor: { type: 'system' } }),
    );
    return ctx.prisma.booking.update({
      where: { id: booking.id },
      data: { amountPaidKobo: row.totalKobo },
    });
  };
  const page = async (/** @type {string} */ id) =>
    (await owner.get(`/api/desk/bookings/${id}`)).body.booking;
  return { ...s, owner, guide, sojourna, octo, tarkwa, departure, sale, websiteBooking, page };
}

describe('the bookings desk', () => {
  it('a tag and "Paid by Sojourna" on OTA bookings only; the channel filter', async () => {
    const s = await setup();
    const sold = await s.sale('48213');
    await s.websiteBooking();
    const all = (await s.owner.get('/api/desk/bookings?filter=all')).body.list;
    const row = all.rows.find((/** @type {any} */ r) => r.id === sold.id);
    expect(row).toMatchObject({
      via: 'via Sojourna',
      chip: { key: 'paid', text: 'Paid by Sojourna', tone: 'ok' },
    });
    // Website and WhatsApp bookings show no tag, so the OTA ones stand out.
    expect(
      all.rows.filter((/** @type {any} */ r) => r.via).map((/** @type {any} */ r) => r.id),
    ).toEqual([sold.id]);
    expect(all.channel).toBe('');
    expect(all.channels).toEqual([
      { value: 'web', label: 'Website' },
      { value: 'whatsapp', label: 'WhatsApp' },
      { value: s.sojourna.id, label: 'Sojourna' },
      { value: 'staff', label: 'Staff' },
    ]);
    const only = (await s.owner.get(`/api/desk/bookings?filter=all&channel=${s.sojourna.id}`)).body
      .list;
    expect(only.rows.map((/** @type {any} */ r) => r.id)).toEqual([sold.id]);
    expect(only.channel).toBe(s.sojourna.id);
    const web = (await s.owner.get('/api/desk/bookings?filter=all&channel=web')).body.list;
    expect(web.rows.length).toBeGreaterThan(0);
    expect(web.rows.some((/** @type {any} */ r) => r.id === sold.id)).toBe(false);
    const whatsapp = (await s.owner.get('/api/desk/bookings?filter=all&channel=whatsapp')).body
      .list;
    expect(whatsapp.rows.every((/** @type {any} */ r) => r.id !== sold.id)).toBe(true);
    expect((await s.owner.get('/api/desk/bookings?channel=telegram')).status).toBe(400);
  });
});

describe('an OTA booking’s page', () => {
  it('the header, the money, the messages and the actions, as designed', async () => {
    const s = await setup();
    const sold = await s.sale('48214');
    const b = await s.page(sold.id);
    expect(b.refLine).toMatch(
      new RegExp(
        `^${sold.reference} · VIA SOJOURNA \\(SJ-48214\\) · BOOKED [A-Z]{3} \\d{1,2} [A-Z]{3}$`,
      ),
    );
    expect(b.chip).toMatchObject({ text: 'Paid by Sojourna', tone: 'ok' });
    expect(b.money).toEqual([
      { label: 'Price · guest paid Sojourna', value: '₦102,000', tone: 'ink' },
      { label: 'Sojourna’s 20%', value: '− ₦20,400', tone: 'muted' },
      {
        label: `Sojourna owes ${s.operator.name}`,
        value: '₦81,600',
        tone: 'warning',
        total: true,
      },
    ]);
    expect(b.messages).toEqual([
      expect.objectContaining({
        id: 'ota-confirmation',
        what: 'Booking confirmation',
        text: 'Not sent: Sojourna sends its own',
        tone: 'muted',
      }),
      expect.objectContaining({ what: 'Trip page link', text: 'Email · waiting to send' }),
    ]);
    expect(b.actions.paymentLink).toEqual({ enabled: false, why: 'Sojourna collects payment' });
    expect(b.actions.changeTravellers).toMatchObject({ enabled: false, hidden: true });
    expect(b.actions.move).toMatchObject({ enabled: false, hidden: true });
    expect(b.actions.addNote.enabled).toBe(true);
    expect(b.actions.cancel.enabled).toBe(true);
    expect(b.cancel).toMatchObject({
      initiatedBy: 'operator',
      fixed: true,
      policyKobo: 10_200_000,
      policyText:
        '₦102,000 back to Hannah, from Sojourna (you’re calling it off, so everything goes back)',
      doneNote: 'Cancelled. Sojourna refunds Hannah ₦102,000 and is told through OCTO.',
    });
    expect(b.actNote).toBe(
      'Cancelling here (e.g. weather) tells Sojourna through OCTO; Sojourna refunds Hannah and owes ' +
        `${s.operator.name} ₦0 for it. Changing travellers on an OTA booking goes through Sojourna, so it’s not offered here.`,
    );
    // A website booking keeps its own words and buttons.
    const web = await s.page((await s.websiteBooking()).id);
    expect(web.actions.changeTravellers.hidden).toBeUndefined();
    expect(web.cancel?.fixed ?? false).toBe(false);
    expect(web.messages.some((/** @type {any} */ m) => m.id === 'ota-confirmation')).toBe(false);
  });

  it('cancelled by the office: everything back from Sojourna, settled at once; no "Refund to send"', async () => {
    const s = await setup();
    const sold = await s.sale('48215');
    // Sojourna had already paid for it.
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(new Date());
    await s.owner
      .post(`/api/channels/${s.sojourna.id}/payments`)
      .send({ amountKobo: 8_160_000, receivedOn: today });
    expect((await s.page(sold.id)).actNote).toMatch(
      /Sojourna refunds Hannah and .* owes Sojourna back the ₦81,600 it already paid for it\./,
    );
    const res = await s.owner.post(`/api/bookings/${sold.id}/cancel`).send({
      initiatedBy: 'operator',
      reason: 'Bad weather at sea',
      startRefund: true,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.refund).toMatchObject({ refundKobo: 10_200_000, settledWithOta: true });
    expect(res.body.refundStart).toBeNull(); // nothing for Paystack to do
    const refunds = await ctx.prisma.refund.findMany({ where: { bookingId: sold.id } });
    expect(refunds).toEqual([
      expect.objectContaining({
        provider: 'ota',
        status: 'processed',
        amountKobo: 10_200_000,
        reason: 'Refunded to the guest by Sojourna',
      }),
    ]);
    const b = await s.page(sold.id);
    expect(b.chip.key).not.toMatch(/refund_due|refund_failed/);
    expect(b.money).toEqual([
      { label: 'Price · guest paid Sojourna', value: '₦102,000', tone: 'ink' },
      {
        label: expect.stringMatching(/^Refunded to the guest by Sojourna · /),
        value: '− ₦102,000',
        tone: 'ink',
      },
      { label: 'Sojourna’s 20%', value: '− ₦0', tone: 'muted' },
      {
        label: expect.stringMatching(/^Sojourna paid it · /),
        value: '− ₦81,600',
        tone: 'ok',
      },
      { label: `${s.operator.name} owes Sojourna`, value: '₦81,600', tone: 'ink', total: true },
    ]);
    // Sojourna is told (its BOOKING_UPDATE); the guest isn't told by us.
    const kinds = (
      await ctx.prisma.notification.findMany({ where: { bookingId: sold.id, audience: 'guest' } })
    ).map((n) => n.kind);
    expect(kinds).toEqual(['trip_link']);
  });

  it('a website booking cancelled by the office: still refunded by card, as before', async () => {
    const s = await setup();
    const web = await s.websiteBooking();
    const res = await s.owner.post(`/api/bookings/${web.id}/cancel`).send({
      initiatedBy: 'operator',
      reason: 'Bad weather at sea',
      startRefund: true,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.refund.settledWithOta).toBe(false);
    expect(
      (await ctx.prisma.refund.findMany({ where: { bookingId: web.id } })).every(
        (r) => r.provider !== 'ota',
      ),
    ).toBe(true);
  });

  it('a no-show under a policy that gives some back: settled with Sojourna too', async () => {
    const s = await setup();
    const sold = await s.sale('48219');
    // A version of the policy that gives half back for a no-show (versions are never edited).
    const was = await ctx.prisma.cancellationPolicyVersion.findUniqueOrThrow({
      where: { id: /** @type {string} */ (sold.policyVersionId) },
    });
    const half = await ctx.prisma.cancellationPolicyVersion.create({
      data: {
        policyId: was.policyId,
        version: was.version + 1,
        rules: /** @type {any} */ (was.rules),
        noShowRefundBasisPoints: 5000,
        depositRefundable: was.depositRefundable,
      },
    });
    await ctx.prisma.booking.update({ where: { id: sold.id }, data: { policyVersionId: half.id } });
    await ctx.prisma.departure.update({
      where: { id: s.departure.id },
      data: { startsAt: new Date(Date.now() - 3_600_000 + 999) },
    });
    const res = await s.owner.post(`/api/bookings/${sold.id}/no-show`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await ctx.prisma.refund.findMany({ where: { bookingId: sold.id } })).toEqual([
      expect.objectContaining({ provider: 'ota', status: 'processed', amountKobo: 5_100_000 }),
    ]);
    expect((await s.page(sold.id)).chip.key).not.toMatch(/refund_due|refund_failed/);
  });

  it('a departure called off: its OTA bookings settled with the OTA, not counted as refunds to start', async () => {
    const s = await setup();
    const sold = await s.sale('48216');
    const res = await s.owner
      .post(`/api/departures/${s.departure.id}/cancel`)
      .send({ reason: 'Bad weather at sea' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.refundsFailed ?? 0).toBe(0);
    const refunds = await ctx.prisma.refund.findMany({ where: { bookingId: sold.id } });
    expect(refunds).toEqual([
      expect.objectContaining({ provider: 'ota', status: 'processed', amountKobo: 10_200_000 }),
    ]);
  });
});

describe('the departure, the manifest and the trip page', () => {
  it('counts by channel, a channel per booking, and the guide’s "via Sojourna"', async () => {
    const s = await setup();
    const web = await s.websiteBooking();
    const sold = await s.sale('48217');
    const d = (await s.owner.get(`/api/departures/${s.departure.id}/overview`)).body.departure;
    // Designs: "8 website · 3 via Sojourna · 1 seat left everywhere" (seats are one stock).
    expect(d.channelsLine).toBe(
      `2 website · 3 via Sojourna · ${d.numbers.left} seats left everywhere`,
    );
    expect(d.rows.find((/** @type {any} */ r) => r.id === web.id).channel).toBe('Website');
    expect(d.cancel.toldLine).toBe('Guests told by WhatsApp and email; Sojourna tells its guests');
    // Full: "sold out everywhere".
    await ctx.prisma.departure.update({
      where: { id: s.departure.id },
      data: { seatsHeld: d.numbers.left },
    });
    const full = (await s.owner.get(`/api/departures/${s.departure.id}/overview`)).body.departure;
    expect(full.channelsLine).toBe('2 website · 3 via Sojourna · sold out everywhere');
    await ctx.prisma.departure.update({ where: { id: s.departure.id }, data: { seatsHeld: 0 } });
    const row = d.rows.find((/** @type {any} */ r) => r.id === sold.id);
    expect(row).toMatchObject({
      channel: 'Sojourna',
      via: 'via Sojourna',
      pay: 'Paid by Sojourna',
    });
    // A departure with no OTA bookings: no line.
    const other = await ctx.prisma.departure.findFirstOrThrow({
      where: { productId: s.tarkwa.id, id: { not: s.departure.id } },
    });
    expect(
      (await s.owner.get(`/api/departures/${other.id}/overview`)).body.departure.channelsLine,
    ).toBeNull();

    await ctx.prisma.departure.update({
      where: { id: s.departure.id },
      data: { guideId: s.guides[0].id },
    });
    const m = (await s.guide.get(`/api/departures/${s.departure.id}/manifest`)).body.manifest;
    const mb = m.bookings.find((/** @type {any} */ x) => x.id === sold.id);
    expect(mb).toMatchObject({ otaName: 'Sojourna', money: { label: 'Paid' } });
    // The lead is the first traveller; the others are "Guest 2 of …" (OCTO names only the lead).
    expect(mb.travellers.map((/** @type {any} */ t) => t.displayName)).toEqual([
      'Hannah Weber',
      'Guest 2 of Hannah Weber’s booking',
      'Guest 3 of Hannah Weber’s booking',
    ]);
  });

  it('who tells the guests when a departure is called off, in words', () => {
    const ours = { channelBooking: null };
    const ota = (/** @type {string} */ name) => ({ channelBooking: { channel: { name } } });
    expect(toldLine([ours])).toBe('Guests told by WhatsApp and email');
    expect(toldLine([])).toBe('Guests told by WhatsApp and email');
    expect(toldLine([ota('Sojourna'), ota('Sojourna')])).toBe('Sojourna tells its guests');
    expect(toldLine([ota('Sojourna'), ota('Tripwell'), ours])).toBe(
      'Guests told by WhatsApp and email; Sojourna and Tripwell tell their guests',
    );
  });

  it('the trip page: booked through Sojourna, so no cancelling here', async () => {
    const s = await setup();
    const sold = await s.sale('48218');
    const token = guestToken(TEST_AUTH_SECRET, sold.id);
    const trip = await request(ctx.app).get(`/public/bookings/${token}`);
    expect(trip.body.booking.bookedThrough).toBe('Sojourna');
    const cancel = await request(ctx.app)
      .post(`/public/bookings/${token}/cancel`)
      .send({ expectRefundKobo: 10_200_000 });
    expect(cancel.status).toBe(409);
    expect(cancel.body.error).toMatchObject({
      code: 'BOOKED_ELSEWHERE',
      message: 'You booked through Sojourna: cancel your booking there.',
    });
    expect((await ctx.prisma.booking.findUniqueOrThrow({ where: { id: sold.id } })).status).toBe(
      'paid',
    );
    // A website booking's trip page: nothing changes.
    const web = await s.websiteBooking();
    const webTrip = await request(ctx.app).get(
      `/public/bookings/${guestToken(TEST_AUTH_SECRET, web.id)}`,
    );
    expect(webTrip.body.booking.bookedThrough).toBeNull();
  });
});
