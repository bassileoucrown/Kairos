const crypto = require('crypto');
const db = require('./db');
const { todayInZone, addCalendarDays, zonedTimeToUtc } = require('./timezone');

// A journey that repeats.
//
// THE SCHOOL RUN IS THE BULK OF REAL MOVEMENT and it was the thing this module
// handled worst. Every morning at 6:40 to the same school, every Friday to the
// same place — each one typed again from scratch, which means in practice each
// one not typed at all, and the days that mattered were the ones nobody
// bothered to record.
//
// MATERIALISED, NOT COMPUTED. Each occurrence is a real movement row rather
// than a rule evaluated at read time, and that is deliberate for three
// reasons that all come from the same place: a movement is a safety record.
//
//   IT MUST BE EDITABLE ONE DAY AT A TIME. Thursday's run takes a different
//   driver because the usual one is ill. A computed occurrence has nowhere to
//   put that.
//
//   IT MUST CARRY ITS OWN ARRIVAL. "They arrived" is a fact about one journey
//   on one day, and the alarm in lib/reminders.js is built on a row existing
//   and not being marked. A rule has nothing to mark.
//
//   IT MUST OUTLIVE THE RULE. Cancel the school run in December and last
//   September's journeys must still be there, exactly as a movement outlives
//   the trip and the appointment it was arranged for.
//
// SO THE SERIES IS A GENERATOR, NOT A PARENT. Occurrences carry series_id so
// the pattern can be found and stopped, but nothing about an occurrence is
// read through it.

// How far ahead to lay down journeys. Far enough that a fortnight's plan is
// visible and a driver's card can be armed in advance; short enough that
// cancelling a pattern does not leave a year of dead rows to clean up.
const HORIZON_DAYS = 28;

// Sunday is 0, matching dayOfWeek in lib/timezone.js and the availability
// rules, so nobody has to hold two conventions in their head.
const DAYS = [0, 1, 2, 3, 4, 5, 6];

function validDays(days) {
  if (!Array.isArray(days) || days.length === 0) return null;
  const clean = [...new Set(days.map((d) => Number(d)))].filter((d) => DAYS.includes(d));
  return clean.length ? clean.sort() : null;
}

/**
 * Lay down the occurrences of a repeating journey.
 *
 * IN THE PRINCIPAL'S TIMEZONE, because "6:40 every weekday" is a wall time and
 * not an instant. Computed as a UTC range it would drift by an hour twice a
 * year in any zone that changes, and the school run would start arriving at
 * 5:40 with nobody able to say why.
 *
 * SKIPS WHAT ALREADY EXISTS, so calling it twice does not double the week.
 * The guard is the series id plus the departure instant, which is the only
 * pair that can identify "this occurrence" without a second table.
 */
async function generate({ seriesId, owner, template, days, timeOfDay, from = new Date() }) {
  const zone = owner.timezone || 'UTC';
  const [hh, mm] = String(timeOfDay || '').split(':').map((n) => Number.parseInt(n, 10));
  if (!Number.isInteger(hh) || !Number.isInteger(mm)) return [];

  const start = todayInZone(zone, from);
  const made = [];

  for (let i = 0; i < HORIZON_DAYS; i += 1) {
    const day = addCalendarDays(start, i);
    const at = zonedTimeToUtc(day.year, day.month, day.day, hh, mm, zone);
    // getUTCDay on the resulting instant would be the wrong day for a late
    // evening journey in a zone ahead of UTC. The calendar day is the one the
    // office means, so ask the calendar.
    const weekday = new Date(Date.UTC(day.year, day.month - 1, day.day)).getUTCDay();
    if (!days.includes(weekday)) continue;
    if (at.getTime() < from.getTime()) continue;

    const iso = at.toISOString();
    const exists = await db.prepare(
      'SELECT id FROM movements WHERE series_id = ? AND departs_at = ?',
    ).get(seriesId, iso);
    if (exists) continue;

    const row = {
      id: crypto.randomUUID(),
      owner_id: owner.id,
      arranged_by: template.arranged_by,
      trip_id: null,
      title: template.title,
      departs_from: template.departs_from,
      destination: template.destination,
      departs_at: iso,
      buffer_minutes: template.buffer_minutes || 0,
      notes: template.notes || '',
      expected_minutes: template.expected_minutes || 0,
      booking_id: null,
      series_id: seriesId,
      created_at: new Date().toISOString(),
    };
    await db.prepare(`
      INSERT INTO movements (id, owner_id, arranged_by, trip_id, title, departs_from,
                             destination, departs_at, buffer_minutes, notes,
                             expected_minutes, booking_id, series_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(row.id, row.owner_id, row.arranged_by, row.trip_id, row.title, row.departs_from,
      row.destination, row.departs_at, row.buffer_minutes, row.notes,
      row.expected_minutes, row.booking_id, row.series_id, row.created_at);
    made.push(row);
  }
  return made;
}

/**
 * Stop a pattern.
 *
 * THE PAST IS NEVER TOUCHED, and neither is anything already under way. What
 * goes is journeys that have not happened and that nobody has begun to run —
 * no arrival, no check call answered, no card handed to a driver. Deleting a
 * journey somebody is on would remove the row the arrival alarm is watching,
 * which is the one moment this feature must not be clever.
 */
async function stop(seriesId, ownerId, now = new Date()) {
  const rows = await db.prepare(`
    SELECT m.id FROM movements m
     WHERE m.series_id = ? AND m.owner_id = ?
       AND m.departs_at > ?
       AND m.arrived_at IS NULL
       AND m.card_token IS NULL
       AND m.duress_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM movement_checks c
          WHERE c.movement_id = m.id AND c.checked_at IS NOT NULL
       )
  `).all(seriesId, ownerId, now.toISOString());

  for (const r of rows) {
    await db.prepare('DELETE FROM movements WHERE id = ?').run(r.id);
  }
  return rows.length;
}

module.exports = { HORIZON_DAYS, DAYS, validDays, generate, stop };
