const crypto = require('crypto');
const db = require('./db');
const tripPrivacy = require('./tripPrivacy');

// A reminder somebody set for themselves, on one appointment.
//
// ONE ROW PER PERSON PER APPOINTMENT. A chief of staff wanting an hour to get
// the brief together and a principal wanting fifteen minutes to finish what
// they are doing are not in disagreement — they are two people with different
// jobs looking at the same four o'clock. A single lead time on the appointment
// would have made them argue over one number, and whoever lost would have
// turned reminders off.
//
// THE BOOKER IS NOT IN HERE. Their day-ahead email stays automatic in
// lib/reminders.js: they have no account to set anything with, and somebody
// travelling to a meeting needs the warning early whatever the office thinks.
//
// SETTING A REMINDER IS NOT A WAY TO FIND OUT SOMETHING EXISTS. Every call
// resolves the appointment through the same visibility rule the day sheet
// uses, and a subject the caller cannot see is reported as not found rather
// than as refused — the difference matters when the thing being hidden is that
// the principal is somewhere on a private trip at all.

// What the picker offers. Minutes, because that is the unit people say out
// loud — "give me twenty minutes' notice" — even for the long ones.
//
// NOTHING SHORTER THAN THE SWEEP. A reminder fires only if a pass of the sweep
// lands inside its window, and the window is exactly as wide as the lead. The
// sweep runs every fifteen minutes (REMINDER_SWEEP_MS), so a five-minute lead
// had roughly one chance in three of being caught and a ten-minute lead two in
// three — and a miss is permanent rather than late, because the next pass finds
// the meeting already started and skips it on purpose.
//
// So five and ten were removed rather than left on the list. An offer the
// deployment cannot keep is worse than a shorter list: somebody sets a
// five-minute warning, is told nothing twice out of three times, and learns
// that Kairos does not remind them — which is a lesson that then applies to
// every other lead on here, all of which do work.
//
// FIFTEEN IS THE FLOOR BECAUSE THE SWEEP IS FIFTEEN. If the sweep interval is
// ever shortened — a plan where the container is not stopped between requests,
// and a scheduler calling /api/sweep every minute — these come back, and this
// comment is where to look. See lib/reminders.js SWEEP_INTERVAL_MS.
const PRESETS = [15, 30, 45, 60, 120, 1440];

// What a booking gets when nobody has chosen. This is the lead time the app
// has always used for the principal, kept as the default so that turning a
// choice on does not quietly change what everybody already relies on.
const DEFAULT_MINUTES = 30;

const MIN_MINUTES = 1;
// Four weeks. Not a guess about what is useful — a bound, so a typo of 100000
// cannot write a row the sweep will carry forever.
const MAX_MINUTES = 40320;

const KINDS = new Set(['itinerary', 'booking']);

function problem(minutes) {
  const n = Number(minutes);
  if (!Number.isInteger(n)) return 'How many minutes before?';
  if (n < MIN_MINUTES) return 'A reminder has to be at least a minute before.';
  if (n > MAX_MINUTES) return 'That is further ahead than a reminder can be set.';
  return null;
}

/**
 * The appointment, if this viewer may see it.
 *
 * Returns null for "no such thing" and for "not yours to see", deliberately
 * the same answer. The visibility rule is tripPrivacy's, the same one
 * buildDay filters the day sheet with, rather than a second rule that would
 * drift from it.
 */
async function resolveSubject(kind, subjectId, ownerId, viewerId) {
  if (!KINDS.has(kind)) return null;

  if (kind === 'itinerary') {
    const item = await db.prepare(
      'SELECT id, owner_id, title, start_at, trip_id, status FROM itinerary_items WHERE id = ? AND owner_id = ?',
    ).get(subjectId, ownerId);
    if (!item) return null;
    if (item.trip_id) {
      const hidden = await tripPrivacy.hiddenTripIds(ownerId, viewerId);
      if (hidden.has(item.trip_id)) return null;
    }
    return { id: item.id, title: item.title, startAt: item.start_at, status: item.status };
  }

  const b = await db.prepare(`
    SELECT b.id, b.owner_id, b.start_at, b.status, mt.name AS meeting_name
    FROM bookings b LEFT JOIN meeting_types mt ON mt.id = b.meeting_type_id
    WHERE b.id = ? AND b.owner_id = ?
  `).get(subjectId, ownerId);
  if (!b) return null;
  return { id: b.id, title: b.meeting_name || 'Appointment', startAt: b.start_at, status: b.status };
}

/** This user's reminder on this appointment, or null. */
async function mine(userId, kind, subjectId) {
  const row = await db.prepare(`
    SELECT * FROM appointment_reminders
    WHERE user_id = ? AND subject_kind = ? AND subject_id = ?
  `).get(userId, kind, subjectId);
  return row ? serialize(row) : null;
}

function serialize(row) {
  return {
    minutes: row.minutes_before,
    sent: row.reminder_stage === 'sent',
    setAt: row.updated_at,
  };
}

/**
 * Set or replace it. Replacing clears the sent stamp: somebody who moves their
 * reminder from fifteen minutes to an hour is asking to be told again.
 */
async function set(userId, ownerId, kind, subjectId, minutes) {
  const now = new Date().toISOString();
  const existing = await db.prepare(`
    SELECT id FROM appointment_reminders
    WHERE user_id = ? AND subject_kind = ? AND subject_id = ?
  `).get(userId, kind, subjectId);

  if (existing) {
    await db.prepare(`
      UPDATE appointment_reminders
      SET minutes_before = ?, reminder_stage = NULL, updated_at = ?
      WHERE id = ?
    `).run(minutes, now, existing.id);
  } else {
    await db.prepare(`
      INSERT INTO appointment_reminders
        (id, user_id, owner_id, subject_kind, subject_id, minutes_before, reminder_stage, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)
    `).run(crypto.randomUUID(), userId, ownerId, kind, subjectId, minutes, now, now);
  }
  return mine(userId, kind, subjectId);
}

async function clear(userId, kind, subjectId) {
  await db.prepare(`
    DELETE FROM appointment_reminders
    WHERE user_id = ? AND subject_kind = ? AND subject_id = ?
  `).run(userId, kind, subjectId);
}

/**
 * Everything set on one appointment, for the screen that shows it.
 *
 * Names are included because "Tunde is reminded an hour before" is the useful
 * sentence; a count is not. Whose reminders these are is not sensitive within
 * an office that already shares the diary.
 */
async function forSubject(kind, subjectId) {
  const rows = await db.prepare(`
    SELECT r.*, u.name AS person_name
    FROM appointment_reminders r JOIN users u ON u.id = r.user_id
    WHERE r.subject_kind = ? AND r.subject_id = ?
    ORDER BY r.minutes_before DESC
  `).all(kind, subjectId);
  return rows.map((r) => ({ ...serialize(r), userId: r.user_id, personName: r.person_name }));
}

/**
 * A MEETING THAT HAS MOVED DESERVES A FRESH WARNING.
 *
 * Called wherever an appointment's start time changes — the delay cascade, a
 * reschedule, an assistant dragging something an hour later. Without it a
 * reminder that already fired for the old time stays stamped, and the one
 * occasion a person most needs telling is the one they are not told about.
 *
 * The same rule the rest of lib/reminders.js follows for tasks and stages.
 */
async function reopen(kind, subjectId) {
  await db.prepare(`
    UPDATE appointment_reminders SET reminder_stage = NULL
    WHERE subject_kind = ? AND subject_id = ?
  `).run(kind, subjectId);
}

/** A subject that no longer exists keeps no reminders. */
async function forget(kind, subjectId) {
  await db.prepare(
    'DELETE FROM appointment_reminders WHERE subject_kind = ? AND subject_id = ?',
  ).run(kind, subjectId);
}

module.exports = {
  PRESETS, DEFAULT_MINUTES, MIN_MINUTES, MAX_MINUTES, KINDS,
  problem, resolveSubject, mine, set, clear, forSubject, reopen, forget,
};
