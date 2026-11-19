/**
 * Session 13c: changing, stopping, and when things run out (designs: branches; typed words).
 *   - "cancel" asks first: "No, carry on" picks up where you were; "Yes, stop" gives the seats back
 *   - "Change something" changes one part and comes straight back to a new summary
 *   - pickup points (Lekki): the area, the place and the time
 *   - a sold-out date is listed, and picking it says so
 *   - someone booked while we were chatting: "Book 1 seat" or "Choose another date"
 */
import { describe, it, expect, afterAll, afterEach } from 'vitest';
import { createTestContext } from './helpers.js';
import { chatHelpers } from './whatsapp-chat.js';

const ctx = createTestContext();
afterEach(() => ctx.cleanup());
afterAll(() => ctx.close());
const { guest, options, words, openDates, toSummary } = chatHelpers(ctx);

/** The held booking, its seats and its departure. @param {string} operatorId */
const held = (operatorId) =>
  ctx.prisma.booking.findFirstOrThrow({
    where: { operatorId, status: 'held' },
    include: { departure: true, travellers: true },
  });

describe('stopping (design: cancel)', () => {
  it('"cancel" asks first; "No, carry on" shows the summary again; "Yes, stop" releases the seats', async () => {
    const { operator } = await ctx.seedOperator();
    const g = guest(operator.slug);
    await toSummary(g, { tour: 'lagos-island-heritage-walk' });
    const { departure } = await held(operator.id);
    expect(departure.seatsHeld).toBe(2);

    const ask = await g.say('cancel');
    expect(words(ask)).toBe('Stop this booking? Your held seats will be released.');
    expect(options(ask).map((/** @type {any} */ b) => b.title)).toEqual([
      'Yes, stop',
      'No, carry on',
    ]);
    expect(words(await g.tap('carry_on'))).toContain('*Your booking*');

    await g.tap('cancel'); // the summary's own Cancel button asks too
    expect(words(await g.tap('stop'))).toBe(
      'Stopped. Nothing was booked or paid. Type menu any time to start again.',
    );
    const after = await ctx.prisma.departure.findUniqueOrThrow({ where: { id: departure.id } });
    expect(after.seatsHeld).toBe(0);
  });

  it('"cancel" before anything is held just asks, without mentioning seats', async () => {
    const { operator } = await ctx.seedOperator();
    const g = guest(operator.slug);
    await g.say('Hi');
    await g.tap('tours');
    await g.tap(openDates(await g.tap('tour:lagos-island-heritage-walk'))[0].id);
    expect(words(await g.say('cancel'))).toBe('Stop this booking?');
    expect(words(await g.tap('carry_on'))).toMatch(/How many adults \(13 or over\)\?$/);
  });
});

describe('changing one thing (design: change)', () => {
  it('the list offers only what this tour has', async () => {
    const { operator } = await ctx.seedOperator();
    const g = guest(operator.slug);
    await toSummary(g, { tour: 'lagos-island-heritage-walk' });
    const list = await g.tap('change');
    expect(words(list)).toBe('What would you like to change?');
    expect(list[0].button).toBe('Choose what');
    expect(options(list).map((/** @type {any} */ r) => r.title)).toEqual([
      'Date',
      'Travellers',
      'Name or email',
    ]);
  });

  it('travellers: ask who’s coming again, then straight to a new summary (one hold, not two)', async () => {
    const { operator } = await ctx.seedOperator();
    const g = guest(operator.slug);
    await toSummary(g, { tour: 'lagos-island-heritage-walk', adults: 2 });
    const first = await held(operator.id);
    await g.tap('change');
    expect(words(await g.tap('change:travellers'))).toMatch(/How many adults/);
    await g.tap('n:1');
    const summary = await g.tap('no');
    expect(words(summary)).toContain('1 adult · ₦25,000');
    expect(words(summary)).toContain('I’m holding your seat until');

    const now = await held(operator.id);
    expect(now.id).not.toBe(first.id);
    expect(now.leadName).toBe('Adaeze Okafor'); // other answers kept
    expect(now.departure.seatsHeld).toBe(1); // the old hold was given back
  });

  it('date: choose another, and the rest is kept', async () => {
    const { operator } = await ctx.seedOperator();
    const g = guest(operator.slug);
    await toSummary(g, { tour: 'lagos-street-food-crawl', extras: [['Palm wine sampler', 2]] });
    const first = await held(operator.id);
    await g.tap('change');
    const dates = await g.tap('change:date');
    const other = openDates(dates)[1];
    const summary = await g.tap(other.id);
    expect(words(summary)).toContain(other.title);
    expect(words(summary)).toContain('2 palm wine samplers · ₦8,000');
    const now = await held(operator.id);
    expect(now.departureId).not.toBe(first.departureId);
    expect(
      (await ctx.prisma.departure.findUniqueOrThrow({ where: { id: first.departureId } }))
        .seatsHeld,
    ).toBe(0);
  });
});

describe('extras', () => {
  it('one at a time, "Add another extra", and what’s left on that date', async () => {
    const { operator } = await ctx.seedOperator();
    const g = guest(operator.slug);
    const summary = await toSummary(g, {
      tour: 'lagos-street-food-crawl',
      extras: [
        ['Extra tasting plate', 1],
        ['Palm wine sampler', 2],
      ],
    });
    expect(words(summary)).toContain('1 extra tasting plate · ₦5,000');
    expect(words(summary)).toContain('2 palm wine samplers · ₦8,000');

    // Another guest sees one tasting plate fewer on that date.
    const h = guest(operator.slug, '0803 999 0000');
    await h.say('Hi');
    await h.tap('tours');
    const booking = await held(operator.id);
    const dates = await h.tap('tour:lagos-street-food-crawl');
    const same = openDates(dates).find((r) => r.id === `dep:${booking.departureId}`);
    await h.tap(same.id);
    const extras = await h.tap('n:1').then(() => h.tap('no'));
    expect(options(extras)[0].description).toMatch(/· 9 left$/);
  });
});

describe('extras that run out', () => {
  it('changing extras doesn’t count your own; another guest isn’t offered a sold-out one', async () => {
    const { operator } = await ctx.seedOperator();
    const g = guest(operator.slug);
    await toSummary(g, { tour: 'lagos-street-food-crawl', extras: [['Extra tasting plate', 10]] });
    const booking = await held(operator.id);

    // Changing extras: all 10 plates are still yours to choose.
    await g.tap('change');
    const mine = await g.tap('change:extras');
    expect(options(mine)[0]).toMatchObject({
      title: 'Extra tasting plate',
      description: expect.stringMatching(/· 10 left$/),
    });

    // Someone else on that date: no plates left, so they aren't offered.
    const h = guest(operator.slug, '0803 999 0000');
    await h.say('Hi');
    await h.tap('tours');
    const dates = await h.tap('tour:lagos-street-food-crawl');
    await h.tap(openDates(dates).find((r) => r.id === `dep:${booking.departureId}`).id);
    await h.tap('n:1');
    const extras = await h.tap('no');
    expect(options(extras).map((/** @type {any} */ r) => r.title)).toEqual([
      'Palm wine sampler',
      'No extras',
    ]);
  });
});

describe('pickup (design: Lekki)', () => {
  it('rows: the area, then the place and time; the choice is repeated with the time', async () => {
    const { operator } = await ctx.seedOperator();
    const g = guest(operator.slug);
    await g.say('Hi');
    await g.tap('tours');
    await g.tap(openDates(await g.tap('tour:lekki-nature-and-craft'))[0].id);
    await g.tap('n:1');
    const pickup = await g.tap('no');
    expect(words(pickup)).toBe('Where should the van pick you up? Pickup is included.');
    expect(pickup[0].button).toBe('Choose pickup point');
    expect(options(pickup).map((/** @type {any} */ r) => [r.title, r.description])).toEqual([
      ['Victoria Island', 'Eko Hotel main gate · 07:15'],
      ['Ikoyi', 'Falomo roundabout · 07:30'],
      ['Lekki Phase 1', 'Admiralty Way gate · 07:45'],
    ]);
    expect(words(await g.say('Ikoyi'))).toBe(
      'Pickup: Ikoyi, Falomo roundabout at 07:30. Please be there 5 minutes early.\n\nWhat name should the booking be under?',
    );
    await g.say('Adaeze Okafor');
    const summary = await g.tap('skip');
    expect(words(summary)).toContain('Pickup: Ikoyi, Falomo roundabout at 07:30');
  });
});

describe('when seats run out (design: few seats, sold out, seats ran out)', () => {
  it('a full date is listed as "Sold out"; picking it says so and lists the dates again', async () => {
    const { operator } = await ctx.seedOperator();
    const g = guest(operator.slug);
    await g.say('Hi');
    await g.tap('tours');
    const first = openDates(await g.tap('tour:lagos-island-heritage-walk'))[0];
    const d = await ctx.prisma.departure.update({
      where: { id: first.id.slice(4) },
      data: { seatsSold: 15 },
    });
    expect(d.capacity).toBe(15);
    await g.say('menu');
    const dates = await g.tap('tour:lagos-island-heritage-walk');
    const full = options(dates).find((/** @type {any} */ r) => r.id === first.id);
    expect(full.description).toBe('Sold out');
    const again = await g.tap(full.id);
    expect(words(again)).toBe(
      `Sorry, ${first.title.split(' · ')[0]} is sold out. Please choose another date.`,
    );
    expect(again[0].button).toBe('Choose a date');
  });

  it('few left: "Only 2 left"', async () => {
    const { operator } = await ctx.seedOperator();
    const g = guest(operator.slug);
    await g.say('Hi');
    await g.tap('tours');
    const first = openDates(await g.tap('tour:lagos-island-heritage-walk'))[0];
    await ctx.prisma.departure.update({
      where: { id: first.id.slice(4) },
      data: { seatsSold: 13 },
    });
    const dates = await g.say('menu').then(() => g.tap('tour:lagos-island-heritage-walk'));
    expect(options(dates).find((/** @type {any} */ r) => r.id === first.id).description).toBe(
      'Only 2 left',
    );
  });

  /** Fills a departure so only `left` seats remain, as if someone booked meanwhile. */
  const leaveOnly = async (/** @type {string} */ departureId, /** @type {number} */ left) => {
    const d = await ctx.prisma.departure.findUniqueOrThrow({ where: { id: departureId } });
    await ctx.prisma.departure.update({
      where: { id: departureId },
      data: { seatsSold: d.capacity - d.seatsHeld - left },
    });
  };

  /** Up to the email, on the first date; returns the departure id. @param {any} g */
  async function upToEmail(g, adults = 2) {
    await g.say('Hi');
    await g.tap('tours');
    const date = openDates(await g.tap('tour:lagos-island-heritage-walk'))[0];
    await g.tap(date.id);
    await g.tap(`n:${adults}`);
    await g.tap('no');
    await g.say('Adaeze Okafor');
    return { departureId: date.id.slice(4), date };
  }

  it('someone booked while we were chatting: "Book 1 seat" holds what’s left', async () => {
    const { operator } = await ctx.seedOperator();
    const g = guest(operator.slug);
    const { departureId, date } = await upToEmail(g);
    await leaveOnly(departureId, 1);
    const short = await g.tap('skip');
    expect(words(short)).toBe(
      `Sorry, someone booked while we were chatting. Only 1 seat is left on ${date.title.split(' · ')[0]} now, and you asked for 2.`,
    );
    expect(options(short).map((/** @type {any} */ b) => b.title)).toEqual([
      'Book 1 seat',
      'Choose another date',
      'Talk to a person',
    ]);
    const summary = await g.tap('shrink');
    expect(words(summary)).toContain('1 adult · ₦25,000');
  });

  it('…or "Choose another date": “I’ll keep your other answers”, then a new summary', async () => {
    const { operator } = await ctx.seedOperator();
    const g = guest(operator.slug);
    const { departureId } = await upToEmail(g);
    await leaveOnly(departureId, 1);
    await g.tap('skip');
    const dates = await g.tap('other_date');
    expect(words(dates)).toBe('No problem, I’ll keep your other answers.');
    const other = openDates(dates).find((/** @type {any} */ r) => r.id !== `dep:${departureId}`);
    const summary = await g.tap(other.id);
    expect(words(summary)).toContain('2 adults · ₦50,000');
    expect((await held(operator.id)).leadName).toBe('Adaeze Okafor');
  });
});
