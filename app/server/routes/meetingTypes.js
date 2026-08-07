const express = require('express');
const crypto = require('crypto');
const db = require('../lib/db');
const { requireAuth, slugify } = require('../lib/auth');

const router = express.Router();
router.use(requireAuth);

const LOCATION_TYPES = new Set(['video', 'phone', 'in_person']);

function serialize(mt) {
  return {
    id: mt.id,
    name: mt.name,
    slug: mt.slug,
    durationMinutes: mt.duration_minutes,
    description: mt.description,
    locationType: mt.location_type,
    bufferBeforeMinutes: mt.buffer_before_minutes,
    bufferAfterMinutes: mt.buffer_after_minutes,
    isActive: !!mt.is_active,
  };
}

function uniqueSlug(ownerId, name) {
  const base = slugify(name) || 'meeting';
  let candidate = base;
  let n = 1;
  const exists = db.prepare('SELECT 1 FROM meeting_types WHERE owner_id = ? AND slug = ?');
  while (exists.get(ownerId, candidate)) {
    n += 1;
    candidate = `${base}-${n}`;
  }
  return candidate;
}

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM meeting_types WHERE owner_id = ? ORDER BY created_at').all(req.user.id);
  res.json({ meetingTypes: rows.map(serialize) });
});

router.post('/', (req, res) => {
  const { name, durationMinutes, description, locationType, bufferBeforeMinutes, bufferAfterMinutes } = req.body || {};

  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'Please name this meeting type.' });
  }
  const duration = Number(durationMinutes);
  if (!Number.isInteger(duration) || duration < 5 || duration > 480) {
    return res.status(400).json({ error: 'Duration must be between 5 and 480 minutes.' });
  }
  const location = LOCATION_TYPES.has(locationType) ? locationType : 'video';
  const bufBefore = Number.isInteger(Number(bufferBeforeMinutes)) ? Number(bufferBeforeMinutes) : 0;
  const bufAfter = Number.isInteger(Number(bufferAfterMinutes)) ? Number(bufferAfterMinutes) : 0;

  const id = crypto.randomUUID();
  const slug = uniqueSlug(req.user.id, name);

  db.prepare(`
    INSERT INTO meeting_types
      (id, owner_id, name, slug, duration_minutes, description, location_type, buffer_before_minutes, buffer_after_minutes, is_active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
  `).run(id, req.user.id, String(name).trim(), slug, duration, String(description || ''), location, bufBefore, bufAfter, new Date().toISOString());

  const row = db.prepare('SELECT * FROM meeting_types WHERE id = ?').get(id);
  res.status(201).json({ meetingType: serialize(row) });
});

router.patch('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM meeting_types WHERE id = ? AND owner_id = ?').get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Meeting type not found.' });

  const { isActive } = req.body || {};
  if (isActive !== undefined) {
    db.prepare('UPDATE meeting_types SET is_active = ? WHERE id = ?').run(isActive ? 1 : 0, row.id);
  }
  const updated = db.prepare('SELECT * FROM meeting_types WHERE id = ?').get(row.id);
  res.json({ meetingType: serialize(updated) });
});

router.delete('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM meeting_types WHERE id = ? AND owner_id = ?').get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Meeting type not found.' });
  db.prepare('DELETE FROM meeting_types WHERE id = ?').run(row.id);
  res.status(204).end();
});

module.exports = router;
