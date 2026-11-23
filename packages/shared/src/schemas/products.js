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
import { MAX_TOUR_PHOTOS } from '../ready-to-sell.js';

const text = (max) => z.string().trim().min(1).max(max);
/** Whole kobo, never negative. 0 is allowed (e.g. a free infant place). */
const kobo = z.number().int().nonnegative().max(2_000_000_000);

export const PRODUCT_STATUSES = /** @type {const} */ (['draft', 'published', 'archived']);

/** How a tour travels (16b): on foot needs no vehicle; a van or a boat is assigned per departure. */
export const TRANSPORTS = /** @type {const} */ (['on_foot', 'van', 'boat']);

/**
 * Where guests meet the guide. lat/lng put the pin on the trip hub map (GST-04). Settings may
 * leave them out (16e-4: "paste a map link"): the server then uses the business's city and
 * marks the pin `approximate`, and the trip hub shows no map or directions until a real one.
 */
export const MeetingPointSchema = z.object({
  name: text(120),
  address: text(300),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  approximate: z.boolean().optional(),
  // How to find the guide once there: "Look for the guide in the green Ìrìn cap, by the
  // fountain." Optional (stage 12b).
  note: text(300).optional(),
});

export const StopSchema = z.object({
  name: text(120),
  description: z.string().trim().max(1000).default(''),
});

/**
 * One photo (stage 19b-1: uploads). `url` and `small` are pictures the app made from an upload
 * (@okapigo/media): a 1600 px copy and a 640 px one for cards. The API accepts only its own
 * pictures' addresses here, never a link to another site.
 */
export const PhotoSchema = z.object({
  url: z.url(),
  // The 640 px copy, for cards and phones. Optional: older photos have none (the page then
  // uses `url`).
  small: z.url().optional(),
  // Required: screen readers read it aloud, and the PRD asks for WCAG 2.1 AA guest pages.
  alt: text(200),
  // Who took it, for photos someone else took ("Sho photography, CC BY-SA 4.0"). Shown small
  // under the photo. Empty means none.
  credit: z
    .string()
    .trim()
    .max(120, 'Keep the credit under 120 characters.')
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional(),
});

export { MAX_TOUR_PHOTOS };

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
  // For WhatsApp's list rows (24 characters): "Heritage Walk". null = use the title.
  shortTitle: z.string().trim().min(1).max(24, 'Keep it to 24 characters.').nullable(),
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
  photos: z.array(PhotoSchema).max(MAX_TOUR_PHOTOS, `Up to ${MAX_TOUR_PHOTOS} photos a tour.`),
  pickupPoints: z.array(PickupPointSchema).max(20),
  faqs: z.array(FaqSchema).max(50),
  inclusions: z.array(text(200)).max(30),
  exclusions: z.array(text(200)).max(30),
  whatToBring: z.array(text(200)).max(30),
  // Which cancellation policy applies (BKG-26); null = none.
  cancellationPolicyId: z.uuid().nullable(),
  // Deposit share in basis points (3000 = 30%); null = pay in full (BKG-06).
  depositBasisPoints: z.number().int().min(1).max(9999).nullable(),
  // How it travels (16b; set in Settings › Tours, 16e-4): only that kind of vehicle can be
  // assigned to its departures.
  transport: z.enum(TRANSPORTS),
  // "Arrive by 08:50" on the trip page: minutes before the start; null hides the line.
  arriveMinutesEarly: z.number().int().min(0).max(120).nullable(),
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
  shortTitle: productFields.shortTitle.default(null),
  transport: productFields.transport.default('on_foot'),
  arriveMinutesEarly: productFields.arriveMinutesEarly.default(null),
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

/**
 * PUT /api/products/:id/price-categories (Settings › Tours › Prices, 16e-4b): the tour's prices
 * as a whole, in order. A category with an id is changed; one without is added (its key made
 * from its name); one left out is archived (bookings keep pointing at it).
 */
export const PutPriceCategoriesSchema = z.object({
  categories: z
    .array(
      z
        .object({
          id: z.uuid().optional(),
          name: priceCategoryFields.name,
          minAge: priceCategoryFields.minAge,
          maxAge: priceCategoryFields.maxAge,
          amountKobo: priceCategoryFields.amountKobo,
        })
        .refine(ageRangeOk, ageRangeMessage),
    )
    .max(12),
});

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

/**
 * PUT /api/products/:id/add-ons (Settings › Tours › Extras, 16e-4c): the tour's extras as a
 * whole, in order. With an id: changed; without: added; left out: archived (bookings keep them).
 */
export const PutAddOnsSchema = z.object({
  addOns: z
    .array(
      z.object({
        id: z.uuid().optional(),
        name: addOnFields.name,
        description: addOnFields.description.default(''),
        priceKobo: addOnFields.priceKobo,
        stockPerDeparture: addOnFields.stockPerDeparture,
      }),
    )
    .max(20),
});

export const UpdateAddOnSchema = z
  .object(addOnFields)
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'Send at least one field to change');
