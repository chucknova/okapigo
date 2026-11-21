// @ts-check
/**
 * Zod schemas for the channel manager (Settings › Channels, session 17c): connecting an OTA
 * that sells through OCTO, and changing it.
 */
import { z } from 'zod';

/** "20" or "17.5" (%): what the OTA keeps of each sale, 0 to 100, at most two decimals. */
const commissionPercent = z
  .number()
  .min(0, 'From 0% to 100%')
  .max(100, 'From 0% to 100%')
  .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, 'At most two decimals');

/** Where we tell the OTA what changed: an http(s) address. */
const webhookUrl = z
  .string()
  .trim()
  .max(500)
  .regex(/^https?:\/\/[^\s]+$/, 'An address starting with https://');

/** POST /api/channels */
export const CreateChannelSchema = z.object({
  name: z.string().trim().min(2, 'At least 2 characters').max(60, 'At most 60 characters'),
  commissionPercent,
  productIds: z.array(z.uuid()).max(200).default([]),
  webhookUrl: webhookUrl.nullable().default(null),
});

/** PATCH /api/channels/:id */
export const UpdateChannelSchema = z
  .object({
    name: z.string().trim().min(2, 'At least 2 characters').max(60, 'At most 60 characters'),
    commissionPercent,
    isActive: z.boolean(),
    productIds: z.array(z.uuid()).max(200),
    webhookUrl: webhookUrl.nullable(),
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'Send at least one field to change');

/** 17.5 → 1750 basis points. @param {number} percent */
export const percentToBasisPoints = (percent) => Math.round(percent * 100);
