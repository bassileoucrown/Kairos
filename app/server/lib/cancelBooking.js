// The office calling a meeting off.
//
// This used to be three lines in routes/bookings.js that set the status and
// returned 204, and it told the person who had booked absolutely nothing. They
// would have arrived. Nobody notices that bug from the inside, because the row
// looks right and the calendar looks right — the only person who can see it is
// standing in a lobby.
//
// So cancelling is a lib now, and telling them is part of it rather than
// something each caller remembers. Attribution comes along too: an assistant
// cancelling on a principal's behalf is recorded as themselves, which is what
// makes the correspondence trail worth reading afterwards.

const db = require('./db');
const { sendEmail } = require('./email');
const { formatForEmail } = require('./format');

/**
 * Cancel a booking and tell whoever made it.
 *
 * Idempotent: cancelling something already cancelled sends no second email, so
 * a double-tap on a phone does not write to somebody twice.
 */
async function cancelBooking({ booking, cancelledByUserId = null, note = '' }) {
  if (booking.status === 'cancelled') return false;

  await db.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ?").run(booking.id);

  const owner = await db.prepare('SELECT * FROM users WHERE id = ?').get(booking.owner_id);
  const meetingType = await db.prepare('SELECT name FROM meeting_types WHERE id = ?')
    .get(booking.meeting_type_id);
  const when = formatForEmail(booking.start_at, booking.booker_timezone);
  const reason = String(note || '').trim();

  await sendEmail({
    ownerId: booking.owner_id,
    sentByUserId: cancelledByUserId,
    toEmail: booking.booker_email,
    relatedBookingId: booking.id,
    category: 'transactional',
    subject: `Cancelled: ${meetingType?.name || 'your meeting'} with ${owner?.name || 'us'}`,
    body: `Hi ${booking.booker_name},\n\n`
      + `${owner?.name || 'The office'} has had to cancel your ${when} (${booking.booker_timezone}) meeting.`
      + (reason ? `\n\n${reason}` : '')
      + `\n\nYou're welcome to pick another time: /book/${owner?.slug || ''}`,
  });

  return true;
}

module.exports = { cancelBooking };
