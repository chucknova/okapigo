// @ts-check
/**
 * The operator's business details for their one-page website (MKT-08, stage 12g-2).
 * Typed by the operator, shown to the public: every field has a length limit, and the site
 * hides any section whose content is missing (designs: file 04, "Missing optional content").
 *
 *   kind      "City and food tours"            hero eyebrow: "City and food tours · Lagos"
 *   tagline   "Walk Lagos with people who love it"     the hero's title
 *   intro     "Small groups, local guides, …"   under the title
 *   about     a short paragraph                 "About Ìrìn"
 *   whyUs     up to 3 { title, text }           "Why book with us"
 *   faqs      { question, answer }              "Questions" (each tour has its own FAQs too)
 *   email, address, socials                     "Get in touch" (phone and WhatsApp are
 *                                               their own fields, used by the trip hub too)
 *   hours     { opens: '08:00', closes: '20:00' } when the team answers chats (stage 13c),
 *                                               the same every day, local time
 *   logo      { url, small }                    beside the name everywhere (stage 19b-1)
 *   hero      { url, small, alt, credit }       the hero's photo (stage 19b-1)
 *
 * Stored as ONE JSON value (operators.site): read as a whole, never queried field by field.
 */
import { z } from 'zod';
import { normalizeEmail, normalizePhone } from '../contact.js';
import { PhotoSchema } from './products.js';

/**
 * The business's logo (stage 19b-1): a picture the app made from an upload, 512 px and a
 * 128 px copy for headers. Square works best; it's shown small.
 */
export const LogoSchema = z.object({ url: z.url(), small: z.url() });

/** Optional text: trimmed; empty means "not given" (null). @param {number} max */
const text = (max) =>
  z
    .string()
    .trim()
    .max(max, `Keep it under ${max} characters.`)
    .transform((v) => (v === '' ? null : v))
    .nullable();

export const SOCIAL_NETWORKS = /** @type {const} */ ([
  'instagram',
  'facebook',
  'x',
  'tiktok',
  'youtube',
]);

const HHMM = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, 'Use a time like 08:00');

export const SiteSchema = z.object({
  kind: text(60).optional(),
  tagline: text(80).optional(),
  intro: text(200).optional(),
  about: text(1500).optional(),
  whyUs: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(60),
        text: z.string().trim().min(1).max(160),
      }),
    )
    .max(3, 'Three points at most.')
    .optional(),
  faqs: z
    .array(
      z.object({
        question: z.string().trim().min(1).max(140),
        answer: z.string().trim().min(1).max(800),
      }),
    )
    .max(12, 'Twelve questions at most.')
    .optional(),
  email: z
    .string()
    .trim()
    .max(254)
    .transform((v, ctx) => {
      if (v === '') return null;
      const email = normalizeEmail(v);
      if (!email)
        ctx.addIssue({ code: 'custom', message: 'Enter an email like hello@example.com.' });
      return email ?? z.NEVER;
    })
    .nullable()
    .optional(),
  address: text(200).optional(),
  socials: z
    .array(
      z.object({
        network: z.enum(SOCIAL_NETWORKS),
        // https only: these become links on a public page.
        url: z.url({ protocol: /^https$/ }).max(300),
      }),
    )
    .max(SOCIAL_NETWORKS.length)
    .optional(),
  // The logo beside the name (header, checkout, posters, link previews) and the website's
  // hero photo (stage 19b-1). null removes one: the first letter, or the style's pattern.
  logo: LogoSchema.nullable().optional(),
  hero: PhotoSchema.nullable().optional(),
  hours: z
    .object({ opens: HHMM, closes: HHMM })
    // 'HH:MM' strings compare correctly as text. (Overnight hours aren't supported.)
    .refine((h) => h.opens < h.closes, 'Closing time must be after opening time.')
    .nullable()
    .optional(),
});

/** A phone or WhatsApp number for the site, normalised to +234…; '' or null clears it. */
export const SitePhoneSchema = z
  .string()
  .trim()
  .max(30)
  .transform((v, ctx) => {
    if (v === '') return null;
    const phone = normalizePhone(v);
    if (!phone) {
      ctx.addIssue({
        code: 'custom',
        message: 'Enter 11 digits like 0803 123 4567, or start with +234.',
      });
    }
    return phone ?? z.NEVER;
  })
  .nullable();

/**
 * The stored site, read back safely: anything not matching (older data, a hand edit) is
 * dropped rather than shown. Missing → {}.
 * @param {unknown} value
 * @returns {z.infer<typeof SiteSchema>}
 */
export function readSite(value) {
  const parsed = SiteSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : {};
}

// ---------------------------------------------------------------------------------------------
// APPROVED WEBSITES for the booking widget (BKG-01, stage 12h)
// ---------------------------------------------------------------------------------------------
// An operator lists the sites that may show their widget. People paste all sorts:
// "https://www.IrinLagosTours.com/tours/", "irinlagostours.com". Each is reduced to a host
// name (plus a port, for local testing only), so the list is one clear form.

/** At most this many: an operator's own site and a few partners (hotels, blogs). */
export const MAX_EMBED_DOMAINS = 10;

const HOST = /^(?:localhost|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63})(?::\d{2,5})?$/;

/**
 * "https://www.IrinLagosTours.com/tours/" → "www.irinlagostours.com". Null if it isn't a
 * website address (an email, a bare word, an IP address).
 * @param {string} input
 */
export function normalizeEmbedDomain(input) {
  const trimmed = input.trim().toLowerCase();
  // Drop a scheme and anything after the host (path, query, fragment).
  const host = trimmed.replace(/^[a-z]+:\/\//, '').split(/[/?#]/)[0];
  if (!HOST.test(host)) return null;
  // Ports only for local testing: a real website is on 443.
  if (host.includes(':') && !host.startsWith('localhost:')) return null;
  return host;
}

export const EmbedDomainsSchema = z
  .array(
    z
      .string()
      .max(260)
      .transform((v, ctx) => {
        const host = normalizeEmbedDomain(v);
        if (!host) ctx.addIssue({ code: 'custom', message: `“${v}” isn’t a website address.` });
        return host ?? z.NEVER;
      }),
  )
  .max(MAX_EMBED_DOMAINS, `${MAX_EMBED_DOMAINS} websites at most.`)
  .transform((list) => [...new Set(list)]);

/**
 * The Content-Security-Policy that lets ONLY these sites show the widget in a frame, and
 * OkapiGo's own pages ('self': the Embed page's live preview in Settings, 16e-1). With no
 * approved site, no other site may: the browser refuses, whatever the page does.
 * A real site is https; localhost (testing) is http.
 * @param {string[]} domains  already normalised
 */
export function frameAncestors(domains) {
  const sources = domains.map((d) => (d.startsWith('localhost') ? `http://${d}` : `https://${d}`));
  return `frame-ancestors ${["'self'", ...sources].join(' ')}`;
}

/**
 * Is a page at this Origin ("https://irinlagostours.com") one of the approved sites? The
 * same rule as frameAncestors, for embed.js to ask before showing anything.
 * @param {string[]} domains
 * @param {string | undefined} origin
 */
export function originApproved(domains, origin) {
  if (!origin) return false;
  let url;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  const host = url.host.toLowerCase();
  if (!domains.includes(host)) return false;
  return host.startsWith('localhost') ? url.protocol === 'http:' : url.protocol === 'https:';
}
