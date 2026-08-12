const express = require('express');
const crypto = require('crypto');
const db = require('../lib/db');
const { requireAuth } = require('../lib/auth');
const { requirePaAccess } = require('../lib/paAccess');
const { isValidTimeZone } = require('../lib/timezone');

const router = express.Router();
router.use(requireAuth);

const KINDS = new Set(['flight', 'train', 'car', 'hotel', 'meeting', 'meal', 'personal', 'call', 'note']);

// Which calendar day an instant falls on, in a given zone. Everything about a
// day view depends on this being the principal's day rather than the server's.
function dayKeyInZone(iso, timeZone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date(iso));
}

function timeInZone(iso, timeZone) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone, hour: 'numeric', minute: '2-digit',
  }).format(new Date(iso));
}

function serializeItem(i, ownerTz) {
  const startTz = i.start_timezone || ownerTz;
  const endTz = i.end_timezone || startTz;
  return {
    id: i.id,
    source: 'itinerary',
    kind: i.kind,
    title: i.title,
    startAt: i.start_at,
    endAt: i.end_at,
    startTimezone: startTz,
    endTimezone: endTz,
    startLabel: timeInZone(i.start_at, startTz),
    endLabel: i.end_at ? timeInZone(i.end_at, endTz) : null,
    // Only worth shouting about when the two ends really differ — otherwise
    // every ordinary meeting would carry noise about timezones.
    crossesTimezone: !!(i.end_at && endTz !== startTz),
    // A red-eye ends on a different calendar day than it starts. Saying so
    // is the difference between a day sheet you can trust at 3am and one you
    // have to double-check.
    overnight: !!(i.end_at && dayKeyInZone(i.end_at, endTz) !== dayKeyInZone(i.start_at, startTz)),
    location: i.location,
    destination: i.destination,
    reference: i.reference,
    notes: i.notes,
    bookingId: i.booking_id,
  };
}

// A confirmed booking is part of the day too. Rendering it in the same stream
// as everything else is the entire point — a PA shouldn't have to check two
// lists to know what the principal's Tuesday looks like.
function serializeBooking(b, ownerTz) {
  return {
    id: `booking:${b.id}`,
    source: 'booking',
    kind: 'meeting',
    title: `${b.meeting_type_name} with ${b.booker_name}`,
    startAt: b.start_at,
    endAt: b.end_at,
    startTimezone: ownerTz,
    endTimezone: ownerTz,
    startLabel: timeInZone(b.start_at, ownerTz),
    endLabel: timeInZone(b.end_at, ownerTz),
    crossesTimezone: false,
    overnight: false,
    location: b.video_room ? 'Video call' : '',
    destination: '',
    reference: '',
    notes: '',
    bookingId: b.id,
    videoRoom: b.video_room,
    bookerEmail: b.booker_email,
  };
}

/**
 * Everything on the principal's plate for a given day, in their timezone:
 * itinerary items plus confirmed bookings, merged and ordered.
 */
function buildDay(principal, dateKey) {
  const tz = principal.timezone || 'UTC';

  // Pull a generous window and filter by day-in-zone rather than trying to
  // express "this calendar day in Lagos" as a UTC range in SQL.
  const windowStart = new Date(`${dateKey}T00:00:00Z`);
  const from = new Date(windowStart.getTime() - 36 * 3600 * 1000).toISOString();
  const to = new Date(windowStart.getTime() + 60 * 3600 * 1000).toISOString();

  const items = db.prepare(`
    SELECT * FROM itinerary_items
    WHERE owner_id = ? AND start_at >= ? AND start_at <= ?
  `).all(principal.id, from, to);

  const bookings = db.prepare(`
    SELECT b.*, mt.name AS meeting_type_name FROM bookings b
    JOIN meeting_types mt ON mt.id = b.meeting_type_id
    WHERE b.owner_id = ? AND b.status = 'confirmed' AND b.start_at >= ? AND b.start_at <= ?
  `).all(principal.id, from, to);

  // An itinerary item created from a booking replaces it, so the same meeting
  // never appears twice.
  const covered = new Set(items.filter((i) => i.booking_id).map((i) => i.booking_id));

  const entries = [
    ...items.map((i) => serializeItem(i, tz)),
    ...bookings.filter((b) => !covered.has(b.id)).map((b) => serializeBooking(b, tz)),
  ].filter((e) => dayKeyInZone(e.startAt, e.startTimezone || tz) === dateKey);

  entries.sort((a, b) => new Date(a.startAt) - new Date(b.startAt));
  return entries;
}

router.get('/:ownerId/day', requirePaAccess, (req, res) => {
  const tz = req.principal.timezone || 'UTC';
  const date = req.query.date || new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Date must be YYYY-MM-DD.' });
  }

  res.json({
    date,
    timezone: tz,
    principal: { id: req.principal.id, name: req.principal.name },
    entries: buildDay(req.principal, date),
  });
});

// A compact multi-day outlook, so a PA can see the shape of the week without
// clicking through seven days.
router.get('/:ownerId/upcoming', requirePaAccess, (req, res) => {
  const tz = req.principal.timezone || 'UTC';
  const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 30);
  const todayKey = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());

  const out = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(`${todayKey}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    const key = d.toISOString().slice(0, 10);
    const entries = buildDay(req.principal, key);
    out.push({ date: key, count: entries.length, entries });
  }
  res.json({ timezone: tz, days: out });
});

router.post('/:ownerId/items', requirePaAccess, (req, res) => {
  const { kind, title, startAt, endAt, startTimezone, endTimezone,
    location, destination, reference, notes } = req.body || {};

  if (!title || !String(title).trim()) return res.status(400).json({ error: 'Give it a title.' });
  if (!KINDS.has(kind)) return res.status(400).json({ error: 'Pick what kind of item this is.' });
  const start = new Date(startAt);
  if (!startAt || Number.isNaN(start.getTime())) return res.status(400).json({ error: 'A valid start time is required.' });
  if (endAt) {
    const end = new Date(endAt);
    if (Number.isNaN(end.getTime())) return res.status(400).json({ error: 'That end time is not valid.' });
    if (end < start) return res.status(400).json({ error: 'It cannot end before it starts.' });
  }
  for (const [label, tz] of [['start', startTimezone], ['end', endTimezone]]) {
    if (tz && !isValidTimeZone(tz)) return res.status(400).json({ error: `Unrecognized ${label} timezone.` });
  }

  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO itinerary_items
      (id, owner_id, created_by, kind, title, start_at, end_at, start_timezone, end_timezone,
       location, destination, reference, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, req.principal.id, req.user.id, kind, String(title).trim(),
    start.toISOString(), endAt ? new Date(endAt).toISOString() : null,
    startTimezone || null, endTimezone || null,
    String(location || '').trim(), String(destination || '').trim(),
    String(reference || '').trim(), String(notes || '').trim(), new Date().toISOString());

  const row = db.prepare('SELECT * FROM itinerary_items WHERE id = ?').get(id);
  res.status(201).json({ item: serializeItem(row, req.principal.timezone || 'UTC') });
});

router.patch('/:ownerId/items/:itemId', requirePaAccess, (req, res) => {
  const row = db.prepare('SELECT * FROM itinerary_items WHERE id = ? AND owner_id = ?')
    .get(req.params.itemId, req.principal.id);
  if (!row) return res.status(404).json({ error: 'Item not found.' });

  const fields = {
    kind: 'kind', title: 'title', startAt: 'start_at', endAt: 'end_at',
    startTimezone: 'start_timezone', endTimezone: 'end_timezone',
    location: 'location', destination: 'destination', reference: 'reference', notes: 'notes',
  };
  const updates = [];
  const values = [];
  for (const [key, column] of Object.entries(fields)) {
    if (req.body?.[key] === undefined) continue;
    let value = req.body[key];
    if (key === 'kind' && !KINDS.has(value)) return res.status(400).json({ error: 'Unknown item kind.' });
    if (key === 'title' && !String(value).trim()) return res.status(400).json({ error: 'Give it a title.' });
    if ((key === 'startAt' || key === 'endAt') && value) {
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) return res.status(400).json({ error: 'That time is not valid.' });
      value = d.toISOString();
    }
    if ((key === 'startTimezone' || key === 'endTimezone') && value && !isValidTimeZone(value)) {
      return res.status(400).json({ error: 'Unrecognized timezone.' });
    }
    updates.push(`${column} = ?`);
    values.push(value === '' && (key === 'endAt' || key.endsWith('Timezone')) ? null : value);
  }
  if (updates.length === 0) return res.status(400).json({ error: 'Nothing to update.' });

  values.push(row.id);
  db.prepare(`UPDATE itinerary_items SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  const updated = db.prepare('SELECT * FROM itinerary_items WHERE id = ?').get(row.id);
  res.json({ item: serializeItem(updated, req.principal.timezone || 'UTC') });
});

router.delete('/:ownerId/items/:itemId', requirePaAccess, (req, res) => {
  const row = db.prepare('SELECT * FROM itinerary_items WHERE id = ? AND owner_id = ?')
    .get(req.params.itemId, req.principal.id);
  if (!row) return res.status(404).json({ error: 'Item not found.' });
  db.prepare('DELETE FROM itinerary_items WHERE id = ?').run(row.id);
  res.status(204).end();
});

// Pull a confirmed booking onto the itinerary so it can carry the things a
// booking record has no room for — the car that gets them there, the room
// number, what to read beforehand.
router.post('/:ownerId/items/from-booking/:bookingId', requirePaAccess, (req, res) => {
  const booking = db.prepare(`
    SELECT b.*, mt.name AS meeting_type_name FROM bookings b
    JOIN meeting_types mt ON mt.id = b.meeting_type_id
    WHERE b.id = ? AND b.owner_id = ?
  `).get(req.params.bookingId, req.principal.id);
  if (!booking) return res.status(404).json({ error: 'Booking not found.' });

  const existing = db.prepare('SELECT id FROM itinerary_items WHERE booking_id = ?').get(booking.id);
  if (existing) return res.status(409).json({ error: "That booking is already on the itinerary." });

  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO itinerary_items
      (id, owner_id, created_by, kind, title, start_at, end_at, location, booking_id, created_at)
    VALUES (?, ?, ?, 'meeting', ?, ?, ?, ?, ?, ?)
  `).run(id, req.principal.id, req.user.id,
    `${booking.meeting_type_name} with ${booking.booker_name}`,
    booking.start_at, booking.end_at, booking.video_room ? 'Video call' : '',
    booking.id, new Date().toISOString());

  const row = db.prepare('SELECT * FROM itinerary_items WHERE id = ?').get(id);
  res.status(201).json({ item: serializeItem(row, req.principal.timezone || 'UTC') });
});

module.exports = { router, buildDay, KINDS };
