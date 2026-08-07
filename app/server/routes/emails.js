const express = require('express');
const db = require('../lib/db');
const { requireAuth } = require('../lib/auth');

const router = express.Router();
router.use(requireAuth);

function serialize(e) {
  return {
    id: e.id,
    toEmail: e.to_email,
    subject: e.subject,
    body: e.body,
    category: e.category,
    relatedBookingId: e.related_booking_id,
    createdAt: e.created_at,
  };
}

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM emails WHERE owner_id = ? ORDER BY created_at DESC LIMIT 100').all(req.user.id);
  res.json({ emails: rows.map(serialize) });
});

module.exports = router;
