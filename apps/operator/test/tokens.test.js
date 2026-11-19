// @vitest-environment node
/** The operator tokens: the CSS file is up to date, and the sheet's rules hold. */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { OPERATOR, operatorTokensToCss } from '@okapigo/shared/operator-tokens';
import { contrastRatio } from '@okapigo/shared/tokens';

describe('operator tokens', () => {
  it('src/styles/tokens.css matches (run `pnpm --filter @okapigo/operator tokens`)', () => {
    expect(readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8')).toBe(
      operatorTokensToCss(),
    );
  });

  it('the sheet’s values: text.md 17, main action 56, nothing tappable under 48, darker muted text', () => {
    expect(OPERATOR.text.md).toBe('17px');
    expect(OPERATOR.size['tap-main']).toBe('56px');
    expect(OPERATOR.size['tap-min']).toBe('48px');
    expect(OPERATOR.color['text-muted']).toBe('#4A5349');
  });

  it('text pairs readable in sunlight (at least 4.5:1)', () => {
    const c = OPERATOR.color;
    for (const [fg, bg] of [
      [c.text, c.bg],
      [c['text-muted'], c.bg],
      [c['text-muted'], c.surface],
      [c['primary-ink'], c['primary-soft']],
      ['#FFFFFF', c['state-present']],
      [c['state-late-ink'], c['state-late']],
      ['#FFFFFF', c['state-no-show']],
      [c.warning, c['warning-soft']],
      [c.info, c['info-soft']],
      [c['on-primary'], c.primary],
      ['#FFFFFF', c['sync-offline']],
      [c['sync-trouble-ink'], c['sync-trouble']],
      [c['state-pending-ink'], c['state-pending']],
    ])
      expect(contrastRatio(fg, bg), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
  });
});
