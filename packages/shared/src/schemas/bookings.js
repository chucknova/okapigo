// @ts-check
/**
 * Zod schemas for bookings (BKG-23, BKG-25).
 *
 * The lead booker's email and phone go through the same normalisation as staff contacts
 * (contact.js), so "0803 123 4567" and "+2348031234567" are stored identically.
 */
import { z } from 'zod';
import { normalizeEmail, normalizePhone } from '../contact.js';
import { AddOnSelectionsSchema } from './pricing.js';
import { BOOKING_STATUSES } from '../booking-status.js';

/** Optional email, normalised; empty string counts as "not given". */
const OptionalEmail = z
  .string()
  .trim()
  .max(254)
  .transform((v, ctx) => {
    if (v === '') return null;
    const email = normalizeEmail(v);
    if (!email) ctx.addIssue({ code: 'custom', message: 'Enter a valid email address' });
    return email ?? z.NEVER;
  })
  .nullish();

/** Optional phone, normalised to +234…; empty string counts as "not given". */
const OptionalPhone = z
  .string()
  .trim()
  .max(30)
  .transform((v, ctx) => {
    if (v === '') return null;
    const phone = normalizePhone(v);
    // The checkout design's wording (stage 12d): it says what a valid number looks like.
    if (!phone) {
      ctx.addIssue({
        code: 'custom',
        message: 'Enter 11 digits like 0803 123 4567, or start with +234.',
      });
    }
    return phone ?? z.NEVER;
  })
  .nullish();

const name = z.string().trim().min(1, 'Enter a name').max(100);

/** A pickup point is chosen by name; createBooking checks it against the tour's list. */
export const PickupPointName = z.string().trim().min(1).max(100).nullish();

/** The person paying: reachable by email or phone, and must accept the booking terms. */
export const LeadBookerSchema = z
  .object({
    name,
    email: OptionalEmail,
    phone: OptionalPhone,
    // Consent capture (PRD privacy): must be literally true to book.
    acceptTerms: z.literal(true, { error: 'Tick this box to continue.' }),
    marketingConsent: z.boolean().default(false),
  })
  .refine((l) => l.email || l.phone, {
    message: 'Give an email or a phone number, or both.',
    path: ['email'],
  });

export const TravellerSchema = z.object({
  name,
  age: z.number().int().min(0).max(120),
  dietaryNeeds: z.string().trim().max(300).default(''),
  email: OptionalEmail,
  phone: OptionalPhone,
});

/** POST /api/bookings */
export const CreateBookingSchema = z.object({
  departureId: z.uuid(),
  lead: LeadBookerSchema,
  travellers: z.array(TravellerSchema).min(1, 'Add at least one traveller').max(50),
  addOns: AddOnSelectionsSchema,
  notes: z.string().trim().max(2000).default(''),
  // The NAME of one of the tour's pickup points (required on tours that have them).
  pickupPoint: PickupPointName,
});

/** PATCH /api/bookings/:id/travellers/:travellerId (age is not editable: that's an amendment) */
export const UpdateTravellerSchema = z
  .object({
    name,
    dietaryNeeds: z.string().trim().max(300),
    email: OptionalEmail,
    phone: OptionalPhone,
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'Send at least one field to change');

/**
 * POST /api/bookings/:id/status: the move staff make directly. (Cancelling and no-shows have
 * their own endpoints, because they work out refunds.)
 */
export const SetBookingStatusSchema = z.object({ status: z.enum(['completed']) });

/** GET /api/bookings?status=&departureId=&q=&page= */
export const ListBookingsQuerySchema = z.object({
  status: z.enum(BOOKING_STATUSES).optional(),
  departureId: z.uuid().optional(),
  // Search by reference ("ILT-7K4Q") or lead booker name/email/phone.
  q: z.string().trim().min(2).max(100).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});

/**
 * POST /public/:operatorSlug/bookings: the guest checkout (stage 11b).
 * Like the staff version, plus each traveller's chosen CATEGORY from the "who's coming"
 * counters, so the server can say "Children are 3–12. For age 13, choose Adult." No notes:
 * staff notes are internal.
 */
/**
 * Where a guest booking came from (BKG-01 "UTM codes carry into the booking", stage 12h-2):
 * the website or the widget, the widget's host site, and the campaign codes from the address
 * the guest arrived at (?utm_source=instagram&utm_campaign=december). Typed by nobody we
 * trust (they're in a link), so short plain text only, and unknown keys are refused.
 */
const utm = z
  .string()
  .trim()
  .max(100)
  .regex(/^[\p{L}\p{N} ._\-+:/]*$/u, 'Letters, numbers and . _ - + : / only.');
export const AttributionSchema = z
  .object({
    via: z.enum(['website', 'widget']).optional(),
    // The host page's name, for the widget ("irinlagostours.com"): no path, no query.
    host: z
      .string()
      .trim()
      .max(255)
      .regex(/^[a-z0-9.-]+(:\d{2,5})?$/i)
      .optional(),
    utm_source: utm.optional(),
    utm_medium: utm.optional(),
    utm_campaign: utm.optional(),
    utm_term: utm.optional(),
    utm_content: utm.optional(),
  })
  .strict();

export const PublicCreateBookingSchema = z.object({
  departureId: z.uuid(),
  lead: LeadBookerSchema,
  travellers: z
    .array(TravellerSchema.extend({ categoryKey: z.string().trim().min(1).max(50).optional() }))
    .min(1, 'Add at least one traveller')
    .max(20, 'For groups over 20, please contact the operator'),
  addOns: AddOnSelectionsSchema,
  pickupPoint: PickupPointName,
  attribution: AttributionSchema.optional(),
});
