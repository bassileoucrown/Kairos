const express = require('express');
const db = require('../lib/db');
const { requireAuth, slugify } = require('../lib/auth');
const { isValidTimeZone } = require('../lib/timezone');
const { publicUser } = require('./auth');

const router = express.Router();

router.use(requireAuth);

router.patch('/', (req, res) => {
  const { name, timezone, slug } = req.body || {};
  const updates = [];
  const values = [];

  if (name !== undefined) {
    if (!String(name).trim()) return res.status(400).json({ error: 'Name cannot be empty.' });
    updates.push('name = ?');
    values.push(String(name).trim());
  }
  if (timezone !== undefined) {
    if (!isValidTimeZone(timezone)) return res.status(400).json({ error: 'Unrecognized timezone.' });
    updates.push('timezone = ?');
    values.push(timezone);
  }
  if (slug !== undefined) {
    const cleanSlug = slugify(slug);
    if (!cleanSlug) return res.status(400).json({ error: 'Please choose a valid booking link.' });
    const taken = db.prepare('SELECT 1 FROM users WHERE slug = ? AND id != ?').get(cleanSlug, req.user.id);
    if (taken) return res.status(409).json({ error: 'That booking link is already taken.' });
    updates.push('slug = ?');
    values.push(cleanSlug);
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'Nothing to update.' });
  }

  values.push(req.user.id);
  db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: publicUser(user) });
});

router.post('/onboarding-step', (req, res) => {
  const { step } = req.body || {};
  const allowed = ['profile', 'availability', 'meeting_type', 'done'];
  if (!allowed.includes(step)) {
    return res.status(400).json({ error: 'Invalid onboarding step.' });
  }
  db.prepare('UPDATE users SET onboarding_step = ? WHERE id = ?').run(step, req.user.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: publicUser(user) });
});

module.exports = router;
