/**
 * Stage 18b: posters (MKT-01/02).
 *   GET /api/posters       the tours, their departures with seats (14 days), this weekend
 *   GET /api/posters/png   the poster: a real PNG of the right size, named for the tour
 */
import { describe, it, expect, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { createTestContext } from './helpers.js';

const ctx = createTestContext();
afterEach(() => ctx.cleanup());
afterAll(() => ctx.close());

/** A seeded business and a signed-in person of that role. @param {'manager' | 'owner' | 'guide'} role */
async function asRole(role = 'manager') {
  const s = await ctx.seedOperator();
  const user = role === 'guide' ? s.guides[0] : s[role];
  const token = await ctx.tokenFor(user.id);
  /** @param {string} url */
  const get = (url) =>
    request(ctx.app)
      .get(url)
      .set('Authorization', `Bearer ${token}`)
      .buffer(true)
      .parse((res, done) => {
        // Keep PNGs as bytes; JSON as text, parsed below.
        const chunks = /** @type {Buffer[]} */ ([]);
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      });
  return { ...s, get };
}
const json = (/** @type {any} */ res) => JSON.parse(res.body.toString());
/** A PNG's width and height, from its header. @param {Buffer} png */
const sizeOf = (png) => [png.readUInt32BE(16), png.readUInt32BE(20)];
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('the choices', () => {
  it('the tours on sale: a line each, departures with seats, this weekend’s count', async () => {
    const s = await asRole('manager');
    const res = await s.get('/api/posters');
    expect(res.status).toBe(200);
    const { tours, weekend } = json(res);
    const walk = tours.find((/** @type {any} */ t) => t.slug === 'lagos-island-heritage-walk');
    expect(walk).toMatchObject({
      title: 'Lagos Island Heritage Walk',
      posterTitle: 'Lagos Island Heritage Walk',
      meta: 'From ₦25,000 · 3 h · Daily 09:00',
    });
    expect(walk.departures.length).toBeGreaterThan(0);
    expect(walk.departures.length).toBeLessThanOrEqual(10);
    expect(walk.departures[0]).toMatchObject({
      id: expect.any(String),
      seatsLeft: expect.any(Number),
    });
    expect(walk.departures[0].when).toMatch(/^\w{3} \d{1,2} \w{3}, 09:00$/);
    expect(weekend.days.length).toBeGreaterThan(0);
    expect(weekend.count).toBeGreaterThan(0);
  });

  it('a full departure isn’t offered for “Seats left”', async () => {
    const s = await asRole('manager');
    const first = json(await s.get('/api/posters')).tours.find(
      (/** @type {any} */ t) => t.slug === 'lagos-island-heritage-walk',
    ).departures[0];
    const d = await ctx.prisma.departure.findUniqueOrThrow({ where: { id: first.id } });
    await ctx.prisma.departure.update({ where: { id: d.id }, data: { seatsSold: d.capacity } });
    const again = json(await s.get('/api/posters')).tours.find(
      (/** @type {any} */ t) => t.slug === 'lagos-island-heritage-walk',
    );
    expect(again.departures.map((/** @type {any} */ x) => x.id)).not.toContain(first.id);
  });

  it('the staff app may show the preview it fetched (a blob: image)', async () => {
    const s = await asRole('manager');
    const res = await s.get('/api/posters');
    expect(res.headers['content-security-policy']).toContain(
      "img-src 'self' data: blob: https://tile.openstreetmap.org",
    );
  });

  it('a guide can’t (posters are marketing)', async () => {
    const s = await asRole('guide');
    expect((await s.get('/api/posters')).status).toBe(403);
    expect((await s.get('/api/posters/png?template=weekend')).status).toBe(403);
  });
});

describe('the PNG', () => {
  it('New tour, square: a 1080 × 1080 PNG, named for the tour, never cached by the browser', async () => {
    const s = await asRole('manager');
    const walk = json(await s.get('/api/posters')).tours[1];
    const res = await s.get(`/api/posters/png?template=new_tour&productId=${walk.id}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.headers['content-disposition']).toBe(
      `attachment; filename="${walk.slug}-new-tour.png"`,
    );
    expect(res.body.subarray(0, 8)).toEqual(PNG_SIGNATURE);
    expect(sizeOf(res.body)).toEqual([1080, 1080]);
  });

  it('Offer as a story: 1080 × 1920, "-story" in the name; words over 30 characters refused', async () => {
    const s = await asRole('owner');
    const walk = json(await s.get('/api/posters')).tours[0];
    const res = await s.get(
      `/api/posters/png?template=offer&size=story&productId=${walk.id}&words=${encodeURIComponent('Festive season in Lagos')}`,
    );
    expect(res.status).toBe(200);
    expect(sizeOf(res.body)).toEqual([1080, 1920]);
    expect(res.headers['content-disposition']).toContain(`${walk.slug}-offer-story.png`);
    const long = await s.get(
      `/api/posters/png?template=offer&productId=${walk.id}&words=${'x'.repeat(31)}`,
    );
    expect(long.status).toBe(400);
    expect(long.body.toString()).toContain('Up to 30 characters.');
  });

  it('Seats left: a departure of that tour, with seats; not another tour’s, not a full one', async () => {
    const s = await asRole('manager');
    const list = json(await s.get('/api/posters')).tours;
    const [a, b] = list.filter((/** @type {any} */ t) => t.departures.length > 0);
    const ok = await s.get(
      `/api/posters/png?template=seats_left&productId=${a.id}&departureId=${a.departures[0].id}`,
    );
    expect(ok.status).toBe(200);
    expect(ok.headers['content-disposition']).toContain(`${a.slug}-seats-left.png`);
    const wrongTour = await s.get(
      `/api/posters/png?template=seats_left&productId=${a.id}&departureId=${b.departures[0].id}`,
    );
    expect(wrongTour.status).toBe(404);
    expect((await s.get(`/api/posters/png?template=seats_left&productId=${a.id}`)).status).toBe(
      404,
    );
    const d = await ctx.prisma.departure.findUniqueOrThrow({ where: { id: a.departures[0].id } });
    await ctx.prisma.departure.update({ where: { id: d.id }, data: { seatsSold: d.capacity } });
    const full = await s.get(
      `/api/posters/png?template=seats_left&productId=${a.id}&departureId=${d.id}`,
    );
    expect(full.status).toBe(409);
    expect(full.body.toString()).toContain('That departure is full.');
  });

  it('This weekend: the business’s own poster, no tour needed', async () => {
    const s = await asRole('manager');
    const res = await s.get('/api/posters/png?template=weekend&size=story');
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain(`${s.operator.slug}-weekend-story.png`);
  });

  it('This weekend with nothing on (every departure called off): refused in words', async () => {
    const s = await asRole('manager');
    await ctx.prisma.departure.updateMany({
      where: { operatorId: s.operator.id },
      data: { status: 'cancelled' },
    });
    const res = await s.get('/api/posters/png?template=weekend');
    expect(res.status).toBe(409);
    expect(res.body.toString()).toContain('Nothing on this weekend.');
  });

  it('another business’s tour, or one off sale: not found', async () => {
    const s = await asRole('manager');
    const other = await ctx.seedOperator();
    const theirs = await ctx.prisma.product.findFirstOrThrow({
      where: { operatorId: other.operator.id },
    });
    expect((await s.get(`/api/posters/png?template=new_tour&productId=${theirs.id}`)).status).toBe(
      404,
    );
    const mine = await ctx.prisma.product.findFirstOrThrow({
      where: { operatorId: s.operator.id },
    });
    await ctx.prisma.product.update({ where: { id: mine.id }, data: { status: 'draft' } });
    expect((await s.get(`/api/posters/png?template=new_tour&productId=${mine.id}`)).status).toBe(
      404,
    );
    expect((await s.get('/api/posters/png?template=new_tour')).status).toBe(404);
  });
});
