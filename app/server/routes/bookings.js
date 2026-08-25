const express = require('express');
const { asyncRouter } = require('../lib/asyncRouter');
const db = require('../lib/db');
const { requireAuth } = require('../lib/auth');
const history = require('../lib/bookingHistory');
const { cancelBooking } = require('../lib/cancelBooking');
const { rescheduleBooking } = require('../lib/rescheduleBooking');

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

module.exports = router;
