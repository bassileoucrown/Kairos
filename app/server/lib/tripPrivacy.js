const db = require('./db');

// Whose journey is nobody else's business.
//
// A principal's travel is not one thing. A board trip is work, and the office
// arranging it is the point. A family holiday is not work, and an office that
// can see it — where, for how long, with whom — is holding a pattern of a
// private person's movements that nobody agreed to hand over. So a trip is
// either the office's or it is not, and a private one is genuinely absent
// rather than merely quiet: no title, no destination, no dates, no travellers,
// no legs. Not redacted. Absent.
//
// WHO CAN STILL SEE ONE. The principal, always. Whoever arranged it, because
// somebody booked the flights and pretending otherwise would mean an assistant
// who cannot open the thing they built. And anybody the principal has named —
// the point of a private trip is that the principal chooses, not that nobody
// knows.
//
// ONE GATE, CALLED FROM EVERYWHERE. Itinerary items are read from six places
// in this codebase — the day sheet, the rhythm, the openings, the cascade, the
// pickup card, the itinerary itself. Filtering privately in each of them is
// how two queries end up answering one question, which this codebase has been
// bitten by repeatedly and which here would mean a private trip surfacing on
// somebody's screen. So the answer to "may this viewer see this trip" is
// computed once, here, and every read path asks it.

const OFFICE = 'office';
const PRIVATE = 'private';
const VISIBILITIES = new Set([OFFICE, PRIVATE]);

/**
 * The trips on this account the viewer may not see, as a Set of ids.
 *
 * Returns ids to EXCLUDE rather than ids to include, deliberately: a read path
 * that forgets to call this shows too much, which is visible in a test, while
 * one that gets an empty include-list shows nothing, which looks like a
 * feature working correctly and is how a leak hides.
 */
async function hiddenTripIds(ownerId, viewerId) {
  const hidden = new Set();
  if (ownerId === viewerId) return hidden;

  const rows = await db.prepare(
    'SELECT id, created_by FROM trips WHERE owner_id = ? AND visibility = ?',
  ).all(ownerId, PRIVATE);
  if (!rows.length) return hidden;

  const shared = await db.prepare(
    'SELECT trip_id FROM trip_shares WHERE user_id = ?',
  ).all(viewerId);
  const sharedWith = new Set(shared.map((s) => s.trip_id));

  for (const t of rows) {
    // The arranger keeps what they built; anybody named keeps what they were
    // given. Everybody else, including a Chief of Staff who can otherwise see
    // the whole office, does not.
    if (t.created_by === viewerId) continue;
    if (sharedWith.has(t.id)) continue;
    hidden.add(t.id);
  }
  return hidden;
}

/** Whether one trip, already loaded, is this viewer's to see. */
async function maySeeTrip(trip, viewerId) {
  if (!trip) return false;
  if (trip.visibility !== PRIVATE) return true;
  if (trip.owner_id === viewerId || trip.created_by === viewerId) return true;
  const share = await db.prepare(
    'SELECT id FROM trip_shares WHERE trip_id = ? AND user_id = ?',
  ).get(trip.id, viewerId);
  return !!share;
}

/**
 * The days a private trip covers, for the diary.
 *
 * THE ONE THING THAT LEAKS, AND WHY IT IS WORTH IT. A trip nobody can see is a
 * trip the office books meetings straight over — the principal is away with
 * their family and an assistant accepts a Tuesday call, in good faith, because
 * as far as the app told them the day was free. That is a worse failure than
 * the office knowing a date is spoken for.
 *
 * So exactly one bit crosses: the day is not available. No title, no
 * destination, no reason, not even that it is travel. The picker subtracts it
 * the way it subtracts nothing else — an ordinary commitment is SHOWN and left
 * bookable, because the office can see what it is and judge. Here they cannot
 * see it, so they cannot judge it, so it is taken off the table instead.
 */
async function privateWindows(ownerId, viewerId) {
  if (ownerId === viewerId) return [];
  const rows = await db.prepare(`
    SELECT id, starts_on, ends_on FROM trips
     WHERE owner_id = ? AND visibility = ? AND status != 'cancelled'
  `).all(ownerId, PRIVATE);
  if (!rows.length) return [];

  // Only the journeys THIS viewer cannot see close a day. Somebody the
  // principal has let in, or the assistant who arranged it, can already see
  // what is happening and does not need the day taken away from them.
  const hidden = await hiddenTripIds(ownerId, viewerId);
  return rows
    .filter((r) => hidden.has(r.id))
    .map((r) => ({ startsOn: r.starts_on, endsOn: r.ends_on }));
}

/** Is this local date inside a private trip? */
function coversDay(windows, localDate) {
  return windows.some((w) => localDate >= w.startsOn && localDate <= w.endsOn);
}

module.exports = {
  OFFICE, PRIVATE, VISIBILITIES,
  hiddenTripIds, maySeeTrip, privateWindows, coversDay,
};
