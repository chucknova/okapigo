/**
 * Stage 14c: the guest messages as WhatsApp TEMPLATES, for when WhatsApp's 24-hour window is
 * closed (a website guest who never wrote, or a chat gone quiet). Against a fake Meta.
 *   - each template follows Meta's rules (no blank at the start or end, blanks numbered in
 *     order, one value per blank, no line breaks in a value)
 *   - a website guest's confirmation goes to real WhatsApp as the template; the chat keeps
 *     the business's own words for staff to read
 *   - inside the window, the business's own words go, as they are
 */
import { describe, it, expect, afterAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import { randomInt } from 'node:crypto';
import { addDays, localDate } from '@okapigo/shared/time';
import { MESSAGE_KINDS } from '@okapigo/shared/message-templates';
import { createTestContext, TEST_AUTH_SECRET } from './helpers.js';
import { WHATSAPP_TEMPLATES, fillTemplate, blank } from '../src/whatsapp/templates.js';
import { toGraph } from '../src/whatsapp/cloud-api.js';
import { createChannels } from '../src/whatsapp/channels.js';
import { sendGuestMessages } from '../src/messages/send.js';

const ctx = createTestContext();
afterEach(() => ctx.cleanup());
afterAll(() => ctx.close());
vi.setConfig({ testTimeout: 60_000, hookTimeout: 30_000 });

describe('the templates follow Meta’s rules', () => {
  // The trip page link (17c-3) goes by email only: no WhatsApp template to approve.
  it('the trip page link has none, and asking for one is refused', () => {
    expect(/** @type {any} */ (WHATSAPP_TEMPLATES).trip_link).toBeUndefined();
    expect(() => fillTemplate('trip_link', {})).toThrow('email only');
  });

  it.each(MESSAGE_KINDS.filter((k) => k !== 'trip_link'))('%s', (kind) => {
    const t = WHATSAPP_TEMPLATES[/** @type {Exclude<typeof kind, 'trip_link'>} */ (kind)];
    expect(t.name).toMatch(/^[a-z0-9_]{1,512}$/);
    expect(t.text).not.toMatch(/^\s*\{\{/); // doesn't start with a blank
    expect(t.text).not.toMatch(/\}\}\s*$/); // nor end with one
    const numbers = [...t.text.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
    expect(numbers).toEqual(numbers.map((_, i) => i + 1)); // 1, 2, 3… each once, in order
    expect(t.params).toHaveLength(numbers.length);
    expect(t.text.length).toBeLessThanOrEqual(1024); // Meta's body limit
  });

  it('a value is one line, never empty, with no long runs of spaces', () => {
    expect(blank('Refund: ₦31,250.\nIt goes back…')).toBe('Refund: ₦31,250. It goes back…');
    expect(blank('a\tb      c')).toBe('a b   c');
    expect(blank('')).toBe('-');
  });

  it('filled: the words a guest would read, and the blanks in order', () => {
    const t = fillTemplate('balance_reminder', {
      first_name: 'Funmi',
      balance: '₦45,500',
      due_date: 'Sat 28 Nov',
      tour_short: 'Badagry Day Trip',
      date: 'Sat 5 Dec',
      reference: 'ILT-3MZ8RB',
      pay_url: 'https://okapigo.example/trip/x/pay',
    });
    expect(t.name).toBe('okapigo_balance_reminder');
    expect(t.params[0]).toBe('Funmi');
    expect(t.text).toBe(
      'Hi Funmi, a reminder: ₦45,500 is due by Sat 28 Nov for your Badagry Day Trip on Sat 5 Dec (ILT-3MZ8RB).\n\nPay here:\nhttps://okapigo.example/trip/x/pay\n\nCan’t make it? Just reply and we’ll help.',
    );
    expect(
      toGraph(
        { kind: 'text', text: 'own words', template: t },
        { operatorName: 'Ìrìn', useTemplate: true },
      ),
    ).toEqual({
      type: 'template',
      template: {
        name: 'okapigo_balance_reminder',
        language: { code: 'en' },
        components: [
          { type: 'body', parameters: t.params.map((text) => ({ type: 'text', text })) },
        ],
      },
    });
    // Inside the window: the business's own words, as text.
    expect(
      toGraph({ kind: 'text', text: 'own words', template: t }, { operatorName: 'Ìrìn' }),
    ).toMatchObject({
      type: 'text',
      text: { body: 'own words' },
    });
  });
});

describe('sending: real WhatsApp, a website guest', () => {
  /** A fake Meta that records what it's sent. */
  function fakeMeta() {
    /** @type {any[]} */
    const sent = [];
    const fetch = async (/** @type {string} */ _url, /** @type {any} */ init) => {
      sent.push(JSON.parse(init.body));
      return {
        ok: true,
        status: 200,
        json: async () => ({ messages: [{ id: `wamid.${sent.length}` }] }),
      };
    };
    return {
      sent,
      channels: createChannels({
        whatsapp: {
          accessToken: 'test-token',
          graphVersion: 'v23.0',
          templateLanguage: 'en',
          fetch: /** @type {any} */ (fetch),
        },
      }),
    };
  }
  const send = (/** @type {any} */ channels, /** @type {string} */ operatorId) =>
    sendGuestMessages({
      prisma: ctx.prisma,
      authSecret: TEST_AUTH_SECRET,
      webPublicUrl: 'http://localhost:4000',
      channels,
      operatorId,
    });

  async function paidWebsiteBooking() {
    const { operator } = await ctx.seedOperator();
    await ctx.prisma.operator.update({
      where: { id: operator.id },
      data: { whatsappPhoneNumberId: String(randomInt(10 ** 9, 10 ** 10)) },
    });
    const today = localDate(new Date(), 'Africa/Lagos');
    const deps = (
      await request(ctx.app).get(
        `/public/${operator.slug}/tours/lagos-island-heritage-walk/departures?to=${addDays(today, 20)}`,
      )
    ).body.departures;
    const { token } = (
      await request(ctx.app)
        .post(`/public/${operator.slug}/bookings`)
        .send({
          lead: { name: 'Adaeze Okafor', phone: '0803 123 4567', acceptTerms: true },
          departureId: deps[3].id,
          travellers: [{ name: 'Adaeze Okafor', age: 34 }],
          addOns: [],
        })
    ).body;
    const { reference } = (
      await request(ctx.app).post(`/public/bookings/${token}/pay`).send({ option: 'full' })
    ).body.payment;
    await ctx.provider.complete(reference);
    await request(ctx.app).post(`/public/bookings/${token}/payments/${reference}/check`);
    return { operator, token };
  }

  it('the guest never wrote: the confirmation goes as the approved template; the chat keeps the own words', async () => {
    const { operator, token } = await paidWebsiteBooking();
    const meta = fakeMeta();
    expect(await send(meta.channels, operator.id)).toMatchObject({ sent: 1, failed: 0 });

    expect(meta.sent).toHaveLength(1);
    expect(meta.sent[0]).toMatchObject({
      to: '2348031234567',
      type: 'template',
      template: { name: 'okapigo_booking_confirmed', language: { code: 'en' } },
    });
    const params = meta.sent[0].template.components[0].parameters.map(
      (/** @type {any} */ p) => p.text,
    );
    expect(params[0]).toBe('Adaeze');
    expect(params[7]).toBe(`http://localhost:4000/trip/${token}`);

    // A real WhatsApp chat now exists for the guest, holding the business's words.
    const c = await ctx.prisma.conversation.findFirstOrThrow({
      where: { operatorId: operator.id },
      include: { messages: true },
    });
    expect(c.channel).toBe('whatsapp');
    expect(c.messages[0]).toMatchObject({ delivery: 'sent', providerMessageId: 'wamid.1' });
    expect(/** @type {any} */ (c.messages[0].body).text).toMatch(
      /^Hi Adaeze, your booking is confirmed!/,
    );
  });

  it('the guest wrote within 24 hours: the business’s own words go, as text', async () => {
    const { operator } = await paidWebsiteBooking();
    // The guest messaged the business on WhatsApp an hour ago.
    const c = await ctx.prisma.conversation.create({
      data: { operatorId: operator.id, channel: 'whatsapp', guestPhone: '+2348031234567' },
    });
    await ctx.prisma.chatMessage.create({
      data: {
        operatorId: operator.id,
        conversationId: c.id,
        direction: 'in',
        author: 'guest',
        body: { kind: 'text', text: 'Hi' },
        createdAt: new Date(Date.now() - 3_600_000),
      },
    });
    const meta = fakeMeta();
    await send(meta.channels, operator.id);
    expect(meta.sent[0]).toMatchObject({ type: 'text' });
    expect(meta.sent[0].text.body).toMatch(/^Hi Adaeze, your booking is confirmed!/);
  });

  it('a DEMO business (19a-2) never writes on real WhatsApp, even when connected: the simulator only', async () => {
    const { operator } = await paidWebsiteBooking();
    await ctx.prisma.operator.update({ where: { id: operator.id }, data: { isDemo: true } });
    // Even a guest who once wrote on real WhatsApp gets the simulator from a demo business.
    const booking = await ctx.prisma.booking.findFirstOrThrow({
      where: { operatorId: operator.id },
    });
    await ctx.prisma.conversation.create({
      data: {
        operatorId: operator.id,
        channel: 'whatsapp',
        guestPhone: /** @type {string} */ (booking.leadPhone),
        guestName: 'Adaeze',
        lastMessageAt: new Date(),
      },
    });
    const meta = fakeMeta();
    expect(await send(meta.channels, operator.id)).toMatchObject({ sent: 1, failed: 0 });
    expect(meta.sent).toEqual([]);
    const chats = await ctx.prisma.conversation.findMany({
      where: { operatorId: operator.id },
      include: { messages: true },
      orderBy: { channel: 'asc' },
    });
    expect(chats.map((c) => [c.channel, c.messages.length])).toEqual([
      ['simulator', 1],
      ['whatsapp', 0],
    ]);
  });
});
