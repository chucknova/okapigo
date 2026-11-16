// @ts-check
/**
 * Zod schemas for schedules and departures (INV-03).
 *
 * Dates are 'YYYY-MM-DD' and times are 'HH:MM', both in the OPERATOR'S time zone.
 * The API converts them to UTC instants (see time.js); clients never do time-zone maths.
 */
import { z } from 'zod';

/** 'YYYY-MM-DD' that is a real calendar date (rejects 2026-02-30). */
export const DateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((s) => new Date(`${s}T00:00:00Z`).toISOString().startsWith(s), 'Not a real date');

/** 'HH:MM', 24-hour. */
export const TimeString = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour HH:MM, e.g. 09:00 or 18:30');

const uniqueList = (item, max) =>
  z
    .array(item)
    .min(1)
    .max(max)
    .refine((list) => new Set(list).size === list.length, 'Remove duplicates');

const scheduleFields = {
  startDate: DateString,
  endDate: DateString.nullable(),
  // 0 = Sunday … 6 = Saturday. Daily = [0,1,2,3,4,5,6].
  daysOfWeek: uniqueList(z.number().int().min(0).max(6), 7),
  times: uniqueList(TimeString, 12),
  // null = use the product's default capacity.
  capacity: z.number().int().min(1).max(500).nullable(),
  // Exceptions: dates the rule would produce that don't run.
  skipDates: z.array(DateString).max(366),
  isActive: z.boolean(),
};

const datesInOrder = (b) => !b.endDate || !b.startDate || b.endDate >= b.startDate;
const datesMessage = { message: 'endDate must be on or after startDate', path: ['endDate'] };

/** POST /api/products/:id/schedules */
export const CreateScheduleSchema = z
  .object({
    ...scheduleFields,
    endDate: scheduleFields.endDate.default(null),
    capacity: scheduleFields.capacity.default(null),
    skipDates: scheduleFields.skipDates.default([]),
    isActive: scheduleFields.isActive.default(true),
  })
  .refine(datesInOrder, datesMessage);

/** PATCH /api/schedules/:id */
export const UpdateScheduleSchema = z
  .object(scheduleFields)
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'Send at least one field to change')
  .refine(datesInOrder, datesMessage);

/** POST /api/products/:id/departures: a one-off ("custom") departure. */
export const CreateDepartureSchema = z.object({
  date: DateString,
  time: TimeString,
  capacity: z.number().int().min(1).max(500).optional(),
});

/** PATCH /api/departures/:id */
export const UpdateDepartureSchema = z
  .object({
    capacity: z.number().int().min(1).max(500),
    status: z.enum(['scheduled', 'cancelled']),
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'Send at least one field to change');

/** ?from=YYYY-MM-DD&to=YYYY-MM-DD (both optional) for calendars and availability. */
export const DateRangeQuerySchema = z
  .object({
    from: DateString.optional(),
    to: DateString.optional(),
    productId: z.uuid().optional(),
  })
  .refine((q) => !q.from || !q.to || q.to >= q.from, {
    message: 'to must be on or after from',
    path: ['to'],
  });
