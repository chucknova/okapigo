// @ts-check
/**
 * operator-tokens.js — the operator app's design tokens (your "Operator tokens v1", session 15).
 *
 * "Built for a guide in the sun, with one hand." The same token NAMES as the guest web
 * (tokens.js), with the differences your sheet lists:
 *   - body text (text.md) is 17 px, not 16
 *   - the main action is 56 px tall; nothing tappable is under 48 px
 *   - muted text is darker (#4A5349), for sunlight
 *   - a state is never colour alone: each has its own icon and word too (the components do that)
 *
 * Light only, on purpose: the app is used outdoors in daylight, and every design is light.
 *
 * ONE SOURCE: this file. `pnpm --filter @okapigo/operator tokens` writes it out as CSS custom
 * properties (apps/operator/src/styles/tokens.css); a test fails if that file is stale.
 */

export const OPERATOR = {
  color: /** @type {Record<string, string>} */ ({
    bg: '#F4F6F3',
    surface: '#FFFFFF',
    'surface-2': '#EEF1EC',
    text: '#111511',
    'text-muted': '#4A5349',
    // Ink on the light grey of a "Not yet" pill and an unselected tab.
    'text-soft': '#3B423B',
    border: '#DCE2D9',
    'border-strong': '#6E786D',
    // The edge of a phone-sized card on the grey frame (sign-in, first run).
    'border-frame': '#C9CFC7',
    primary: '#9BD10F',
    'on-primary': '#111511',
    'primary-ink': '#3F5A00',
    'primary-soft': '#F1FBD6',
    // Traveller states (Not yet · Present · Late · No-show): solid fills for Present and
    // No-show, so they read at arm's length in sunlight.
    'state-pending': '#EEF1EC',
    'state-pending-ink': '#3B423B',
    'state-present': '#1E6B34',
    'state-late': '#FFE3A3',
    'state-late-ink': '#5C3800',
    'state-no-show': '#B42318',
    // Payment chips: Paid · "₦45,500 still to pay" · cash reported (office to confirm).
    'success-soft': '#E3F3E6',
    success: '#1E6B34',
    'warning-soft': '#FFF1D1',
    warning: '#7A4B00',
    'info-soft': '#E8EEF8',
    info: '#1F3A6B',
    danger: '#B42318',
    'danger-soft': '#FDECEA',
    'disabled-bg': '#E3E8E1',
    'disabled-text': '#5E675E',
    // The connection strip: offline is the dark one on purpose ("impossible to miss").
    'sync-offline': '#111511',
    'sync-sending': '#F1FBD6',
    'sync-conflict': '#B42318',
    // "Can't reach OkapiGo", and "sign in again to send": amber.
    'sync-trouble': '#FFE3A3',
    'sync-trouble-ink': '#5C3800',
    // The "O" mark, and the scanner (O4, 15c-3).
    'mark-bg': '#111511',
    'mark-text': '#C6F432',
    'scanner-bg': '#1C201C',
    'scanner-muted': '#C9D1C8',
    // Behind a sheet or dialog.
    scrim: 'rgba(17, 21, 17, 0.55)',
  }),
  text: /** @type {Record<string, string>} */ ({
    '2xs': '13px',
    xs: '14px',
    sm: '15px',
    base: '16px',
    md: '17px',
    action: '18px',
    lg: '20px',
    xl: '24px',
    '2xl': '28px',
    display: '34px',
  }),
  size: /** @type {Record<string, string>} */ ({
    // Nothing tappable is under 48 px; the main action is 56.
    'tap-min': '48px',
    'tap-main': '56px',
    strip: '40px',
    gutter: '16px',
  }),
  radius: /** @type {Record<string, string>} */ ({
    chip: '8px',
    strip: '10px',
    input: '12px',
    button: '14px',
    card: '16px',
    'card-lg': '18px',
    sheet: '20px',
    pill: '999px',
  }),
  shadow: /** @type {Record<string, string>} */ ({
    dialog: '0 12px 32px rgba(17, 21, 17, 0.16)',
  }),
  font: /** @type {Record<string, string>} */ ({
    sans: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  }),
};

/** The tokens as CSS custom properties: --color-bg, --text-md, --radius-card… */
export function operatorTokensToCss() {
  const lines = [
    '/* Generated from packages/shared/src/operator-tokens.js. Do not edit. */',
    ':root {',
  ];
  for (const [group, values] of Object.entries(OPERATOR)) {
    for (const [name, value] of Object.entries(values))
      lines.push(`  --${group}-${name}: ${value};`);
  }
  lines.push('}', '');
  return lines.join('\n');
}
