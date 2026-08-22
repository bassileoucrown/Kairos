const db = require('./db');
const { zonedTimeToUtc, todayInZone, addCalendarDays, dayOfWeek } = require('./timezone');

// How far ahead the diary is open, when nobody has said otherwise. This was
// the only answer the platform had; it is now the starting one.
const DEFAULT_WINDOW_DAYS = 14;

// The lengths offered, and the outer limits of what will be accepted. A day is
// the shortest thing that is still a window — anything less is "not open" and
// is said by having no hours, not by having a window of zero. A year is where
// a rolling window stops being a window and becomes a diary somebody has to
// maintain by hand.
const WINDOW_CHOICES = [
  { days: 1, label: 'A day' },
  { days: 3, label: 'Three days' },
  { days: 7, label: 'A week' },
  { days: 14, label: 'Two weeks' },
  { days: 30, label: 'A month' },
  { days: 60, label: 'Two months' },
  { days: 90, label: 'Three months' },
];
const MIN_WINDOW_DAYS = 1;
const MAX_WINDOW_DAYS = 365;

/** The window to use for an owner, however old or odd their row is. */
function windowDaysFor(owner) {
  const n = Number(owner?.booking_window_days);
  if (!Number.isInteger(n) || n < MIN_WINDOW_DAYS || n > MAX_WINDOW_DAYS) return DEFAULT_WINDOW_DAYS;
  return n;
}

/** Why this window is unusable, or null. Returns prose; callers show it. */
function windowProblem(value) {
  const n = Number(value);
  if (!Number.isInteger(n)) return 'Choose how far ahead people can book.';
  if (n < MIN_WINDOW_DAYS) return 'The diary has to be open for at least a day.';
  if (n > MAX_WINDOW_DAYS) return "A year ahead is as far as Kairos will hold open.";
  return null;
}

/**
 * Computes open booking slots for a meeting type over the owner's booking
 * window, starting from "today" in the owner's timezone.
 * Returns an array of { startUtc: Date, endUtc: Date }, soonest first.
 */
async function getOpenSlots({ owner, meetingType, excludeBookingId = null }) {
  const rules = await db.prepare('SELECT * FROM availability_rules WHERE owner_id = ?').all(owner.id);
  if (rules.length === 0) return [];

  const rulesByDay = new Map();
  for (const rule of rules) {
    const list = rulesByDay.get(rule.day_of_week) || [];
    list.push(rule);
    rulesByDay.set(rule.day_of_week, list);
  }

  const now = new Date();
  // excludeBookingId lets a reschedule ignore the booking's own current slot —
  // otherwise it would appear to conflict with itself and block the move.
  // Pending (Tier 3/4, awaiting PA approval) bookings still hold their slot —
  // only cancelled/declined bookings free it back up.
  const existingBookings = await db.prepare("SELECT id, start_at, end_at FROM bookings WHERE owner_id = ? AND status IN ('confirmed', 'pending') AND end_at > ? AND id != ?")
    .all(owner.id, now.toISOString(), excludeBookingId || '');

  const durationMs = meetingType.duration_minutes * 60000;
  const bufferBeforeMs = meetingType.buffer_before_minutes * 60000;
  const bufferAfterMs = meetingType.buffer_after_minutes * 60000;

  const slots = [];
  let cursor = todayInZone(owner.timezone, now);

  for (let i = 0, days = windowDaysFor(owner); i < days; i++) {
    const date = i === 0 ? cursor : addCalendarDays(cursor, i);
    const dow = dayOfWeek(date);
    const dayRules = rulesByDay.get(dow) || [];

    for (const rule of dayRules) {
      const [startH, startM] = rule.start_time.split(':').map(Number);
      const [endH, endM] = rule.end_time.split(':').map(Number);
      const windowStart = zonedTimeToUtc(date.year, date.month, date.day, startH, startM, owner.timezone);
      const windowEnd = zonedTimeToUtc(date.year, date.month, date.day, endH, endM, owner.timezone);

      for (let slotStart = windowStart.getTime(); slotStart + durationMs <= windowEnd.getTime(); slotStart += durationMs) {
        const slotEnd = slotStart + durationMs;
        if (slotStart <= now.getTime()) continue;

        const checkStart = slotStart - bufferBeforeMs;
        const checkEnd = slotEnd + bufferAfterMs;
        const overlaps = existingBookings.some((b) => {
          const bStart = new Date(b.start_at).getTime();
          const bEnd = new Date(b.end_at).getTime();
          return checkStart < bEnd && checkEnd > bStart;
        });
        if (overlaps) continue;

        slots.push({ startUtc: new Date(slotStart), endUtc: new Date(slotEnd) });
      }
    }
  }

  slots.sort((a, b) => a.startUtc - b.startUtc);
  return slots;
}

module.exports = {
  getOpenSlots,
  windowDaysFor,
  windowProblem,
  WINDOW_CHOICES,
  DEFAULT_WINDOW_DAYS,
  MIN_WINDOW_DAYS,
  MAX_WINDOW_DAYS,
};
