const crypto = require('crypto');
const db = require('./db');
const { slugify } = require('./auth');

// Availability and meeting types, expressed as operations on an owner id
// rather than on "the logged-in user".
//
// Both are now reachable two ways — a principal editing their own, and an
// assistant editing their principal's — and the rules must be identical down
// to the error strings. Keeping one implementation here is the only way that
// stays true as either path changes.

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const LOCATION_TYPES = new Set(['video', 'phone', 'in_person']);
const TIER_COLORS = { 1: '#3E6357', 2: '#3E6357', 3: '#B08D3D', 4: '#B3453A' };

/** Thrown for user-fixable input; routes turn this into a 4xx with the message. */
class SchedulingError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// ---------- Availability ----------

function serializeRule(r) {
  return { id: r.id, dayOfWeek: r.day_of_week, startTime: r.start_time, endTime: r.end_time };
}

function listAvailability(ownerId) {
  return db.prepare('SELECT * FROM availability_rules WHERE owner_id = ? ORDER BY day_of_week, start_time')
    .all(ownerId).map(serializeRule);
}

/**
 * Replaces the whole weekly schedule. A day may hold several blocks (a split
 * day, an evening window); they simply must not overlap, since overlapping
 * windows would emit the same slot twice on the booking page.
 */
function replaceAvailability(ownerId, rules) {
  if (!Array.isArray(rules)) throw new SchedulingError('Expected a list of availability rules.');

  for (const r of rules) {
    if (
      typeof r.dayOfWeek !== 'number' || r.dayOfWeek < 0 || r.dayOfWeek > 6 ||
      !TIME_RE.test(r.startTime) || !TIME_RE.test(r.endTime) ||
      r.startTime >= r.endTime
    ) {
      throw new SchedulingError('Each rule needs a valid day and a start time before its end time.');
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
        throw new SchedulingError(`${DAY_NAMES[day]}: time blocks can't overlap.`);
      }
    }
  }

  const del = db.prepare('DELETE FROM availability_rules WHERE owner_id = ?');
  const insert = db.prepare(
    'INSERT INTO availability_rules (id, owner_id, day_of_week, start_time, end_time) VALUES (?, ?, ?, ?, ?)'
  );

  db.exec('BEGIN');
  try {
    del.run(ownerId);
    for (const r of rules) {
      insert.run(crypto.randomUUID(), ownerId, r.dayOfWeek, r.startTime, r.endTime);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return listAvailability(ownerId);
}

// ---------- Meeting types ----------

function serializeMeetingType(mt) {
  return {
    id: mt.id,
    name: mt.name,
    slug: mt.slug,
    durationMinutes: mt.duration_minutes,
    description: mt.description,
    locationType: mt.location_type,
    bufferBeforeMinutes: mt.buffer_before_minutes,
    bufferAfterMinutes: mt.buffer_after_minutes,
    accessTier: mt.access_tier,
    color: mt.color,
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

function normalizeTier(accessTier) {
  const n = Number(accessTier);
  return [1, 2, 3, 4].includes(n) ? n : 1;
}

function listMeetingTypes(ownerId) {
  return db.prepare('SELECT * FROM meeting_types WHERE owner_id = ? ORDER BY created_at')
    .all(ownerId).map(serializeMeetingType);
}

function createMeetingType(ownerId, body = {}) {
  const { name, durationMinutes, description, locationType, bufferBeforeMinutes, bufferAfterMinutes, accessTier } = body;
  if (!name || !String(name).trim()) throw new SchedulingError('Give the meeting type a name.');

  const duration = Number(durationMinutes);
  if (!Number.isInteger(duration) || duration < 5 || duration > 480) {
    throw new SchedulingError('Duration must be between 5 and 480 minutes.');
  }
  const location = LOCATION_TYPES.has(locationType) ? locationType : 'video';
  const bufBefore = Number.isInteger(Number(bufferBeforeMinutes)) ? Number(bufferBeforeMinutes) : 0;
  const bufAfter = Number.isInteger(Number(bufferAfterMinutes)) ? Number(bufferAfterMinutes) : 0;
  const tier = normalizeTier(accessTier);

  const id = crypto.randomUUID();
  const slug = uniqueSlug(ownerId, name);
  db.prepare(`
    INSERT INTO meeting_types
      (id, owner_id, name, slug, duration_minutes, description, location_type,
       buffer_before_minutes, buffer_after_minutes, access_tier, color, is_active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
  `).run(id, ownerId, String(name).trim(), slug, duration, String(description || ''),
    location, bufBefore, bufAfter, tier, TIER_COLORS[tier], new Date().toISOString());

  return serializeMeetingType(db.prepare('SELECT * FROM meeting_types WHERE id = ?').get(id));
}

function updateMeetingType(ownerId, id, body = {}) {
  const row = db.prepare('SELECT * FROM meeting_types WHERE id = ? AND owner_id = ?').get(id, ownerId);
  if (!row) throw new SchedulingError('Meeting type not found.', 404);

  const map = {
    name: 'name', description: 'description', durationMinutes: 'duration_minutes',
    locationType: 'location_type', bufferBeforeMinutes: 'buffer_before_minutes',
    bufferAfterMinutes: 'buffer_after_minutes', accessTier: 'access_tier', isActive: 'is_active',
  };
  const updates = [];
  const values = [];

  for (const [key, column] of Object.entries(map)) {
    if (body[key] === undefined) continue;
    let value = body[key];
    if (key === 'name') {
      if (!String(value).trim()) throw new SchedulingError('Give the meeting type a name.');
      value = String(value).trim();
    }
    if (key === 'durationMinutes') {
      value = Number(value);
      if (!Number.isInteger(value) || value < 5 || value > 480) {
        throw new SchedulingError('Duration must be between 5 and 480 minutes.');
      }
    }
    if (key === 'locationType' && !LOCATION_TYPES.has(value)) {
      throw new SchedulingError('Unknown meeting format.');
    }
    if (key === 'accessTier') {
      value = normalizeTier(value);
      // Colour tracks the tier so the calendar stays readable at a glance.
      updates.push('color = ?');
      values.push(TIER_COLORS[value]);
    }
    if (key === 'isActive') value = value ? 1 : 0;
    updates.push(`${column} = ?`);
    values.push(value);
  }
  if (updates.length === 0) throw new SchedulingError('Nothing to update.');

  values.push(row.id);
  db.prepare(`UPDATE meeting_types SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  return serializeMeetingType(db.prepare('SELECT * FROM meeting_types WHERE id = ?').get(row.id));
}

function deleteMeetingType(ownerId, id) {
  const row = db.prepare('SELECT * FROM meeting_types WHERE id = ? AND owner_id = ?').get(id, ownerId);
  if (!row) throw new SchedulingError('Meeting type not found.', 404);
  db.prepare('DELETE FROM meeting_types WHERE id = ?').run(row.id);
}

/** Wraps a handler so SchedulingError becomes its intended HTTP response. */
function handle(fn) {
  return (req, res, next) => {
    try {
      fn(req, res);
    } catch (err) {
      if (err instanceof SchedulingError) return res.status(err.status).json({ error: err.message });
      next(err);
    }
  };
}

module.exports = {
  SchedulingError, handle,
  listAvailability, replaceAvailability,
  listMeetingTypes, createMeetingType, updateMeetingType, deleteMeetingType,
};
