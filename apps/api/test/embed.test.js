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
      expect(csp).toContain('frame-ancestors https://irinlagostours.com http://localhost:4200');
      expect(csp).not.toContain("frame-ancestors 'self'");
      expect(csp).toContain("default-src 'self'"); // helmet's other rules are kept
      expect(res.headers['x-frame-options']).toBeUndefined();
      expect(res.text).toContain('data-embed');
      expect(res.text).toContain('<meta name="robots" content="noindex">');
    }
  });

  it('with no approved site, no site may frame them', async () => {
    const { operator } = await ctx.seedOperator();
    const res = await request(ctx.app).get(`/embed/${operator.slug}`);
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
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
  it('answers yes only for an approved Origin, to any site (CORS), and says nothing else', async () => {
    const { operator } = await approved(['irinlagostours.com']);
    const ask = (/** @type {string | undefined} */ origin) => {
      const r = request(ctx.app).get(`/public/${operator.slug}/embed-check`);
      return origin ? r.set('Origin', origin) : r;
    };
    const yes = await ask('https://irinlagostours.com');
    expect(yes.body).toEqual({ approved: true });
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
