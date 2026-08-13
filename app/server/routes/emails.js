const express = require('express');
const { asyncRouter } = require('../lib/asyncRouter');
const db = require('../lib/db');
const { requireAuth } = require('../lib/auth');

const router = asyncRouter();
router.use(requireAuth);

function serialize(e) {
  return {
    id: e.id,
    toEmail: e.to_email,
    subject: e.subject,
    body: e.body,
    category: e.category,
    relatedBookingId: e.related_booking_id,
    // outbox: no provider configured, so this is the only copy that exists.
    // sent: the provider accepted it. failed: it refused, and said why.
    deliveryStatus: e.delivery_status || 'outbox',
    deliveryError: e.delivery_error || null,
    createdAt: e.created_at,
  };
}

router.get('/', async (req, res) => {
  const rows = await db.prepare('SELECT * FROM emails WHERE owner_id = ? ORDER BY created_at DESC LIMIT 100').all(req.user.id);
  res.json({ emails: rows.map(serialize) });
});

module.exports = router;
