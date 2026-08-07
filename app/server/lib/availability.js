const db = require('./db');
const { zonedTimeToUtc, todayInZone, addCalendarDays, dayOfWeek } = require('./timezone');

const BOOKING_WINDOW_DAYS = 14;

/**
 * Computes open booking slots for a meeting type over the next
 * BOOKING_WINDOW_DAYS, starting from "today" in the owner's timezone.
 * Returns an array of { startUtc: Date, endUtc: Date }, soonest first.
 */
function getOpenSlots({ owner, meetingType }) {
  const rules = db.prepare('SELECT * FROM availability_rules WHERE owner_id = ?').all(owner.id);
  if (rules.length === 0) return [];

  const rulesByDay = new Map();
  for (const rule of rules) {
    const list = rulesByDay.get(rule.day_of_week) || [];
    list.push(rule);
    rulesByDay.set(rule.day_of_week, list);
  }

  const now = new Date();
  const existingBookings = db
    .prepare("SELECT start_at, end_at FROM bookings WHERE owner_id = ? AND status = 'confirmed' AND end_at > ?")
    .all(owner.id, now.toISOString());

  const durationMs = meetingType.duration_minutes * 60000;
  const bufferBeforeMs = meetingType.buffer_before_minutes * 60000;
  const bufferAfterMs = meetingType.buffer_after_minutes * 60000;

  const slots = [];
  let cursor = todayInZone(owner.timezone, now);

  for (let i = 0; i < BOOKING_WINDOW_DAYS; i++) {
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

module.exports = { getOpenSlots, BOOKING_WINDOW_DAYS };
