/**
 * Stage 12h-1 (API side): the booking widget.
 *   /embed.js                     the snippet's script: readable by other websites
 *   /embed/:operator(/:tour…)     frames only the approved websites may show (frame-ancestors)
 *   /public/:operator/embed-check "may THIS page show it?" from the browser's Origin
 *   PATCH /api/website            the approved list, cleaned up
 */
import { describe, it, expect, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { createTestContext } from './helpers.js';

const ctx = createTestContext();
afterEach(() => ctx.cleanup());
afterAll(() => ctx.close());

/** @param {string} token */
const owner = (token) => ({
  patch: (/** @type {string} */ url) =>
    request(ctx.app).patch(url).set('Authorization', `Bearer ${token}`),
});

async function approved(/** @type {string[]} */ domains) {
  const seeded = await ctx.seedOperator();
  const res = await owner(await ctx.tokenFor(seeded.owner.id))
    .patch('/api/website')
    .send({ embedDomains: domains });
  return { ...seeded, res };
}

describe('the approved websites', () => {
  it('are cleaned up as they’re saved, and a wrong one is refused with its name', async () => {
    const { res, owner: o } = await approved([
      'https://www.IrinLagosTours.com/tours/',
      'irinlagostours.com',
      'irinlagostours.com',
    ]);
    expect(res.status).toBe(200);
    expect(res.body.website.embedDomains).toEqual(['www.irinlagostours.com', 'irinlagostours.com']);

    const bad = await owner(await ctx.tokenFor(o.id))
      .patch('/api/website')
      .send({ embedDomains: ['irinlagostours.com', 'my site'] });
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.body)).toContain('“my site” isn’t a website address.');
  });
});

describe('the frames', () => {
  it('only the approved sites may frame them; the rest of the security policy stays', async () => {
    const { operator } = await approved(['irinlagostours.com', 'localhost:4200']);
    for (const path of [
      `/embed/${operator.slug}`,
      `/embed/${operator.slug}/lagos-island-heritage-walk`,
      `/embed/${operator.slug}/lagos-island-heritage-walk/book/who`,
    ]) {
      const res = await request(ctx.app).get(path);
      expect(res.status, path).toBe(200);
      const csp = res.headers['content-security-policy'];
      // The approved sites, and OkapiGo's own pages (Settings' preview, 16e-1); one rule only.
      expect(csp).toContain(
        "frame-ancestors 'self' https://irinlagostours.com http://localhost:4200",
      );
      expect(csp.match(/frame-ancestors/g)).toHaveLength(1);
      expect(csp).toContain("default-src 'self'"); // helmet's other rules are kept
      expect(res.headers['x-frame-options']).toBeUndefined();
      expect(res.text).toContain('data-embed');
      expect(res.text).toContain('<meta name="robots" content="noindex">');
    }
  });

  it('with no approved site, no other site may frame them (only OkapiGo’s own preview)', async () => {
    const { operator } = await ctx.seedOperator();
    const res = await request(ctx.app).get(`/embed/${operator.slug}`);
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'self';");
  });

  it('the ordinary pages still refuse to be framed anywhere', async () => {
    const { operator } = await approved(['irinlagostours.com']);
    const res = await request(ctx.app).get(`/${operator.slug}`);
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'self'");
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
  });

  it('an unknown business or tour is a 404; a made-up step is not ours', async () => {
    const { operator } = await ctx.seedOperator();
    expect((await request(ctx.app).get('/embed/nobody-here')).status).toBe(404);
    expect((await request(ctx.app).get(`/embed/${operator.slug}/no-such-tour`)).status).toBe(404);
    expect(
      (await request(ctx.app).get(`/embed/${operator.slug}/lagos-island-heritage-walk/book/x`))
        .status,
    ).toBe(404);
  });
});

describe('embed-check and embed.js', () => {
  it('answers yes only for an approved Origin, to any site (CORS), and never the list itself', async () => {
    const { operator } = await approved(['irinlagostours.com']);
    const ask = (/** @type {string | undefined} */ origin) => {
      const r = request(ctx.app).get(`/public/${operator.slug}/embed-check`);
      return origin ? r.set('Origin', origin) : r;
    };
    const yes = await ask('https://irinlagostours.com');
    expect(yes.body).toEqual({ approved: true, buttonRadius: 12 }); // + the button's corners (12h-2)
    expect(yes.headers['access-control-allow-origin']).toBe('*');
    expect((await ask('https://evil.example')).body).toEqual({ approved: false });
    expect((await ask('http://irinlagostours.com')).body).toEqual({ approved: false });
    expect((await ask(undefined)).body).toEqual({ approved: false });
  });

  it('embed.js may be loaded by other websites, and points at our own address', async () => {
    const res = await request(ctx.app).get('/embed.js');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/javascript/);
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(res.text).toContain('e.origin !== BASE || e.source !== frame.contentWindow');
    expect(res.text).toContain('/embed-check');
  });
});

describe('stage 12h-2', () => {
  /** A held booking through the public checkout, with the given attribution. */
  async function bookWith(/** @type {any} */ attribution) {
    const seeded = await ctx.seedOperator();
    const deps = (
      await request(ctx.app).get(
        `/public/${seeded.operator.slug}/tours/lagos-island-heritage-walk/departures`,
      )
    ).body.departures;
    const res = await request(ctx.app)
      .post(`/public/${seeded.operator.slug}/bookings`)
      .send({
        lead: { name: 'Tola Bello', email: 'tola@guest.example', acceptTerms: true },
        departureId: deps[0].id,
        travellers: [{ name: 'Tola Bello', age: 30 }],
        addOns: [],
        attribution,
      });
    return { ...seeded, res };
  }

  it('where a booking came from is kept, and staff see it', async () => {
    const attribution = {
      via: 'widget',
      host: 'irinlagostours.com',
      utm_source: 'instagram',
      utm_campaign: 'december',
    };
    const { res, manager, operator } = await bookWith(attribution);
    expect(res.status).toBe(201);
    const row = await ctx.prisma.booking.findFirstOrThrow({ where: { operatorId: operator.id } });
    expect(row.attribution).toEqual(attribution);
    const staff = await request(ctx.app)
      .get(`/api/bookings/${row.id}`)
      .set('Authorization', `Bearer ${await ctx.tokenFor(manager.id)}`);
    expect(staff.body.booking.attribution).toEqual(attribution);
  });

  it('none given → null; junk in a link is refused', async () => {
    const { res, operator } = await bookWith(undefined);
    expect(res.status).toBe(201);
    const row = await ctx.prisma.booking.findFirstOrThrow({ where: { operatorId: operator.id } });
    expect(row.attribution).toBeNull();

    for (const bad of [
      { utm_source: '<script>alert(1)</script>' },
      { utm_source: 'x'.repeat(101) },
      { via: 'carrier-pigeon' },
      { host: 'irin.com/path?q=1' },
      { email: 'tola@guest.example' }, // unknown keys aren't stored
    ]) {
      expect((await bookWith(bad)).res.status, JSON.stringify(bad)).toBe(400);
    }
  });

  it('embed-check gives the "Book now" button the style’s corners', async () => {
    const { operator, owner: o } = await approved(['irinlagostours.com']);
    const ask = () =>
      request(ctx.app)
        .get(`/public/${operator.slug}/embed-check`)
        .set('Origin', 'https://irinlagostours.com');
    expect((await ask()).body).toEqual({ approved: true, buttonRadius: 12 }); // Lagoon
    await owner(await ctx.tokenFor(o.id))
      .patch('/api/website')
      .send({ style: 'earth' });
    expect((await ask()).body).toEqual({ approved: true, buttonRadius: 999 }); // Earth: pills
  });
});
