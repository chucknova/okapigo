// @vitest-environment node
/** tokens.css must be what packages/shared/src/tokens.js (CHAT) says: run `pnpm … tokens`. */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { chatTokensToCss } from '@okapigo/shared/tokens';

describe('tokens.css', () => {
  it('is up to date', () => {
    const css = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');
    expect(css).toBe(chatTokensToCss());
  });
});
