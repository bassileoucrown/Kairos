const MONTH_DAY_RE = /^(\d{2})-(\d{2})$/;

// Given 'MM-DD', returns the number of days from today (UTC calendar date)
// until the next occurrence of that month/day, 0 if it's today, or null if
// the input isn't a valid MM-DD string.
function daysUntilNextOccurrence(monthDay, now = new Date()) {
  const match = MONTH_DAY_RE.exec(monthDay || '');
  if (!match) return null;
  const month = parseInt(match[1], 10);
  const day = parseInt(match[2], 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const todayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  let occurrence = Date.UTC(now.getUTCFullYear(), month - 1, day);
  if (occurrence < todayUTC) {
    occurrence = Date.UTC(now.getUTCFullYear() + 1, month - 1, day);
  }
  return Math.round((occurrence - todayUTC) / (24 * 60 * 60 * 1000));
}

module.exports = { daysUntilNextOccurrence };
