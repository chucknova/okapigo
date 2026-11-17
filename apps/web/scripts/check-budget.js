// @ts-check
/**
 * The 300 KB budget (PRD NFR "Mobile": checkout's first load under 300 KB on throttled 3G).
 *
 * Runs after `vite build`. Reads dist/.vite/manifest.json to find everything the first page
 * load needs (the entry script, every script it imports up front, and their CSS), gzips each
 * file the way a server sends it, and FAILS the build if the total is over budget. A heavy
 * library added by mistake is caught here, not by a guest on a slow connection.
 *
 * Fonts: none (system fonts, 0 files). Photos aren't counted: they load after the page and
 * are optional (designs: "Photos are optional decoration").
 */
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

// OKG_BUDGET_KB lowers it on purpose, to prove the check really fails (see the 12a note).
export const BUDGET_BYTES = Number(process.env.OKG_BUDGET_KB ?? 300) * 1024;
const dist = new URL('../dist/', import.meta.url);

/** @type {Record<string, { file: string, css?: string[], imports?: string[], isEntry?: boolean }>} */
const manifest = JSON.parse(readFileSync(new URL('.vite/manifest.json', dist), 'utf8'));

/** Every file loaded up front: entries and their static imports (not lazy-loaded chunks). */
const files = new Set();
/** @param {string} key */
function collect(key) {
  const chunk = manifest[key];
  if (!chunk || files.has(chunk.file)) return;
  files.add(chunk.file);
  for (const css of chunk.css ?? []) files.add(css);
  for (const imported of chunk.imports ?? []) collect(imported);
}
for (const [key, chunk] of Object.entries(manifest)) if (chunk.isEntry) collect(key);

const rows = [...files].map((file) => {
  const bytes = readFileSync(new URL(file, dist));
  return { file, raw: bytes.length, gzip: gzipSync(bytes, { level: 9 }).length };
});
const total = rows.reduce((sum, r) => sum + r.gzip, 0);
const kb = (/** @type {number} */ n) => `${(n / 1024).toFixed(1)} KB`;

for (const r of rows) process.stdout.write(`  ${r.file}  ${kb(r.raw)} → ${kb(r.gzip)} gzip\n`);
process.stdout.write(
  `First load: ${kb(total)} of ${kb(BUDGET_BYTES)} (${Math.round((total / BUDGET_BYTES) * 100)}%)\n`,
);
if (total > BUDGET_BYTES) {
  process.stderr.write(`Over the ${kb(BUDGET_BYTES)} budget (PRD NFR "Mobile"). Find what grew.\n`);
  process.exit(1);
}
