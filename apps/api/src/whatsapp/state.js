// @ts-check
/**
 * state.js — what the booking assistant remembers between a guest's messages (session 13).
 * Saved on the conversation (conversations.state) after every message, read back before the
 * next, and CHECKED when read: a state from an older version of the bot, or a hand edit, is
 * dropped and the chat starts again rather than crashing.
 *
 *   step         where the guest is: hello · choose_tour · choose_date · count · count_type ·
 *                age · add_on · pickup · name · email · summary · pay_choice · hold_over
 *   tourSlug     the tour chosen          departureId  the date chosen
 *   counts       { adult: 2, child: 1 }   (per price category, in the order asked)
 *   categoryIndex / ageIndex / ages      which category or child is being asked about
 *   addOnIndex / addOns                  which extra is being offered; { addOnId: quantity }
 *   pickup / leadName / email            the rest of the booking
 *   bookingId                            the booking the summary is for (seats held)
 */
import { z } from 'zod';

export const ConversationStateSchema = z.object({
  step: z
    .enum([
      'hello',
      'choose_tour',
      'choose_date',
      'count',
      'count_type',
      'age',
      'add_on',
      'pickup',
      'name',
      'email',
      'summary',
      'pay_choice', // full or deposit? (only when the tour takes deposits)
      'hold_over', // the 30 minutes ran out: hold the same seats again?
    ])
    .default('hello'),
  tourSlug: z.string().max(80).optional(),
  departureId: z.uuid().optional(),
  datePage: z.number().int().min(0).max(20).optional(),
  counts: z.record(z.string(), z.number().int().min(0).max(20)).optional(),
  categoryIndex: z.number().int().min(0).max(20).optional(),
  ages: z.record(z.string(), z.array(z.number().int().min(0).max(120))).optional(),
  ageIndex: z.number().int().min(0).max(20).optional(),
  addOnIndex: z.number().int().min(0).max(50).optional(),
  addOns: z.record(z.string(), z.number().int().min(0).max(50)).optional(),
  pickup: z.string().max(120).optional(),
  leadName: z.string().max(80).optional(),
  email: z.string().max(254).nullable().optional(),
  bookingId: z.uuid().optional(),
});

/** @typedef {z.infer<typeof ConversationStateSchema>} ConversationState */

/**
 * The saved state, checked. Anything unreadable → a fresh start.
 * @param {unknown} value
 * @returns {ConversationState}
 */
export function readState(value) {
  const parsed = ConversationStateSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : { step: 'hello' };
}
