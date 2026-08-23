// The story of a booking, as opposed to its state.
//
// Everything that changes a booking writes a line here, and nothing ever
// edits or removes one. The table is append-only by convention rather than by
// constraint, which is the honest description: a database that lets you
// UPDATE is not an audit log, and pretending otherwise would be worse than
// saying so. What it does give is a record that no ordinary product path
// touches — every write in this file is an INSERT.
//
// WHY THIS EXISTS AT ALL. A reschedule overwrites start_at. Before this, the
// time a meeting was first agreed for was gone the moment it moved, so
// "when did we originally say?" had no answer anywhere in the system. That is
// the question this table was added to answer, and the reason from_value and
// to_value are on every row rather than only on the kinds that obviously need
// them.
//
// WHO DID IT. Three kinds of actor, and they are genuinely different:
//   - somebody in the office, who has an account: actor_user_id
//   - the booker, who does not: actor_label, frozen at the time, because
//     people rename themselves and a trail that renames retroactively is a
//     trail you cannot rely on
//   - Kairos itself, on a schedule: neither
// Collapsing these into one string would lose the only distinction that
// matters when somebody asks who cancelled.

const crypto = require('crypto');
const db = require('./db');

const KINDS = {
  booked: 'booked',
  format_proposed: 'format_proposed',
  format_countered: 'format_countered',
  format_agreed: 'format_agreed',
  approved: 'approved',
  declined: 'declined',
  cancelled: 'cancelled',
  rescheduled: 'rescheduled',
};

/**
 * Write one line. Never throws into the caller's path.
 *
 * A booking that succeeded must not be reported as failed because its
 * bookkeeping did — the meeting is real either way, and a 500 after the row is
 * committed would tell the booker to try again and give the office a
 * duplicate. So a failure here is logged and swallowed. That is a deliberate
 * trade: the trail may have a hole, the diary may not have a lie.
 */
async function record({
  bookingId, ownerId, kind,
  actorUserId = null, actorLabel = '',
  fromValue = null, toValue = null, note = '',
}) {
  try {
    await db.prepare(`
      INSERT INTO booking_events
        (id, booking_id, owner_id, kind, actor_user_id, actor_label, from_value, to_value, note, at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(crypto.randomUUID(), bookingId, ownerId, kind, actorUserId, String(actorLabel || ''),
      fromValue, toValue, String(note || ''), new Date().toISOString());
  } catch (err) {
    console.error('[booking-events] could not record %s for %s: %s', kind, bookingId, err.message);
  }
}

/**
 * One line of prose per event.
 *
 * Built here rather than in the client because the vocabulary belongs with
 * whoever writes it — two screens each inventing their own phrasing for
 * `format_countered` is how a product starts describing the same thing two
 * ways.
 *
 * `formatLabel` and `when` are passed in rather than imported so this stays a
 * pure function of the row: the same event renders the same sentence whichever
 * screen asks, in whichever timezone it asks for.
 */
function headline(event, { formatLabel, whenLabel }) {
  const to = event.to_value;
  const from = event.from_value;
  switch (event.kind) {
    case KINDS.booked:
      return 'Booked';
    case KINDS.format_proposed:
      return `Asked to meet ${formatLabel(to).toLowerCase()} instead of ${formatLabel(from).toLowerCase()}`;
    case KINDS.format_countered:
      return `Suggested ${formatLabel(to).toLowerCase()} instead`;
    case KINDS.format_agreed:
      // Name what it replaced when there was something to replace. This line
      // is how the office answers "was an exception made for them?", and
      // "Agreed on in person" on its own does not answer it — the useful half
      // is that in person is not what this meeting type usually is. When the
      // two match there is nothing to contrast, so it stays the short form.
      return from && from !== to
        ? `Agreed on ${formatLabel(to).toLowerCase()}, rather than ${formatLabel(from).toLowerCase()}`
        : `Agreed on ${formatLabel(to).toLowerCase()}`;
    case KINDS.approved:
      return 'Approved';
    case KINDS.declined:
      return 'Declined';
    case KINDS.cancelled:
      return 'Cancelled';
    case KINDS.rescheduled:
      // The whole reason for the table. Both times, spelled out, because
      // "moved" without the old time is the loss this was built to stop.
      return `Moved from ${whenLabel(from)} to ${whenLabel(to)}`;
    default:
      return event.kind;
  }
}

async function forBooking(ownerId, bookingId) {
  return await db.prepare(`
    SELECT e.*, u.name AS actor_name
    FROM booking_events e
    LEFT JOIN users u ON u.id = e.actor_user_id
    WHERE e.booking_id = ? AND e.owner_id = ?
    ORDER BY e.at ASC
  `).all(bookingId, ownerId);
}

module.exports = { KINDS, record, headline, forBooking };
