const express = require('express');
const { asyncRouter } = require('../lib/asyncRouter');
const db = require('../lib/db');
const { requireAuth } = require('../lib/auth');

const router = asyncRouter();
router.use(requireAuth);

function serialize(b) {
  return {
    id: b.id,
    meetingTypeId: b.meeting_type_id,
    meetingTypeName: b.meeting_type_name,
    meetingTypeColor: b.meeting_type_color,
    accessTier: b.access_tier,
    bookerName: b.booker_name,
    bookerEmail: b.booker_email,
    bookerTimezone: b.booker_timezone,
    startAt: b.start_at,
    endAt: b.end_at,
    status: b.status,
    videoRoom: b.video_room,
  };
}

router.get('/', async (req, res) => {
  const { scope } = req.query;
  const now = new Date().toISOString();
  let query = `
    SELECT b.*, mt.name as meeting_type_name, mt.color as meeting_type_color, mt.access_tier
    FROM bookings b
    JOIN meeting_types mt ON mt.id = b.meeting_type_id
    WHERE b.owner_id = ?
  `;
  const params = [req.user.id];

  if (scope === 'upcoming') {
    query += " AND b.status = 'confirmed' AND b.start_at >= ?";
    params.push(now);
  } else if (scope === 'past') {
    query += " AND b.status = 'confirmed' AND b.start_at < ?";
    params.push(now);
  } else if (scope === 'pending') {
    query += " AND b.status = 'pending'";
  } else {
    query += " AND b.status = 'confirmed'";
  }
  query += ' ORDER BY b.start_at ASC';

  const rows = await db.prepare(query).all(...params);
  res.json({ bookings: rows.map(serialize) });
});

router.post('/:id/cancel', async (req, res) => {
  const row = await db.prepare('SELECT * FROM bookings WHERE id = ? AND owner_id = ?').get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Booking not found.' });
  await db.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ?").run(row.id);
  res.status(204).end();
});

module.exports = router;
