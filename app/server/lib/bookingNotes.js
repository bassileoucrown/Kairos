const crypto = require('crypto');
const db = require('./db');
const { sendEmail } = require('./email');
const { formatForEmail } = require('./format');

/**
 * What is said about an appointment, and to whom.
 *
 * THE ONE RULE. A booking's manage link asks for no password — holding
 * /book/manage/<id> is what makes somebody the booker. So everything the
 * booker's side can reach is, in effect, public to anyone that link is
 * forwarded to. The office's own preparation must therefore never travel on
 * the same rail as a message written for the booker.
 *
 * The filter lives HERE, in one function, rather than in each route. A route
 * that forgets a WHERE clause leaks a principal's private prep to a stranger,
 * and that is not a mistake to leave available: `forBooker` cannot return an
 * office note, because it does not ask for one.
 */

const VISIBILITIES = new Set(['office', 'shared']);

/** Everything about this appointment — both registers. Office eyes only. */
async function forOffice(ownerId, bookingId) {
  return db.prepare(`
    SELECT n.*, u.name AS author_name
      FROM booking_notes n
      LEFT JOIN users u ON u.id = n.author_user_id
     WHERE n.booking_id = ? AND n.owner_id = ?
     ORDER BY n.created_at ASC
  `).all(bookingId, ownerId);
}

/**
 * What the booker may see: shared notes only.
 *
 * Takes no ownerId, because the booking id is the whole credential on that
 * side and adding one would only invite a caller to pass the wrong thing.
 */
async function forBooker(bookingId) {
  return db.prepare(`
    SELECT n.id, n.body, n.created_at, n.author_user_id, u.name AS author_name
      FROM booking_notes n
      LEFT JOIN users u ON u.id = n.author_user_id
     WHERE n.booking_id = ? AND n.visibility = 'shared'
     ORDER BY n.created_at ASC
  `).all(bookingId);
}

function serialize(n) {
  return {
    id: n.id,
    body: n.body,
    visibility: n.visibility || 'shared',
    // The booker has no account, so an absent author is the booker rather than
    // an unknown. Said as a name so no screen has to work it out.
    authorName: n.author_name || null,
    fromBooker: !n.author_user_id,
    createdAt: n.created_at,
  };
}

async function add({ bookingId, ownerId, visibility, authorUserId = null, body }) {
  const text = String(body || '').trim();
  if (!text) return { ok: false, status: 400, error: 'Write something first.' };
  if (!VISIBILITIES.has(visibility)) {
    return { ok: false, status: 400, error: 'A note is either for the office or for the booker.' };
  }
  const id = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO booking_notes (id, booking_id, owner_id, visibility, author_user_id, body, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, bookingId, ownerId, visibility, authorUserId, text.slice(0, 4000), new Date().toISOString());
  const row = await db.prepare(`
    SELECT n.*, u.name AS author_name FROM booking_notes n
    LEFT JOIN users u ON u.id = n.author_user_id WHERE n.id = ?
  `).get(id);
  return { ok: true, note: serialize(row) };
}

/**
 * A word to the booker after the meeting.
 *
 * Deliberately its own function rather than "a shared note that happens to be
 * sent". A follow-up is the one note somebody is waiting on — what was agreed,
 * what is owed, who does what next — and if it only appeared on a page the
 * booker has no reason to revisit, it would not arrive. So it is written to
 * the record AND emailed, and the email carries the text rather than telling
 * them to go and look: this one was composed for them.
 */
async function followUp({ booking, owner, authorUserId, body }) {
  const added = await add({
    bookingId: booking.id,
    ownerId: owner.id,
    visibility: 'shared',
    authorUserId,
    body,
  });
  if (!added.ok) return added;

  const meetingType = await db.prepare('SELECT name FROM meeting_types WHERE id = ?')
    .get(booking.meeting_type_id);
  const when = formatForEmail(booking.start_at, booking.booker_timezone || owner.timezone);
  await sendEmail({
    ownerId: owner.id,
    sentByUserId: authorUserId,
    toEmail: booking.booker_email,
    relatedBookingId: booking.id,
    category: 'transactional',
    subject: `Following up: ${meetingType?.name || 'your meeting'} with ${owner.name}`,
    body: `Hi ${booking.booker_name},\n\nFollowing up on ${when}.\n\n${added.note.body}`
      + `\n\nYou can reply here: /book/manage/${booking.id}`,
  });
  return added;
}

module.exports = { forOffice, forBooker, add, followUp, serialize, VISIBILITIES };
