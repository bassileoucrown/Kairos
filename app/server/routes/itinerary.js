const express = require('express');
const { asyncRouter } = require('../lib/asyncRouter');
const crypto = require('crypto');
const db = require('../lib/db');
const { requireAuth } = require('../lib/auth');
const { requirePaAccess } = require('../lib/paAccess');
const { isValidTimeZone } = require('../lib/timezone');

const router = asyncRouter();
router.use(requireAuth);

const KINDS = new Set(['flight', 'train', 'car', 'hotel', 'meeting', 'meal', 'personal', 'call', 'note']);
const STATUSES = new Set(['draft', 'proposed', 'confirmed']);

// What each viewer is allowed to see on a principal's itinerary.
//
// The principal's day sheet has one job: be true. A half-arranged flight an
// assistant is still chasing does not belong on it, or the sheet stops being
// something you can plan around. Drafts are therefore invisible to the
// principal — not dimmed, not collapsed, absent.
//
// Proposals are different: those were deliberately sent to the principal and
// are waiting on them, so they show, marked as pending, and are listed
// separately as requests. Assistants see everything, because arranging it is
// the job.
function visibleStatusesFor(viewerIsPrincipal) {
  return viewerIsPrincipal ? ['confirmed', 'proposed'] : ['draft', 'proposed', 'confirmed'];
}

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
    status: i.status || 'confirmed',
    proposalNote: i.proposal_note || '',
    proposedAt: i.proposed_at || null,
    decisionNote: i.decision_note || '',
    decidedAt: i.decided_at || null,
    createdBy: i.created_by,
    createdByName: i.created_by_name || null,
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
    // A confirmed booking is by definition confirmed — it went through the
    // booking flow, not the assistant's drafting one.
    status: 'confirmed',
    proposalNote: '',
    proposedAt: null,
    decisionNote: '',
    decidedAt: null,
    createdBy: null,
    createdByName: null,
    videoRoom: b.video_room,
    bookerEmail: b.booker_email,
  };
}

/**
 * Everything on the principal's plate for a given day, in their timezone:
 * itinerary items plus confirmed bookings, merged and ordered.
 */
async function buildDay(principal, dateKey, { viewerIsPrincipal = true } = {}) {
  const tz = principal.timezone || 'UTC';

  // Pull a generous window and filter by day-in-zone rather than trying to
  // express "this calendar day in Lagos" as a UTC range in SQL.
  const windowStart = new Date(`${dateKey}T00:00:00Z`);
  const from = new Date(windowStart.getTime() - 36 * 3600 * 1000).toISOString();
  const to = new Date(windowStart.getTime() + 60 * 3600 * 1000).toISOString();

  const statuses = visibleStatusesFor(viewerIsPrincipal);
  const items = await db.prepare(`
    SELECT i.*, u.name AS created_by_name FROM itinerary_items i
    LEFT JOIN users u ON u.id = i.created_by
    WHERE i.owner_id = ? AND i.start_at >= ? AND i.start_at <= ?
      AND i.status IN (${statuses.map(() => '?').join(',')})
  `).all(principal.id, from, to, ...statuses);

  const bookings = await db.prepare(`
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

router.get('/:ownerId/day', requirePaAccess, async (req, res) => {
  const tz = req.principal.timezone || 'UTC';
  const date = req.query.date || new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Date must be YYYY-MM-DD.' });
  }

  const viewerIsPrincipal = req.paRole === 'owner';
  res.json({
    date,
    timezone: tz,
    principal: { id: req.principal.id, name: req.principal.name },
    viewerIsPrincipal,
    entries: await buildDay(req.principal, date, { viewerIsPrincipal }),
  });
});

// A compact multi-day outlook, so a PA can see the shape of the week without
// clicking through seven days.
router.get('/:ownerId/upcoming', requirePaAccess, async (req, res) => {
  const tz = req.principal.timezone || 'UTC';
  const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 30);
  const todayKey = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());

  const viewerIsPrincipal = req.paRole === 'owner';
  const out = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(`${todayKey}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    const key = d.toISOString().slice(0, 10);
    const entries = await buildDay(req.principal, key, { viewerIsPrincipal });
    out.push({ date: key, count: entries.length, entries });
  }
  res.json({ timezone: tz, viewerIsPrincipal, days: out });
});

router.post('/:ownerId/items', requirePaAccess, async (req, res) => {
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

  // A principal entering their own plan means it — it is live at once. An
  // assistant arranging something starts in draft, so nothing reaches the
  // principal's day until they say so. `status` in the body lets an assistant
  // who has finished arranging skip straight to confirmed in one step.
  const viewerIsPrincipal = req.paRole === 'owner';
  const requested = req.body?.status;
  if (requested !== undefined && !STATUSES.has(requested)) {
    return res.status(400).json({ error: 'Unknown status.' });
  }
  if (requested === 'proposed') {
    return res.status(400).json({ error: 'Create it first, then send it for approval.' });
  }
  let status;
  if (viewerIsPrincipal) {
    status = 'confirmed';
  } else {
    status = requested || 'draft';
  }

  const id = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO itinerary_items
      (id, owner_id, created_by, kind, title, start_at, end_at, start_timezone, end_timezone,
       location, destination, reference, notes, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, req.principal.id, req.user.id, kind, String(title).trim(),
    start.toISOString(), endAt ? new Date(endAt).toISOString() : null,
    startTimezone || null, endTimezone || null,
    String(location || '').trim(), String(destination || '').trim(),
    String(reference || '').trim(), String(notes || '').trim(), status, new Date().toISOString());

  const row = await db.prepare('SELECT * FROM itinerary_items WHERE id = ?').get(id);
  res.status(201).json({ item: serializeItem(row, req.principal.timezone || 'UTC') });
});

// --- The draft → proposed → confirmed path ------------------------------
//
// Three transitions, each with exactly one party entitled to make it, which
// is the whole reason this is a state machine rather than a boolean.

async function loadItem(itemId, principalId) {
  return db.prepare(`
    SELECT i.*, u.name AS created_by_name FROM itinerary_items i
    LEFT JOIN users u ON u.id = i.created_by
    WHERE i.id = ? AND i.owner_id = ?
  `).get(itemId, principalId);
}

// Assistant → principal: "please approve this".
router.post('/:ownerId/items/:itemId/propose', requirePaAccess, async (req, res) => {
  if (req.paRole === 'owner') {
    return res.status(400).json({ error: "It's your own itinerary — you don't need to ask yourself." });
  }
  const item = await loadItem(req.params.itemId, req.principal.id);
  if (!item) return res.status(404).json({ error: 'Item not found.' });
  if (item.status === 'proposed') return res.status(409).json({ error: 'That is already waiting with them.' });
  if (item.status === 'confirmed') {
    return res.status(409).json({ error: 'That is already on their itinerary.' });
  }

  await db.prepare(`
    UPDATE itinerary_items
    SET status = 'proposed', proposal_note = ?, proposed_at = ?, decision_note = '', decided_at = NULL, decided_by = NULL
    WHERE id = ?
  `).run(String(req.body?.note || '').trim(), new Date().toISOString(), item.id);

  res.json({ item: serializeItem(await loadItem(item.id, req.principal.id), req.principal.timezone || 'UTC') });
});

// Straight onto the principal's day, no approval round. This is the ordinary
// case — an assistant who has finished arranging something is not asking
// permission, they are reporting a fact.
router.post('/:ownerId/items/:itemId/publish', requirePaAccess, async (req, res) => {
  const item = await loadItem(req.params.itemId, req.principal.id);
  if (!item) return res.status(404).json({ error: 'Item not found.' });
  if (item.status === 'confirmed') return res.json({ item: serializeItem(item, req.principal.timezone || 'UTC') });

  await db.prepare(`
    UPDATE itinerary_items SET status = 'confirmed', decided_at = ?, decided_by = ? WHERE id = ?
  `).run(new Date().toISOString(), req.user.id, item.id);

  res.json({ item: serializeItem(await loadItem(item.id, req.principal.id), req.principal.timezone || 'UTC') });
});

// The principal's answer. Theirs alone — an assistant approving their own
// proposal would make the whole request meaningless.
router.post('/:ownerId/items/:itemId/decide', requirePaAccess, async (req, res) => {
  if (req.paRole !== 'owner') {
    return res.status(403).json({ error: 'Only the principal can approve or decline a request.' });
  }
  const item = await loadItem(req.params.itemId, req.principal.id);
  if (!item) return res.status(404).json({ error: 'Item not found.' });
  if (item.status !== 'proposed') {
    return res.status(409).json({ error: 'That is not waiting for a decision.' });
  }

  const { approve, note } = req.body || {};
  if (typeof approve !== 'boolean') {
    return res.status(400).json({ error: 'Say whether you approve it.' });
  }

  // Declining returns it to the assistant's drafts rather than deleting it —
  // the work of assembling it was real, and "not this time" usually means
  // "come back with a different flight", not "forget it".
  await db.prepare(`
    UPDATE itinerary_items SET status = ?, decision_note = ?, decided_at = ?, decided_by = ? WHERE id = ?
  `).run(approve ? 'confirmed' : 'draft', String(note || '').trim(),
    new Date().toISOString(), req.user.id, item.id);

  res.json({ item: serializeItem(await loadItem(item.id, req.principal.id), req.principal.timezone || 'UTC') });
});

// Everything an assistant has in flight for this principal, which is the
// working list the day view deliberately hides.
router.get('/:ownerId/pipeline', requirePaAccess, async (req, res) => {
  const rows = await db.prepare(`
    SELECT i.*, u.name AS created_by_name FROM itinerary_items i
    LEFT JOIN users u ON u.id = i.created_by
    WHERE i.owner_id = ? AND i.status IN ('draft', 'proposed')
    ORDER BY i.start_at ASC
  `).all(req.principal.id);

  const tz = req.principal.timezone || 'UTC';
  const items = rows.map((r) => serializeItem(r, tz));
  res.json({
    timezone: tz,
    drafts: items.filter((i) => i.status === 'draft'),
    proposed: items.filter((i) => i.status === 'proposed'),
  });
});

// A principal cannot see an assistant's drafts, so for them a draft does not
// exist — 404, not 403. Reporting "forbidden" would confirm that something is
// there, which is exactly the leak that hiding drafts is meant to prevent.
function hiddenFromViewer(row, req) {
  return row.status === 'draft' && req.paRole === 'owner';
}

router.patch('/:ownerId/items/:itemId', requirePaAccess, async (req, res) => {
  const row = await db.prepare('SELECT * FROM itinerary_items WHERE id = ? AND owner_id = ?')
    .get(req.params.itemId, req.principal.id);
  if (!row || hiddenFromViewer(row, req)) return res.status(404).json({ error: 'Item not found.' });

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
  await db.prepare(`UPDATE itinerary_items SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  const updated = await db.prepare('SELECT * FROM itinerary_items WHERE id = ?').get(row.id);
  res.json({ item: serializeItem(updated, req.principal.timezone || 'UTC') });
});

router.delete('/:ownerId/items/:itemId', requirePaAccess, async (req, res) => {
  const row = await db.prepare('SELECT * FROM itinerary_items WHERE id = ? AND owner_id = ?')
    .get(req.params.itemId, req.principal.id);
  if (!row || hiddenFromViewer(row, req)) return res.status(404).json({ error: 'Item not found.' });
  await db.prepare('DELETE FROM itinerary_items WHERE id = ?').run(row.id);
  res.status(204).end();
});

// Pull a confirmed booking onto the itinerary so it can carry the things a
// booking record has no room for — the car that gets them there, the room
// number, what to read beforehand.
router.post('/:ownerId/items/from-booking/:bookingId', requirePaAccess, async (req, res) => {
  const booking = await db.prepare(`
    SELECT b.*, mt.name AS meeting_type_name FROM bookings b
    JOIN meeting_types mt ON mt.id = b.meeting_type_id
    WHERE b.id = ? AND b.owner_id = ?
  `).get(req.params.bookingId, req.principal.id);
  if (!booking) return res.status(404).json({ error: 'Booking not found.' });

  const existing = await db.prepare('SELECT id FROM itinerary_items WHERE booking_id = ?').get(booking.id);
  if (existing) return res.status(409).json({ error: "That booking is already on the itinerary." });

  const id = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO itinerary_items
      (id, owner_id, created_by, kind, title, start_at, end_at, location, booking_id, created_at)
    VALUES (?, ?, ?, 'meeting', ?, ?, ?, ?, ?, ?)
  `).run(id, req.principal.id, req.user.id,
    `${booking.meeting_type_name} with ${booking.booker_name}`,
    booking.start_at, booking.end_at, booking.video_room ? 'Video call' : '',
    booking.id, new Date().toISOString());

  const row = await db.prepare('SELECT * FROM itinerary_items WHERE id = ?').get(id);
  res.status(201).json({ item: serializeItem(row, req.principal.timezone || 'UTC') });
});

module.exports = { router, buildDay, KINDS };
