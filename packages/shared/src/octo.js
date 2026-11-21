// @ts-check
/**
 * octo.js — the OCTO API's shapes (Open Connectivity for Tours, Activities and Attractions;
 * Core v1 and the pricing capability), as schemas: the CONTRACT our OCTO endpoints keep
 * (session 17, DST-01: "checked by contract tests"). Written from docs.octo.travel (read
 * 2026-11-21). The mock OTA (17d) reads our answers with the same schemas.
 *
 * Things the spec is strict about, kept here on purpose:
 *   - "required but nullable": the KEY must be there even when its value is null (zod: a
 *     `.nullable()` field that isn't `.optional()` fails when missing). E.g. Product.reference,
 *     Availability.vacancies, every SupplierContact field.
 *   - Availability.utcCutoffAt is required and never null.
 *   - Option.availabilityLocalStartTimes has at least one time.
 *   - UnitRestrictions has all seven keys.
 *   - Option.cancellationCutoffUnit is lowercase: hour, minute, day.
 *   - Pricing: integers in the currency's smallest unit; original ≥ retail.
 *
 * Schemas don't reject EXTRA fields: capabilities add fields, and OTAs must ignore unknown
 * ones. Where the docs contradict themselves (errors: "always 400" vs "403 for a bad key";
 * the pricing capability called "pricing" or "octo/pricing"), see the session 17 learning note.
 */
import { z } from 'zod';

const nullableString = z.string().nullable();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const localDateTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/, 'ISO 8601 with its offset');
const utcDateTime = z.iso.datetime({ offset: true });

export const CAPABILITY_PRICING = 'octo/pricing';

export const UNIT_TYPES = /** @type {const} */ ([
  'ADULT',
  'YOUTH',
  'CHILD',
  'INFANT',
  'FAMILY',
  'SENIOR',
  'STUDENT',
  'MILITARY',
  'OTHER',
]);
export const AVAILABILITY_STATUSES = /** @type {const} */ ([
  'AVAILABLE',
  'FREESALE',
  'SOLD_OUT',
  'LIMITED',
  'CLOSED',
]);
export const CONTACT_FIELDS = /** @type {const} */ ([
  'firstName',
  'lastName',
  'emailAddress',
  'phoneNumber',
  'country',
  'notes',
  'locales',
  'allowMarketing',
  'postalCode',
]);

// --- Pricing (capability) ---------------------------------------------------------------------

export const TaxSchema = z.object({
  name: z.string(),
  retail: z.number().int(),
  original: z.number().int(),
  net: z.number().int().nullable(),
});

export const PricingSchema = z
  .object({
    original: z.number().int(),
    retail: z.number().int(),
    net: z.number().int().nullable(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    currencyPrecision: z.number().int().min(0),
    includedTaxes: z.array(TaxSchema),
  })
  .refine((p) => p.original >= p.retail, 'original must be at least retail');

export const PricingUnitSchema = z
  .object({
    unitId: z.string(),
    original: z.number().int(),
    retail: z.number().int(),
    net: z.number().int().nullable(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    currencyPrecision: z.number().int().min(0),
    includedTaxes: z.array(TaxSchema),
  })
  .refine((p) => p.original >= p.retail, 'original must be at least retail');

// --- Supplier ---------------------------------------------------------------------------------

export const SupplierSchema = z.object({
  id: z.string(),
  name: z.string(),
  endpoint: z.url().refine((u) => !u.endsWith('/'), 'no trailing slash'),
  contact: z.object({
    website: nullableString,
    email: nullableString,
    telephone: nullableString.refine((t) => t === null || /^\+\d+$/.test(t), 'E.164'),
    address: nullableString,
  }),
});

// --- Products, options, units -----------------------------------------------------------------

export const UnitSchema = z.object({
  id: z.string(),
  internalName: z.string(),
  reference: nullableString,
  type: z.enum(UNIT_TYPES),
  requiredContactFields: z.array(z.enum(CONTACT_FIELDS)),
  restrictions: z.object({
    minAge: z.number().int(),
    maxAge: z.number().int(),
    idRequired: z.boolean(),
    minQuantity: z.number().int().nullable(),
    maxQuantity: z.number().int().nullable(),
    paxCount: z.number().int(),
    accompaniedBy: z.array(z.string()),
  }),
  title: nullableString.optional(),
  pricingFrom: z.array(PricingSchema).optional(),
});

export const OptionSchema = z.object({
  id: z.string(),
  default: z.boolean(),
  internalName: z.string(),
  reference: nullableString,
  availabilityLocalStartTimes: z.array(z.string().regex(/^\d{2}:\d{2}$/)).min(1),
  cancellationCutoff: z.string(),
  cancellationCutoffAmount: z.number().int(),
  cancellationCutoffUnit: z.enum(['hour', 'minute', 'day']),
  requiredContactFields: z.array(z.enum(CONTACT_FIELDS)),
  restrictions: z.object({
    minUnits: z.number().int().nullable(),
    maxUnits: z.number().int().nullable(),
  }),
  units: z.array(UnitSchema).min(1),
  pricingFrom: z.array(PricingSchema).optional(),
});

export const ProductSchema = z.object({
  id: z.string(),
  internalName: z.string(),
  reference: nullableString,
  locale: z.string(),
  timeZone: z.string().optional(),
  allowFreesale: z.boolean(),
  instantConfirmation: z.boolean(),
  instantDelivery: z.boolean(),
  availabilityRequired: z.boolean(),
  availabilityType: z.enum(['START_TIME', 'OPENING_HOURS']),
  deliveryFormats: z.array(z.enum(['PDF_URL', 'QRCODE', 'CODE128', 'PKPASS_URL'])),
  deliveryMethods: z.array(z.enum(['VOUCHER', 'TICKET'])),
  redemptionMethod: z.enum(['DIGITAL', 'PRINT', 'MANIFEST']),
  options: z.array(OptionSchema).min(1),
  title: z.string().optional(),
  shortDescription: nullableString.optional(),
  description: nullableString.optional(),
  durationMinutesFrom: z.number().int().optional(),
  durationMinutesTo: z.number().int().nullable().optional(),
  faqs: z.array(z.object({ question: z.string(), answer: z.string() })).optional(),
  defaultCurrency: z.string().optional(),
  availableCurrencies: z.array(z.string()).optional(),
  pricingPer: z.enum(['BOOKING', 'UNIT']).optional(),
});

// --- Availability -----------------------------------------------------------------------------

const OpeningHoursSchema = z.object({ from: z.string(), to: z.string() });

export const AvailabilitySchema = z.object({
  id: z.string(),
  localDateTimeStart: localDateTime,
  localDateTimeEnd: localDateTime,
  utcCutoffAt: utcDateTime,
  allDay: z.boolean(),
  available: z.boolean(),
  status: z.enum(AVAILABILITY_STATUSES),
  vacancies: z.number().int().nullable(),
  capacity: z.number().int().nullable(),
  maxUnits: z.number().int().nullable(),
  openingHours: z.array(OpeningHoursSchema),
  unitPricing: z.array(PricingUnitSchema).optional(),
  pricing: PricingSchema.optional(),
});

export const CalendarDaySchema = z.object({
  localDate: isoDate,
  available: z.boolean(),
  status: z.enum(AVAILABILITY_STATUSES),
  vacancies: z.number().int().nullable(),
  capacity: z.number().int().nullable(),
  openingHours: z.array(OpeningHoursSchema),
  unitPricingFrom: z.array(PricingUnitSchema).optional(),
  pricingFrom: z.array(PricingSchema).optional(),
});

// --- Requests (what an OTA sends) -------------------------------------------------------------

const UnitQuantitySchema = z.object({
  id: z.string(),
  quantity: z.number().int().min(0).max(100),
});

/** POST /availability: a date range, or availability ids. */
export const AvailabilityCheckBodySchema = z
  .object({
    productId: z.string(),
    optionId: z.string(),
    localDateStart: isoDate.optional(),
    localDateEnd: isoDate.optional(),
    availabilityIds: z.array(z.string()).min(1).max(100).optional(),
    units: z.array(UnitQuantitySchema).max(20).optional(),
    currency: z.string().optional(),
  })
  .refine(
    (b) =>
      Boolean(b.availabilityIds) !== Boolean(b.localDateStart && b.localDateEnd) &&
      Boolean(b.localDateStart) === Boolean(b.localDateEnd),
    'Send localDateStart and localDateEnd, or availabilityIds',
  );

/** POST /availability/calendar: a date range. */
export const AvailabilityCalendarBodySchema = z.object({
  productId: z.string(),
  optionId: z.string(),
  localDateStart: isoDate,
  localDateEnd: isoDate,
  units: z.array(UnitQuantitySchema).max(20).optional(),
  currency: z.string().optional(),
});

// --- Bookings (17b) --------------------------------------------------------------------------

export const BOOKING_STATUSES = /** @type {const} */ ([
  'ON_HOLD',
  'CONFIRMED',
  'EXPIRED',
  'CANCELLED',
  'REDEEMED',
  'PENDING',
  'REJECTED',
]);

/** Every key present; all but `locales` may be null. */
export const ContactSchema = z.object({
  fullName: nullableString,
  firstName: nullableString,
  lastName: nullableString,
  emailAddress: nullableString,
  phoneNumber: nullableString,
  locales: z.array(z.string()),
  postalCode: nullableString,
  country: nullableString,
  notes: nullableString,
});

const TicketSchema = z.object({
  redemptionMethod: z.enum(['DIGITAL', 'PRINT', 'MANIFEST']),
  utcRedeemedAt: nullableString,
  deliveryOptions: z.array(
    z.object({
      deliveryFormat: z.enum(['PDF_URL', 'QRCODE', 'CODE128', 'PKPASS_URL']),
      deliveryValue: z.string(),
    }),
  ),
});

export const UnitItemSchema = z.object({
  uuid: z.string(),
  resellerReference: nullableString,
  supplierReference: nullableString,
  unitId: z.string(),
  status: z.enum(BOOKING_STATUSES),
  utcRedeemedAt: utcDateTime.nullable(),
  contact: ContactSchema,
  ticket: TicketSchema.nullable(),
  pricing: PricingSchema.optional(),
});

export const BookingSchema = z.object({
  id: z.string(),
  uuid: z.string(),
  testMode: z.boolean(),
  resellerReference: nullableString,
  supplierReference: nullableString,
  status: z.enum(BOOKING_STATUSES),
  utcCreatedAt: utcDateTime,
  utcUpdatedAt: utcDateTime,
  utcExpiresAt: utcDateTime.nullable(),
  utcRedeemedAt: utcDateTime.nullable(),
  utcConfirmedAt: utcDateTime.nullable(),
  productId: z.string(),
  optionId: z.string(),
  cancellable: z.boolean(),
  cancellation: z
    .object({
      refund: z.enum(['FULL', 'PARTIAL', 'NONE']),
      reason: nullableString,
      utcCancelledAt: utcDateTime,
    })
    .nullable(),
  freesale: z.boolean(),
  availabilityId: nullableString,
  availability: AvailabilitySchema.nullable(),
  contact: ContactSchema,
  notes: nullableString,
  deliveryMethods: z.array(z.enum(['VOUCHER', 'TICKET'])),
  voucher: TicketSchema.nullable(),
  unitItems: z.array(UnitItemSchema),
  pricing: PricingSchema.optional(),
});

const BookingContactBodySchema = z.object({
  fullName: z.string().max(200).optional(),
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
  emailAddress: z.string().max(254).optional(),
  phoneNumber: z.string().max(40).optional(),
  locales: z.array(z.string()).optional(),
  postalCode: z.string().max(40).optional(),
  country: z.string().max(80).optional(),
  notes: z.string().max(1000).optional(),
});

/** POST /bookings: reserve (seats held). */
export const BookingReservationBodySchema = z.object({
  uuid: z.string().min(1).max(100).optional(),
  productId: z.string(),
  optionId: z.string(),
  availabilityId: z.string(),
  unitItems: z
    .array(z.object({ unitId: z.string(), uuid: z.string().min(1).max(100).optional() }))
    .min(1)
    .max(50),
  expirationMinutes: z.number().int().min(1).optional(),
  notes: z.string().max(1000).optional(),
  // The pickups capability, in part: which of the option's pickup points.
  pickupRequested: z.boolean().optional(),
  pickupPointId: z.string().optional(),
  currency: z.string().optional(),
});

/** POST /bookings/{uuid}/confirm */
export const BookingConfirmationBodySchema = z.object({
  contact: BookingContactBodySchema,
  resellerReference: z.string().max(100).optional(),
  emailReceipt: z.boolean().optional(),
  unitItems: z.array(z.object({ unitId: z.string(), uuid: z.string().optional() })).optional(),
});

/** POST /bookings/{uuid}/cancel */
export const BookingCancellationBodySchema = z.object({
  reason: z.string().max(500).optional(),
  force: z.boolean().optional(),
});

/** POST /bookings/{uuid}/extend */
export const BookingExtendBodySchema = z.object({
  expirationMinutes: z.number().int().min(1).optional(),
});

/** PATCH /bookings/{uuid}: here, the reference, the notes and the contact. */
export const BookingUpdateBodySchema = z.object({
  resellerReference: z.string().max(100).optional(),
  notes: z.string().max(1000).optional(),
  contact: BookingContactBodySchema.optional(),
  productId: z.string().optional(),
  optionId: z.string().optional(),
  availabilityId: z.string().optional(),
  unitItems: z.array(z.object({ unitId: z.string(), uuid: z.string().optional() })).optional(),
  expirationMinutes: z.number().int().min(1).optional(),
  emailReceipt: z.boolean().optional(),
});

// --- Errors -----------------------------------------------------------------------------------

export const ERROR_CODES = /** @type {const} */ ([
  'INVALID_PRODUCT_ID',
  'INVALID_OPTION_ID',
  'INVALID_UNIT_ID',
  'INVALID_AVAILABILITY_ID',
  'INVALID_BOOKING_UUID',
  'BAD_REQUEST',
  'UNPROCESSABLE_ENTITY',
  'INTERNAL_SERVER_ERROR',
  'UNAUTHORIZED',
  'FORBIDDEN',
]);

export const ErrorSchema = z.object({
  error: z.enum(ERROR_CODES),
  errorMessage: z.string(),
});
