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
    if (!phone) ctx.addIssue({ code: 'custom', message: 'Enter a valid phone number' });
    return phone ?? z.NEVER;
  })
  .nullish();

const name = z.string().trim().min(1, 'Enter a name').max(100);

/** The person paying: reachable by email or phone, and must accept the booking terms. */
export const LeadBookerSchema = z
  .object({
    name,
    email: OptionalEmail,
    phone: OptionalPhone,
    // Consent capture (PRD privacy): must be literally true to book.
    acceptTerms: z.literal(true, { error: 'Accept the booking terms to continue' }),
    marketingConsent: z.boolean().default(false),
  })
  .refine((l) => l.email || l.phone, {
    message: 'Give an email or a phone number',
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

/** POST /api/bookings/:id/status: the moves staff make directly. */
export const SetBookingStatusSchema = z.object({ status: z.enum(['completed', 'no_show']) });

/** GET /api/bookings?status=&departureId=&q=&page= */
export const ListBookingsQuerySchema = z.object({
  status: z.enum(BOOKING_STATUSES).optional(),
  departureId: z.uuid().optional(),
  // Search by reference ("ILT-7K4Q") or lead booker name/email/phone.
  q: z.string().trim().min(2).max(100).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});
