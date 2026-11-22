/**
 * Stage 18a: the AI trip companion (GST-16, journey 7's server side).
 *   GET  /public/bookings/:token/companion   the card: available?, left today, suggestions, so far
 *   POST /public/bookings/:token/companion   a question → answered, or handed to the team
 * The app uses the fake model (answers from the FAQs by matching words). The steps behind it
 * (kept answers, the day's limit, the spend cap, the model being down) are tested on
 * askCompanion with pretend models that count their calls.
 */
import { describe, it, expect, afterAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import { addDays, localDate } from '@okapigo/shared/time';
import {
  askCompanion,
  bookingIdFromGuestToken,
  companionSpendThisMonth,
  createGuestRequest,
  guestCancelBooking,
} from '@okapigo/db';
import { AiUnavailableError } from '@okapigo/ai';
import { buildApp, createTestContext, TEST_AUTH_SECRET } from './helpers.js';

const ctx = createTestContext();
afterEach(() => ctx.cleanup());
afterAll(() => ctx.close());

/** A PAID one-adult Heritage Walk, at least `daysAhead` days away, on a business of its own. */
async function paidBooking(daysAhead = 5, seeded = null) {
  const s = seeded ?? (await ctx.seedOperator());
  const today = localDate(new Date(), 'Africa/Lagos');
  const deps = (
    await request(ctx.app).get(
      `/public/${s.operator.slug}/tours/lagos-island-heritage-walk/departures?to=${addDays(today, 20)}`,
    )
  ).body.departures;
  const departure = deps.find((/** @type {any} */ d) => d.localDate >= addDays(today, daysAhead));
  const { token } = (
    await request(ctx.app)
      .post(`/public/${s.operator.slug}/bookings`)
      .send({
        lead: { name: 'Adaeze Okafor', email: 'adaeze@guest.example', acceptTerms: true },
        departureId: departure.id,
        travellers: [{ name: 'Adaeze Okafor', age: 34 }],
        addOns: [],
      })
  ).body;
  const { reference } = (
    await request(ctx.app).post(`/public/bookings/${token}/pay`).send({ option: 'full' })
  ).body.payment;
  await ctx.provider.complete(reference);
  await request(ctx.app).post(`/public/bookings/${token}/payments/${reference}/check`);
  const bookingId = /** @type {string} */ (bookingIdFromGuestToken(TEST_AUTH_SECRET, token));
  return { ...s, token, bookingId };
}

const ask = (/** @type {string} */ token, /** @type {string} */ question, app = ctx.app) =>
  request(app).post(`/public/bookings/${token}/companion`).send({ question });
const card = (/** @type {string} */ token) =>
  request(ctx.app).get(`/public/bookings/${token}/companion`);

/** A pretend model that always replies `reply`, costing 7 µ$, and counts its calls. */
function pretendModel(/** @type {any} */ reply = {}) {
  const answer = vi.fn(async () => ({
    status: 'answered',
    answer: 'Wear light clothes.',
    source: 'What should I wear?',
    usesBookingDetails: false,
    model: 'pretend',
    usage: { inputTokens: 1000, outputTokens: 100, costMicroUsd: 7 },
    ...reply,
  }));
  return { name: 'pretend', model: 'pretend', answer };
}
const BIG_CAP = 1_000_000_000;

describe('on the trip page (the fake model)', () => {
  it('the card: available, 20 questions today, the tour’s FAQs to tap, nothing asked yet', async () => {
    const { token } = await paidBooking();
    const res = await card(token);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      available: true,
      reason: null,
      left: 20,
      suggestions: ['What should I wear?', 'Is the walk suitable for children?'],
      messages: [],
    });
  });

  it('"What should I wear?" is answered from the business’s own FAQ (journey 7)', async () => {
    const { token, bookingId } = await paidBooking();
    const res = await ask(token, 'What should I wear for the Heritage Walk?');
    expect(res.status).toBe(201);
    expect(res.body.left).toBe(19);
    expect(res.body.message).toMatchObject({
      question: 'What should I wear for the Heritage Walk?',
      outcome: 'answered',
      source: 'What should I wear?',
    });
    expect(res.body.message.answer).toMatch(
      /^Light, breathable clothes and comfortable walking shoes/,
    );
    // It's on the card from now on, and nothing went to the team.
    const after = (await card(token)).body;
    expect(after.left).toBe(19);
    expect(after.messages.map((/** @type {any} */ m) => m.outcome)).toEqual(['answered']);
    expect(await ctx.prisma.guestRequest.count({ where: { bookingId } })).toBe(0);
  });

  it('an unclear question goes to the team at once: an inbox request, kind "question"', async () => {
    const { token, bookingId, manager } = await paidBooking();
    const res = await ask(token, 'Can I fly my drone over Freedom Park?');
    expect(res.status).toBe(201);
    expect(res.body.message).toMatchObject({ outcome: 'handed_over', answer: null, source: null });

    const req = await ctx.prisma.guestRequest.findFirstOrThrow({ where: { bookingId } });
    expect(req).toMatchObject({
      kind: 'question',
      message: 'Can I fly my drone over Freedom Park?',
      status: 'open',
    });
    const m = await ctx.prisma.companionMessage.findFirstOrThrow({ where: { bookingId } });
    expect(m.guestRequestId).toBe(req.id);
    // The inbox shows it, labelled.
    const inbox = (
      await request(ctx.app)
        .get('/api/inbox/requests?tab=open')
        .set('Authorization', `Bearer ${await ctx.tokenFor(manager.id)}`)
    ).body.requests;
    expect(inbox.rows[0]).toMatchObject({ kind: 'question', kindLabel: 'Asked the assistant' });
    // And the trip page says it was sent (its existing "Your request was sent").
    const view = (await request(ctx.app).get(`/public/bookings/${token}`)).body;
    expect(view.booking.openRequests).toEqual([expect.objectContaining({ kind: 'question' })]);
  });

  it('an empty or over-long question is refused in words; a bad link is 404', async () => {
    const { token } = await paidBooking();
    expect((await ask(token, '   ')).status).toBe(400);
    const long = await ask(token, 'x'.repeat(501));
    expect(long.status).toBe(400);
    expect(JSON.stringify(long.body)).toContain('Please keep your question shorter.');
    expect((await ask('A'.repeat(44), 'Hello?')).status).toBe(404);
    expect((await card('A'.repeat(44))).status).toBe(404);
  });

  it('a cancelled booking: closed (409), and the card says why', async () => {
    const { token, bookingId } = await paidBooking();
    await guestCancelBooking(ctx.prisma, { bookingId, expectRefundKobo: 2_500_000 });
    const res = await ask(token, 'What should I wear?');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('COMPANION_CLOSED');
    expect((await card(token)).body).toMatchObject({ available: false, reason: 'closed' });
  });

  it('the spend cap reached: 503 "not available", and the card says it’s paused', async () => {
    const { token } = await paidBooking();
    const capped = buildApp({ prisma: ctx.prisma, ai: pretendModel(), aiMonthlyCapMicroUsd: 0 });
    const res = await ask(token, 'Can I fly my drone?', capped);
    expect(res.status).toBe(503);
    expect(res.body.error).toMatchObject({
      code: 'COMPANION_UNAVAILABLE',
      message: 'The assistant isn’t available right now.',
    });
    const cardRes = await request(capped).get(`/public/bookings/${token}/companion`);
    expect(cardRes.body).toMatchObject({ available: false, reason: 'paused' });
  });
  it('the day’s 20 used: 429 "all the questions for today", and the card says so', async () => {
    const { token, bookingId } = await paidBooking();
    const b = await ctx.prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    await ctx.prisma.companionMessage.createMany({
      data: Array.from({ length: 20 }, (_, i) => ({
        operatorId: b.operatorId,
        bookingId,
        question: `Q${i}`,
        answer: 'A',
        outcome: 'answered',
        model: 'fake',
      })),
    });
    const res = await ask(token, 'What should I wear?');
    expect(res.status).toBe(429);
    expect(res.body.error).toMatchObject({
      code: 'COMPANION_LIMIT',
      message: 'That’s all the questions for today.',
    });
    expect((await card(token)).body).toMatchObject({ available: false, reason: 'limit', left: 0 });
  });

  it('after the trip, guests can still ask (lost property, "what was that dish?")', async () => {
    const { token, bookingId } = await paidBooking();
    await ctx.prisma.booking.update({ where: { id: bookingId }, data: { status: 'completed' } });
    expect((await ask(token, 'What should I wear?')).status).toBe(201);
  });
});

describe('askCompanion: what happens behind the card', () => {
  it('an answer is kept: the next guest’s same question costs nothing and skips the model', async () => {
    const s = await ctx.seedOperator();
    const a = await paidBooking(5, s);
    const b = await paidBooking(6, s);
    const model = pretendModel();
    const first = await askCompanion(ctx.prisma, model, {
      bookingId: a.bookingId,
      question: 'What should I wear?',
      monthlyCapMicroUsd: BIG_CAP,
    });
    const second = await askCompanion(ctx.prisma, model, {
      bookingId: b.bookingId,
      question: '  what should i WEAR ', // the same question, typed differently
      monthlyCapMicroUsd: BIG_CAP,
    });
    expect(model.answer).toHaveBeenCalledTimes(1);
    expect(second.message).toMatchObject({ answer: 'Wear light clothes.', outcome: 'answered' });
    const rows = await ctx.prisma.companionMessage.findMany({
      where: { bookingId: { in: [a.bookingId, b.bookingId] } },
      orderBy: { createdAt: 'asc' },
    });
    expect(rows.map((r) => [r.cached, r.costMicroUsd])).toEqual([
      [false, 7],
      [true, 0],
    ]);
    expect(first.message.id).toBe(rows[0].id);
    const kept = await ctx.prisma.companionAnswer.findFirstOrThrow({
      where: { product: { operatorId: s.operator.id } },
    });
    expect(kept.hits).toBe(1);
  });

  it('an answer built on THIS booking’s details is never kept for another guest', async () => {
    const s = await ctx.seedOperator();
    const a = await paidBooking(5, s);
    const b = await paidBooking(6, s);
    const model = pretendModel({ answer: 'Your walk is on Sat 5 Dec.', usesBookingDetails: true });
    for (const { bookingId } of [a, b]) {
      await askCompanion(ctx.prisma, model, {
        bookingId,
        question: 'When is my walk?',
        monthlyCapMicroUsd: BIG_CAP,
      });
    }
    expect(model.answer).toHaveBeenCalledTimes(2);
    expect(
      await ctx.prisma.companionAnswer.count({ where: { product: { operatorId: s.operator.id } } }),
    ).toBe(0);
  });

  it('the tour’s notes changed: old kept answers no longer match, the model is asked again', async () => {
    const s = await ctx.seedOperator();
    const a = await paidBooking(5, s);
    const model = pretendModel();
    const q = {
      bookingId: a.bookingId,
      question: 'What should I wear?',
      monthlyCapMicroUsd: BIG_CAP,
    };
    await askCompanion(ctx.prisma, model, q);
    await ctx.prisma.product.updateMany({
      where: { operatorId: s.operator.id, slug: 'lagos-island-heritage-walk' },
      data: { whatToBring: ['A raincoat'] },
    });
    await askCompanion(ctx.prisma, model, q);
    expect(model.answer).toHaveBeenCalledTimes(2);
  });

  it('it is given the business’s rules and this booking’s facts, and the question', async () => {
    const a = await paidBooking();
    const model = pretendModel();
    await askCompanion(ctx.prisma, model, {
      bookingId: a.bookingId,
      question: 'Where do we meet?',
      monthlyCapMicroUsd: BIG_CAP,
    });
    const input = /** @type {any} */ (model.answer.mock.calls[0])[0];
    expect(input.question).toBe('Where do we meet?');
    expect(input.instructions).toContain('guests of Ìrìn Lagos Tours');
    const topics = input.facts.map((/** @type {any} */ f) => f.topic);
    expect(topics).toEqual(
      expect.arrayContaining([
        'Meeting point',
        'What should I wear?',
        'Cancellation policy',
        'Your booking',
      ]),
    );
  });

  it('20 questions per booking per Lagos day; the 21st waits for tomorrow (429)', async () => {
    const a = await paidBooking();
    const b = await ctx.prisma.booking.findUniqueOrThrow({ where: { id: a.bookingId } });
    // 23:00 in Lagos (22:00 UTC) on some day, with 20 asked since that day's midnight.
    const lateEvening = new Date('2026-11-25T22:00:00Z');
    await ctx.prisma.companionMessage.createMany({
      data: Array.from({ length: 20 }, (_, i) => ({
        operatorId: b.operatorId,
        bookingId: b.id,
        question: `Q${i}`,
        answer: 'A',
        outcome: 'answered',
        model: 'pretend',
        createdAt: new Date('2026-11-24T23:30:00Z'), // 00:30 on the 25th in Lagos
      })),
    });
    const model = pretendModel();
    const q = { bookingId: b.id, question: 'One more?', monthlyCapMicroUsd: BIG_CAP };
    await expect(askCompanion(ctx.prisma, model, { ...q, now: lateEvening })).rejects.toMatchObject(
      {
        code: 'COMPANION_LIMIT',
      },
    );
    // 00:30 the next Lagos day (23:30 UTC, still the 25th in UTC): a fresh 20.
    const nextDay = new Date('2026-11-25T23:30:00Z');
    const r = await askCompanion(ctx.prisma, model, { ...q, now: nextDay });
    expect(r.left).toBe(19);
    expect(model.answer).toHaveBeenCalledTimes(1);
  });

  it('the cap counts what was spent this month; at the cap, no more model calls', async () => {
    const a = await paidBooking();
    const spent = await companionSpendThisMonth(ctx.prisma);
    const model = pretendModel({ answer: 'One.', usesBookingDetails: true });
    const q = { bookingId: a.bookingId, monthlyCapMicroUsd: spent + 5 };
    await askCompanion(ctx.prisma, model, { ...q, question: 'First?' }); // costs 7: over the cap now
    expect(await companionSpendThisMonth(ctx.prisma)).toBeGreaterThanOrEqual(spent + 7);
    await expect(
      askCompanion(ctx.prisma, model, { ...q, question: 'Second?' }),
    ).rejects.toMatchObject({ code: 'COMPANION_UNAVAILABLE' });
    expect(model.answer).toHaveBeenCalledTimes(1);
  });

  it('exactly at the cap counts as reached', async () => {
    const a = await paidBooking();
    const model = pretendModel();
    await expect(
      askCompanion(ctx.prisma, model, {
        bookingId: a.bookingId,
        question: 'Anything?',
        monthlyCapMicroUsd: await companionSpendThisMonth(ctx.prisma),
      }),
    ).rejects.toMatchObject({ code: 'COMPANION_UNAVAILABLE' });
    expect(model.answer).not.toHaveBeenCalled();
  });

  it('the model can’t be reached: "not available", nothing recorded; our own bug still throws', async () => {
    const a = await paidBooking();
    const down = {
      name: 'pretend',
      model: 'pretend',
      answer: vi.fn(async () => {
        throw new AiUnavailableError('Anthropic: no connection');
      }),
    };
    const q = { bookingId: a.bookingId, question: 'Hello?', monthlyCapMicroUsd: BIG_CAP };
    await expect(askCompanion(ctx.prisma, down, q)).rejects.toMatchObject({
      code: 'COMPANION_UNAVAILABLE',
    });
    expect(await ctx.prisma.companionMessage.count({ where: { bookingId: a.bookingId } })).toBe(0);
    const buggy = {
      ...down,
      answer: vi.fn(async () => {
        throw new TypeError('oops');
      }),
    };
    await expect(askCompanion(ctx.prisma, buggy, q)).rejects.toThrow(TypeError);
  });

  it('the hand-over failing for a reason of our own (the database) is not hidden', async () => {
    const a = await paidBooking();
    // The same database, except its transactions fail (createGuestRequest runs in one).
    const broken = new Proxy(ctx.prisma, {
      get: (target, key) =>
        key === '$transaction'
          ? async () => {
              throw new Error('database unavailable');
            }
          : Reflect.get(target, key),
    });
    const unsure = pretendModel({ status: 'unsure', answer: '', source: null });
    await expect(
      askCompanion(/** @type {any} */ (broken), unsure, {
        bookingId: a.bookingId,
        question: 'Is there parking?',
        monthlyCapMicroUsd: BIG_CAP,
      }),
    ).rejects.toThrow('database unavailable');
  });

  it('not sure, but three requests already wait for the team: nothing sent, outcome "unsure"', async () => {
    const a = await paidBooking();
    for (const kind of /** @type {const} */ (['change_date', 'cancel', 'other'])) {
      await createGuestRequest(ctx.prisma, { bookingId: a.bookingId, kind, message: 'Hi' });
    }
    const unsure = pretendModel({ status: 'unsure', answer: '', source: null });
    const r = await askCompanion(ctx.prisma, unsure, {
      bookingId: a.bookingId,
      question: 'Is there parking?',
      monthlyCapMicroUsd: BIG_CAP,
    });
    expect(r.message).toMatchObject({ outcome: 'unsure', answer: null });
    expect(await ctx.prisma.guestRequest.count({ where: { bookingId: a.bookingId } })).toBe(3);
    // Its cost is still counted: the model was asked.
    const m = await ctx.prisma.companionMessage.findFirstOrThrow({
      where: { bookingId: a.bookingId },
    });
    expect(m.costMicroUsd).toBe(7);
  });
});
