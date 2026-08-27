const crypto = require('crypto');
const db = require('./db');
const formats = require('./meetingFormats');

/**
 * Putting something straight in the diary.
 *
 * WHAT WAS MISSING. Every booking in Kairos arrived through the public page —
 * a stranger picking from published hours against a meeting type with a
 * shareable link. That is the right front door and it is not how most of a
 * principal's diary is actually filled. A meeting is agreed on a call, a
 * driver is told to come at six, a board member says "same time Thursday" in a
 * corridor. The office then had to either invent a bookable link for it or
 * keep it somewhere that is not the diary. So the day sheet showed a fraction
 * of the day and quietly implied it was the day.
 *
 * WHAT IS DELIBERATELY DIFFERENT FROM THE PUBLIC DOOR:
 *
 *   NO AVAILABILITY CHECK. Published hours are an offer made to strangers, not
 *   a fact about when the principal can be somewhere. The office slotting in a
 *   seven a.m. call is not violating a rule; it is doing the job. Refusing on
 *   the grounds that Tuesday at seven is not bookable would make this feature
 *   useless for the cases that need it most.
 *
 *   NO APPROVAL TIER. Tiers exist so a stranger cannot land on a principal's
 *   calendar unreviewed. The principal's own office IS the review.
 *
 *   NO EMAIL TO THE OTHER PERSON unless it is asked for. "Slot it in" is about
 *   the diary, not about correspondence, and an unexpected confirmation sent
 *   to a board member because an assistant was tidying the calendar is a much
 *   worse failure than a missing one. Off by default, on when the caller says.
 *
 * WHAT IS THE SAME, and has to be: a clash is still a clash. A principal
 * genuinely cannot be in two places, so an overlap is refused and named rather
 * than accepted quietly — with a way to say "yes, both", because a call taken
 * during a car journey is a real thing and only the office knows.
 */

/**
 * The meeting type the app keeps for this, made on demand.
 *
 * A booking must name a meeting type — that is a NOT NULL on the table and a
 * join half the app relies on — but an internal booking has no type in the
 * sense the owner means: nobody chose it and nobody can book against it. So
 * there is exactly one per owner, marked internal, kept out of the public page
 * AND out of the owner's own list of types.
 *
 * ON DEMAND rather than at signup, so an office that never uses this never has
 * one. Two assistants slotting something in at the same moment would both find
 * none and both try to make one; the unique index on (owner_id, slug) settles
 * that, and the loser reads the winner's row rather than failing.
 */
async function internalType(ownerId) {
  const existing = await db.prepare(
    "SELECT * FROM meeting_types WHERE owner_id = ? AND kind = 'internal'",
  ).get(ownerId);
  if (existing) return existing;

  const id = crypto.randomUUID();
  try {
    await db.prepare(`
      INSERT INTO meeting_types
        (id, owner_id, name, slug, duration_minutes, description, location_type,
         buffer_before_minutes, buffer_after_minutes, access_tier, color,
         is_active, kind, created_at)
      VALUES (?, ?, 'In the diary', 'in-the-diary', 30, '', 'in_person', 0, 0, 1,
              '#3E6357', 0, 'internal', ?)
    `).run(id, ownerId, new Date().toISOString());
  } catch {
    // Lost the race, or the slug is taken by a public type this owner made
    // and called "In the diary" long ago. Either way, ask again.
  }
  const now = await db.prepare(
    "SELECT * FROM meeting_types WHERE owner_id = ? AND kind = 'internal'",
  ).get(ownerId);
  if (now) return now;
  // The slug was taken by a public type. Give this one a name of its own
  // rather than fighting over it.
  const alt = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO meeting_types
      (id, owner_id, name, slug, duration_minutes, description, location_type,
       buffer_before_minutes, buffer_after_minutes, access_tier, color,
       is_active, kind, created_at)
    VALUES (?, ?, 'In the diary', ?, 30, '', 'in_person', 0, 0, 1,
            '#3E6357', 0, 'internal', ?)
  `).run(alt, ownerId, `in-the-diary-${alt.slice(0, 8)}`, new Date().toISOString());
  return db.prepare('SELECT * FROM meeting_types WHERE id = ?').get(alt);
}

/**
 * Anything already on the diary that this would sit on top of.
 *
 * Touching is not overlapping: a meeting ending at four and another starting
 * at four are back to back, which is the most ordinary shape a day has.
 */
async function clashes(ownerId, startIso, endIso, exceptId = null) {
  const rows = await db.prepare(`
    SELECT b.id, b.booker_name, b.start_at, b.end_at, mt.name AS meeting_name
    FROM bookings b
    LEFT JOIN meeting_types mt ON mt.id = b.meeting_type_id
    WHERE b.owner_id = ?
      AND b.status IN ('confirmed', 'pending')
      AND b.start_at < ?
      AND b.end_at > ?
  `).all(ownerId, endIso, startIso);
  return rows.filter((r) => r.id !== exceptId);
}

/**
 * Create it. Answers with a problem rather than throwing, because every
 * failure here is a sentence for somebody's screen.
 */
async function place(ownerId, {
  startAt, durationMinutes = 30, name, email = '', note = '',
  format = null, allowOverlap = false, notify = false,
}) {
  const who = String(name || '').trim();
  if (!who) return { problem: 'Say who the meeting is with.' };

  const start = new Date(startAt);
  if (Number.isNaN(start.getTime())) return { problem: 'That is not a time.' };

  const mins = Number(durationMinutes);
  if (!Number.isFinite(mins) || mins < 5 || mins > 12 * 60) {
    return { problem: 'A meeting runs between 5 minutes and 12 hours.' };
  }
  const end = new Date(start.getTime() + mins * 60000);

  // The past is allowed, and on purpose: an assistant writing up a meeting
  // that happened this morning is recording the diary, not booking it. Every
  // other route refuses a past time because a stranger booking yesterday is a
  // mistake; here it is the job.

  const chosen = formats.isFormat(format) ? format : 'in_person';
  const noteProblem = formats.problem(chosen, note);
  if (noteProblem) return { problem: noteProblem };

  const over = await clashes(ownerId, start.toISOString(), end.toISOString());
  if (over.length > 0 && !allowOverlap) {
    const first = over[0];
    return {
      problem: `That overlaps ${first.meeting_name || 'something'} with ${first.booker_name}. `
        + 'Move one of them, or say to keep both.',
      clashes: over.map((c) => ({
        id: c.id, name: c.meeting_name, with: c.booker_name,
        startAt: c.start_at, endAt: c.end_at,
      })),
    };
  }

  const type = await internalType(ownerId);
  const id = crypto.randomUUID();
  const videoRoom = chosen === 'video'
    ? `kairos-${crypto.randomBytes(8).toString('hex')}`
    : null;

  await db.prepare(`
    INSERT INTO bookings
      (id, meeting_type_id, owner_id, booker_name, booker_email, booker_timezone,
       start_at, end_at, status, video_room, format, format_note, format_state, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?, ?, ?)
  `).run(
    id, type.id, ownerId, who, String(email || '').trim().toLowerCase(),
    // The principal's own zone: this was written down by their office, not
    // chosen by somebody abroad.
    (await db.prepare('SELECT timezone FROM users WHERE id = ?').get(ownerId))?.timezone || 'UTC',
    start.toISOString(), end.toISOString(), videoRoom,
    chosen, String(note || '').trim() || null, formats.STATES.agreed,
    new Date().toISOString(),
  );

  return { id, notify: !!notify && !!String(email || '').trim() };
}

module.exports = { place, clashes, internalType };
