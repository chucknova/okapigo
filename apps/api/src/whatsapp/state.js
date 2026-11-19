// @ts-check
/**
 * state.js — what the booking assistant remembers between a guest's messages (session 13).
 * Saved on the conversation (conversations.state) after every message, read back before the
 * next, and CHECKED when read: a state from an older version of the bot, or a hand edit, is
 * dropped and the chat starts again rather than crashing.
 *
 *   step          where the guest is (see STEPS)
 *   tourSlug, departureId, datePage          the tour and date chosen; which page of dates
 *   adults, underCount, childAges, ageIndex  who's coming: adults, and each under-13's age
 *   kidsPending   "under 13: 2" was said with no adults: ask adults, then the ages
 *   addOns, addOnId                          extras chosen { addOnId: quantity }; the one asked about
 *   pickup, leadName, email                  the rest of the booking
 *   bookingId     the booking the summary is for (seats HELD)
 *   payChoice     full or deposit, remembered for "Try again" and "Hold them again"
 *   changing      the guest is changing one thing: when it's done, hold and summarise again
 *   resume        the step to go back to after "No, carry on"
 *   seatsLeft     how many seats were left when they ran short (for "Book 1 seat")
 */
import { z } from 'zod';

export const STEPS = /** @type {const} */ ([
  'hello',
  'choose_tour',
  'choose_date',
  'adults',
  'adults_type', // "3 or more": type the number
  'under', // anyone under 13?
  'under_count',
  'under_type',
  'child_age',
  'extras',
  'extra_qty',
  'extra_qty_type',
  'extra_more',
  'pickup',
  'name',
  'email',
  'seats_short', // someone booked while we were chatting
  'summary', // seats held; pay, change or cancel
  'change', // what would you like to change?
  'confirm_cancel', // stop this booking?
  'hold_over', // the 30 minutes ran out: hold again?
  'booked', // paid: anything typed goes to the team
]);

const count = z.number().int().min(0).max(50);

export const ConversationStateSchema = z.object({
  step: z.enum(STEPS).default('hello'),
  tourSlug: z.string().max(80).optional(),
  departureId: z.uuid().optional(),
  datePage: z.number().int().min(0).max(20).optional(),
  adults: count.optional(),
  underCount: count.optional(),
  childAges: z.array(z.number().int().min(0).max(120)).max(50).optional(),
  ageIndex: count.optional(),
  kidsPending: z.boolean().optional(),
  addOns: z.record(z.string(), count).optional(),
  addOnId: z.uuid().optional(),
  pickup: z.string().max(120).optional(),
  leadName: z.string().max(80).optional(),
  email: z.string().max(254).nullable().optional(),
  bookingId: z.uuid().optional(),
  payChoice: z.enum(['full', 'deposit']).optional(),
  changing: z.boolean().optional(),
  resume: z.enum(STEPS).optional(),
  seatsLeft: count.optional(),
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
