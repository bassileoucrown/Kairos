const express = require('express');
const { asyncRouter } = require('../lib/asyncRouter');
const db = require('../lib/db');
const { requireAuth } = require('../lib/auth');
const history = require('../lib/bookingHistory');
const { cancelBooking } = require('../lib/cancelBooking');
const { rescheduleBooking, setDuration } = require('../lib/rescheduleBooking');
const notes = require('../lib/bookingNotes');

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

router.get('/:id/trail', async (req, res) => {
  const booking = await history.get(req.user.id, req.params.id);
  if (!booking) return res.status(404).json({ error: 'Booking not found.' });
  res.json({ trail: await history.trail(req.user.id, req.params.id) });
});

router.post('/:id/cancel', async (req, res) => {
  const row = await db.prepare('SELECT * FROM bookings WHERE id = ? AND owner_id = ?').get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Booking not found.' });
  await cancelBooking({ booking: row, cancelledByUserId: req.user.id, note: req.body?.note });
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
