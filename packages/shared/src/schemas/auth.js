// @ts-check
/**
 * Zod schemas for the sign-up and sign-in requests.
 *
 * The API uses them to reject bad input with a clear 400. The future sign-in screens can
 * import the same schemas to show the same errors before the request is even sent.
 *
 * `.transform(...)` both VALIDATES and NORMALISES: after parsing, `contact` is no longer
 * the raw string the user typed but `{ channel, destination }` in canonical form.
 */
import { z } from 'zod';
import { parseContact } from '../contact.js';

/** One input field that accepts an email address or a phone number. */
export const ContactSchema = z
  .string()
  .trim()
  .min(1, 'Enter your email or phone number')
  .max(254)
  .transform((value, ctx) => {
    const contact = parseContact(value);
    if (!contact) {
      ctx.addIssue({ code: 'custom', message: 'Enter a valid email or phone number' });
      return z.NEVER; // tells Zod "parsing failed"; the value is never used
    }
    return contact;
  });

/** POST /auth/signup: a new tour business and its owner. */
export const SignupRequestSchema = z.object({
  businessName: z.string().trim().min(2).max(100),
  name: z.string().trim().min(2).max(100),
  contact: ContactSchema,
});

/** POST /auth/otp/request: "send me a sign-in code". */
export const OtpRequestSchema = z.object({
  contact: ContactSchema,
});

/** POST /auth/otp/verify: "here's the code I received". */
export const OtpVerifySchema = z.object({
  contact: ContactSchema,
  // Exactly six digits. A string, not a number, so a leading zero ("042917") survives.
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'The code is 6 digits'),
});
