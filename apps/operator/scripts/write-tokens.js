// @ts-check
/**
 * Writes the operator tokens (packages/shared/src/operator-tokens.js) out as CSS custom
 * properties: src/styles/tokens.css. Run after changing a token:
 *   pnpm --filter @okapigo/operator tokens
 * (test/tokens.test.js fails if the CSS file is out of date.)
 */
import { writeFileSync } from 'node:fs';
import { operatorTokensToCss } from '@okapigo/shared/operator-tokens';

const target = new URL('../src/styles/tokens.css', import.meta.url);
writeFileSync(target, operatorTokensToCss());
process.stdout.write(`wrote ${target.pathname}\n`);
