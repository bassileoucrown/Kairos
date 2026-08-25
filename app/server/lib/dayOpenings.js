const db = require('./db');
const { zonedTimeToUtc, dayOfWeek } = require('./timezone');
const { gapMinutesFor } = require('./availability');

/**
 * What a day actually looks like, for somebody deciding where to put a meeting.
 *
 * WHY THIS IS NOT getOpenSlots. That one answers a stranger's question — when
 * may I book this person — and is therefore bounded by the published hours and
 * the booking window, as it should be. This answers the office's question,
 * which is a different one: where in Thursday is there room.
 *
 * The difference is a capability, not a detail. lib/rescheduleBooking.js is
 * explicit that the office is NOT confined to the published hours: an assistant
 * moving a meeting to a seven o'clock breakfast, or into a gap deliberately
 * kept clear, is doing their job. Feeding the office the public grid would take
 * that back — every time outside the published hours would simply be missing,
 * and "missing from the picker" reads as "not allowed" to whoever is looking.
 *
 * THE RULE THIS FILE EXISTS TO KEEP: the picker must never be stricter than the
 * verb it feeds. An opening that is offered must be one rescheduleBooking would
 * accept, and a time rescheduleBooking would accept must not be silently
 * absent. So the only thing that removes a candidate here is the only thing
 * that refuses one there — a real overlap with a live booking. Everything else
 * a person might want to know about a time is said ON the time rather than used
 * to delete it: whether it is inside the published hours, whether it lands
 * back-to-back on something, whether the principal is on a plane.
 */

// The office's day. Not the published hours — those belong to strangers — but
// not the full twenty-four either, which would be ninety-six candidates a day
// with sixty of them at three in the morning. Six to ten covers the breakfast
// the reschedule comment is about and the dinner at the other end.
const DAY_START_HOUR = 6;
const DAY_END_HOUR = 22;

// Quarter-hours. The public grid steps by the meeting's own length because a
// stranger is picking from a tidy list; the office is fitting something into a
// gap, and a gap rarely begins on the half hour.
const STEP_MINUTES = 15;

function parseDateKey(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''));
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

const overlaps = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && aEnd > bStart;

/**
 * Returns { ok: true, ... } or { ok: false, status, error } — prose, since
 * every caller shows it to somebody.
 */
async function openingsFor({ owner, date, minutes, excludeBookingId = null }) {
  const parts = parseDateKey(date);
  if (!parts) return { ok: false, status: 400, error: 'That is not a date.' };

  const mins = Number(minutes);
  if (!Number.isInteger(mins) || mins < 5 || mins > 480) {
    return { ok: false, status: 400, error: 'That is not a length a meeting runs for.' };
  }

  const tz = owner.timezone || 'UTC';
  const { year, month, day } = parts;
  const dayStart = zonedTimeToUtc(year, month, day, DAY_START_HOUR, 0, tz);
  const dayEnd = zonedTimeToUtc(year, month, day, DAY_END_HOUR, 0, tz);

  // Everything already holding this day. Fetched over a window wide enough to
  // catch a meeting that began yesterday evening and is still running, since
  // that overlaps a six o'clock start just as much as one that begins at six.
  const from = new Date(dayStart.getTime() - 24 * 3600000).toISOString();
  const to = new Date(dayEnd.getTime() + 24 * 3600000).toISOString();

  const bookings = await db.prepare(`
    SELECT b.id, b.start_at, b.end_at, b.booker_name, mt.name AS meeting_type_name
      FROM bookings b
      JOIN meeting_types mt ON mt.id = b.meeting_type_id
     WHERE b.owner_id = ?
       AND b.id != ?
       AND b.status IN ('confirmed', 'pending')
       AND b.start_at < ? AND b.end_at > ?
     ORDER BY b.start_at ASC
  `).all(owner.id, excludeBookingId || '', to, from);

  // The principal's own day holds more than meetings. A flight at three is a
  // reason not to put a meeting at three, and an office choosing a time without
  // seeing it is choosing blind. It is shown, and it is deliberately NOT
  // subtracted: see the rule at the top — reschedule allows it, so the picker
  // may caution about it but must not hide it. A call from the lounge is a real
  // thing somebody arranges on purpose.
  const commitments = await db.prepare(`
    SELECT id, title, kind, start_at, end_at
      FROM itinerary_items
     WHERE owner_id = ?
       AND status = 'confirmed'
       AND booking_id IS NULL
       AND start_at < ?
       AND COALESCE(end_at, start_at) > ?
     ORDER BY start_at ASC
  `).all(owner.id, to, from);

  const rules = await db.prepare('SELECT start_time, end_time FROM availability_rules WHERE owner_id = ? AND day_of_week = ?')
    .all(owner.id, dayOfWeek(parts));
  const published = rules.map((r) => {
    const [sh, sm] = r.start_time.split(':').map(Number);
    const [eh, em] = r.end_time.split(':').map(Number);
    return {
      start: zonedTimeToUtc(year, month, day, sh, sm, tz).getTime(),
      end: zonedTimeToUtc(year, month, day, eh, em, tz).getTime(),
    };
  });

  const gapMs = gapMinutesFor(owner) * 60000;
  const lengthMs = mins * 60000;
  const now = Date.now();

  const openings = [];
  for (let t = dayStart.getTime(); t < dayEnd.getTime(); t += STEP_MINUTES * 60000) {
    const end = t + lengthMs;

    // A picker offering six this morning at four this afternoon is not
    // offering anything. The typed field still takes any time at all, so
    // nothing is actually lost by leaving the past out of the suggestions.
    if (t <= now) continue;

    const clash = bookings.find((b) => overlaps(t, end, Date.parse(b.start_at), Date.parse(b.end_at)));
    if (clash) continue;

    // Free, but with nothing either side of it. Said rather than hidden: the
    // office runs back-to-back deliberately often enough that refusing would
    // be wrong, and finds out it did so by accident often enough that saying
    // nothing would be worse.
    const tight = gapMs > 0 && bookings.some((b) => overlaps(
      t - gapMs, end + gapMs, Date.parse(b.start_at), Date.parse(b.end_at),
    ));

    const against = commitments.find((c) => overlaps(
      t, end, Date.parse(c.start_at), Date.parse(c.end_at || c.start_at),
    ));

    openings.push({
      startAt: new Date(t).toISOString(),
      endAt: new Date(end).toISOString(),
      // Whether a stranger could have taken this. Useful as a hint about what
      // is normal for this principal, never as a bar on the office.
      withinHours: published.some((w) => t >= w.start && end <= w.end),
      tight,
      alongside: against ? against.title : null,
    });
  }

  return {
    ok: true,
    date,
    timezone: tz,
    minutes: mins,
    openings,
    // What is already there, so a day with no room explains itself instead of
    // just coming back empty.
    busy: [
      ...bookings.map((b) => ({
        id: b.id,
        kind: 'booking',
        label: `${b.meeting_type_name} with ${b.booker_name}`,
        startAt: b.start_at,
        endAt: b.end_at,
      })),
      ...commitments.map((c) => ({
        id: c.id,
        kind: c.kind || 'itinerary',
        label: c.title,
        startAt: c.start_at,
        endAt: c.end_at || c.start_at,
      })),
    ].sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt)),
    // The office's day, so the screen can say what it is showing rather than
    // leaving somebody to infer it from the first and last button.
    dayStartsAt: dayStart.toISOString(),
    dayEndsAt: dayEnd.toISOString(),
  };
}

module.exports = { openingsFor, DAY_START_HOUR, DAY_END_HOUR, STEP_MINUTES };
