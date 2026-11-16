// @ts-check
/**
 * time.js — converting between an operator's LOCAL wall-clock time and UTC.
 *
 * The problem: an operator says "the walk starts at 09:00". That means 09:00 *in Lagos*.
 * The database stores instants in UTC, so 09:00 in Lagos (UTC+1) is stored as 08:00Z.
 * Showing it back to a guest converts again.
 *
 * Lagos has no daylight saving time, so "subtract one hour" would work today. But places
 * like London jump an hour twice a year, and OkapiGo's later versions run trips abroad
 * (v2). So this asks the system's time-zone database (via Intl) what the offset was at
 * that exact moment, which is correct for any IANA zone ("Africa/Lagos", "Europe/London").
 *
 * Conventions:
 *   - a calendar DATE is a string 'YYYY-MM-DD' (no time zone attached)
 *   - a wall-clock TIME is a string 'HH:MM' (24-hour)
 *   - an INSTANT is a JavaScript Date (always UTC inside)
 */

/** Cache of formatters: creating Intl.DateTimeFormat is slow, reusing it is fast. */
const formatters = new Map();

/** @param {string} timeZone */
function partsFormatter(timeZone) {
  if (!formatters.has(timeZone)) {
    formatters.set(
      timeZone,
      new Intl.DateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
    );
  }
  return formatters.get(timeZone);
}

/**
 * The wall-clock reading in `timeZone` at a given instant, as numbers.
 * @param {Date} instant
 * @param {string} timeZone
 */
function wallClock(instant, timeZone) {
  /** @type {Record<string, number>} */
  const p = {};
  for (const { type, value } of partsFormatter(timeZone).formatToParts(instant)) {
    if (type !== 'literal') p[type] = Number(value);
  }
  return p;
}

/**
 * How far ahead of UTC `timeZone` is at `instant`, in milliseconds (Lagos: +3,600,000).
 * @param {Date} instant
 * @param {string} timeZone
 */
function offsetMs(instant, timeZone) {
  const w = wallClock(instant, timeZone);
  // Pretend the wall-clock reading were UTC; the difference from the real instant IS the offset.
  const asIfUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return asIfUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * Converts a local date + time in a zone to the real instant.
 *   zonedTimeToUtc('2026-12-01', '09:00', 'Africa/Lagos') → 2026-12-01T08:00:00.000Z
 *
 * How: start by pretending the wall time is UTC, look up the zone's offset near there,
 * subtract it, then check the offset again at the result (it can differ across a
 * daylight-saving switch) and correct once more if needed.
 *
 * @param {string} date 'YYYY-MM-DD'
 * @param {string} time 'HH:MM'
 * @param {string} timeZone IANA zone, e.g. 'Africa/Lagos'
 */
export function zonedTimeToUtc(date, time, timeZone) {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const naive = Date.UTC(y, m - 1, d, hh, mm);

  let guess = naive - offsetMs(new Date(naive), timeZone);
  const secondOffset = offsetMs(new Date(guess), timeZone);
  guess = naive - secondOffset;
  return new Date(guess);
}

/**
 * The local calendar date in a zone at an instant.
 *   localDate(new Date('2026-12-01T23:30:00Z'), 'Africa/Lagos') → '2026-12-02' (00:30 in Lagos)
 * @param {Date} instant
 * @param {string} timeZone
 */
export function localDate(instant, timeZone) {
  const w = wallClock(instant, timeZone);
  return `${w.year}-${String(w.month).padStart(2, '0')}-${String(w.day).padStart(2, '0')}`;
}

/**
 * The local wall-clock time in a zone at an instant, 'HH:MM'.
 *   localTime(new Date('2026-12-01T08:00:00Z'), 'Africa/Lagos') → '09:00'
 * @param {Date} instant
 * @param {string} timeZone
 */
export function localTime(instant, timeZone) {
  const w = wallClock(instant, timeZone);
  return `${String(w.hour).padStart(2, '0')}:${String(w.minute).padStart(2, '0')}`;
}

/**
 * Calendar arithmetic on 'YYYY-MM-DD' strings, independent of any time zone.
 *   addDays('2026-12-31', 1) → '2027-01-01'
 * (Done in UTC, where days are always exactly 24 hours, so there are no DST surprises.)
 * @param {string} date
 * @param {number} days
 */
export function addDays(date, days) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * Day of the week for a calendar date: 0 = Sunday … 6 = Saturday (same as Date#getDay).
 * @param {string} date
 */
export function dayOfWeek(date) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * Converts a JavaScript Date that represents a calendar DATE (as Prisma returns @db.Date
 * columns: midnight UTC) to 'YYYY-MM-DD'; and back.
 * @param {Date} value
 */
export const dateToString = (value) => value.toISOString().slice(0, 10);
/** @param {string} date */
export const stringToDate = (date) => new Date(`${date}T00:00:00.000Z`);
