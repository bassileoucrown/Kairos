const express = require('express');
const crypto = require('crypto');
const db = require('../lib/db');
const { requireAuth } = require('../lib/auth');

const router = express.Router();
router.use(requireAuth);

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function serialize(rule) {
  return {
    id: rule.id,
    dayOfWeek: rule.day_of_week,
    startTime: rule.start_time,
    endTime: rule.end_time,
  };
}

router.get('/', (req, res) => {
  const rules = db.prepare('SELECT * FROM availability_rules WHERE owner_id = ? ORDER BY day_of_week, start_time')
    .all(req.user.id);
  res.json({ rules: rules.map(serialize) });
});

// Replace the full weekly schedule in one call — simplest correct model for
// an editor UI that presents "your week" and saves it as a whole.
router.put('/', (req, res) => {
  const { rules } = req.body || {};
  if (!Array.isArray(rules)) {
    return res.status(400).json({ error: 'Expected a list of availability rules.' });
  }

  for (const r of rules) {
    if (
      typeof r.dayOfWeek !== 'number' || r.dayOfWeek < 0 || r.dayOfWeek > 6 ||
      !TIME_RE.test(r.startTime) || !TIME_RE.test(r.endTime) ||
      r.startTime >= r.endTime
    ) {
      return res.status(400).json({ error: 'Each rule needs a valid day and a start time before its end time.' });
    }
  }

  const del = db.prepare('DELETE FROM availability_rules WHERE owner_id = ?');
  const insert = db.prepare('INSERT INTO availability_rules (id, owner_id, day_of_week, start_time, end_time) VALUES (?, ?, ?, ?, ?)');

  db.exec('BEGIN');
  try {
    del.run(req.user.id);
    for (const r of rules) {
      insert.run(crypto.randomUUID(), req.user.id, r.dayOfWeek, r.startTime, r.endTime);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  const saved = db.prepare('SELECT * FROM availability_rules WHERE owner_id = ? ORDER BY day_of_week, start_time')
    .all(req.user.id);
  res.json({ rules: saved.map(serialize) });
});

module.exports = router;
