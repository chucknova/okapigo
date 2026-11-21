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
 *   message…             Messages (16e-2): the list, the editor's form, inserting a detail, what
 *                        a message must keep, the 24-hour rule in words
 *   whatsapp…            WhatsApp (16e-2): how it stands, the Phone number ID's check
 *   staff…               Staff and roles (16e-3): what each role may do, the invite's checks,
 *                        removing someone in words
 */
import { STYLES } from '@okapigo/shared/tokens';
import {
  normalizeEmail,
  normalizePhone,
  formatPhoneForDisplay,
  parseContact,
} from '@okapigo/shared/contact';
import { checkTemplate } from '@okapigo/shared/message-templates';

/** The menu; `needs` is the area a role must at least see (designs: "Managers and guides don't see Staff at all"). */
export const SECTIONS = /** @type {const} */ ([
  { key: 'website', label: 'Website', built: true, needs: 'marketing' },
  { key: 'embed', label: 'Embed on your site', built: true, needs: 'marketing' },
  { key: 'messages', label: 'Messages', built: true, needs: 'settings' },
  { key: 'whatsapp', label: 'WhatsApp', built: true, needs: 'channels' },
  { key: 'staff', label: 'Staff and roles', built: true, needs: 'settings' },
  { key: 'tours', label: 'Tours', built: true, needs: 'products' },
]);

/** The sections this person may open (a role with "none" for an area doesn't see it). @param {any} me */
export const visibleSections = (me) =>
  SECTIONS.filter((x) => (me?.permissions?.[x.needs] ?? 'none') !== 'none');

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
 * May this person change a section? Website and Embed need marketing: edit, Messages settings:
 * edit, WhatsApp channels: edit (the owner; a manager can look at Website, Embed and WhatsApp).
 * @param {any} me @param {'marketing' | 'settings' | 'products' | 'channels'} area
 */
export const mayEdit = (me, area) => me?.permissions?.[area] === 'edit';

/** The line on a section someone can only look at. */
export const LOOK_ONLY = 'Only the owner can change this. You can look.';

// --- Messages (16e-2) -------------------------------------------------------------------------

/** The details to insert, in staff's words (the chips above the editor). */
export const DETAIL_LABELS = /** @type {const} */ ({
  first_name: 'First name',
  operator: 'Business name',
  reference: 'Reference',
  tour: 'Tour',
  tour_short: 'Tour, short',
  date: 'Date',
  time: 'Time',
  meeting_point: 'Meeting point',
  travellers: 'Travellers',
  trip_url: 'Trip page link',
  deposit: 'Deposit',
  balance: 'Balance',
  due_date: 'Due date',
  pay_url: 'Pay link',
  amount: 'Amount',
  link_for: 'What it’s for',
  expiry: 'Expiry',
  link_url: 'Payment link',
  refund_line: 'Refund line',
  refund: 'Refund',
  from_date: 'Old date',
});

/** A placeholder's chip label ("Pay link"); an unknown one as it is. @param {string} name */
export const detailLabel = (name) => /** @type {any} */ (DETAIL_LABELS)[name] ?? name;

/**
 * The list (designs: each message, "Default" or "Edited"), from GET /api/message-templates.
 * @param {any} data
 */
export const messageRows = (data) =>
  data.templates.map((/** @type {any} */ t) => ({
    kind: t.kind,
    name: t.name,
    when: t.when,
    tag: t.custom ? 'Edited' : 'Default',
  }));

/** @typedef {{ subject: string, body: string }} MessageForm */

/** The words in force: the business's own, or OkapiGo's. @param {any} t @returns {MessageForm} */
export const messageForm = (t) => ({
  subject: (t.custom ?? t.default).subject,
  body: (t.custom ?? t.default).body,
});

/**
 * Puts {name} where the cursor is (replacing a selection), and says where the cursor goes next.
 * @param {string} text @param {{ start: number, end: number }} at @param {string} name
 */
export function insertDetail(text, { start, end }, name) {
  const token = `{${name}}`;
  const a = Math.max(0, Math.min(start, text.length));
  const b = Math.max(a, Math.min(end, text.length));
  return { text: text.slice(0, a) + token + text.slice(b), caret: a + token.length };
}

/**
 * What the message must keep (the link, the amount), each ticked or not ("Must keep: Pay link ✓").
 * @param {any} t @param {string} body
 */
export const mustKeep = (t, body) =>
  t.placeholders
    .filter((/** @type {any} */ p) => p.required)
    .map((/** @type {any} */ p) => ({
      name: p.name,
      label: detailLabel(p.name),
      kept: body.includes(`{${p.name}}`),
    }));

/** What's wrong, in staff's words (the shared rules, the server's too). @param {string} kind @param {MessageForm} f */
export const messageProblems = (kind, f) => checkTemplate(/** @type {any} */ (kind), f);

/** "Unsaved changes: Subject, Message" @param {MessageForm} f @param {MessageForm} saved */
export const messageChanges = (f, saved) =>
  [f.subject !== saved.subject ? 'Subject' : null, f.body !== saved.body ? 'Message' : null].filter(
    (x) => x !== null,
  );

/**
 * WhatsApp's 24-hour rule, for this message: who gets the wording above, who gets the approved one.
 * @param {any} t
 */
export const whatsappRule = (t) =>
  t.approved
    ? 'On WhatsApp, a guest who messaged you in the last 24 hours gets your wording. Anyone else gets the approved version below: WhatsApp only lets a business write first with wording Meta has approved. Email always uses your wording.'
    : 'On WhatsApp, only a guest who messaged you in the last 24 hours can get this. Email always uses your wording.';

/**
 * Meta's approved text, its gaps labelled ("{balance}" → "[Balance]"): read, not edited.
 * @param {string} text
 */
export const approvedText = (text) =>
  text.replace(/\{([a-z_]+)\}/g, (_, name) => `[${detailLabel(name)}]`);

/** Above the preview. @param {string | null} example "Funmi Adeyemi, ILT-3MZ8RB" */
export const exampleLine = (example) =>
  example
    ? `With a real booking: ${example}`
    : 'With a made-up booking (yours will show once you have one)';

/** After a test is sent. @param {string} to "0809 244 0014" */
export const testSentLine = (to) => `Sent to ${to}. Check your WhatsApp.`;

// --- WhatsApp (16e-2) -------------------------------------------------------------------------

/** The dot beside how it stands. @param {'simulator' | 'waiting' | 'connected'} state */
export const whatsappTone = (state) =>
  state === 'connected' ? 'success' : state === 'waiting' ? 'warning' : 'muted';

/**
 * The Phone number ID's check, as typed (the server's rule: digits only). null: fine.
 * @param {string} typed
 */
export function phoneIdError(typed) {
  const t = typed.trim();
  if (!t) return 'Paste the Phone number ID from Meta’s API Setup page.';
  if (!/^[0-9]{5,30}$/.test(t))
    return 'Paste the Phone number ID: digits only, from Meta’s API Setup page.';
  return null;
}

// --- Staff and roles (16e-3) ------------------------------------------------------------------

/** What each preset role may do (designs: under the invite form and in the edit sheet). */
export const ROLE_LINES = /** @type {Record<string, string>} */ ({
  owner: 'Everything, including prices, staff and settings.',
  manager: 'Schedule, bookings, refunds and inbox. Can’t change prices, tours’ policies or staff.',
  guide: 'Their own departures, manifests and check-in.',
});

/** A role's line; a role the business made itself says so. @param {any} role */
export const roleLine = (role) =>
  ROLE_LINES[role?.key] ?? 'A role your business made: it can do what its permissions say.';

/**
 * The roles in the menu's order (designs: Guide, Operations manager, Owner), then any the
 * business made. @param {any[]} roles
 */
export function roleChoices(roles) {
  const order = ['guide', 'manager', 'owner'];
  const rank = (/** @type {any} */ r) => (order.includes(r.key) ? order.indexOf(r.key) : 9);
  return [...roles].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/** The dot beside someone's status. @param {'active' | 'invited' | 'removed'} status */
export const staffTone = (status) =>
  status === 'active' ? 'success' : status === 'invited' ? 'warning' : 'muted';

/** "Dayo" from "Dayo Ogunleye". @param {string} name */
export const firstName = (name) => name.trim().split(/\s+/)[0] ?? name;

/** The invite form and the edit form: who, how they sign in, the role. @typedef {{ name: string, contact: string, roleId: string }} StaffForm */

/**
 * What's wrong, field by field (empty: nothing).
 * @param {StaffForm} f @returns {Partial<Record<keyof StaffForm, string>>}
 */
export function staffErrors(f) {
  /** @type {Partial<Record<keyof StaffForm, string>>} */
  const e = {};
  if (f.name.trim().length < 2) e.name = 'Enter their name.';
  else if (f.name.trim().length > 100) e.name = 'Keep the name under 100 characters.';
  if (!f.contact.trim()) e.contact = 'Enter the email or phone they’ll sign in with.';
  else if (!parseContact(f.contact.trim()))
    e.contact = 'Enter an email like dayo@example.com, or a phone like 0809 777 8899.';
  if (!f.roleId) e.roleId = 'Choose a role.';
  return e;
}

/** The edit form from someone's row. @param {any} row @returns {StaffForm} */
export const staffForm = (row) => ({ name: row.name, contact: row.contact, roleId: row.role.id });

/**
 * What PATCH /api/staff/:id gets: only what changed.
 * @param {StaffForm} f @param {StaffForm} saved
 */
export function staffBody(f, saved) {
  /** @type {Record<string, string>} */
  const body = {};
  if (f.name.trim() !== saved.name.trim()) body.name = f.name.trim();
  if (f.contact.trim() !== saved.contact.trim()) body.contact = f.contact.trim();
  if (f.roleId !== saved.roleId) body.roleId = f.roleId;
  return body;
}

/** Making someone an owner asks first (designs). @param {any[]} roles @param {StaffForm} f @param {StaffForm} saved */
export const becomesOwner = (roles, f, saved) =>
  f.roleId !== saved.roleId && roles.find((r) => r.id === f.roleId)?.key === 'owner';

/** The question before making someone an owner. */
export const OWNER_WARNING = 'Owners can change prices, staff and payouts.';

/**
 * "Remove Tolu's access?", in words (decided 2026-11-21: say it accurately). Removal is
 * instant; what was waiting on their phone is said, and a sync first is suggested.
 * @param {any} row
 */
export function removeWords(row) {
  const first = firstName(row.name);
  const n = row.upcoming.length;
  return {
    title: `Remove ${first}’s access?`,
    signOut: `${first} is signed out at once, on every phone. You can give access back later.`,
    waiting: row.waiting
      ? `${row.waiting}. Those don’t arrive once ${first} is removed: ask ${first} to open OkapiGo with signal first, or someone redoes them on the departure.`
      : null,
    departures:
      n === 0 ? null : `${n} upcoming ${n === 1 ? 'departure' : 'departures'} will have no guide:`,
    yes: n === 0 ? `Remove ${first}` : `Remove and show me ${n === 1 ? 'it' : 'those departures'}`,
    no: `Keep ${first}`,
  };
}

/**
 * After an invitation: what happened, in a line.
 * @param {{ how: 'email' | 'copy', to: string, problem: string | null }} invite
 */
export const inviteLine = (invite) =>
  invite.how === 'email'
    ? `Invitation emailed to ${invite.to}.`
    : (invite.problem ?? `Copy this and send it to ${invite.to} by WhatsApp or SMS:`);
