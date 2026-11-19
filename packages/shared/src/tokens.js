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
      // The dark band at the top of "Booking confirmed" (designs: file 02, screen D).
      'band-bg': '#111511',
      'band-surface': '#212821',
      'band-text': '#EEF2EC',
      'band-muted': '#A9B3A8',
      'band-soft': '#C9D1C8',
      'band-line': '#6E786D',
      // On the dark band, an accent ("TODAY" on the trip day). Lagoon: its bright primary.
      'band-accent': '#9BD10F',
      // The letter mark in the header ("Ì"): a square and its letter.
      'mark-bg': '#111511',
      'mark-text': '#9BD10F',
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
      'band-bg': '#000000',
      'band-surface': '#1B211B',
      'band-text': '#EEF2EC',
      'band-muted': '#A9B3A8',
      'band-soft': '#C9D1C8',
      'band-line': '#6E786D',
      'band-accent': '#B5E64A',
      'mark-bg': '#000000',
      'mark-text': '#B5E64A',
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
  radius: { sm: 8, md: 12, lg: 16, pill: 999, button: 12 },
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
 * A style built on Lagoon: the same names, its own values. Only what differs is written out,
 * and the tests check every style has exactly Lagoon's names and passes the same contrast.
 * @param {string} name
 * @param {{ color: Palette, font?: Partial<typeof LAGOON.font>, radius?: Partial<typeof LAGOON.radius> }} o
 * @returns {typeof LAGOON}
 */
function styleFrom(name, o) {
  return {
    ...LAGOON,
    name,
    color: o.color,
    font: { ...LAGOON.font, ...o.font },
    radius: { ...LAGOON.radius, ...o.radius },
  };
}

/**
 * Classic: calm, editorial, Georgia headings, radius 6 / 4 (designs: file 04).
 * ⚠ The design gives the main colours. Status colours, disabled greys and the band's
 * secondary shades are filled in by Claude to the same contrast targets (12g-1 note).
 */
export const CLASSIC = styleFrom('classic', {
  color: {
    light: {
      ...LAGOON.color.light,
      bg: '#FAF7F0',
      surface: '#FFFFFF',
      'surface-2': '#EFE8DA',
      text: '#1F1B16',
      'text-muted': '#5C5448',
      border: '#E6DFD2',
      'border-strong': '#8A7F6E',
      primary: '#0F4C5C',
      'on-primary': '#FFFFFF',
      'primary-ink': '#0F4C5C',
      'primary-soft': '#E4EFF1',
      'disabled-bg': '#ECE6DA',
      'disabled-text': '#5C5448',
      'pattern-bg': '#EFE8DA',
      'pattern-line': '#E6DFD2',
      'band-bg': '#1F1B16',
      'band-surface': '#2C2620',
      'band-text': '#F3EEE4',
      'band-muted': '#B8AE9E',
      'band-soft': '#D3CABB',
      'band-line': '#7A7063',
      'band-accent': '#8CC7D3',
      'mark-bg': '#0F4C5C',
      'mark-text': '#FFFFFF',
    },
    dark: {
      ...LAGOON.color.dark,
      bg: '#15130F',
      surface: '#1F1C17',
      'surface-2': '#2A2620',
      text: '#F3EEE4',
      'text-muted': '#B8AE9E',
      border: '#34302A',
      'border-strong': '#857B6C',
      // "Teal lightens to #8CC7D3 with dark text on buttons" (designs).
      primary: '#8CC7D3',
      'on-primary': '#0B1F24',
      'primary-ink': '#8CC7D3',
      'primary-soft': '#16303A',
      'disabled-bg': '#2A2620',
      'disabled-text': '#B8AE9E',
      'pattern-bg': '#1F1C17',
      'pattern-line': '#2A2620',
      'band-surface': '#1F1C17',
      'band-text': '#F3EEE4',
      'band-muted': '#B8AE9E',
      'band-soft': '#D3CABB',
      'band-line': '#7A7063',
      'band-accent': '#8CC7D3',
      'mark-bg': '#8CC7D3',
      'mark-text': '#0B1F24',
    },
  },
  font: { 'family-heading': 'Georgia, "Times New Roman", serif' },
  radius: { sm: 4, md: 4, lg: 6, button: 4 },
});

/**
 * Earth: warm and natural, system sans, radius 24 with pill buttons (designs: file 04).
 * ⚠ As for Classic: main colours from the design, the rest filled in to the same targets.
 */
export const EARTH = styleFrom('earth', {
  color: {
    light: {
      ...LAGOON.color.light,
      bg: '#F5EDE3',
      surface: '#FFFAF4',
      'surface-2': '#EFE3D4',
      text: '#2A1E16',
      'text-muted': '#6B5646',
      border: '#E5D6C5',
      'border-strong': '#8F7763',
      primary: '#A3431C',
      'on-primary': '#FFFFFF',
      'primary-ink': '#8A3615',
      'primary-soft': '#F2C48D',
      'disabled-bg': '#EAE0D3',
      'disabled-text': '#6B5646',
      'pattern-bg': '#EFE3D4',
      'pattern-line': '#E5D6C5',
      'band-bg': '#2A1E16',
      'band-surface': '#3A2C21',
      'band-text': '#F5E9DC',
      'band-muted': '#C2AA94',
      'band-soft': '#DCC8B4',
      'band-line': '#86705C',
      'band-accent': '#F2C48D',
      'mark-bg': '#A3431C',
      'mark-text': '#FFFFFF',
    },
    dark: {
      ...LAGOON.color.dark,
      bg: '#1A130E',
      surface: '#241A13',
      'surface-2': '#2F2219',
      text: '#F5E9DC',
      'text-muted': '#C2AA94',
      border: '#3A2C21',
      'border-strong': '#8F7763',
      // "Terracotta lifts to #E88A5B with dark text on it" (designs).
      primary: '#E88A5B',
      'on-primary': '#2A1206',
      'primary-ink': '#F0A47E',
      'primary-soft': '#3A2416',
      'disabled-bg': '#2F2219',
      'disabled-text': '#C2AA94',
      'pattern-bg': '#241A13',
      'pattern-line': '#2F2219',
      'band-surface': '#241A13',
      'band-text': '#F5E9DC',
      'band-muted': '#C2AA94',
      'band-soft': '#DCC8B4',
      'band-line': '#86705C',
      'band-accent': '#F0A47E',
      'mark-bg': '#E88A5B',
      'mark-text': '#2A1206',
    },
  },
  radius: { sm: 12, md: 12, lg: 24, button: 999 },
});

/** Every website style, by the name stored in operators.website_style. Lagoon is the default. */
export const STYLES = /** @type {const} */ ({ lagoon: LAGOON, classic: CLASSIC, earth: EARTH });
/** @typedef {keyof typeof STYLES} StyleName */
export const STYLE_NAMES = /** @type {StyleName[]} */ (Object.keys(STYLES));
/** light · dark · auto (follow the phone's setting). */
export const MODES = /** @type {const} */ (['auto', 'light', 'dark']);

/**
 * The CSS for ONE token set, under a selector (default `:root`, i.e. Lagoon):
 *   {sel} { --color-bg: …; --text-md: 16px; … }                         light (the default)
 *   @media (prefers-color-scheme: dark) { {sel}:not([data-mode="light"]) { … } }
 *   {sel}[data-mode="dark"] { … }                                         forced dark
 *
 * The page follows the phone's light/dark setting unless data-mode is set on <html> (the
 * operator's chosen mode, stage 12g).
 *
 * @param {typeof LAGOON} set
 * @param {string} [sel]
 * @returns {string}
 */
export function tokensToCss(set, sel = ':root') {
  /** @param {ColorSet} colors @param {string} pad */
  const colorVars = (colors, pad = '  ') =>
    Object.entries(colors)
      .map(([k, v]) => `${pad}--color-${k}: ${v};`)
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

  return `${sel} {
${sel === ':root' ? '  color-scheme: light dark;\n' : ''}${shared}
${colorVars(set.color.light)}
}

@media (prefers-color-scheme: dark) {
  ${sel}:not([data-mode='light']) {
${colorVars(set.color.dark, '    ')}
  }
}

${sel}[data-mode='dark'] {
${colorVars(set.color.dark)}
}
`;
}

/**
 * The whole tokens.css: Lagoon on :root, then each other style on :root[data-style="…"].
 * A style's selectors are more specific than Lagoon's, and come later, so they win; the
 * operator's style is set on <html> by the server (no flash) or the app (stage 12g).
 * @returns {string}
 */
export function stylesToCss() {
  const others = Object.values(STYLES).filter((s) => s !== LAGOON);
  return [
    `/* Generated from packages/shared/src/tokens.js. Don't edit by hand:
   run \`pnpm --filter @okapigo/web tokens\`. Lagoon is the default; the other website
   styles apply with <html data-style="…"> (stage 12g). */`,
    tokensToCss(LAGOON),
    ...others.map(
      (s) => `/* --- ${s.name} --- */\n${tokensToCss(s, `:root[data-style='${s.name}']`)}`,
    ),
  ].join('\n');
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

// ---------------------------------------------------------------------------------------------
// THE WHATSAPP SIMULATOR (stage 13c-2): a phone chat, not an operator's website, so it has its
// own small set, read from your chat designs (docs/designs/06-whatsapp/). Light only: it
// stands in for WhatsApp's own look, which the operator's style doesn't change.
// `pnpm --filter @okapigo/simulators tokens` writes apps/simulators/src/styles/tokens.css.
// ---------------------------------------------------------------------------------------------

export const CHAT = {
  color: {
    // Around the phone (desktop), the phone's edge, and the chat's background.
    page: '#E9EDE7',
    'phone-edge': '#C9CFC7',
    chat: '#ECEFE8',
    // The header: the operator's picture and name.
    header: '#111511',
    'header-text': '#EEF2EC',
    'header-muted': '#A9B3A8',
    avatar: '#9BD10F',
    'on-avatar': '#111511',
    // Bubbles: the guest's (mine), the bot's (theirs), a person from the team's.
    mine: '#DDF1B4',
    theirs: '#FFFFFF',
    staff: '#F1FBD6',
    text: '#111511',
    muted: '#4F584F',
    // Reply buttons, the list button, links and the staff member's name.
    action: '#3F5A00',
    // Day lines and events ("Tolu from Ìrìn joined").
    event: '#DCE2D9',
    'event-text': '#3B423B',
    // A link's preview card, the bar at the bottom, the text box.
    preview: '#F4F6F3',
    bar: '#F4F6F3',
    line: '#DCE2D9',
    input: '#FFFFFF',
    placeholder: '#5E675E',
    send: '#9BD10F',
    'on-send': '#111511',
    // A message that didn't send (not in the designs: the brief's "failed" state).
    danger: '#B42318',
    'danger-soft': '#FDECEA',
    // The list sheet's backdrop.
    scrim: 'rgba(17, 21, 17, 0.45)',
  },
  font: LAGOON.font.family,
  /** size / line height, in px (the designs: 15 bubbles, 14 labels, 13 previews, 12 events, 11 times) */
  text: {
    time: [11, 14],
    event: [12, 16],
    preview: [13, 18],
    label: [14, 20],
    body: [15, 21],
    name: [15, 20],
  },
  /** px */
  radius: { bubble: 12, tail: 4, button: 10, preview: 8, phone: 16, pill: 999 },
  /** px */
  size: { phone: 360, avatar: 36, control: 40, bubble: 290, mine: 250 },
};

/** The simulator's tokens as CSS custom properties (--chat-…). @returns {string} */
export function chatTokensToCss() {
  const lines = [
    ...Object.entries(CHAT.color).map(([k, v]) => `  --chat-${k}: ${v};`),
    `  --chat-font: ${CHAT.font};`,
    ...Object.entries(CHAT.text).flatMap(([k, [size, line]]) => [
      `  --chat-text-${k}: ${size}px;`,
      `  --chat-leading-${k}: ${line}px;`,
    ]),
    ...Object.entries(CHAT.radius).map(([k, v]) => `  --chat-radius-${k}: ${v}px;`),
    ...Object.entries(CHAT.size).map(([k, v]) => `  --chat-size-${k}: ${v}px;`),
  ];
  return `/* Generated from packages/shared/src/tokens.js (CHAT). Don't edit by hand:
   run \`pnpm --filter @okapigo/simulators tokens\`. */
:root {
  color-scheme: light;
${lines.join('\n')}
}
`;
}
