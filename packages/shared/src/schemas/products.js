// @ts-check
/**
 * Zod schemas for the catalogue: products, price categories and add-ons.
 *
 * These define the SHAPE of the JSONB columns (meetingPoint, stops, photos, ...), which the
 * database stores but doesn't check. Everything that writes product content goes through
 * these schemas, so the JSON in the database is always well-formed.
 *
 * Money fields are integer KOBO (see money.js) and end in "Kobo".
 */
import { z } from 'zod';
import { RESERVED_TOUR_SLUGS } from '../slug.js';

const text = (max) => z.string().trim().min(1).max(max);
/** Whole kobo, never negative. 0 is allowed (e.g. a free infant place). */
const kobo = z.number().int().nonnegative().max(2_000_000_000);

export const PRODUCT_STATUSES = /** @type {const} */ (['draft', 'published', 'archived']);

/** Where guests meet the guide. lat/lng put the pin on the trip hub map (GST-04). */
export const MeetingPointSchema = z.object({
  name: text(120),
  address: text(300),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  // How to find the guide once there: "Look for the guide in the green Ìrìn cap, by the
  // fountain." Optional (stage 12b).
  note: text(300).optional(),
});

export const StopSchema = z.object({
  name: text(120),
  description: z.string().trim().max(1000).default(''),
});

export const PhotoSchema = z.object({
  url: z.url(),
  // Required: screen readers read it aloud, and the PRD asks for WCAG 2.1 AA guest pages.
  alt: text(200),
});

export const PickupPointSchema = z.object({
  name: text(120),
  // Where exactly: a landmark people know ("Eko Hotel main gate").
  address: text(300),
  // When the van comes, local time "HH:MM" (stage 12c: "Eko Hotel main gate · 07:15").
  time: z
    .string()
    .regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, 'Use a time like 07:15')
    .optional(),
});

export const FaqSchema = z.object({ question: text(300), answer: text(2000) });

const productFields = {
  // Optional on create: derived from the title when missing ("Lagos Street Food Crawl" →
  // "lagos-street-food-crawl"). Must be URL-safe when given.
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and hyphens')
    .refine((s) => !RESERVED_TOUR_SLUGS.has(s), 'That word is reserved for booking pages'),
  title: text(120),
  summary: text(300),
  description: text(10_000),
  status: z.enum(PRODUCT_STATUSES),
  activityLabel: z.string().trim().min(1).max(40).nullable(),
  durationMinutes: z
    .number()
    .int()
    .min(15)
    .max(24 * 60 * 14),
  defaultCapacity: z.number().int().min(1).max(500),
  meetingPoint: MeetingPointSchema,
  stops: z.array(StopSchema).max(30),
  photos: z.array(PhotoSchema).max(20),
  pickupPoints: z.array(PickupPointSchema).max(20),
  faqs: z.array(FaqSchema).max(50),
  inclusions: z.array(text(200)).max(30),
  exclusions: z.array(text(200)).max(30),
  whatToBring: z.array(text(200)).max(30),
  // Which cancellation policy applies (BKG-26); null = none.
  cancellationPolicyId: z.uuid().nullable(),
  // Deposit share in basis points (3000 = 30%); null = pay in full (BKG-06).
  depositBasisPoints: z.number().int().min(1).max(9999).nullable(),
};

/** POST /api/products. Content lists default to empty; new products start as drafts. */
export const CreateProductSchema = z.object({
  ...productFields,
  slug: productFields.slug.optional(),
  status: productFields.status.default('draft'),
  stops: productFields.stops.default([]),
  photos: productFields.photos.default([]),
  pickupPoints: productFields.pickupPoints.default([]),
  faqs: productFields.faqs.default([]),
  inclusions: productFields.inclusions.default([]),
  exclusions: productFields.exclusions.default([]),
  whatToBring: productFields.whatToBring.default([]),
  cancellationPolicyId: productFields.cancellationPolicyId.default(null),
  depositBasisPoints: productFields.depositBasisPoints.default(null),
  activityLabel: productFields.activityLabel.default(null),
});

/** PATCH /api/products/:id. Any subset of fields; lists are replaced as a whole. */
export const UpdateProductSchema = z
  .object(productFields)
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'Send at least one field to change');

// --- Price categories (INV-05) -------------------------------------------------------

const priceCategoryFields = {
  key: z
    .string()
    .trim()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and hyphens'),
  name: text(50),
  minAge: z.number().int().min(0).max(120),
  maxAge: z.number().int().min(0).max(120).nullable(),
  amountKobo: kobo,
  sortOrder: z.number().int().min(0).max(1000),
  isActive: z.boolean(),
};

/** The upper age can't be below the lower one (the database checks this too). */
const ageRangeOk = (b) => b.maxAge == null || b.minAge == null || b.maxAge >= b.minAge;
const ageRangeMessage = { message: 'maxAge must be at least minAge', path: ['maxAge'] };

export const CreatePriceCategorySchema = z
  .object({
    ...priceCategoryFields,
    sortOrder: priceCategoryFields.sortOrder.default(0),
    isActive: priceCategoryFields.isActive.default(true),
  })
  .refine(ageRangeOk, ageRangeMessage);

/** The key is fixed once created (bookings will refer to it); everything else can change. */
export const UpdatePriceCategorySchema = z
  .object(priceCategoryFields)
  .omit({ key: true })
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'Send at least one field to change')
  .refine(ageRangeOk, ageRangeMessage);

// --- Add-ons (INV-10) ----------------------------------------------------------------

const addOnFields = {
  name: text(100),
  description: z.string().trim().max(500),
  priceKobo: kobo,
  // null = unlimited
  stockPerDeparture: z.number().int().min(0).max(10_000).nullable(),
  sortOrder: z.number().int().min(0).max(1000),
  isActive: z.boolean(),
};

export const CreateAddOnSchema = z.object({
  ...addOnFields,
  description: addOnFields.description.default(''),
  stockPerDeparture: addOnFields.stockPerDeparture.default(null),
  sortOrder: addOnFields.sortOrder.default(0),
  isActive: addOnFields.isActive.default(true),
});

export const UpdateAddOnSchema = z
  .object(addOnFields)
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'Send at least one field to change');
