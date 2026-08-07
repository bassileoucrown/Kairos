const express = require('express');
const crypto = require('crypto');
const db = require('../lib/db');
const { requireAuth } = require('../lib/auth');

const router = express.Router();
router.use(requireAuth);

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

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
//
// A day may carry several rules: mornings-only, a split day around lunch, an
// evening window. The slot engine (lib/availability.js) already walks every
// rule for a given weekday, so the only extra constraint here is that a day's
// blocks must not overlap each other — overlapping windows would emit the
// same slot twice on the booking page.
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

  const byDay = new Map();
  for (const r of rules) {
    const list = byDay.get(r.dayOfWeek) || [];
    list.push(r);
    byDay.set(r.dayOfWeek, list);
  }
  for (const [day, list] of byDay) {
    // 'HH:MM' zero-padded 24h sorts and compares correctly as a string.
    const sorted = [...list].sort((a, b) => a.startTime.localeCompare(b.startTime));
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].startTime < sorted[i - 1].endTime) {
        return res.status(400).json({ error: `${DAY_NAMES[day]}: time blocks can't overlap.` });
      }
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
