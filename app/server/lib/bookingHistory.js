// What happened with the people who booked you.
//
// A principal's own list already existed and showed two things: confirmed
// meetings ahead, and confirmed meetings behind. An assistant needs more than
// that, because the questions they get asked are of a different kind — "did
// that man from the bank ever actually come?", "we cancelled on her once,
// didn't we?", "what did we tell them?". None of those can be answered from a
// list that only holds what is still standing.
//
// So this adds the two states the old list dropped on the floor — cancelled
// and declined — and a search, and it is shared by both paths so the principal
// and their office are never looking at differently-shaped truth.
//
// WHAT THIS IS NOT. The bookings table records a booking's state, not its
// story: there is no column saying when it was cancelled or who cancelled it,
// and a reschedule overwrites start_at in place, so the time it was first
// booked for is gone. What survives is the correspondence — every transition
// sends an email, and those rows are dated and attributed. That is the trail
// this exposes, and it is honest about being a trail of what was said rather
// than a ledger of what was done.

const db = require('./db');
const formats = require('./meetingFormats');

// Every field both callers need, in one place, so the principal's list and the
// assistant's cannot drift into showing different things about one booking.
const SELECT = `
  SELECT b.*, mt.name AS meeting_type_name, mt.color AS meeting_type_color,
    mt.access_tier, mt.location_type,
    (SELECT 1 FROM briefs br WHERE br.booking_id = b.id) AS has_brief,
    (SELECT COUNT(*) FROM emails e WHERE e.related_booking_id = b.id) AS letters
  FROM bookings b
  JOIN meeting_types mt ON mt.id = b.meeting_type_id
`;

const SCOPES = new Set(['upcoming', 'past', 'cancelled', 'pending', 'all']);

function serialize(b) {
  const format = b.format || b.location_type;
  return {
    id: b.id,
    meetingTypeId: b.meeting_type_id,
    meetingTypeName: b.meeting_type_name,
    meetingTypeColor: b.meeting_type_color,
    accessTier: b.access_tier,
    bookerName: b.booker_name,
    bookerEmail: b.booker_email,
    bookerTimezone: b.booker_timezone,
    startAt: b.start_at,
    endAt: b.end_at,
    status: b.status,
    videoRoom: b.video_room,
    // How it was to happen, and whether that was the principal's usual — the
    // office is regularly asked "did we agree to see them in person?" and the
    // answer is not in the meeting type.
    format,
    formatLabel: formats.label(format),
    formatNote: b.format_note || null,
    formatState: b.format_state || 'agreed',
    counterFormatLabel: b.counter_format ? formats.label(b.counter_format) : null,
    usualFormat: b.location_type,
    usualFormatLabel: formats.label(b.location_type),
    wasUnusual: !!b.format && b.format !== b.location_type,
    hasBrief: !!b.has_brief,
    letters: Number(b.letters || 0),
    createdAt: b.created_at,
  };
}

// LIKE is case-sensitive in Postgres and not in SQLite, so both sides are
// lowered rather than trusting the backend to agree. The wildcards are escaped
// because a booker with an underscore in their address is not a pattern.
function likeTerm(q) {
  return `%${String(q).toLowerCase().replace(/([\\%_])/g, '\\$1')}%`;
}

/**
 * One scope of a principal's bookings, newest question first.
 *
 * Cancelled and declined are deliberately one scope. To the office they are
 * the same event — a meeting that is not going to happen — and separating them
 * would mean checking two lists to answer one question.
 */
async function list(ownerId, { scope = 'upcoming', q = '' } = {}) {
  const chosen = SCOPES.has(scope) ? scope : 'upcoming';
  const now = new Date().toISOString();
  const where = ['b.owner_id = ?'];
  const params = [ownerId];

  if (chosen === 'upcoming') {
    where.push("b.status = 'confirmed'", 'b.start_at >= ?');
    params.push(now);
  } else if (chosen === 'past') {
    where.push("b.status = 'confirmed'", 'b.start_at < ?');
    params.push(now);
  } else if (chosen === 'cancelled') {
    where.push("b.status IN ('cancelled', 'declined')");
  } else if (chosen === 'pending') {
    where.push("b.status = 'pending'");
  }

  const term = String(q || '').trim();
  if (term) {
    where.push(
      "(LOWER(b.booker_name) LIKE ? ESCAPE '\\'"
      + " OR LOWER(b.booker_email) LIKE ? ESCAPE '\\'"
      + " OR LOWER(mt.name) LIKE ? ESCAPE '\\')",
    );
    params.push(likeTerm(term), likeTerm(term), likeTerm(term));
  }

  // Ahead of you, soonest first; behind you, most recent first. Both are the
  // order somebody reads the list in.
  const order = chosen === 'past' || chosen === 'cancelled' ? 'DESC' : 'ASC';
  const rows = await db.prepare(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY b.start_at ${order}`)
    .all(...params);
  return rows.map(serialize);
}

async function get(ownerId, bookingId) {
  const row = await db.prepare(`${SELECT} WHERE b.id = ? AND b.owner_id = ?`).get(bookingId, ownerId);
  return row ? serialize(row) : null;
}

/**
 * What was said about one booking, and by whom.
 *
 * Subjects only — never the bodies. A confirmation email carries the booker's
 * manage link, which is that booking's access capability: anybody holding it
 * can move or cancel the meeting as the booker. An assistant has their own,
 * attributed way to do both, so handing them the booker's would only blur who
 * did what. The subject line answers the question that gets asked.
 */
async function trail(ownerId, bookingId) {
  const rows = await db.prepare(`
    SELECT e.id, e.subject, e.to_email, e.category, e.created_at, u.name AS sent_by_name
    FROM emails e
    LEFT JOIN users u ON u.id = e.sent_by_user_id
    WHERE e.related_booking_id = ? AND e.owner_id = ?
    ORDER BY e.created_at ASC
  `).all(bookingId, ownerId);

  return rows.map((e) => ({
    id: e.id,
    subject: e.subject,
    toEmail: e.to_email,
    category: e.category,
    at: e.created_at,
    // A null sender is Kairos acting on its own — a booking confirmation, a
    // reminder. Saying "Kairos" is more use than saying nobody.
    by: e.sent_by_name || 'Kairos',
    byPerson: !!e.sent_by_name,
  }));
}

module.exports = { list, get, trail, SCOPES };
