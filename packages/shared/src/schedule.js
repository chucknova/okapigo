// @ts-check
/**
 * schedule.js — turns a schedule RULE into concrete departure TIMES (INV-03).
 *
 *   rule:   "Heritage Walk: every day at 09:00 from 1 Dec, except 25 Dec"
 *   result: [ 1 Dec 08:00Z, 2 Dec 08:00Z, …, 24 Dec 08:00Z, 26 Dec 08:00Z, … ]
 *
 * This is a PURE function: no database, no clock. Give it the same input and it always
 * returns the same output. That makes it easy to test thoroughly, and the database code
 * (packages/db/src/departures.js) just compares this list with what already exists.
 *
 * Kinds of schedule the PRD asks for, all expressed with `daysOfWeek`:
 *   daily  → [0,1,2,3,4,5,6]
 *   weekly → e.g. [4,5,6] (Thursday to Saturday, the Street Food Crawl)
 *   custom → one-off departures are created directly, without a schedule
 * "Exceptions per date" → `skipDates`: dates the rule would produce but shouldn't.
 */
import { addDays, dayOfWeek, zonedTimeToUtc } from './time.js';

/** 0 = Sunday … 6 = Saturday */
export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * @typedef {{
 *   startDate: string,            // 'YYYY-MM-DD', first day the rule applies
 *   endDate: string | null,       // 'YYYY-MM-DD', last day (inclusive), or null = no end
 *   daysOfWeek: number[],         // which weekdays run
 *   times: string[],              // local start times, 'HH:MM'
 *   skipDates: string[],          // exceptions: dates that don't run
 * }} ScheduleRule
 */

/**
 * Lists every departure the rule produces between two dates (inclusive).
 *
 * @param {ScheduleRule} rule
 * @param {{ from: string, to: string, timeZone: string, durationMinutes: number }} window
 * @returns {Array<{ startsAt: Date, endsAt: Date }>} sorted by start time
 */
export function expandSchedule(rule, { from, to, timeZone, durationMinutes }) {
  const first = rule.startDate > from ? rule.startDate : from;
  const last = rule.endDate && rule.endDate < to ? rule.endDate : to;
  const days = new Set(rule.daysOfWeek);
  const skip = new Set(rule.skipDates);
  const times = [...rule.times].sort();

  const departures = [];
  // 'YYYY-MM-DD' strings compare correctly as text, so `<=` works for dates.
  for (let date = first; date <= last; date = addDays(date, 1)) {
    if (!days.has(dayOfWeek(date)) || skip.has(date)) continue;
    for (const time of times) {
      const startsAt = zonedTimeToUtc(date, time, timeZone);
      const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000);
      departures.push({ startsAt, endsAt });
    }
  }
  return departures;
}
