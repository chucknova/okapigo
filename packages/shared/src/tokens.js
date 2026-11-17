// @ts-check
/**
 * tokens.js — the design tokens: named values every guest screen is built from.
 *
 * Source: your "Lagoon" token sheet (docs/designs/00-tokens-lagoon.webp), with values read
 * from the design files where the sheet only describes them (shadows, disabled greys).
 *
 * WHY TOKENS: components never say "#9BD10F" or "16px". They say "color.primary" and
 * "radius.lg". The redesign after the MVP replaces THESE VALUES and the whole guest web
 * changes with it, without touching a single screen's logic. A website style (Classic, Earth,
 * stage 12g) is just another set of values for the same names.
 *
 * ONE SOURCE: this file. `pnpm --filter @okapigo/web tokens` writes them out as CSS custom
 * properties (apps/web/src/styles/tokens.css), and a test fails if that file is stale.
 * Emails (session 14) and the share-card image (12b) can read the same values from here.
 */

/**
 * @typedef {Record<string, string>} ColorSet  name → CSS colour
 * @typedef {{ light: ColorSet, dark: ColorSet }} Palette
 */

/** Lagoon: clean and bright, system sans, radius 16 / 12. The default style. */
export const LAGOON = {
  name: 'lagoon',
  color: /** @type {Palette} */ ({
    light: {
      bg: '#F4F6F3',
      surface: '#FFFFFF',
      'surface-2': '#EEF1EC',
      text: '#111511',
      'text-muted': '#4F584F',
      // Decorative only (dividers, card edges). Inputs and steppers use border-strong (3:1).
      border: '#DCE2D9',
      'border-strong': '#7A847A',
      primary: '#9BD10F',
      'on-primary': '#111511',
      // Primary as TEXT (links, selected states): the bright green fails contrast as text.
      'primary-ink': '#3F5A00',
      'primary-soft': '#F1FBD6',
      success: '#1E6B34',
      // The "Paid" chip's background (read from the design files; not on the sheet).
      'success-soft': '#DCF3D0',
      warning: '#7A4B00',
      'warning-soft': '#FFF1D1',
      danger: '#B42318',
      'danger-soft': '#FDECEA',
      // Disabled controls: grey fill, grey text, plus a reason in words nearby.
      'disabled-bg': '#E3E8E1',
      'disabled-text': '#5E675E',
      // The "Test mode · no real money moves" strip: dark on every screen, in both modes.
      'strip-bg': '#111511',
      'strip-text': '#EEF2EC',
      // The tour photo band's stand-in: thin diagonal lines on a pale green (tour page, 12b).
      'pattern-bg': '#E6EDE2',
      'pattern-line': '#DCE7D6',
    },
    dark: {
      bg: '#0E120E',
      surface: '#171C17',
      'surface-2': '#212821',
      text: '#EEF2EC',
      'text-muted': '#A9B3A8',
      border: '#2E362E',
      // ⚠ Not on the sheet (dark): filled in by Claude to the same contrast targets as light
      // (3:1 for controls, 4.5:1 for text). Listed in the 12a learning note for your review.
      'border-strong': '#7D877C',
      primary: '#B5E64A',
      'on-primary': '#111511',
      'primary-ink': '#C6F432',
      'primary-soft': '#26330D',
      success: '#7BD89A',
      'success-soft': '#163322',
      warning: '#F2B649',
      'warning-soft': '#3A2D10',
      danger: '#FF8A80',
      'danger-soft': '#3B1A17',
      'disabled-bg': '#2A312A',
      'disabled-text': '#A9B3A8',
      'strip-bg': '#000000',
      'strip-text': '#EEF2EC',
      'pattern-bg': '#1C231C',
      'pattern-line': '#252E25',
    },
  }),
  font: {
    // System fonts: 0 font files to download on checkout (the 300 KB budget).
    family: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    'family-heading':
      'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  },
  /** size / line height, in px */
  text: {
    xs: [12, 16],
    sm: [14, 20],
    md: [16, 24],
    lg: [18, 26],
    xl: [22, 28],
    '2xl': [28, 34],
  },
  weight: { regular: 400, semibold: 600, bold: 700 },
  /** px */
  space: { 1: 4, 2: 8, 3: 12, 4: 16, 5: 24, 6: 32, 7: 48 },
  /** px */
  radius: { sm: 8, md: 12, lg: 16, pill: 999 },
  border: { width: 1 },
  focus: { width: 2, offset: 2 },
  elevation: {
    1: '0 1px 2px rgba(17, 21, 17, 0.08)',
    2: '0 12px 32px rgba(17, 21, 17, 0.16)',
    // The sticky "Continue" bar at the bottom of checkout casts a shadow upwards.
    sticky: '0 -4px 16px rgba(17, 21, 17, 0.08)',
  },
  /** Controls are at least this tall (44 px tap targets, WCAG / PRD). */
  control: { height: 48, 'min-target': 44 },
};

/**
 * The CSS for a token set:
 *   :root { --color-bg: …; --text-md: 16px; … }                  light values (the default)
 *   @media (prefers-color-scheme: dark) { :root:not([data-mode="light"]) { … } }
 *   :root[data-mode="dark"] { … }                                  forced dark
 *
 * The page follows the phone's light/dark setting unless something sets data-mode on <html>
 * (the operator's chosen mode, stage 12g).
 *
 * @param {typeof LAGOON} set
 * @returns {string}
 */
export function tokensToCss(set) {
  /** @param {ColorSet} colors */
  const colorVars = (colors) =>
    Object.entries(colors)
      .map(([k, v]) => `  --color-${k}: ${v};`)
      .join('\n');

  const shared = [
    `  --font-family: ${set.font.family};`,
    `  --font-family-heading: ${set.font['family-heading']};`,
    ...Object.entries(set.text).flatMap(([k, [size, line]]) => [
      `  --text-${k}: ${size}px;`,
      `  --leading-${k}: ${line}px;`,
    ]),
    ...Object.entries(set.weight).map(([k, v]) => `  --weight-${k}: ${v};`),
    ...Object.entries(set.space).map(([k, v]) => `  --space-${k}: ${v}px;`),
    ...Object.entries(set.radius).map(([k, v]) => `  --radius-${k}: ${v}px;`),
    `  --border-width: ${set.border.width}px;`,
    `  --focus-width: ${set.focus.width}px;`,
    `  --focus-offset: ${set.focus.offset}px;`,
    ...Object.entries(set.elevation).map(([k, v]) => `  --elevation-${k}: ${v};`),
    ...Object.entries(set.control).map(([k, v]) => `  --control-${k}: ${v}px;`),
  ].join('\n');

  return `/* Generated from packages/shared/src/tokens.js (${set.name}). Don't edit by hand:
   run \`pnpm --filter @okapigo/web tokens\`. */
:root {
  color-scheme: light dark;
${shared}
${colorVars(set.color.light)}
}

@media (prefers-color-scheme: dark) {
  :root:not([data-mode='light']) {
${colorVars(set.color.dark).replaceAll('\n', '\n  ').replace(/^/, '  ')}
  }
}

:root[data-mode='dark'] {
${colorVars(set.color.dark)}
}
`;
}

/**
 * WCAG contrast ratio between two #RRGGBB colours (1 to 21). Used by the tests to prove
 * every text/background pair in a token set meets AA, in light AND dark.
 * @param {string} a
 * @param {string} b
 */
export function contrastRatio(a, b) {
  /** @param {string} hex */
  const luminance = (hex) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const lin = (/** @type {number} */ c) =>
      c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(bl);
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
