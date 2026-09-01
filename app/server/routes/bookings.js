const express = require('express');
const { asyncRouter } = require('../lib/asyncRouter');
const minuteHandlers = require('./minuteHandlers');
const db = require('../lib/db');
const { requireAuth } = require('../lib/auth');
const history = require('../lib/bookingHistory');
const { cancelBooking } = require('../lib/cancelBooking');
const { rescheduleBooking, setDuration } = require('../lib/rescheduleBooking');
const { openingsFor } = require('../lib/dayOpenings');
const notes = require('../lib/bookingNotes');
const internal = require('../lib/internalBooking');
const { sendEmail } = require('../lib/email');
const { formatForEmail } = require('../lib/format');

// A principal's own bookings. The delegated equivalent is in routes/pa.js and
// both go through lib/bookingHistory.js, so the two lists cannot disagree
// about what a booking is or which scope it falls in.
const router = asyncRouter();
router.use(requireAuth);

router.get('/', async (req, res) => {
  res.json({
    bookings: await history.list(req.user.id, {
      scope: req.query.scope, q: req.query.q, from: req.query.from, to: req.query.to,
    }),
  });
});

/**
 * Put something in the diary directly.
 *
 * ?ownerId= names whose diary, defaulting to your own. A PA has to have the
 * scheduling remit — the same one that lets them move and cancel — because
 * putting a meeting IN somebody's day is no smaller a power than taking one
 * out of it, and a delegate who was given the vault but not the diary must not
 * get there by a side door.
 *
 * See lib/internalBooking.js for what this deliberately does NOT check:
 * published hours, approval tiers, and whether the time has already passed.
 */
router.post('/', async (req, res) => {
  const ownerId = String(req.body?.ownerId || req.user.id);
  if (ownerId !== req.user.id) {
    const membership = await db.prepare(`
      SELECT * FROM memberships
      WHERE owner_id = ? AND member_user_id = ? AND status = 'active'
    `).get(ownerId, req.user.id);
    // 404 rather than 403 for somebody with no relationship at all: whether a
    // given person has a Kairos account is not a fact this confirms.
    if (!membership) return res.status(404).json({ error: 'No such diary.' });
    if (!membership.can_manage_scheduling) {
      return res.status(403).json({ error: 'Your remit here does not cover the diary.' });
    }
  }

  const result = await internal.place(ownerId, req.body || {});
  if (result.problem) {
    // 409 for a clash specifically, because the caller can retry the same
    // request with allowOverlap and it will work — which is a different thing
    // from a request that was malformed.
    return res.status(result.clashes ? 409 : 400)
      .json({ error: result.problem, clashes: result.clashes });
  }

  const booking = await db.prepare('SELECT * FROM bookings WHERE id = ?').get(result.id);

  // Only when asked. "Slot it in" is about the diary, not about
  // correspondence, and an unexpected confirmation to a board member because
  // an assistant was tidying the calendar is the worse failure.
  if (result.notify) {
    const owner = await db.prepare('SELECT name, timezone FROM users WHERE id = ?').get(ownerId);
    await sendEmail({
      ownerId,
      sentByUserId: req.user.id,
      toEmail: booking.booker_email,
      category: 'transactional',
      subject: `Confirmed: ${formatForEmail(booking.start_at, booking.booker_timezone)}`,
      body: `This is to confirm your meeting with ${owner?.name}.\n\n`
        + `When: ${formatForEmail(booking.start_at, booking.booker_timezone)} `
        + `(${booking.booker_timezone})`,
    }).catch(() => { /* a diary entry does not fail over its mail */ });
  }

  res.status(201).json({ booking: { id: booking.id, startAt: booking.start_at, endAt: booking.end_at } });
});

router.get('/:id/trail', async (req, res) => {
  const booking = await history.get(req.user.id, req.params.id);
  if (!booking) return res.status(404).json({ error: 'Booking not found.' });
  res.json({ trail: await history.trail(req.user.id, req.params.id) });
});

router.post('/:id/cancel', async (req, res) => {
  const row = await db.prepare('SELECT * FROM bookings WHERE id = ? AND owner_id = ?').get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Booking not found.' });
  const result = await cancelBooking({ booking: row, cancelledByUserId: req.user.id, note: req.body?.note });
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  res.status(204).end();
});

// Moving an appointment the office already has. The booker can move their own
// from the link they were sent; this is the same act from the other side, and
// both go through lib/rescheduleBooking.js so they cannot drift apart.
router.post('/:id/reschedule', async (req, res) => {
  const row = await db.prepare('SELECT * FROM bookings WHERE id = ? AND owner_id = ?')
    .get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Booking not found.' });

  const result = await rescheduleBooking({
    booking: row,
    owner: req.user,
    startAt: req.body?.startAt,
    movedByUserId: req.user.id,
    note: String(req.body?.note || '').trim().slice(0, 280),
  });
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  res.json({ booking: { id: result.booking.id, startAt: result.booking.start_at, endAt: result.booking.end_at } });
});

// Where there is room on a given day, for somebody about to move this. See
// lib/dayOpenings.js — it is deliberately not the public slot grid.
router.get('/:id/openings', async (req, res) => {
  const row = await db.prepare('SELECT * FROM bookings WHERE id = ? AND owner_id = ?')
    .get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Booking not found.' });

  const result = await openingsFor({
    owner: req.user,
    date: req.query.date,
    // Defaults to however long this meeting already runs, since moving it is
    // not meant to change that.
    minutes: req.query.minutes
      || Math.round((Date.parse(row.end_at) - Date.parse(row.start_at)) / 60000),
    excludeBookingId: row.id,
  });
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  res.json(result);
});

// --- What is said about an appointment ---------------------------------
//
// The office sees both registers; see lib/bookingNotes.js for why that
// distinction is load-bearing rather than cosmetic.

async function loadOwn(req, res, next) {
  const row = await db.prepare('SELECT * FROM bookings WHERE id = ? AND owner_id = ?')
    .get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Booking not found.' });
  req.booking = row;
  next();
}

router.get('/:id/notes', loadOwn, async (req, res) => {
  const rows = await notes.forOffice(req.user.id, req.booking.id);
  res.json({ notes: rows.map(notes.serialize) });
});

router.post('/:id/notes', loadOwn, async (req, res) => {
  const result = await notes.add({
    bookingId: req.booking.id,
    ownerId: req.user.id,
    // Defaults to the office's own register. Somebody adding a note about a
    // meeting is preparing for it far more often than they are writing to the
    // person they are meeting, and the safer of the two is the right default:
    // a private note shown by mistake is recoverable, one sent is not.
    visibility: req.body?.visibility || 'office',
    authorUserId: req.user.id,
    body: req.body?.body,
  });
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  res.status(201).json({ note: result.note });
});

// A principal minuting their own meeting. Rarer than the delegated case — the
// whole point is an account written by whoever was in the room for somebody
// who was not — but a principal who took the meeting alone and wants it on the
// record should not have to ask an assistant to type it.
//
// All four handlers are shared with the assistant's door in routes/pa.js. See
// routes/minuteHandlers.js: the only difference between the two mounts is who
// the owner is, and letting each router answer that separately is how they
// drift.
router.post('/:id/minutes', loadOwn, minuteHandlers.file(minuteHandlers.own));
router.post('/:id/minutes/draft', loadOwn, minuteHandlers.draft(minuteHandlers.own));
router.post('/:id/dictation', loadOwn, minuteHandlers.dictate(minuteHandlers.own));
router.post('/:id/recording', loadOwn, minuteHandlers.recording(minuteHandlers.own));
router.post('/:id/recording/audio', loadOwn, minuteHandlers.captureAudio(minuteHandlers.own));
router.get('/:id/recordings', loadOwn, minuteHandlers.recordings(minuteHandlers.own));

router.post('/:id/follow-up', loadOwn, async (req, res) => {
  const result = await notes.followUp({
    booking: req.booking,
    owner: req.user,
    authorUserId: req.user.id,
    body: req.body?.body,
  });
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  res.status(201).json({ note: result.note });
});

router.post('/:id/duration', loadOwn, async (req, res) => {
  const result = await setDuration({
    booking: req.booking,
    owner: req.user,
    minutes: req.body?.minutes,
    movedByUserId: req.user.id,
    note: String(req.body?.note || '').trim().slice(0, 280),
  });
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  res.json({ booking: { id: result.booking.id, startAt: result.booking.start_at, endAt: result.booking.end_at } });
});

/**
 * One appointment, everything about it.
 *
 * The office had no such place. Cancelling lived in the Bookings tab, moving
 * on the day sheet, notes in a panel on two other screens — so "edit this
 * appointment" meant knowing which screen happened to carry the verb you
 * wanted. One request, one page, one answer to "what is this meeting and what
 * can I do about it".
 */
router.get('/:id', loadOwn, async (req, res) => {
  const booking = await history.get(req.user.id, req.booking.id);
  res.json({
    booking,
    notes: (await notes.forOffice(req.user.id, req.booking.id)).map(notes.serialize),
    trail: await history.trail(req.user.id, req.booking.id),
    timezone: req.user.timezone || 'UTC',
    principal: { id: req.user.id, name: req.user.name },
  });
});

module.exports = router;
