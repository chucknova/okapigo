/**
 * Stage 15c-1: the API serves the built operator app at /app/ (one origin with the API, so
 * the sign-in token needs no CORS). Its pages are drawn in the browser, so any /app/ page is
 * the app's index.html; the service worker is never cached, so a new version is picked up.
 */
import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp, createTestContext } from './helpers.js';

const ctx = createTestContext();
afterAll(() => ctx.close());

function built() {
  const dir = mkdtempSync(join(tmpdir(), 'okg-operator-'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>OkapiGo</title>');
  writeFileSync(join(dir, 'sw.js'), 'self.addEventListener("fetch", () => {})');
  writeFileSync(join(dir, 'precache.json'), '{"files":["./"]}');
  writeFileSync(join(dir, 'manifest.webmanifest'), '{"name":"OkapiGo"}');
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'assets', 'index-abc.js'), 'export {}');
  return buildApp({ prisma: ctx.prisma, operatorDir: dir });
}

describe('the operator app at /app/', () => {
  it('the app, at /app/ and at any of its pages; never cached, so updates arrive', async () => {
    const app = built();
    // /app goes to /app/ (the app's pages all sit under it).
    const bare = await request(app).get('/app');
    expect([bare.status, bare.headers.location]).toEqual([301, '/app/']);
    for (const path of ['/app/', '/app/sync', '/app/departures/123']) {
      const page = await request(app).get(path);
      expect(page.status, path).toBe(200);
      expect(page.text).toContain('<title>OkapiGo</title>');
      expect(page.headers['cache-control']).toBe('no-cache');
    }
  });

  it('its files: assets kept a year, the service worker and its list never cached, the manifest typed', async () => {
    const app = built();
    expect((await request(app).get('/app/assets/index-abc.js')).headers['cache-control']).toContain(
      'immutable',
    );
    expect((await request(app).get('/app/assets/gone-123.js')).status).toBe(404);
    const sw = await request(app).get('/app/sw.js');
    expect(sw.status).toBe(200);
    expect(sw.headers['cache-control']).toBe('no-cache');
    expect(sw.headers['content-type']).toMatch(/javascript/);
    expect((await request(app).get('/app/precache.json')).headers['cache-control']).toBe(
      'no-cache',
    );
    expect((await request(app).get('/app/manifest.webmanifest')).headers['content-type']).toMatch(
      /^application\/manifest\+json/,
    );
  });

  it('the API underneath still answers, and still needs sign-in', async () => {
    const app = built();
    expect((await request(app).get('/api/sync/package')).status).toBe(401);
    expect((await request(app).get('/health')).status).toBe(200);
  });

  it('without a build, /app is just not found', async () => {
    const app = buildApp({ prisma: ctx.prisma });
    expect((await request(app).get('/app/')).status).toBe(404);
  });
});
