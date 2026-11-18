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
 *
 * Stored as ONE JSON value (operators.site): read as a whole, never queried field by field.
 */
import { z } from 'zod';
import { normalizeEmail, normalizePhone } from '../contact.js';

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
