/**
 * The token sets must meet WCAG 2.1 AA (PRD "Accessibility"), in light AND dark:
 *   text on its background ≥ 4.5:1 · controls and their edges ≥ 3:1.
 * When a redesigner changes a colour, this says at once if a pair stopped passing.
 */
import { describe, it, expect } from 'vitest';
import { LAGOON, STYLES, contrastRatio, tokensToCss, stylesToCss } from '../src/tokens.js';

describe('contrastRatio', () => {
  it('matches the WCAG reference values', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#FFFFFF')).toBeCloseTo(4.48, 2);
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBe(1);
  });
});

// [foreground, background, minimum]
const PAIRS = [
  ['text', 'bg', 4.5],
  ['text', 'surface', 4.5],
  ['text', 'surface-2', 4.5],
  ['text-muted', 'bg', 4.5],
  ['text-muted', 'surface', 4.5],
  ['text-muted', 'surface-2', 4.5],
  ['on-primary', 'primary', 4.5],
  ['primary-ink', 'surface', 4.5],
  ['primary-ink', 'bg', 4.5],
  ['primary-ink', 'primary-soft', 4.5],
  ['success', 'success-soft', 4.5],
  ['warning', 'warning-soft', 4.5],
  ['danger', 'danger-soft', 4.5],
  ['danger', 'surface', 4.5],
  ['strip-text', 'strip-bg', 4.5],
  // The letter mark: its letter on its square (a graphic: 3:1).
  ['mark-text', 'mark-bg', 3],
  // The confirmation band.
  ['band-text', 'band-bg', 4.5],
  ['band-text', 'band-surface', 4.5],
  ['band-muted', 'band-surface', 4.5],
  ['band-soft', 'band-bg', 4.5],
  ['band-line', 'band-bg', 3],
  // The trip hub (stage 12f): "TODAY" on the trip-day band, and the balance line on a card.
  ['band-accent', 'band-bg', 4.5],
  ['warning', 'surface', 4.5],
  // Disabled controls are exempt from WCAG, but people still need to read them.
  ['disabled-text', 'disabled-bg', 4.5],
  // Input and stepper edges: "non-text contrast" 3:1.
  ['border-strong', 'surface', 3],
  ['border-strong', 'bg', 3],
];

// Every website style (Lagoon, Classic, Earth), light and dark, meets the same targets.
for (const style of Object.values(STYLES)) {
  for (const mode of /** @type {const} */ (['light', 'dark'])) {
    describe(`${style.name} ${mode}: AA contrast`, () => {
      const c = style.color[mode];
      it.each(PAIRS)('%s on %s ≥ %s:1', (fg, bg, min) => {
        expect(contrastRatio(c[fg], c[bg])).toBeGreaterThanOrEqual(min);
      });
    });
  }
}

describe('every style', () => {
  it.each(Object.values(STYLES).map((s) => [s.name, s]))(
    '%s: light and dark define exactly Lagoon’s colour names, and every token family',
    (_name, style) => {
      const names = Object.keys(LAGOON.color.light).sort();
      expect(Object.keys(style.color.light).sort()).toEqual(names);
      expect(Object.keys(style.color.dark).sort()).toEqual(names);
      expect(Object.keys(style.radius).sort()).toEqual(Object.keys(LAGOON.radius).sort());
    },
  );
});

describe('tokensToCss', () => {
  it('writes every token as a custom property, dark values for both ways of choosing dark', () => {
    const css = tokensToCss(LAGOON);
    expect(css).toContain('--color-primary: #9BD10F;');
    expect(css).toContain('--text-2xl: 28px;');
    expect(css).toContain('--leading-2xl: 34px;');
    expect(css).toContain('--space-7: 48px;');
    expect(css).toContain('--radius-pill: 999px;');
    expect(css).toContain('--elevation-2: 0 12px 32px rgba(17, 21, 17, 0.16);');
    expect(css.match(/--color-primary: #B5E64A;/g)).toHaveLength(2); // system dark + forced dark
  });
});

describe('stylesToCss', () => {
  it('Lagoon on :root; Classic and Earth on their data-style, light and both kinds of dark', () => {
    const css = stylesToCss();
    expect(css).toContain(":root[data-style='classic'] {");
    expect(css).toContain(":root[data-style='earth'][data-mode='dark'] {");
    expect(css).toContain(":root[data-style='classic']:not([data-mode='light'])");
    expect(css).toContain('--font-family-heading: Georgia, "Times New Roman", serif;');
    expect(css).toContain('--radius-button: 999px;'); // Earth's pill buttons
    // Lagoon's own values are unchanged.
    expect(css.indexOf('--color-primary: #9BD10F;')).toBeLessThan(css.indexOf('classic'));
  });
});
