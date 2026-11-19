// @ts-check
/**
 * Writes the simulator's tokens (CHAT in packages/shared/src/tokens.js) out as CSS custom
 * properties: src/styles/tokens.css. Run after changing one:  pnpm --filter @okapigo/simulators tokens
 * (test/tokens.test.js fails if the CSS file is out of date.)
 */
import { writeFileSync } from 'node:fs';
import { chatTokensToCss } from '@okapigo/shared/tokens';

const target = new URL('../src/styles/tokens.css', import.meta.url);
writeFileSync(target, chatTokensToCss());
process.stdout.write(`wrote ${target.pathname}\n`);
