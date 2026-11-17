// @ts-check
/**
 * date-range.js: reads ?from=YYYY-MM-DD&to=YYYY-MM-DD for calendar requests.
 *
 * Used by the staff availability routes AND the public departures route, so a guest's
 * calendar and the operator's calendar follow exactly the same rules:
 *   - no `from` → today (in the operator's time zone, not the server's)
 *   - no `to`   → two weeks from `from`
 *   - at most MAX_RANGE_DAYS per request, so nobody can ask for ten years in one go
 */
import { DateRangeQuerySchema } from '@okapigo/shared/schemas/schedules';
import { addDays, localDate } from '@okapigo/shared/time';
import { HttpError } from '../middleware/errors.js';

/** The longest date range one calendar request may ask for. */
export const MAX_RANGE_DAYS = 92;

/**
 * @param {unknown} query  req.query
 * @param {string} timeZone  the operator's IANA time zone
 * @param {Date} [now]
 * @returns {{ from: string, to: string, productId?: string }}
 */
export function parseDateRange(query, timeZone, now = new Date()) {
  const parsed = DateRangeQuerySchema.safeParse(query);
  if (!parsed.success) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid date range.', {
      issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  const from = parsed.data.from ?? localDate(now, timeZone);
  const to = parsed.data.to ?? addDays(from, 13);
  if (to > addDays(from, MAX_RANGE_DAYS)) {
    throw new HttpError(400, 'RANGE_TOO_LONG', `Ask for at most ${MAX_RANGE_DAYS} days at a time.`);
  }
  return { from, to, productId: parsed.data.productId };
}
