/**
 * Stage 12a plumbing: the API reads the guest web's build manifest and serves its files.
 * Uses a tiny fake build in a temporary folder, so it doesn't depend on `vite build`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { loadWebAssets, webAssetTags } from '../src/lib/web-assets.js';
import { buildApp } from './helpers.js';

let dist;
beforeAll(() => {
  dist = mkdtempSync(join(tmpdir(), 'okg-web-'));
  mkdirSync(join(dist, '.vite'));
  mkdirSync(join(dist, 'assets'));
  writeFileSync(
    join(dist, '.vite', 'manifest.json'),
    JSON.stringify({
      'index.html': {
        file: 'assets/index-abc123.js',
        css: ['assets/index-def456.css'],
        isEntry: true,
      },
      // A lazily loaded chunk (like the gallery): never loaded up front.
      'src/gallery/Gallery.jsx': { file: 'assets/Gallery-zzz.js', isDynamicEntry: true },
    }),
  );
  writeFileSync(join(dist, 'assets', 'index-abc123.js'), 'console.log("app")');
});
afterAll(() => rmSync(dist, { recursive: true, force: true }));

describe('loadWebAssets', () => {
  it('finds the entry script and its CSS, but not lazy chunks', () => {
    expect(loadWebAssets(dist)).toEqual({
      dir: dist,
      scripts: ['/assets/index-abc123.js'],
      styles: ['/assets/index-def456.css'],
    });
  });

  it('is null when the web app was never built', () => {
    expect(loadWebAssets(join(dist, 'nope'))).toBeNull();
  });

  it('makes the tags for a page head', () => {
    expect(webAssetTags(loadWebAssets(dist))).toBe(
      '<link rel="stylesheet" href="/assets/index-def456.css">\n' +
        '<script type="module" src="/assets/index-abc123.js"></script>',
    );
  });
});

describe('GET /assets/*', () => {
  it('serves built files, cacheable for a year (their names change when they do)', async () => {
    const app = buildApp({ webAssets: loadWebAssets(dist) });

    const res = await request(app).get('/assets/index-abc123.js');

    expect(res.status).toBe(200);
    expect(res.text).toBe('console.log("app")');
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });

  it('answers a missing file with the normal 404, and nothing without a build', async () => {
    const built = buildApp({ webAssets: loadWebAssets(dist) });
    const unbuilt = buildApp();

    expect((await request(built).get('/assets/nope.js')).status).toBe(404);
    expect((await request(unbuilt).get('/assets/index-abc123.js')).status).toBe(404);
  });
});
