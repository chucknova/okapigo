// @ts-check
/**
 * Zod schemas for the ledger API (PAY-22).
 */
import { z } from 'zod';
import { ACCOUNTS } from '../ledger.js';
import { DateString } from './schedules.js';

const accountKeys = /** @type {[string, ...string[]]} */ (Object.keys(ACCOUNTS));

/**
 * POST /api/ledger/adjustments: a manual correction against the Adjustments account.
 * direction "debit" = the chosen account goes UP if it's a debit-normal account (and vice versa).
 */
export const AdjustmentSchema = z.object({
  account: z
    .enum(accountKeys)
    .refine((k) => k !== 'ADJUSTMENTS', 'Choose the account to adjust, not Adjustments itself'),
  direction: z.enum(['debit', 'credit']),
  amountKobo: z.number().int().positive().max(2_000_000_000),
  // Required: a correction without a reason is a mystery to the next person.
  reason: z.string().trim().min(5).max(500),
});

/** POST /api/ledger/transactions/:id/reverse */
export const ReverseSchema = z.object({ reason: z.string().trim().min(5).max(500) });

/** ?from=YYYY-MM-DD&to=YYYY-MM-DD (local dates, both optional, inclusive) */
export const LedgerRangeQuerySchema = z
  .object({ from: DateString.optional(), to: DateString.optional() })
  .refine((q) => !q.from || !q.to || q.to >= q.from, {
    message: 'to must be on or after from',
    path: ['to'],
  });

/** ?bookingId=&page= */
export const LedgerTransactionsQuerySchema = z.object({
  bookingId: z.uuid().optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});
