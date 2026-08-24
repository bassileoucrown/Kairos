// Minimal timezone helpers built on Intl, no dependency needed.
// zonedTimeToUtc: given wall-clock date/time components meant to be read in
// `timeZone`, return the UTC Date instant they refer to. Handles DST via the
// standard two-pass offset-guess technique.

function getTimeZoneOffsetMinutes(date, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = dtf.formatToParts(date);
  const map = {};
  for (const p of parts) map[p.type] = p.value;
  const asUTC = Date.UTC(
    parseInt(map.year, 10), parseInt(map.month, 10) - 1, parseInt(map.day, 10),
    parseInt(map.hour, 10), parseInt(map.minute, 10), parseInt(map.second, 10)
  );
  return (asUTC - date.getTime()) / 60000;
}

function zonedTimeToUtc(year, month, day, hour, minute, timeZone) {
  let utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0);
  for (let i = 0; i < 2; i++) {
    const offsetMin = getTimeZoneOffsetMinutes(new Date(utcGuess), timeZone);
    utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0) - offsetMin * 60000;
  }
  return new Date(utcGuess);
}

/**
 * The wall clock somebody in `timeZone` would read off an instant.
 *
 * The inverse of zonedTimeToUtc, and needed by anything that has to keep a
 * local time fixed while the UTC instant moves — a weekly meeting at nine has
 * to stay at nine through a daylight-saving change, which means recurring on
 * the calendar and converting back, not adding 168 hours.
 */
function utcToZonedParts(date, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
  const map = {};
  for (const p of dtf.formatToParts(date)) map[p.type] = p.value;
  return {
    year: parseInt(map.year, 10),
    month: parseInt(map.month, 10),
    day: parseInt(map.day, 10),
    hour: parseInt(map.hour, 10),
    minute: parseInt(map.minute, 10),
  };
}

// Returns {year, month, day} for "now" as seen in timeZone.
function todayInZone(timeZone, now = new Date()) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const parts = dtf.formatToParts(now);
  const map = {};
  for (const p of parts) map[p.type] = p.value;
  return { year: parseInt(map.year, 10), month: parseInt(map.month, 10), day: parseInt(map.day, 10) };
}

// Pure calendar-date arithmetic (no timezone conversion) — safe to add days
// to a {year,month,day} triple using UTC as a neutral calendar calculator.
function addCalendarDays({ year, month, day }, n) {
  const d = new Date(Date.UTC(year, month - 1, day));
  d.setUTCDate(d.getUTCDate() + n);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

// 0 = Sunday .. 6 = Saturday, for a plain calendar date (no timezone math needed).
function dayOfWeek({ year, month, day }) {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function isValidTimeZone(tz) {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  zonedTimeToUtc, utcToZonedParts, todayInZone, addCalendarDays, dayOfWeek, isValidTimeZone,
};
