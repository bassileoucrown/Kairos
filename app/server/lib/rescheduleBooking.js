const db = require('./db');
const events = require('./bookingEvents');
const { sendEmail } = require('./email');
const { rangeForEmail } = require('./format');
const { refuseIfOver } = require('./bookingWindow');

/**
 * Moving an appointment, from the office's side.
 *
 * THE OFFICE IS NOT BOUND BY THE PUBLISHED HOURS, and that is the whole
 * difference from the booker's own reschedule in routes/publicBooking.js.
 * Bookable hours say when a STRANGER may take a slot; they were never a
 * statement about when the principal is allowed to meet anybody. An assistant
 * moving a meeting to a seven o'clock breakfast, or into a gap they have
 * deliberately kept clear, is doing their job — refusing them because the slot
 * grid says otherwise would make the product argue with the person it works
 * for.
 *
 * WHAT IT WILL NOT DO IS DOUBLE-BOOK. Two meetings on top of each other is not
 * a judgement call, it is a mistake, and the office finds out about it in a
 * corridor. So the only bar is a real clash with another live booking.
 *
 * The event is recorded BEFORE the update, because afterwards the old time
 * exists nowhere — which is the loss lib/bookingEvents.js was written to stop.
 */

/** A live booking of this owner's that would overlap the proposed window. */
async function clashingBooking({ ownerId, bookingId, startAt, endAt }) {
  return db.prepare(`
    SELECT b.id, b.start_at, b.end_at, b.booker_name, mt.name AS meeting_type_name
      FROM bookings b
      JOIN meeting_types mt ON mt.id = b.meeting_type_id
     WHERE b.owner_id = ?
       AND b.id != ?
       AND b.status IN ('confirmed', 'pending')
       AND b.start_at < ?
       AND b.end_at > ?
     LIMIT 1
  `).get(ownerId, bookingId, endAt, startAt);
}

/**
 * Returns { ok: true, booking } or { ok: false, status, error } — prose, since
 * every caller shows it to somebody.
 */
async function rescheduleBooking({ booking, owner, startAt, movedByUserId = null, actorLabel = null, note = '' }) {
  if (booking.status === 'cancelled') {
    return { ok: false, status: 400, error: 'This appointment was cancelled — make a new one instead.' };
  }
  if (booking.status === 'declined') {
    return { ok: false, status: 400, error: 'That request was declined — there is nothing to move.' };
  }
  // The clock closes an appointment as surely as a status does. See
  // lib/bookingWindow.js for why that answer lives in one place.
  const over = refuseIfOver(booking, 'move');
  if (over) return over;

  const start = new Date(startAt);
  if (!startAt || Number.isNaN(start.getTime())) {
    return { ok: false, status: 400, error: 'That is not a valid time.' };
  }

  // The length comes from the booking, not the caller. Moving a meeting is
  // moving it; changing how long it runs for is a different decision and would
  // be an odd thing to do by accident while picking a new time.
  const lengthMs = new Date(booking.end_at).getTime() - new Date(booking.start_at).getTime();
  const end = new Date(start.getTime() + lengthMs);

  const clash = await clashingBooking({
    ownerId: owner.id,
    bookingId: booking.id,
    startAt: start.toISOString(),
    endAt: end.toISOString(),
  });
  if (clash) {
    // Named, because "that time is taken" leaves somebody hunting through a
    // calendar for what took it.
    return {
      ok: false,
      status: 409,
      error: `That overlaps ${clash.meeting_type_name} with ${clash.booker_name}.`,
    };
  }

  await events.record({
    bookingId: booking.id,
    ownerId: owner.id,
    kind: events.KINDS.rescheduled,
    actorUserId: movedByUserId,
    actorLabel,
    fromValue: booking.start_at,
    toValue: start.toISOString(),
    note,
  });
  await db.prepare('UPDATE bookings SET start_at = ?, end_at = ? WHERE id = ?')
    .run(start.toISOString(), end.toISOString(), booking.id);

  // The booker is told, always. Their diary is as real as the principal's, and
  // an appointment that moves without a word is how somebody arrives at an
  // empty room.
  const meetingType = await db.prepare('SELECT name FROM meeting_types WHERE id = ?')
    .get(booking.meeting_type_id);
  const when = rangeForEmail(start.toISOString(), end.toISOString(), booking.booker_timezone || owner.timezone);
  await sendEmail({
    ownerId: owner.id,
    sentByUserId: movedByUserId,
    toEmail: booking.booker_email,
    relatedBookingId: booking.id,
    category: 'transactional',
    subject: `Moved: ${meetingType?.name || 'your meeting'} with ${owner.name}`,
    body: `Hi ${booking.booker_name},\n\n${owner.name}'s office has moved your meeting.`
      + `\n\nIt is now ${when} (${booking.booker_timezone || owner.timezone}).`
      + (note ? `\n\n"${note}"` : '')
      + `\n\nIf that does not work, you can pick another time: /book/manage/${booking.id}`,
  });

  const updated = await db.prepare('SELECT * FROM bookings WHERE id = ?').get(booking.id);
  return { ok: true, booking: updated };
}

/**
 * Same meeting, same start, different length.
 *
 * ITS OWN ACT, not a parameter on the move. Moving a meeting and re-lengthening
 * it are different decisions with different consequences, and folding the
 * second into the first means somebody picking a new time can turn a
 * half-hour into an hour without noticing they did. They stay apart, and each
 * says what it is in the trail.
 *
 * The same rule about the published hours applies — an office may run a
 * meeting long — and the same rule about clashes: growing into whatever sits
 * after it is exactly the mistake worth refusing, and the commonest one, since
 * the extra time lands on the very slot most likely to be taken.
 */
const MIN_MINUTES = 5;
const MAX_MINUTES = 480;

async function setDuration({ booking, owner, minutes, movedByUserId = null, note = '' }) {
  if (booking.status === 'cancelled' || booking.status === 'declined') {
    return { ok: false, status: 400, error: 'This appointment is closed.' };
  }
  const over = refuseIfOver(booking, 'length');
  if (over) return over;
  const mins = Number(minutes);
  if (!Number.isInteger(mins) || mins < MIN_MINUTES || mins > MAX_MINUTES) {
    return {
      ok: false,
      status: 400,
      error: `A meeting runs between ${MIN_MINUTES} and ${MAX_MINUTES} minutes.`,
    };
  }

  const start = new Date(booking.start_at);
  const wasMinutes = Math.round((new Date(booking.end_at) - start) / 60000);
  if (wasMinutes === mins) {
    return { ok: false, status: 400, error: `It already runs ${mins} minutes.` };
  }
  const end = new Date(start.getTime() + mins * 60000);

  const clash = await clashingBooking({
    ownerId: owner.id,
    bookingId: booking.id,
    startAt: booking.start_at,
    endAt: end.toISOString(),
  });
  if (clash) {
    return {
      ok: false,
      status: 409,
      error: `Running that long would overlap ${clash.meeting_type_name} with ${clash.booker_name}.`,
    };
  }

  await events.record({
    bookingId: booking.id,
    ownerId: owner.id,
    kind: events.KINDS.relengthened,
    actorUserId: movedByUserId,
    fromValue: String(wasMinutes),
    toValue: String(mins),
    note,
  });
  await db.prepare('UPDATE bookings SET end_at = ? WHERE id = ?').run(end.toISOString(), booking.id);

  // The booker is told. A meeting that quietly runs an extra half hour is a
  // change to their diary that they find out about by overrunning.
  const meetingType = await db.prepare('SELECT name FROM meeting_types WHERE id = ?')
    .get(booking.meeting_type_id);
  const when = rangeForEmail(booking.start_at, end.toISOString(), booking.booker_timezone || owner.timezone);
  await sendEmail({
    ownerId: owner.id,
    sentByUserId: movedByUserId,
    toEmail: booking.booker_email,
    relatedBookingId: booking.id,
    category: 'transactional',
    subject: `Now ${mins} minutes: ${meetingType?.name || 'your meeting'} with ${owner.name}`,
    body: `Hi ${booking.booker_name},\n\n${owner.name}'s office has changed the length of your meeting.`
      + `\n\nIt now runs ${when} (${booking.booker_timezone || owner.timezone}).`
      + (note ? `\n\n"${note}"` : '')
      + `\n\nIf that does not work: /book/manage/${booking.id}`,
  });

  const updated = await db.prepare('SELECT * FROM bookings WHERE id = ?').get(booking.id);
  return { ok: true, booking: updated };
}

module.exports = {
  rescheduleBooking, setDuration, clashingBooking, MIN_MINUTES, MAX_MINUTES,
};
