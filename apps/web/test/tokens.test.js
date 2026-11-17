// @vitest-environment node
// (No browser needed: this test reads a file, and in the default browser-like environment
// import.meta.url isn't a file:// address.)
/**
 * src/styles/tokens.css is GENERATED from packages/shared/src/tokens.js. If someone changes a
 * token and forgets `pnpm --filter @okapigo/web tokens`, this fails and says so.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { LAGOON, tokensToCss } from '@okapigo/shared/tokens';

describe('tokens.css', () => {
  it('is up to date with packages/shared/src/tokens.js', () => {
    const onDisk = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');
    expect(onDisk, 'run: pnpm --filter @okapigo/web tokens').toBe(tokensToCss(LAGOON));
  });
});
