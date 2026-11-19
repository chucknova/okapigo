/**
 * Session 13: booking on WhatsApp, as your designs (docs/designs/06-whatsapp/), as scripted
 * chats through the simulator's API.
 *   - the happy path: Hi → tours (short names) → Street Food → a date → 2 adults → no one
 *     under 13 → a palm wine sampler → name → email → the summary, seats HELD 30 minutes
 *   - under-13s: how many, then each age; the price lines ("1 infant (1) · free, needs a seat")
 *   - typed words: help, menu, start again, numbers typed, groups over 20, "didn't catch that"
 *   - every reply fits WhatsApp's own limits; a conversation can only be read with its token
 */
import { describe, it, expect, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { createTestContext } from './helpers.js';
import { chatHelpers } from './whatsapp-chat.js';

const ctx = createTestContext();
afterEach(() => ctx.cleanup());
afterAll(() => ctx.close());
const { guest, options, words, openDates, toSummary } = chatHelpers(ctx);
const TIME = /\d\d:\d\d/;

describe('the happy path (design: Street Food, paid by bank transfer)', () => {
  it('Hi → tours → a date → 2 adults → an extra → name → email → the summary, seats held', async () => {
    const { operator } = await ctx.seedOperator();
    const g = guest(operator.slug);

    const hello = await g.say('Hi');
    expect(words(hello)).toBe(
      'Hi! I’m Ìrìn Lagos Tours’ booking assistant. I can show you our tours and book one for you here in the chat.',
    );
    expect(options(hello).map((/** @type {any} */ b) => b.title)).toEqual([
      'See tours',
      'Talk to a person',
    ]);

    const tours = await g.tap('tours');
    expect(words(tours)).toBe('Here are our 5 tours. Prices are per adult and include VAT.');
    // The website's catalogue order (by title), so both channels list tours the same way.
    expect(options(tours).map((/** @type {any} */ r) => r.title)).toEqual([
      'Badagry Day Trip',
      'Heritage Walk',
      'Street Food Crawl',
      'Lekki Nature & Craft',
      'Tarkwa Bay Beach Day',
    ]);
    expect(options(tours)[2].description).toMatch(/^from ₦35,000 · .+ · 3 h 30 min$/);

    // Typing the name works as well as tapping.
    const tour = await g.say('Street Food Crawl');
    expect(words(tour)).toBe(
      [
        '*Lagos Street Food Crawl*',
        'An evening of suya, boli, amala and puff-puff across Yaba and Surulere.',
        '3 h 30 min · from ₦35,000 per adult',
        'Free cancellation up to 48 hours before.',
        '',
        `All the details: http://localhost:4000/${operator.slug}/lagos-street-food-crawl`,
      ].join('\n'),
    );
    expect(tour[0].button).toBe('Choose a date');
    const date = openDates(tour)[0];
    expect(date.title).toMatch(/^(Thu|Fri|Sat) \d+ \w{3} · 18:30$/);
    expect(date.description).toBe('10 left');

    const adults = await g.tap(date.id);
    expect(words(adults)).toBe(
      `${date.title.replace(' · ', ' at ')}. 10 seats left.\n\nHow many adults (13 or over)?`,
    );
    expect(options(adults).map((/** @type {any} */ b) => b.title)).toEqual(['1', '2', '3 or more']);
    const under = await g.tap('n:2');
    expect(words(under)).toBe('Anyone under 13 coming too?');
    expect(options(under).map((/** @type {any} */ b) => b.title)).toEqual(['No', 'Yes']);

    const extras = await g.tap('no');
    expect(words(extras)).toBe('Would you like an extra?');
    expect(extras[0].button).toBe('See extras');
    expect(options(extras).map((/** @type {any} */ r) => [r.title, r.description])).toEqual([
      ['Extra tasting plate', expect.stringMatching(/^\+₦5,000 each · .* · 10 left$/)],
      ['Palm wine sampler', expect.stringMatching(/^\+₦4,000 each · .*/)],
      ['No extras', 'Continue without extras'],
    ]);
    const wine = options(extras)[1];
    expect(words(await g.tap(wine.id))).toMatch(
      /^How many palm wine samplers\? ₦4,000 each(, \d+ left)?\.$/,
    );
    const more = await g.tap('n:1');
    expect(words(more)).toBe('Added. Anything else?');
    expect(options(more).map((/** @type {any} */ b) => b.title)).toEqual([
      'Add another extra',
      'No, that’s all',
    ]);
    expect(words(await g.tap('done'))).toBe('What name should the booking be under?');
    expect(words(await g.say('Adaeze Okafor'))).toBe(
      'Thanks, Adaeze. An email for your receipt? Type it, or tap Skip.',
    );
    const summary = await g.say('adaeze.okafor@example.com');

    const lines = words(summary).split('\n');
    expect(lines.slice(0, 8)).toEqual([
      '*Your booking*',
      'Lagos Street Food Crawl',
      expect.stringMatching(/^(Thu|Fri|Sat) \d+ \w{3} · 18:30$/),
      'Meet at Yaba Tech main gate',
      '',
      '2 adults · ₦70,000',
      '1 palm wine sampler · ₦4,000',
      'Total ₦74,000 (includes ₦5,163 VAT)', // as in your design: 7.5% inside ₦74,000
    ]);
    expect(lines[9]).toMatch(/^Free cancellation until \w{3} \d+ \w{3}, 18:30\.$/);
    expect(lines[10]).toMatch(/^I’m holding your 2 seats until \d\d:\d\d \(30 minutes\)\.$/);
    expect(lines.at(-1)).toBe(
      `By tapping Pay you accept the booking terms: http://localhost:4000/${operator.slug}/lagos-street-food-crawl`,
    );
    expect(options(summary).map((/** @type {any} */ b) => b.title)).toEqual([
      'Pay ₦74,000',
      'Change something',
      'Cancel',
    ]);

    // In the database: a held WhatsApp booking for 30 minutes, the lead named, the email kept.
    const booking = await ctx.prisma.booking.findFirstOrThrow({
      where: { operatorId: operator.id },
      include: { hold: true, travellers: { orderBy: { position: 'asc' } } },
    });
    expect(booking).toMatchObject({
      status: 'held',
      channel: 'whatsapp',
      leadName: 'Adaeze Okafor',
      leadEmail: 'adaeze.okafor@example.com',
      leadPhone: '+2348031234567',
      totalKobo: 7_400_000,
    });
    const minutes = (booking.hold.expiresAt.getTime() - booking.hold.createdAt.getTime()) / 60_000;
    expect(Math.round(minutes)).toBe(30);
    expect(booking.travellers.map((t) => [t.name, t.age, t.categoryKey])).toEqual([
      ['Adaeze Okafor', null, 'adult'],
      ['', null, 'adult'],
    ]);
  });
});

describe('under 13 (design: children’s ages)', () => {
  it('how many, each age, then the lines: a child priced, an infant free but needing a seat', async () => {
    const { operator } = await ctx.seedOperator();
    const g = guest(operator.slug);
    await g.say('Hi');
    await g.tap('tours');
    const dates = await g.tap('tour:lagos-street-food-crawl');
    await g.tap(openDates(dates)[0].id);
    await g.tap('n:2');
    expect(words(await g.tap('yes'))).toBe(
      'How many under 13? Children must travel with an adult.',
    );
    expect(words(await g.tap('n:2'))).toBe(
      'How old is the first child? Type the age in years, 0 for a baby.',
    );
    expect(words(await g.say('8'))).toBe('And the second child?');
    const ok = await g.say('1');
    expect(ok[0].text).toBe(
      [
        'Got it:',
        '2 adults · ₦70,000',
        '1 child (8) · ₦20,000',
        '1 infant (1) · free, needs a seat',
      ].join('\n'),
    );
    expect(ok.at(-1).button).toBe('See extras'); // and on to the extras
  });

  it('an age of 13 or more is an adult; a typed word is asked again', async () => {
    const { operator } = await ctx.seedOperator();
    const g = guest(operator.slug);
    await g.say('Hi');
    await g.tap('tours');
    await g.tap(openDates(await g.tap('tour:lagos-island-heritage-walk'))[0].id);
    await g.tap('n:1');
    await g.tap('yes');
    await g.tap('n:1');
    expect(words(await g.say('14'))).toBe(
      'Please type an age under 13, like 8. (13 or over counts as an adult.)',
    );
    expect(words(await g.say('eight'))).toBe('Please type a number, like 4.');
    expect(words(await g.say('8'))).toContain('1 child (8) · ₦12,500');
  });

  it('under 13s with no adults: “Children must travel with an adult”, then the ages', async () => {
    const { operator } = await ctx.seedOperator();
    const g = guest(operator.slug);
    await g.say('Hi');
    await g.tap('tours');
    await g.tap(openDates(await g.tap('tour:lagos-island-heritage-walk'))[0].id);
    await g.tap('more');
    expect(words(await g.say('0'))).toBe('0 adults. Anyone under 13 coming too?');
    await g.tap('yes');
    const noAdult = await g.tap('n:1');
    expect(words(noAdult)).toBe(
      'Children must travel with an adult. How many adults (13 or over)?',
    );
    expect(words(await g.tap('n:1'))).toBe(
      'How old is the first child? Type the age in years, 0 for a baby.',
    );
    const ok = await g.say('7');
    expect(ok[0].text).toBe(['Got it:', '1 adult · ₦25,000', '1 child (7) · ₦12,500'].join('\n'));
  });
});

describe('nobody coming', () => {
  it('0 adults and no one under 13: asked for a number again', async () => {
    const { operator } = await ctx.seedOperator();
    const g = guest(operator.slug);
    await g.say('Hi');
    await g.tap('tours');
    await g.tap(openDates(await g.tap('tour:lagos-island-heritage-walk'))[0].id);
    await g.tap('more');
    await g.say('0');
    expect(words(await g.tap('no'))).toBe('Please type a number, like 4.');
  });
});

describe('typed words (design: words the bot understands)', () => {
  it('help, a question it can’t answer, "four", "4", groups over 20, start again', async () => {
    const { operator } = await ctx.seedOperator();
    const g = guest(operator.slug);
    const help = await g.say('help');
    expect(words(help)).toBe(
      'I can show you our tours and book one for you here. Tap a button, or type:\n• menu  • start again  • cancel  • person',
    );
    expect(words(await g.say('how far, abeg which one is best for this weekend'))).toBe(
      'Sorry, I didn’t catch that. I work best with the buttons. For advice, the Ìrìn team can help.',
    );
    await g.say('menu');
    await g.tap(openDates(await g.tap('tour:lagos-island-heritage-walk'))[0].id);
    await g.tap('more');
    expect(words(await g.say('four'))).toBe('Please type a number, like 4.');
    expect(words(await g.say('4'))).toBe('4 adults. Anyone under 13 coming too?');

    // Start over at "how many", then too many.
    await g.say('menu');
    await g.tap(openDates(await g.tap('tour:lagos-island-heritage-walk'))[0].id);
    await g.tap('more');
    const big = await g.say('25');
    expect(words(big)).toBe('For groups over 20 the team plans it with you directly.');
    expect(options(big).map((/** @type {any} */ b) => b.title)).toEqual([
      'Talk to a person',
      'Change the number',
    ]);
    expect(words(await g.tap('recount'))).toMatch(/How many adults \(13 or over\)\?$/);

    const again = await g.say('start again');
    expect(words(again)).toBe('Starting again. Nothing was booked.');
    expect(options(again).map((/** @type {any} */ b) => b.title)).toEqual([
      'See tours',
      'Talk to a person',
    ]);
  });

  it('lists understand a typed number or name; anything else: “Sorry, I didn’t catch that.” and the list again', async () => {
    const { operator } = await ctx.seedOperator();
    const g = guest(operator.slug);
    await g.say('Hi');
    await g.tap('tours');
    const wrong = await g.say('the boat one maybe');
    expect(wrong[0].text).toBe('Sorry, I didn’t catch that.');
    expect(wrong.at(-1).button).toBe('Choose a tour');
    expect(words(await g.say('3'))).toContain('*Lagos Street Food Crawl*');
  });
});

describe('the summary’s time', () => {
  it('shows the hold’s end in Lagos time', async () => {
    const { operator } = await ctx.seedOperator();
    const g = guest(operator.slug);
    const summary = await toSummary(g, { tour: 'lagos-island-heritage-walk', adults: 1 });
    expect(words(summary)).toMatch(
      new RegExp(`I’m holding your seat until ${TIME.source} \\(30 minutes\\)`),
    );
    expect(options(summary)[0].title).toBe('Pay ₦25,000');
  });
});

describe('a person, and privacy', () => {
  it('"person" asks for the team, with the opening hours; outside them, "the team is away"', async () => {
    const { operator } = await ctx.seedOperator();
    // Lagos time now, so the test doesn't depend on when it runs.
    const hh = Number(
      new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit',
        hourCycle: 'h23',
        timeZone: 'Africa/Lagos',
      }).format(new Date()),
    );
    const setHours = (/** @type {{ opens: string, closes: string }} */ hours) =>
      ctx.prisma.operator.update({
        where: { id: operator.id },
        data: { site: { .../** @type {object} */ (operator.site ?? {}), hours } },
      });

    await setHours({ opens: '00:00', closes: '23:59' });
    const g = guest(operator.slug);
    await g.say('hi');
    expect(words(await g.say('can I speak to a person please'))).toBe(
      'I’ve asked the Ìrìn team to join. They usually reply within a few minutes, 00:00–23:59. Until they reply, you can still type menu.',
    );
    const c = await ctx.prisma.conversation.findFirstOrThrow({
      where: { operatorId: operator.id },
    });
    expect(c.needsPersonSince).not.toBeNull();

    await setHours(
      hh < 22 ? { opens: '23:00', closes: '23:30' } : { opens: '00:00', closes: '00:30' },
    );
    expect(words(await g.tap('person'))).toMatch(
      /^The team is away now and back at (23|00):00\. I’ve passed on your message\.$/,
    );
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
