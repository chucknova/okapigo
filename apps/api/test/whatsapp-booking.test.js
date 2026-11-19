/**
 * Session 13a: booking on WhatsApp, as scripted chats through the simulator's API.
 *   - journey 2's path: Hi → tours → Street Food → a date → 2 adults → extras → name → summary,
 *     with the seats HELD (30 minutes), booked through the website's own code
 *   - children give their ages (decided 2026-11-18); adults don't; the website's rules apply
 *   - typed numbers and names work as well as taps; anything else asks again
 *   - "menu", "Change something", "Cancel" give the seats back; "person" asks for the team
 *   - every reply fits WhatsApp's own limits
 *   - a conversation can only be read with its token
 */
import { describe, it, expect, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { createTestContext } from './helpers.js';
import { chatHelpers } from './whatsapp-chat.js';

const ctx = createTestContext();
afterEach(() => ctx.cleanup());
afterAll(() => ctx.close());

const { guest, options, words } = chatHelpers(ctx);

/** Hi → tours → a tour → its first date: ready to say who's coming. */
async function upToWho(/** @type {string} */ slug, /** @type {string} */ tour) {
  const g = guest(slug);
  await g.say('Hi');
  await g.tap('tours');
  const dates = await g.tap(`tour:${tour}`);
  const firstDate = options(dates).find((r) => r.id.startsWith('dep:'));
  const who = await g.tap(firstDate.id);
  return { g, who, departureId: firstDate.id.slice(4) };
}

describe('journey 2’s path: the Street Food Crawl', () => {
  it('Hi → tours → dates → 2 adults → an extra → name → summary, seats held for 30 minutes', async () => {
    const { operator } = await ctx.seedOperator();
    const g = guest(operator.slug);

    const hello = await g.say('Hi');
    expect(hello[0].text).toContain('booking assistant');
    expect(options(hello).map((b) => b.title)).toEqual(['See tours', 'Talk to a person']);

    const tours = await g.tap('tours');
    expect(tours[0].text).toContain('Prices are per adult and include VAT');
    const food = options(tours).find((r) => r.id === 'tour:lagos-street-food-crawl');
    expect(food).toMatchObject({
      title: 'Lagos Street Food Crawl',
      description: expect.stringContaining('from ₦35,000'),
    });

    const dates = await g.tap(food.id);
    expect(dates[0].text).toContain('*Lagos Street Food Crawl*');
    const rows = options(dates);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(10);
    expect(rows[0].title).toMatch(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d+ \w{3} · 18:30$/);

    const adults = await g.tap(rows[0].id);
    expect(adults[0].text).toBe('How many adults (13+)?');
    expect(words(await g.tap('n:2'))).toBe('Any children (3–12)?');
    expect(words(await g.tap('n:0'))).toBe('Any infants (0–2)?');
    const plate = await g.tap('n:0');
    expect(plate[0].text).toBe('Would you like Extra tasting plate (₦5,000 each)?');
    expect(options(plate).map((b) => b.title)).toEqual(['No thanks', '1', '2, one each']);
    await g.tap('n:0'); // no plates
    expect(words(await g.tap('n:2'))).toBe('What name should the booking be under?'); // 2 palm wine
    await g.say('Adaeze Okafor');
    const summary = await g.tap('skip'); // no email

    // The summary: what, when, how many, the price from the website's own pricing.
    const text = words(summary);
    expect(text).toContain('*Lagos Street Food Crawl*');
    expect(text).toContain('2 adults · ₦78,000 (includes VAT)'); // 2 × ₦35,000 + 2 × ₦4,000
    expect(text).toContain('+ 2 × Palm wine sampler');
    expect(text).toContain("I'm holding your seats for 30 minutes.");
    expect(text).toContain('By tapping Pay you accept the booking terms: ');
    expect(options(summary).map((b) => b.title)).toEqual([
      'Pay ₦78,000',
      'Change something',
      'Cancel',
    ]);

    // And in the database: a held WhatsApp booking, 30 minutes, the lead named, the other
    // adult to be named at check-in, no made-up ages.
    const booking = await ctx.prisma.booking.findFirstOrThrow({
      where: { operatorId: operator.id },
      include: { hold: true, travellers: { orderBy: { position: 'asc' } }, addOns: true },
    });
    expect(booking).toMatchObject({
      status: 'held',
      channel: 'whatsapp',
      leadName: 'Adaeze Okafor',
      leadPhone: '+2348031234567',
      totalKobo: 7_800_000,
    });
    const minutes = (booking.hold.expiresAt.getTime() - booking.hold.createdAt.getTime()) / 60_000;
    expect(Math.round(minutes)).toBe(30);
    expect(booking.travellers.map((t) => [t.name, t.age, t.categoryKey])).toEqual([
      ['Adaeze Okafor', null, 'adult'],
      ['', null, 'adult'],
    ]);
    expect(booking.addOns).toHaveLength(1);
    const conversation = await ctx.prisma.conversation.findFirstOrThrow({
      where: { operatorId: operator.id },
    });
    expect(conversation.bookingId).toBe(booking.id);
  });
});

describe('who’s coming', () => {
  it('children give their ages; the age is checked against the category', async () => {
    const { operator } = await ctx.seedOperator();
    const { g } = await upToWho(operator.slug, 'lagos-island-heritage-walk');
    await g.tap('n:1'); // 1 adult
    expect(words(await g.tap('n:1'))).toBe('How old is child 1? (ages 3–12)');
    expect(words(await g.say('13'))).toBe(
      'Child: ages 3–12. Type the age of child 1, or "menu" to start again.',
    );
    expect(words(await g.say('8'))).toBe('Any infants (0–2)?');
    await g.tap('n:0');
    await g.say('Chidi Okafor');
    const summary = await g.say('chidi@guest.example');
    expect(words(summary)).toContain('1 adult, 1 child · ₦37,500');

    const booking = await ctx.prisma.booking.findFirstOrThrow({
      where: { operatorId: operator.id },
      include: { travellers: { orderBy: { position: 'asc' } } },
    });
    expect(booking.leadEmail).toBe('chidi@guest.example');
    expect(booking.travellers.map((t) => [t.age, t.categoryKey])).toEqual([
      [null, 'adult'],
      [8, 'child'],
    ]);
  });

  it('no children without an adult: the website’s rule, in the website’s words', async () => {
    const { operator } = await ctx.seedOperator();
    const { g } = await upToWho(operator.slug, 'lagos-island-heritage-walk');
    await g.tap('n:0'); // no adults (typed as a button? "0" isn't offered for adults, so type it)
    await g.tap('n:1');
    await g.say('6');
    const again = await g.tap('n:0');
    expect(words(again)).toContain('Children must travel with an adult.');
    expect(again.at(-1).text).toBe('How many adults (13+)?');
  });

  it('"3 or more" lets the guest type the number', async () => {
    const { operator } = await ctx.seedOperator();
    const { g } = await upToWho(operator.slug, 'lagos-island-heritage-walk');
    expect(words(await g.tap('more'))).toBe('Type the number of adults (13+).');
    expect(words(await g.say('4'))).toBe('Any children (3–12)?');
  });
});

describe('typing instead of tapping', () => {
  it('a number picks that row, a name picks its row, anything else asks again', async () => {
    const { operator } = await ctx.seedOperator();
    const g = guest(operator.slug);
    await g.say('hello');
    const tours = await g.say('show me what you have'); // anything at the start: the tours
    expect(tours[0].kind).toBe('list');
    const second = options(tours)[1];
    // (Row titles are cut to WhatsApp's 24 characters; the details give the whole name.)
    expect((await g.say('2'))[0].text).toContain(`*${second.title.replace(/…$/, '')}`);

    await g.say('menu');
    await g.tap('tours');
    expect((await g.say('street food'))[0].text).toContain('*Lagos Street Food Crawl*');

    const lost = await g.say('blue');
    expect(lost[0].text).toBe(
      'Sorry, I didn\'t get that. Choose a date from the list, or type "menu" to start again.',
    );
    expect(lost.at(-1).kind).toBe('list'); // and the dates again
  });
});

describe('giving seats back', () => {
  async function toSummary(/** @type {string} */ slug) {
    const { g, departureId } = await upToWho(slug, 'lagos-island-heritage-walk');
    await g.tap('n:2');
    await g.tap('n:0');
    await g.tap('n:0');
    await g.say('Adaeze Okafor');
    await g.tap('skip');
    return { g, departureId };
  }
  const seatsHeld = async (/** @type {string} */ id) =>
    (await ctx.prisma.departure.findUniqueOrThrow({ where: { id } })).seatsHeld;

  it('Cancel releases the hold; nothing was charged', async () => {
    const { operator } = await ctx.seedOperator();
    const { g, departureId } = await toSummary(operator.slug);
    expect(await seatsHeld(departureId)).toBe(2);
    expect(words(await g.tap('cancel'))).toBe('Cancelled. Nothing was charged.');
    expect(await seatsHeld(departureId)).toBe(0);
  });

  it('"Change something" gives the seats back and offers the dates again; "menu" too', async () => {
    const { operator } = await ctx.seedOperator();
    const { g, departureId } = await toSummary(operator.slug);
    const dates = await g.tap('change');
    expect(dates.at(-1).kind).toBe('list');
    expect(await seatsHeld(departureId)).toBe(0);

    await toSummary(operator.slug); // the same guest, a new hold
    expect(await seatsHeld(departureId)).toBe(2);
    expect(words(await g.say('menu'))).toContain('booking assistant');
    expect(await seatsHeld(departureId)).toBe(0);
  });
});

describe('a person, and privacy', () => {
  it('"person" from anywhere asks for the team (and the chat remembers when)', async () => {
    const { operator } = await ctx.seedOperator();
    const g = guest(operator.slug);
    await g.say('hi');
    expect(words(await g.say('can I speak to a person please'))).toContain(
      'asked the Ìrìn team to join',
    );
    const c = await ctx.prisma.conversation.findFirstOrThrow({
      where: { operatorId: operator.id },
    });
    expect(c.needsPersonSince).not.toBeNull();
  });

  it('a conversation is read with its token only; everything is in order', async () => {
    const { operator } = await ctx.seedOperator();
    const g = guest(operator.slug);
    await g.say('Hi');
    await g.tap('tours');
    const read = await request(ctx.app).get(
      `/simulator/whatsapp/conversations/${g.token()}/messages`,
    );
    expect(read.status).toBe(200);
    expect(read.body.messages.map((/** @type {any} */ m) => m.author)).toEqual([
      'guest',
      'bot',
      'guest',
      'bot',
    ]);
    expect(read.body.messages[2].body).toMatchObject({ kind: 'reply', id: 'tours' });

    const [id] = g.token().split('.');
    expect(
      (await request(ctx.app).get(`/simulator/whatsapp/conversations/${id}.forged/messages`))
        .status,
    ).toBe(404);
    expect(
      (await request(ctx.app).get(`/simulator/whatsapp/conversations/${id}/messages`)).status,
    ).toBe(404);
  });

  it('two guests, two conversations; an unknown business or a bad number is refused', async () => {
    const { operator } = await ctx.seedOperator();
    await guest(operator.slug, '0803 111 1111').say('hi');
    await guest(operator.slug, '0803 222 2222').say('hi');
    expect(await ctx.prisma.conversation.count({ where: { operatorId: operator.id } })).toBe(2);
    const bad = await request(ctx.app)
      .post(`/simulator/whatsapp/${operator.slug}/messages`)
      .send({ phone: 'not a phone', text: 'hi' });
    expect(bad.status).toBe(400);
    const nobody = await request(ctx.app)
      .post('/simulator/whatsapp/nobody-here/messages')
      .send({ phone: '08031234567', text: 'hi' });
    expect(nobody.status).toBe(404);
  });
});

describe('bookForGuest: the guard behind every channel', () => {
  it('only an adult may come without an age; a child without one is refused, nothing held', async () => {
    const { bookForGuest } = await import('../src/lib/guest-booking.js');
    const { createQuoteService } = await import('../src/pricing/quote-service.js');
    const { operator } = await ctx.seedOperator();
    const tour = await ctx.prisma.product.findFirstOrThrow({
      where: { operatorId: operator.id, slug: 'lagos-island-heritage-walk' },
    });
    const departure = await ctx.prisma.departure.findFirstOrThrow({
      where: { productId: tour.id, startsAt: { gt: new Date() } },
      orderBy: { startsAt: 'asc' },
    });
    const deps = {
      prisma: ctx.prisma,
      quotes: createQuoteService({ prisma: ctx.prisma }),
      jobs: { scheduleHoldExpiry: async () => {} },
      log: { warn: () => {} },
    };
    const book = (/** @type {any[]} */ travellers) =>
      bookForGuest(deps, {
        operator,
        departureId: departure.id,
        channel: 'whatsapp',
        holdMinutes: 30,
        lead: { name: 'Adaeze Okafor', phone: '+2348031234567' },
        travellers,
      });

    await expect(
      book([
        { name: 'Adaeze Okafor', age: null, categoryKey: 'adult' },
        { name: '', age: null, categoryKey: 'child' },
      ]),
    ).rejects.toMatchObject({ code: 'AGE_REQUIRED' });
    expect(
      (await ctx.prisma.departure.findUniqueOrThrow({ where: { id: departure.id } })).seatsHeld,
    ).toBe(0);

    // With the age, it books; the age decides the price category.
    const ok = await book([
      { name: 'Adaeze Okafor', age: null, categoryKey: 'adult' },
      { name: '', age: 7, categoryKey: 'child' },
    ]);
    expect(ok.bookingId).toBeTruthy();
  });
});
