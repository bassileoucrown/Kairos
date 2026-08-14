export function detectTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function listTimezones() {
  if (typeof Intl.supportedValuesOf === 'function') {
    try {
      return Intl.supportedValuesOf('timeZone');
    } catch {
      // fall through to the curated list below
    }
  }
  return [
    'UTC', 'Africa/Lagos', 'Africa/Accra', 'Africa/Nairobi', 'Africa/Johannesburg', 'Africa/Cairo',
    'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'America/New_York', 'America/Chicago',
    'America/Los_Angeles', 'America/Sao_Paulo', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Singapore',
    'Asia/Tokyo', 'Australia/Sydney',
  ];
}

// Wall-clock time somewhere else, turned into the instant it actually is.
//
// A date input and a time input give "2027-03-04" and "09:00" and nothing
// else — no zone. `new Date('2027-03-04T09:00')` then reads them in the
// BROWSER's zone, which is right only when the person filling the form is
// sitting in the same country as the event. This app exists for the case where
// they are not: a PA in London arranging a 09:00 departure out of Lagos got an
// instant an hour off, and the form beside it was already asking which zone
// the times were in.
//
// The two-pass guess is the standard way to invert an IANA zone without a date
// library, and matches server/lib/timezone.js line for line so the two cannot
// drift: guess the instant as if the wall clock were UTC, ask the zone what
// its offset is there, subtract, and repeat once so a time near a DST boundary
// settles on the offset that actually applies to it.
function offsetMinutes(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date);
  const m = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const asUTC = Date.UTC(
    Number(m.year), Number(m.month) - 1, Number(m.day),
    Number(m.hour), Number(m.minute), Number(m.second),
  );
  return (asUTC - date.getTime()) / 60000;
}

/**
 * @param dateKey  "2027-03-04"
 * @param time     "09:00"
 * @param timeZone the zone those numbers are meant to be read in
 * @returns an ISO instant
 */
export function zonedToUtc(dateKey, time, timeZone) {
  const [y, mo, d] = String(dateKey).split('-').map(Number);
  const [h, mi] = String(time || '00:00').split(':').map(Number);
  const wall = Date.UTC(y, mo - 1, d, h || 0, mi || 0, 0);
  if (!timeZone) return new Date(wall - new Date(wall).getTimezoneOffset() * -60000).toISOString();
  let guess = wall;
  for (let i = 0; i < 2; i++) guess = wall - offsetMinutes(new Date(guess), timeZone) * 60000;
  return new Date(guess).toISOString();
}

const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export function dayName(dayOfWeek) {
  return dayNames[dayOfWeek];
}

export function formatInZone(isoString, timeZone, opts = {}) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
    ...opts,
  }).format(new Date(isoString));
}

export function dateKeyInZone(isoString, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(isoString));
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

export function dayLabelInZone(isoString, timeZone) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone, weekday: 'long', month: 'long', day: 'numeric',
  }).format(new Date(isoString));
}

export function timeLabelInZone(isoString, timeZone) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone, hour: 'numeric', minute: '2-digit',
  }).format(new Date(isoString));
}
