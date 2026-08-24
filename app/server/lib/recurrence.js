const { zonedTimeToUtc, utcToZonedParts } = require('./timezone');

/**
 * Something that happens again.
 *
 * TWO DECISIONS SHAPE EVERYTHING ELSE HERE.
 *
 * 1. OCCURRENCES ARE REAL ROWS, not a rule expanded when somebody looks.
 *
 * A virtual occurrence has no id, and almost everything this product does to
 * an item needs one: a flight is delayed and the rest of the day cascades, an
 * assistant proposes one Tuesday's dinner to the principal and not the others,
 * a car is picked up, one week is cancelled because the principal is abroad.
 * A rule expanded at read time can do none of that without inventing ids that
 * mean nothing the moment the rule changes. So a series is generated up front
 * and each occurrence is an ordinary item that happens to know its siblings.
 *
 * The cost is honest and bounded: a horizon rather than an infinite series,
 * and a cap on how many rows one request can make.
 *
 * 2. RECURRENCE HAPPENS ON THE CALENDAR, IN THE OWNER'S ZONE — never by adding
 *    a fixed number of hours.
 *
 * A weekly nine o'clock meeting must stay at nine o'clock. Add 168 hours in
 * UTC and it silently becomes ten (or eight) the week the clocks change, for
 * everyone in a zone that observes daylight saving. So each occurrence is
 * computed by moving the LOCAL calendar date and keeping the local wall clock,
 * then converting back to UTC. In a zone without DST — Lagos, for one — the
 * two approaches agree, which is exactly why this is the kind of bug that
 * ships.
 */

const FREQUENCIES = new Set(['daily', 'weekly', 'fortnightly', 'monthly', 'yearly']);

// Enough to be useful, small enough that one mistyped form cannot write
// thousands of rows. A standing weekly meeting for two years is 104.
const MAX_OCCURRENCES = 260;

// How far ahead a series may reach when it is given no end at all. Someone
// setting up a standing Monday call does not want to say when it stops; they
// also do not want a row for the year 2093.
const DEFAULT_HORIZON_MONTHS = 12;

const LABELS = {
  daily: 'Every day',
  weekly: 'Every week',
  fortnightly: 'Every two weeks',
  monthly: 'Every month',
  yearly: 'Every year',
};

/** Prose for the screen, or null when there is nothing repeating. */
function label(freq) {
  return LABELS[freq] || null;
}

/** How many days in a given month — used to decide whether a date exists. */
function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Advance a local date by one step of `freq`, keeping the day of the month.
 *
 * Returns null when the resulting date DOES NOT EXIST — the 31st in a month
 * with thirty days, the 29th of February in a common year.
 *
 * Skipping is deliberate, and it is the part worth arguing about. The
 * alternative is to clamp: move the 31st back to the 30th, or forward to the
 * 1st. Both quietly put an appointment on a day nobody chose, and for a
 * product whose whole job is telling a principal where they are supposed to
 * be, a meeting that moves itself is worse than a meeting that is missing.
 * A gap is visible. A wrong date is not.
 */
function step(parts, freq, n) {
  const { year, month, day, hour, minute } = parts;

  if (freq === 'daily' || freq === 'weekly' || freq === 'fortnightly') {
    const days = freq === 'daily' ? 1 : (freq === 'weekly' ? 7 : 14);
    // Day arithmetic has no missing dates, so UTC is a safe neutral calendar
    // here — no zone is involved, only the counting.
    const moved = new Date(Date.UTC(year, month - 1, day + days * n));
    return {
      year: moved.getUTCFullYear(),
      month: moved.getUTCMonth() + 1,
      day: moved.getUTCDate(),
      hour,
      minute,
    };
  }

  let y = year;
  let m = month;
  if (freq === 'monthly') {
    const total = (year * 12) + (month - 1) + n;
    y = Math.floor(total / 12);
    m = (total % 12) + 1;
  } else if (freq === 'yearly') {
    y = year + n;
  } else {
    return null;
  }

  if (day > daysInMonth(y, m)) return null;
  return { year: y, month: m, day, hour, minute };
}

/**
 * Why a recurrence request is unacceptable, or null if it is fine.
 * Prose, because every caller shows it to a person.
 */
function problem({ freq, count, until } = {}) {
  if (!FREQUENCIES.has(freq)) return 'Choose how often this repeats.';
  if (count !== undefined && count !== null) {
    if (!Number.isInteger(count) || count < 2) return 'Repeat at least twice, or do not repeat.';
    if (count > MAX_OCCURRENCES) return `That is more than ${MAX_OCCURRENCES} occurrences.`;
  }
  if (until) {
    const end = new Date(until);
    if (Number.isNaN(end.getTime())) return 'That end date is not valid.';
  }
  return null;
}

/**
 * Every occurrence of a series, the first one included.
 *
 * `timeZone` is the zone the wall clock belongs to — the item's own start zone
 * where it has one, otherwise the owner's. Getting this wrong is the DST bug
 * described at the top of the file, so it is required rather than defaulted.
 *
 * Occurrences that do not exist are skipped, not clamped, and skipping does
 * not consume the count: "the 31st, twelve times" means twelve actual 31sts,
 * spread over however many months contain one.
 */
function expand({ startAt, endAt, timeZone, freq, count, until }) {
  const first = new Date(startAt);
  const durationMs = endAt ? new Date(endAt).getTime() - first.getTime() : null;
  const base = utcToZonedParts(first, timeZone);

  const limit = count || MAX_OCCURRENCES;
  const horizon = until
    ? new Date(until)
    : (() => {
      const h = new Date(first);
      h.setUTCMonth(h.getUTCMonth() + DEFAULT_HORIZON_MONTHS);
      return h;
    })();

  const out = [];
  // Bounded independently of `limit` so that a series of skipped dates — "the
  // 31st" — cannot spin looking for occurrences that a short horizon will
  // never yield.
  for (let n = 0; out.length < limit && n < MAX_OCCURRENCES * 4; n++) {
    const parts = n === 0 ? base : step(base, freq, n);
    if (!parts) continue;
    const start = zonedTimeToUtc(parts.year, parts.month, parts.day, parts.hour, parts.minute, timeZone);
    if (start > horizon) break;
    out.push({
      startAt: start.toISOString(),
      endAt: durationMs === null ? null : new Date(start.getTime() + durationMs).toISOString(),
    });
  }
  return out;
}

module.exports = {
  expand, problem, label, step, FREQUENCIES, MAX_OCCURRENCES, DEFAULT_HORIZON_MONTHS,
};
