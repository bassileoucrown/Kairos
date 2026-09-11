/**
 * Whether an appointment is still something you can do anything about.
 *
 * WHY THIS IS A MODULE AND NOT AN `IF`. Three verbs act on a booking — move it,
 * change its length, call it off — and each one is reachable from four places:
 * the principal's own routes, the delegated PA routes, the booker's manage
 * link, and the office's own screens. That is twelve doors onto one question,
 * and a question answered twelve times is a question answered differently
 * twelve times. It is answered here, once.
 *
 * WHAT "OVER" MEANS, AND WHY IT IS THE END TIME. A meeting that has started is
 * still live: it is the one that runs over, and "change the length" is exactly
 * the verb somebody wants at ten past. It is only once the end time has passed
 * that the arrangements stop being arrangements and become a record of what
 * happened. Moving Tuesday's lunch to Thursday next week is a real act;
 * "moving" last Tuesday's lunch is not a thing that can happen to it.
 *
 * WHAT IT IS NOT. Not a status. `bookings.status` says what was decided —
 * confirmed, cancelled, declined — and nobody decided that a meeting is in the
 * past; the clock did. Writing it into the row would mean a sweep to keep it
 * true, and a sweep that misses leaves an appointment that is over and does not
 * say so. Derived from the clock every time it is asked, it cannot be stale.
 *
 * THE PAST IS STILL READABLE. Nothing here closes a past appointment: its
 * notes, its minutes, its trail and its conversation all stay open, because
 * what happened at a meeting is mostly written down after it. Only the three
 * verbs that would rewrite an arrangement stop applying.
 */

/** Has the end time passed. */
function isOver(booking, now = Date.now()) {
  const end = Date.parse(booking?.end_at || booking?.endAt || '');
  return Number.isFinite(end) && end <= now;
}

// ---------------------------------------------------------------------------
// The half hour before an appointment belongs to whoever booked it
// ---------------------------------------------------------------------------
//
// Running late moves the thing that is running late. When that thing is an
// appointment somebody booked, moving it sends them a new time — and there is
// a point past which a new time is not help, it is a message arriving while
// they are in a car on the way to the old one.
//
// Thirty minutes is where that point was put. It is not a guess at travel time;
// it is the smallest window in which an email still has a chance of being read
// before somebody sets off. Inside it the honest answer is that the appointment
// is happening and the office is late for it — which is a thing to say to a
// person, not a row to rewrite.
//
// THIS IS NOT THE SAME AS THE OFFICE'S OWN DAY. An itinerary entry has nobody
// on the other end of it: the car, the desk hour, the drive to the airport are
// all the principal's own, and the office may shunt them at any point before
// they start. So the floor is asked about here, by the one route that moves a
// booker's appointment, and nowhere else. A PA pushing their principal's 09:00
// prep at 08:55 is not doing anything to anybody.
const MOVE_NOTICE_MINUTES = 30;

/** Minutes from now until it starts. Negative once it has begun; null if unreadable. */
function minutesUntilStart(booking, now = Date.now()) {
  const start = Date.parse(booking?.start_at || booking?.startAt || '');
  if (!Number.isFinite(start)) return null;
  return Math.round((start - now) / 60000);
}

/**
 * The refusal when there is not enough notice left to move a booker's
 * appointment, or null.
 *
 * Names them, because the sentence that actually helps at 08:47 is "Adaeze is
 * due in thirteen minutes" and not "minimum notice not met". And it says what
 * to do instead: the meeting is not in trouble, only the email is.
 */
function refuseIfTooSoon(booking, now = Date.now()) {
  const left = minutesUntilStart(booking, now);
  if (left === null || left >= MOVE_NOTICE_MINUTES) return null;
  const who = booking?.booker_name || booking?.bookerName || 'Whoever booked this';
  return {
    ok: false,
    status: 400,
    minutesLeft: left,
    noticeMinutes: MOVE_NOTICE_MINUTES,
    error: left > 0
      ? `${who} is due in ${left} min and may already be on the way. A new time sent now would reach them too late to be any use — tell them directly instead.`
      : `${who} is due now. A new time sent at this point arrives after they do — tell them directly instead.`,
  };
}

/**
 * The refusal, in the words of whichever verb was attempted, or null.
 *
 * Prose rather than a code, because every caller puts it in front of somebody,
 * and "409" on a screen is not an explanation. Each says what is true instead
 * of only what is refused — an office that cannot move a past meeting usually
 * wants to make a new one, and saying so is the difference between a dead end
 * and an answer.
 */
const REFUSALS = {
  move: 'This appointment has already happened, so there is nothing left to move. Make a new one instead.',
  length: 'This appointment has already happened — its length is a record of how long it ran, not a plan.',
  cancel: 'This appointment has already happened. Calling it off now would tell somebody who was there that it is not going ahead.',
};

function refuseIfOver(booking, verb, now = Date.now()) {
  if (!isOver(booking, now)) return null;
  return { ok: false, status: 400, error: REFUSALS[verb] || REFUSALS.move };
}

module.exports = {
  isOver, refuseIfOver, REFUSALS,
  MOVE_NOTICE_MINUTES, minutesUntilStart, refuseIfTooSoon,
};
