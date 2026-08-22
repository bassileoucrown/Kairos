const express = require('express');
const { asyncRouter } = require('../lib/asyncRouter');
const db = require('../lib/db');
const { requireAuth } = require('../lib/auth');
const history = require('../lib/bookingHistory');
const { cancelBooking } = require('../lib/cancelBooking');

// A principal's own bookings. The delegated equivalent is in routes/pa.js and
// both go through lib/bookingHistory.js, so the two lists cannot disagree
// about what a booking is or which scope it falls in.
const router = asyncRouter();
router.use(requireAuth);

router.get('/', async (req, res) => {
  res.json({
    bookings: await history.list(req.user.id, { scope: req.query.scope, q: req.query.q }),
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

module.exports = router;
