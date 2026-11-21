// @ts-check
/**
 * settings.js — what Settings (O10) shows and checks, outside the screens (stage 16e).
 *
 *   SECTIONS             the menu: Website · Embed on your site · Messages · WhatsApp · Staff
 *                        and roles · Tours (built in four parts: 16e-1…16e-4)
 *   detailsForm…         the business details: from the server, checked, what's changed, what's
 *                        sent (designs: "Errors in a form": "2 things to fix before saving")
 *   stylePreview()       a style card's colours, from the same tokens the website uses
 *   embedSnippet()       the widget's snippet, exactly as an operator pastes it
 *   readableOn()         a text colour that stays readable on a chosen button colour
 */
import { STYLES } from '@okapigo/shared/tokens';
import { normalizeEmail, normalizePhone, formatPhoneForDisplay } from '@okapigo/shared/contact';

export const SECTIONS = /** @type {const} */ ([
  { key: 'website', label: 'Website', built: true },
  { key: 'embed', label: 'Embed on your site', built: true },
  { key: 'messages', label: 'Messages', built: false },
  { key: 'whatsapp', label: 'WhatsApp', built: false },
  { key: 'staff', label: 'Staff and roles', built: false },
  { key: 'tours', label: 'Tours', built: false },
]);

/** The longest each field may be (the server's limits: packages/shared/src/schemas/website.js). */
export const LIMITS = { tagline: 80, about: 1500, address: 200 };

/** The fields on the form, in order, with their labels (for "Unsaved changes: …"). */
export const DETAIL_FIELDS = /** @type {const} */ ([
  ['tagline', 'Tagline'],
  ['whatsapp', 'WhatsApp number'],
  ['about', 'About'],
  ['phone', 'Phone'],
  ['email', 'Email'],
  ['address', 'Address'],
  ['instagram', 'Instagram'],
]);

/** @typedef {{ tagline: string, whatsapp: string, about: string, phone: string, email: string, address: string, instagram: string }} DetailsForm */

/**
 * The form's starting values, from GET /api/website.
 * @param {any} w @returns {DetailsForm}
 */
export function detailsForm(w) {
  const insta = (w.site?.socials ?? []).find((/** @type {any} */ s) => s.network === 'instagram');
  return {
    tagline: w.site?.tagline ?? '',
    whatsapp: w.whatsapp ? formatPhoneForDisplay(w.whatsapp) : '',
    about: w.site?.about ?? '',
    phone: w.phone ? formatPhoneForDisplay(w.phone) : '',
    email: w.site?.email ?? '',
    address: w.site?.address ?? '',
    instagram: insta ? handleOf(insta.url) : '',
  };
}

/** "@irinlagostours" from "https://instagram.com/irinlagostours". @param {string} url */
const handleOf = (url) => {
  const m = /instagram\.com\/([A-Za-z0-9._]+)/.exec(url);
  return m ? `@${m[1]}` : url;
};

/**
 * "@irin.tours", "irin.tours" or an instagram.com link → the link; null if it isn't one.
 * @param {string} typed
 */
export function instagramUrl(typed) {
  const t = typed.trim();
  if (!t) return null;
  const fromLink = /^(?:https?:\/\/)?(?:www\.)?instagram\.com\/([A-Za-z0-9._]{1,30})\/?$/.exec(t);
  const handle = fromLink ? fromLink[1] : /^@?([A-Za-z0-9._]{1,30})$/.exec(t)?.[1];
  return handle ? `https://instagram.com/${handle}` : null;
}

/**
 * What's wrong, field by field, in the designs' words ("Too long: 66 of 60 characters. It's the
 * big title on your site."). Empty: nothing.
 * @param {DetailsForm} f @returns {Partial<Record<keyof DetailsForm, string>>}
 */
export function detailsErrors(f) {
  /** @type {Partial<Record<keyof DetailsForm, string>>} */
  const e = {};
  const tagline = f.tagline.trim().length;
  if (tagline > LIMITS.tagline)
    e.tagline = `Too long: ${tagline} of ${LIMITS.tagline} characters. It’s the big title on your site.`;
  if (f.about.trim().length > LIMITS.about)
    e.about = `Too long: ${f.about.trim().length} of ${LIMITS.about} characters.`;
  if (f.address.trim().length > LIMITS.address)
    e.address = `Too long: ${f.address.trim().length} of ${LIMITS.address} characters.`;
  const email = f.email.trim();
  if (email && !normalizeEmail(email)) {
    e.email = /@[^.@\s]+$/.test(email)
      ? 'This email is missing its ending, like .com.'
      : 'Enter an email like hello@example.com.';
  }
  for (const k of /** @type {const} */ (['phone', 'whatsapp'])) {
    if (f[k].trim() && !normalizePhone(f[k].trim()))
      e[k] = 'Enter 11 digits like 0803 123 4567, or start with +234.';
  }
  if (f.instagram.trim() && !instagramUrl(f.instagram))
    e.instagram = 'Enter your handle, like @irinlagostours.';
  return e;
}

/** "2 things to fix before saving" @param {number} n */
export const fixLine = (n) => `${n} ${n === 1 ? 'thing' : 'things'} to fix before saving`;

/**
 * The labels of the fields changed since the last save ("Unsaved changes: Tagline, Email").
 * @param {DetailsForm} f @param {DetailsForm} saved
 */
export const changedFields = (f, saved) =>
  DETAIL_FIELDS.filter(([k]) => f[k].trim() !== saved[k].trim()).map(([, label]) => label);

/**
 * What PATCH /api/website gets: only what changed; an emptied field clears it.
 * @param {DetailsForm} f @param {DetailsForm} saved
 */
export function detailsBody(f, saved) {
  const changed = (/** @type {keyof DetailsForm} */ k) => f[k].trim() !== saved[k].trim();
  /** @type {any} */
  const body = {};
  /** @type {any} */
  const site = {};
  if (changed('tagline')) site.tagline = f.tagline.trim();
  if (changed('about')) site.about = f.about.trim();
  if (changed('email')) site.email = f.email.trim();
  if (changed('address')) site.address = f.address.trim();
  if (changed('instagram')) {
    const url = instagramUrl(f.instagram);
    site.socials = url ? [{ network: 'instagram', url }] : [];
  }
  if (Object.keys(site).length) body.site = site;
  if (changed('phone')) body.phone = f.phone.trim();
  if (changed('whatsapp')) body.whatsapp = f.whatsapp.trim();
  return body;
}

/** "34 of 80 characters · the hero title" @param {string} text @param {number} max @param {string} [what] */
export const countLine = (text, max, what) =>
  `${text.trim().length} of ${max} characters${what ? ` · ${what}` : ''}`;

/**
 * A style card's look, from the website's own tokens: the hero, its title, the button.
 * @param {'lagoon' | 'classic' | 'earth'} name @param {boolean} dark
 */
export function stylePreview(name, dark) {
  const t = /** @type {any} */ (STYLES)[name];
  const c = dark ? t.color.dark : t.color.light;
  return {
    bg: c.bg,
    text: c.text,
    heroBg: c['band-bg'],
    heroText: c['band-text'],
    accent: c['band-accent'],
    button: c.primary,
    onButton: c['on-primary'],
    font: t.font['family-heading'] ?? t.font.family,
  };
}

/** The styles' names and descriptions (designs: "Clean and bright"…). */
export const STYLE_CHOICES = /** @type {const} */ ([
  { key: 'lagoon', name: 'Lagoon', desc: 'Clean and bright' },
  { key: 'classic', name: 'Classic', desc: 'Calm, editorial, serif' },
  { key: 'earth', name: 'Earth', desc: 'Warm and rounded' },
]);

/**
 * Under the style cards: what you're looking at.
 * @param {{ style: string, mode: string }} shown @param {{ style: string, mode: string }} live
 */
export function styleStatus(shown, live) {
  if (shown.style === live.style && shown.mode === live.mode) return 'This is your live style.';
  const name = STYLE_CHOICES.find((s) => s.key === shown.style)?.name ?? shown.style;
  return `Previewing ${name}, ${shown.mode}. Your checkout pages change too.`;
}

/** "Apply Classic dark" / "Applied" @param {{ style: string, mode: string }} shown @param {{ style: string, mode: string }} live */
export function applyLabel(shown, live) {
  if (shown.style === live.style && shown.mode === live.mode) return 'Applied';
  const name = STYLE_CHOICES.find((s) => s.key === shown.style)?.name ?? shown.style;
  return `Apply ${name} ${shown.mode}`;
}

// --- Embed ------------------------------------------------------------------------------------

/** Quotes and angle brackets, made safe inside an HTML attribute. @param {string} v */
const attr = (v) =>
  v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * The snippet to paste (embed.js, stage 12h): the operator, the tour (or all), and for a pop-up
 * button its words and colour.
 * @param {{ slug: string, tour: string | null, widget: 'inline' | 'button', label: string, colour: string, scriptUrl: string }} o
 */
export function embedSnippet({ slug, tour, widget, label, colour, scriptUrl }) {
  const attrs = [`data-okapigo="${attr(slug)}"`];
  if (tour) attrs.push(`data-tour="${attr(tour)}"`);
  if (widget === 'button') {
    attrs.push('data-widget="button"');
    if (label.trim()) attrs.push(`data-label="${attr(label.trim())}"`);
    attrs.push(`data-colour="${attr(colour)}"`);
  }
  return `<div ${attrs.join(' ')}></div>\n<script src="${attr(scriptUrl)}" async></script>`;
}

/**
 * Black or white text, whichever reads better on this colour (WCAG's relative luminance).
 * @param {string} hex  "#0F4C5C"
 */
export function readableOn(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return '#111511';
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = parseInt(m[1].slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // The same rule as embed.js (12h): contrast with white 1.05/(L+0.05); with #111511 (L+0.05)/0.0587.
  return 1.05 / (lum + 0.05) >= (lum + 0.05) / 0.0587 ? '#FFFFFF' : '#111511';
}

/** With no approved website, the widget shows nowhere (designs). @param {string[]} domains */
export const embedWarning = (domains) =>
  domains.length === 0 ? 'Add your website first, or the widget won’t show.' : null;

/**
 * May this person change a section? Website and Embed need marketing: edit (the owner; a
 * manager can look). @param {any} me @param {'marketing' | 'settings' | 'products'} area
 */
export const mayEdit = (me, area) => me?.permissions?.[area] === 'edit';

/** The line on a section someone can only look at. */
export const LOOK_ONLY = 'Only the owner can change this. You can look.';
