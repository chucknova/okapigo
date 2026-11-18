// @ts-check
/**
 * Writes the design tokens (packages/shared/src/tokens.js) out as CSS custom properties:
 * src/styles/tokens.css. Run after changing a token:  pnpm --filter @okapigo/web tokens
 * (test/tokens.test.js fails if the CSS file is out of date, so forgetting is caught.)
 */
import { writeFileSync } from 'node:fs';
import { stylesToCss } from '@okapigo/shared/tokens';

const target = new URL('../src/styles/tokens.css', import.meta.url);
writeFileSync(target, stylesToCss());
process.stdout.write(`wrote ${target.pathname}\n`);
