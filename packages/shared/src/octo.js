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
/** What's included, where to meet, labels, photos (17d-1). */
export const CAPABILITY_CONTENT = 'octo/content';
/** Where a van collects guests (17d-1). */
export const CAPABILITY_PICKUPS = 'octo/pickups';

// --- Content and pickups (17d-1) ------------------------------------------------------------

export const FEATURE_TYPES = /** @type {const} */ ([
  'INCLUSION',
  'EXCLUSION',
  'HIGHLIGHT',
  'PREARRIVAL_INFORMATION',
  'REDEMPTION_INSTRUCTION',
  'CANCELLATION_TERM',
  'BOOKING_TERM',
  'ACCESSIBILITY_INFORMATION',
]);

export const PlaceSchema = z.object({
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  postalAddress: z.object({
    streetAddress: nullableString,
    addressLocality: nullableString,
    addressRegion: nullableString,
    postalCode: nullableString,
    addressCountry: nullableString,
    postOfficeBoxNumber: nullableString,
  }),
});

/** The `content` capability's additions to a Product. */
export const ProductContentSchema = z.object({
  features: z.array(z.object({ shortDescription: z.string(), type: z.enum(FEATURE_TYPES) })),
  locations: z.array(
    z.object({
      title: z.string(),
      shortDescription: nullableString,
      types: z.array(z.string()),
      minutesTo: z.number().nullable(),
      minutesAt: z.number().nullable(),
      place: PlaceSchema,
    }),
  ),
  categoryLabels: z.array(z.string()),
  media: z.array(
    z.object({
      src: z.string(),
      type: z.string(),
      rel: z.enum(['LOGO', 'COVER', 'GALLERY']),
      title: nullableString,
      caption: nullableString,
      copyright: nullableString,
    }),
  ),
});

export const PickupLocationSchema = z.object({
  id: z.string(),
  title: z.string(),
  shortDescription: nullableString,
  place: PlaceSchema,
});

/** The `pickups` capability's additions to an Option. */
export const OptionPickupsSchema = z.object({
  pickupAvailable: z.boolean(),
  pickupRequired: z.boolean(),
  pickupLocations: z.array(PickupLocationSchema),
});

/** The `pickups` capability's additions to a Booking. */
export const BookingPickupsSchema = z.object({
  pickupRequested: z.boolean(),
  pickupLocationId: nullableString,
  pickupNotes: nullableString,
  localPickupDateTimeStart: localDateTime.nullable(),
  localPickupDateTimeEnd: localDateTime.nullable(),
  pickupLocation: PickupLocationSchema.nullable(),
});

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
  // The `pickups` capability (17d-1): which of the option's pickup locations. pickupPointId is
  // 17b's own name for the same id, still accepted.
  pickupRequested: z.boolean().optional(),
  pickupLocationId: z.string().optional(),
  pickupPointId: z.string().optional(),
  pickupNotes: z.string().max(500).optional(),
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

// --- Notifications (17c-2; OCTO's "notifications" capability) -------------------------------
// An OTA subscribes an address of its own; we POST there when a tour, its seats or one of its
// bookings changed, and it fetches the thing again. The spec spells the path
// "/notifications/subcriptions" (sic); we answer that and the correct spelling.

export const CAPABILITY_NOTIFICATIONS = 'notifications';

export const NOTIFICATION_TYPES = /** @type {const} */ ([
  'PRODUCT_UPDATE',
  'AVAILABILITY_UPDATE',
  'BOOKING_UPDATE',
]);

/** Headers we never send on an OTA's say-so (they'd break the request or impersonate). */
const RESERVED_HEADERS = new Set([
  'host',
  'content-type',
  'content-length',
  'transfer-encoding',
  'connection',
  'cookie',
]);

/** Headers the OTA wants on every notification (e.g. "Api-Key"): 10 at most, short. */
export const SubscriptionHeadersSchema = z
  .record(
    z
      .string()
      .regex(/^[A-Za-z0-9-]{1,64}$/, 'a header name: letters, digits and dashes')
      .refine((n) => !RESERVED_HEADERS.has(n.toLowerCase()), 'a header we set ourselves'),
    z
      .string()
      .max(512)
      .regex(/^[^\r\n]*$/, 'one line'),
  )
  .refine((h) => Object.keys(h).length <= 10, 'at most 10 headers');

/** POST /notifications/subscriptions */
export const SubscriptionBodySchema = z.object({
  url: z
    .string()
    .max(500)
    .regex(/^https?:\/\//, 'an http(s) address'),
  notificationTypes: z.array(z.enum(NOTIFICATION_TYPES)).min(1),
  headers: SubscriptionHeadersSchema.default({}),
});

/** PATCH /notifications/subscriptions/{id}: any of them. */
export const SubscriptionUpdateBodySchema = SubscriptionBodySchema.partial();

/** What we answer: the subscription. */
export const SubscriptionSchema = z.object({
  id: z.string(),
  url: z.string(),
  notificationTypes: z.array(z.enum(NOTIFICATION_TYPES)),
  headers: z.record(z.string(), z.string()),
});

/** What we POST to the OTA. */
export const NotificationSchema = z.object({
  id: z.string(),
  subscriptionId: z.string(),
  notificationType: z.enum(NOTIFICATION_TYPES),
  utcCreatedAt: utcDateTime,
  data: z.union([
    z.object({ productId: z.string() }).strict(),
    z
      .object({
        productId: z.string(),
        optionId: z.string(),
        localDateStart: isoDate,
        localDateEnd: isoDate,
      })
      .strict(),
    z.object({ uuid: z.string() }).strict(),
  ]),
});

/**
 * An address we may send notifications to. In production: https, and not this machine or a
 * private network, so an address can't be used to reach our own insides (SSRF). In
 * development, http://localhost is fine (the mock OTA runs there).
 * @param {string} url @param {boolean} production
 * @returns {{ ok: true, url: string } | { ok: false, problem: string }}
 */
export function checkNotificationUrl(url, production) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return { ok: false, problem: 'That isn’t a web address.' };
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    return { ok: false, problem: 'An address starting with https://' };
  }
  if (production) {
    const host = u.hostname.toLowerCase();
    const privateHost =
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      host.endsWith('.internal') ||
      /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
      host.startsWith('[');
    if (u.protocol !== 'https:' || privateHost) {
      return { ok: false, problem: 'Use a public https:// address.' };
    }
  }
  return { ok: true, url: u.toString() };
}

// --- Helpers shared by the API and the sync job (17c) -----------------------------------------

/**
 * A moment as local ISO 8601 with its offset: "2026-12-05T09:00:00+01:00" (OCTO's
 * localDateTimeStart). @param {Date} at @param {string} timeZone
 */
export function localIso(at, timeZone) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(at)
      .map((x) => [x.type, x.value]),
  );
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  const offset = Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
  const sign = offset < 0 ? '-' : '+';
  const abs = Math.abs(offset);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${sign}${hh}:${mm}`;
}

/**
 * How a departure stands, in OCTO's words: SOLD_OUT, LIMITED (under half left), AVAILABLE.
 * @param {number} left @param {number} capacity
 */
export const statusOf = (left, capacity) =>
  left <= 0 ? 'SOLD_OUT' : left * 2 < capacity ? 'LIMITED' : 'AVAILABLE';

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
