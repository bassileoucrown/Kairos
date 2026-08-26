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
// WHERE THE STORY COMES FROM. The bookings row records state, not story: it
// says a meeting is confirmed for Thursday and cannot say it was booked for
// Tuesday and moved twice. Two other tables hold what happened —
// booking_events, which records the doing, and emails, which records the
// telling. The trail below merges them, because what somebody wants is the
// sequence, and separating the doing from the telling makes that sequence
// something the reader has to reassemble in their head.

const db = require('./db');
const formats = require('./meetingFormats');
const events = require('./bookingEvents');
const { formatForEmail } = require('./format');
const { isOver } = require('./bookingWindow');

// Every field both callers need, in one place, so the principal's list and the
// assistant's cannot drift into showing different things about one booking.
const SELECT = `
  SELECT b.*, mt.name AS meeting_type_name, mt.color AS meeting_type_color,
    mt.access_tier, mt.location_type,
    (SELECT 1 FROM briefs br WHERE br.booking_id = b.id) AS has_brief,
    (SELECT COUNT(*) FROM emails e WHERE e.related_booking_id = b.id)
      + (SELECT COUNT(*) FROM booking_events ev WHERE ev.booking_id = b.id) AS trail_length
  FROM bookings b
  JOIN meeting_types mt ON mt.id = b.meeting_type_id
`;

const SCOPES = new Set(['upcoming', 'past', 'cancelled', 'pending', 'all', 'range']);

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
    // Whether the arrangements are still arrangements. Answered here, from
    // lib/bookingWindow.js, so the screen hides exactly the verbs the server
    // would refuse — a button that exists and always fails is worse than one
    // that is not offered. Not stored on the row: nobody decided a meeting is
    // in the past, the clock did. See that file.
    over: isOver(b),
    videoRoom: b.video_room,
    // How it was to happen, and whether that was the principal's usual — the
    // office is regularly asked "did we agree to see them in person?" and the
    // answer is not in the meeting type.
    format,
    formatLabel: formats.label(format),
    formatNote: b.format_note || null,
    formatState: b.format_state || 'agreed',
    counterFormat: b.counter_format || null,
    counterFormatLabel: b.counter_format ? formats.label(b.counter_format) : null,
    counterFormatNote: b.counter_format_note || null,
    usualFormat: b.location_type,
    usualFormatLabel: formats.label(b.location_type),
    wasUnusual: !!b.format && b.format !== b.location_type,
    // The office can suggest another format from this list now that a
    // booker's choice no longer holds the booking, so the choices travel with
    // the row rather than being fetched a second time to draw one picker.
    formats: formats.offer(b.location_type),
    hasBrief: !!b.has_brief,
    trailLength: Number(b.trail_length || 0),
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
 *
 * `range` is the calendar's scope, and the only one that takes dates: whatever
 * falls between `from` and `to`, forwards or backwards, confirmed or still
 * being asked for. A calendar is the one place that has to be able to look at
 * the past, which is what makes a default of "upcoming" wrong for it.
 */
async function list(ownerId, { scope = 'upcoming', q = '', from = null, to = null } = {}) {
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
  } else if (chosen === 'range') {
    // Held time and agreed time both occupy the diary; a request nobody has
    // answered is exactly the thing you need to see before agreeing to
    // something else at the same hour. What is off is off: a cancelled
    // meeting on a calendar is a meeting somebody plans around by mistake.
    where.push("b.status IN ('confirmed', 'pending')");
    if (from) { where.push('b.start_at >= ?'); params.push(String(from)); }
    if (to) { where.push('b.start_at < ?'); params.push(String(to)); }
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
 * Everything that happened to one booking, and everything that was said about
 * it, in one order.
 *
 * Two sources, deliberately merged rather than shown as two lists. What a
 * person wants is the sequence — booked, we wrote to them, the office
 * suggested a video call, we wrote again, they agreed — and splitting the
 * doing from the telling makes that sequence something the reader has to
 * reassemble in their head.
 *
 * Email lines carry subjects only, never bodies. A confirmation email holds
 * the booker's manage link, which is that booking's access capability:
 * anybody with it can move or cancel the meeting as the booker. An assistant
 * has their own attributed way to do both, so handing them the booker's would
 * only blur who did what.
 */
async function trail(ownerId, bookingId) {
  const owner = await db.prepare('SELECT timezone FROM users WHERE id = ?').get(ownerId);
  const tz = owner?.timezone || 'UTC';
  const whenLabel = (iso) => (iso ? formatForEmail(iso, tz) : 'an unknown time');

  const letters = await db.prepare(`
    SELECT e.id, e.subject, e.to_email, e.category, e.created_at, u.name AS sent_by_name
    FROM emails e
    LEFT JOIN users u ON u.id = e.sent_by_user_id
    WHERE e.related_booking_id = ? AND e.owner_id = ?
  `).all(bookingId, ownerId);

  const happenings = await events.forBooking(ownerId, bookingId);

  const lines = [
    ...happenings.map((e) => ({
      id: e.id,
      source: 'event',
      kind: e.kind,
      at: e.at,
      headline: events.headline(e, { formatLabel: formats.label, whenLabel }),
      detail: e.note || '',
      // An office member has an account and is named from it. The booker has
      // no account and is named by what they typed. Kairos is neither.
      by: e.actor_name || e.actor_label || 'Kairos',
      byPerson: !!(e.actor_name || e.actor_label),
      byOffice: !!e.actor_user_id,
    })),
    ...letters.map((e) => ({
      id: e.id,
      source: 'email',
      kind: 'sent',
      at: e.created_at,
      headline: e.subject,
      detail: `to ${e.to_email}`,
      by: e.sent_by_name || 'Kairos',
      byPerson: !!e.sent_by_name,
      byOffice: !!e.sent_by_name,
    })),
  ];

  // Same instant, event before the letter about it: the thing happened, then
  // we wrote. Ties are common because both are written in the same handler.
  lines.sort((a, b) => (new Date(a.at) - new Date(b.at))
    || (a.source === b.source ? 0 : (a.source === 'event' ? -1 : 1)));
  return lines;
}

module.exports = { list, get, trail, SCOPES };
