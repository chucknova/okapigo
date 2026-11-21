// @ts-check
/**
 * Zod schemas for the channel manager (Settings › Channels, sessions 17c and 17c-2): connecting
 * an OTA that sells through OCTO, changing it, its tours, and recording what it paid.
 */
import { z } from 'zod';

/** "20" or "17.5" (%): what the OTA keeps of each sale, 0 to 100, at most two decimals. */
const commissionPercent = z
  .number()
  .min(0, 'From 0% to 100%')
  .max(100, 'From 0% to 100%')
  .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, 'At most two decimals');

const name = z.string().trim().min(2, 'At least 2 characters').max(60, 'At most 60 characters');

/** POST /api/channels: every published tour starts switched on (designs: O11 Connect). */
export const CreateChannelSchema = z.object({ name, commissionPercent });

/** PATCH /api/channels/:id */
export const UpdateChannelSchema = z
  .object({ name, commissionPercent, isActive: z.boolean() })
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'Send at least one field to change');

/** PUT /api/channels/:id/tours/:productId: one tour on the channel, or off it. */
export const ChannelTourSchema = z.object({ on: z.boolean() });

/** POST /api/channels/:id/payments: money the OTA sent ("Record a payment from Sojourna"). */
export const ChannelPaymentSchema = z.object({
  amountKobo: z.number().int().min(100, 'At least ₦1').max(100_000_000_000),
  receivedOn: z.iso.date('A date like 2026-12-03'),
  reference: z
    .string()
    .trim()
    .max(80, 'At most 80 characters')
    .transform((s) => s || null)
    .nullable()
    .default(null),
});

/** 17.5 → 1750 basis points. @param {number} percent */
export const percentToBasisPoints = (percent) => Math.round(percent * 100);
