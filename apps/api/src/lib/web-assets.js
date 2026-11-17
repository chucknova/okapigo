// @ts-check
/**
 * web-assets.js — lets the API serve the BUILT guest web (apps/web/dist) in production.
 *
 * Why the API serves it: booking links (/irin-lagos-tours/…) must answer with server-made
 * HTML so link previews work (stage 11e). The guest web app then loads INSIDE that page. So
 * the API needs to know which files the app is made of. Vite writes them to a manifest:
 *
 *   dist/.vite/manifest.json   { "index.html": { file: "assets/index-BSGQF.js", css: [...] } }
 *
 * The file names contain a hash of their content ("index-BSGQF.js"). A changed file gets a
 * new name, so browsers may cache /assets/* FOREVER (immutable) and still never run stale
 * code: the page just asks for the new name.
 *
 * In development none of this is used: Vite's dev server (:5173) serves the app itself.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { escapeHtml } from '../routes/payments.js';

/**
 * @typedef {{ dir: string, scripts: string[], styles: string[] }} WebAssets
 *   dir: the dist folder · scripts / styles: URL paths to load on every guest page
 */

/**
 * Reads the build manifest. Returns null when the web app hasn't been built (tests, or an
 * API deployed without it): pages then keep their plain server-made body.
 * @param {string} distDir  e.g. apps/web/dist
 * @returns {WebAssets | null}
 */
export function loadWebAssets(distDir) {
  const manifestPath = join(distDir, '.vite', 'manifest.json');
  if (!existsSync(manifestPath)) return null;

  /** @type {Record<string, { file: string, css?: string[], imports?: string[], isEntry?: boolean }>} */
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const scripts = [];
  const styles = new Set();
  for (const chunk of Object.values(manifest)) {
    if (!chunk.isEntry) continue;
    scripts.push(`/${chunk.file}`);
    for (const css of chunk.css ?? []) styles.add(`/${css}`);
  }
  return { dir: distDir, scripts, styles: [...styles] };
}

/**
 * The tags that load the app, for a page's <head>. Escaped like everything else we put in
 * HTML, even though the names come from our own build.
 * @param {WebAssets} assets
 */
export function webAssetTags(assets) {
  return [
    ...assets.styles.map((href) => `<link rel="stylesheet" href="${escapeHtml(href)}">`),
    ...assets.scripts.map((src) => `<script type="module" src="${escapeHtml(src)}"></script>`),
  ].join('\n');
}
