const express = require('express');
const crypto = require('crypto');
const db = require('../lib/db');
const { requireAuth } = require('../lib/auth');
const { requirePaAccess } = require('../lib/paAccess');
const { sendEmail } = require('../lib/email');
const { formatForEmail } = require('../lib/format');
const { daysUntilNextOccurrence } = require('../lib/relationships');
const { getOpenSlots } = require('../lib/availability');
const { parseRequest, filterSlots } = require('../lib/aiAssist');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const BRIEF_SECTION_KEYS = ['who', 'why', 'background', 'talkingPoints', 'desiredOutcome', 'logistics', 'sensitiveNotes'];

const router = express.Router();
router.use(requireAuth);

router.get('/principals', (req, res) => {
  const self = db.prepare('SELECT id, name, slug FROM users WHERE id = ?').get(req.user.id);
  const memberships = db.prepare(`
    SELECT u.id, u.name, u.slug, m.role
    FROM memberships m
    JOIN users u ON u.id = m.owner_id
    WHERE m.member_user_id = ? AND m.status = 'active'
  `).all(req.user.id);

  res.json({
    principals: [
      { id: self.id, name: self.name, slug: self.slug, role: 'owner' },
      ...memberships.map((m) => ({ id: m.id, name: m.name, slug: m.slug, role: m.role })),
    ],
  });
});

function serializeBooking(b) {
  return {
    id: b.id,
    meetingTypeName: b.meeting_type_name,
    accessTier: b.access_tier,
    bookerName: b.booker_name,
    bookerEmail: b.booker_email,
    bookerTimezone: b.booker_timezone,
    startAt: b.start_at,
    endAt: b.end_at,
    status: b.status,
    createdAt: b.created_at,
  };
}

router.get('/:ownerId/approvals', requirePaAccess, (req, res) => {
  const rows = db.prepare(`
    SELECT b.*, mt.name as meeting_type_name, mt.access_tier
    FROM bookings b
    JOIN meeting_types mt ON mt.id = b.meeting_type_id
    WHERE b.owner_id = ? AND b.status = 'pending'
    ORDER BY b.start_at ASC
  `).all(req.principal.id);
  res.json({ bookings: rows.map(serializeBooking) });
});

router.post('/:ownerId/approvals/:bookingId/approve', requirePaAccess, (req, res) => {
  const booking = db.prepare(`
    SELECT b.*, mt.name as meeting_type_name FROM bookings b
    JOIN meeting_types mt ON mt.id = b.meeting_type_id
    WHERE b.id = ? AND b.owner_id = ?
  `).get(req.params.bookingId, req.principal.id);
  if (!booking) return res.status(404).json({ error: 'Request not found.' });
  if (booking.status !== 'pending') return res.status(400).json({ error: 'This request was already resolved.' });

  db.prepare("UPDATE bookings SET status = 'confirmed' WHERE id = ?").run(booking.id);

  sendEmail({
    ownerId: req.principal.id, sentByUserId: req.user.id, toEmail: booking.booker_email, relatedBookingId: booking.id,
    category: 'transactional',
    subject: `Confirmed: ${booking.meeting_type_name} with ${req.principal.name}`,
    body: `Hi ${booking.booker_name},\n\nYou're confirmed for ${formatForEmail(booking.start_at, booking.booker_timezone)} (${booking.booker_timezone}).\n\nManage this booking: /book/manage/${booking.id}`,
  });

  res.json({ ok: true });
});

router.post('/:ownerId/approvals/:bookingId/decline', requirePaAccess, (req, res) => {
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ? AND owner_id = ?').get(req.params.bookingId, req.principal.id);
  if (!booking) return res.status(404).json({ error: 'Request not found.' });
  if (booking.status !== 'pending') return res.status(400).json({ error: 'This request was already resolved.' });

  db.prepare("UPDATE bookings SET status = 'declined' WHERE id = ?").run(booking.id);

  sendEmail({
    ownerId: req.principal.id, sentByUserId: req.user.id, toEmail: booking.booker_email, relatedBookingId: booking.id,
    category: 'transactional',
    subject: `Update on your request with ${req.principal.name}`,
    body: `Hi ${booking.booker_name},\n\n${req.principal.name} wasn't able to accept your request for ${formatForEmail(booking.start_at, booking.booker_timezone)} (${booking.booker_timezone}). Feel free to pick another time: /book/${req.principal.slug}`,
  });

  res.json({ ok: true });
});

function serializeContact(c) {
  return {
    id: c.id,
    email: c.email,
    name: c.name,
    notes: c.notes,
    relationshipTier: c.relationship_tier,
    birthday: c.birthday,
    anniversary: c.anniversary,
    meetingCount: c.meeting_count,
    lastMeetingAt: c.last_meeting_at,
  };
}

router.get('/:ownerId/contacts', requirePaAccess, (req, res) => {
  const rows = db.prepare(`
    SELECT c.*,
      COUNT(b.id) as meeting_count,
      MAX(b.start_at) as last_meeting_at
    FROM contacts c
    LEFT JOIN bookings b ON b.owner_id = c.owner_id AND b.booker_email = c.email AND b.status = 'confirmed'
    WHERE c.owner_id = ?
    GROUP BY c.id
    ORDER BY COALESCE(last_meeting_at, c.created_at) DESC
  `).all(req.principal.id);
  res.json({ contacts: rows.map(serializeContact) });
});

const RELATIONSHIP_TIERS = new Set(['inner_circle', 'close', 'professional']);
const MONTH_DAY_RE = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

router.patch('/:ownerId/contacts/:id', requirePaAccess, (req, res) => {
  const row = db.prepare('SELECT * FROM contacts WHERE id = ? AND owner_id = ?').get(req.params.id, req.principal.id);
  if (!row) return res.status(404).json({ error: 'Contact not found.' });

  const { notes, relationshipTier, birthday, anniversary } = req.body || {};
  const updates = [];
  const values = [];
  if (notes !== undefined) { updates.push('notes = ?'); values.push(String(notes)); }
  if (relationshipTier !== undefined) {
    if (!RELATIONSHIP_TIERS.has(relationshipTier)) return res.status(400).json({ error: 'Invalid relationship tier.' });
    updates.push('relationship_tier = ?'); values.push(relationshipTier);
  }
  if (birthday !== undefined) {
    if (birthday !== '' && !MONTH_DAY_RE.test(birthday)) return res.status(400).json({ error: 'Birthday must be MM-DD.' });
    updates.push('birthday = ?'); values.push(birthday || null);
  }
  if (anniversary !== undefined) {
    if (anniversary !== '' && !MONTH_DAY_RE.test(anniversary)) return res.status(400).json({ error: 'Anniversary must be MM-DD.' });
    updates.push('anniversary = ?'); values.push(anniversary || null);
  }
  if (updates.length === 0) return res.status(400).json({ error: 'Nothing to update.' });

  updates.push('updated_at = ?');
  values.push(new Date().toISOString(), row.id);
  db.prepare(`UPDATE contacts SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  const updated = db.prepare(`
    SELECT c.*, COUNT(b.id) as meeting_count, MAX(b.start_at) as last_meeting_at
    FROM contacts c
    LEFT JOIN bookings b ON b.owner_id = c.owner_id AND b.booker_email = c.email AND b.status = 'confirmed'
    WHERE c.id = ?
    GROUP BY c.id
  `).get(row.id);
  res.json({ contact: serializeContact(updated) });
});

router.get('/:ownerId/relationships/upcoming', requirePaAccess, (req, res) => {
  const rows = db.prepare(`
    SELECT * FROM contacts WHERE owner_id = ? AND (birthday IS NOT NULL OR anniversary IS NOT NULL)
  `).all(req.principal.id);

  const upcoming = [];
  for (const c of rows) {
    if (c.birthday) {
      const days = daysUntilNextOccurrence(c.birthday);
      if (days !== null) upcoming.push({ contactId: c.id, name: c.name || c.email, email: c.email, relationshipTier: c.relationship_tier, kind: 'birthday', monthDay: c.birthday, daysUntil: days });
    }
    if (c.anniversary) {
      const days = daysUntilNextOccurrence(c.anniversary);
      if (days !== null) upcoming.push({ contactId: c.id, name: c.name || c.email, email: c.email, relationshipTier: c.relationship_tier, kind: 'anniversary', monthDay: c.anniversary, daysUntil: days });
    }
  }
  upcoming.sort((a, b) => a.daysUntil - b.daysUntil);

  res.json({ upcoming });
});

// Upcoming confirmed bookings for this principal — used by the Briefs tab's
// picker (and generally useful to a PA who wants a quick agenda glance).
router.get('/:ownerId/bookings', requirePaAccess, (req, res) => {
  const now = new Date().toISOString();
  const rows = db.prepare(`
    SELECT b.id, b.booker_name, b.booker_email, b.start_at, mt.name as meeting_type_name,
      (SELECT 1 FROM briefs br WHERE br.booking_id = b.id) as has_brief
    FROM bookings b
    JOIN meeting_types mt ON mt.id = b.meeting_type_id
    WHERE b.owner_id = ? AND b.status = 'confirmed' AND b.start_at >= ?
    ORDER BY b.start_at ASC
  `).all(req.principal.id, now);

  res.json({
    bookings: rows.map((b) => ({
      id: b.id,
      bookerName: b.booker_name,
      bookerEmail: b.booker_email,
      startAt: b.start_at,
      meetingTypeName: b.meeting_type_name,
      hasBrief: !!b.has_brief,
    })),
  });
});

function emptySections() {
  return Object.fromEntries(BRIEF_SECTION_KEYS.map((k) => [k, '']));
}

router.get('/:ownerId/briefs/:bookingId', requirePaAccess, (req, res) => {
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ? AND owner_id = ?').get(req.params.bookingId, req.principal.id);
  if (!booking) return res.status(404).json({ error: 'Booking not found.' });

  const brief = db.prepare('SELECT * FROM briefs WHERE booking_id = ?').get(booking.id);
  const sections = brief ? { ...emptySections(), ...JSON.parse(brief.sections) } : emptySections();
  res.json({ sections, updatedAt: brief?.updated_at || null });
});

router.put('/:ownerId/briefs/:bookingId', requirePaAccess, (req, res) => {
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ? AND owner_id = ?').get(req.params.bookingId, req.principal.id);
  if (!booking) return res.status(404).json({ error: 'Booking not found.' });

  const { sections } = req.body || {};
  if (!sections || typeof sections !== 'object') {
    return res.status(400).json({ error: 'Expected brief sections.' });
  }
  const clean = {};
  for (const key of BRIEF_SECTION_KEYS) clean[key] = String(sections[key] || '').slice(0, 4000);

  const existing = db.prepare('SELECT id FROM briefs WHERE booking_id = ?').get(booking.id);
  const now = new Date().toISOString();
  if (existing) {
    db.prepare('UPDATE briefs SET sections = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(clean), now, existing.id);
  } else {
    db.prepare(`
      INSERT INTO briefs (id, booking_id, owner_id, sections, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(crypto.randomUUID(), booking.id, req.principal.id, JSON.stringify(clean), req.user.id, now, now);
  }

  res.json({ sections: clean, updatedAt: now });
});

function serializeInstruction(i) {
  return {
    id: i.id,
    text: i.text,
    priority: i.priority,
    status: i.status,
    createdBy: i.created_by_name,
    createdAt: i.created_at,
  };
}

router.get('/:ownerId/instructions', requirePaAccess, (req, res) => {
  const rows = db.prepare(`
    SELECT i.*, u.name as created_by_name
    FROM instructions i
    JOIN users u ON u.id = i.created_by
    WHERE i.owner_id = ?
    ORDER BY (i.status = 'open') DESC, (i.priority = 'urgent') DESC, i.created_at DESC
  `).all(req.principal.id);
  res.json({ instructions: rows.map(serializeInstruction) });
});

router.post('/:ownerId/instructions', requirePaAccess, (req, res) => {
  const { text, priority } = req.body || {};
  if (!text || !String(text).trim()) {
    return res.status(400).json({ error: 'Instruction text is required.' });
  }
  const cleanPriority = priority === 'urgent' ? 'urgent' : 'normal';
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO instructions (id, owner_id, created_by, text, priority, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'open', ?)
  `).run(id, req.principal.id, req.user.id, String(text).trim(), cleanPriority, new Date().toISOString());

  const row = db.prepare(`
    SELECT i.*, u.name as created_by_name FROM instructions i JOIN users u ON u.id = i.created_by WHERE i.id = ?
  `).get(id);
  res.status(201).json({ instruction: serializeInstruction(row) });
});

router.patch('/:ownerId/instructions/:id', requirePaAccess, (req, res) => {
  const row = db.prepare('SELECT * FROM instructions WHERE id = ? AND owner_id = ?').get(req.params.id, req.principal.id);
  if (!row) return res.status(404).json({ error: 'Instruction not found.' });

  const { status } = req.body || {};
  if (status !== 'open' && status !== 'done') {
    return res.status(400).json({ error: 'Invalid status.' });
  }
  db.prepare('UPDATE instructions SET status = ? WHERE id = ?').run(status, row.id);

  const updated = db.prepare(`
    SELECT i.*, u.name as created_by_name FROM instructions i JOIN users u ON u.id = i.created_by WHERE i.id = ?
  `).get(row.id);
  res.json({ instruction: serializeInstruction(updated) });
});

router.get('/:ownerId/comms', requirePaAccess, (req, res) => {
  const rows = db.prepare(`
    SELECT e.*, u.name as sent_by_name FROM emails e
    LEFT JOIN users u ON u.id = e.sent_by_user_id
    WHERE e.owner_id = ? AND e.category = 'comms'
    ORDER BY e.created_at DESC
  `).all(req.principal.id);
  res.json({
    messages: rows.map((e) => ({
      id: e.id,
      toEmail: e.to_email,
      subject: e.subject,
      body: e.body,
      sentBy: e.sent_by_name,
      createdAt: e.created_at,
    })),
  });
});

router.post('/:ownerId/comms', requirePaAccess, (req, res) => {
  const { toEmail, subject, body } = req.body || {};
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!toEmail || !EMAIL_RE.test(String(toEmail).trim())) {
    return res.status(400).json({ error: 'Please provide a valid recipient email.' });
  }
  if (!subject || !String(subject).trim()) return res.status(400).json({ error: 'Subject is required.' });
  if (!body || !String(body).trim()) return res.status(400).json({ error: 'Message body is required.' });

  sendEmail({
    ownerId: req.principal.id,
    sentByUserId: req.user.id,
    toEmail: String(toEmail).trim().toLowerCase(),
    subject: String(subject).trim(),
    body: String(body).trim(),
    category: 'comms',
  });

  res.status(201).json({ ok: true });
});

router.post('/:ownerId/ai-assist/parse', requirePaAccess, (req, res) => {
  const { message } = req.body || {};
  if (!message || !String(message).trim()) {
    return res.status(400).json({ error: 'Please describe what you want to schedule.' });
  }

  const contacts = db.prepare('SELECT id, name, email FROM contacts WHERE owner_id = ?').all(req.principal.id);
  const meetingTypes = db.prepare('SELECT id, name, slug, duration_minutes, location_type FROM meeting_types WHERE owner_id = ? AND is_active = 1 ORDER BY created_at').all(req.principal.id);

  if (meetingTypes.length === 0) {
    return res.status(400).json({ error: 'No active meeting types to schedule against.' });
  }

  const hints = parseRequest(String(message), { contacts, meetingTypes });
  if (!hints.meetingType) {
    return res.status(400).json({ error: "Couldn't match a meeting type — try naming one explicitly." });
  }

  const meetingType = {
    id: hints.meetingType.id,
    duration_minutes: hints.meetingType.duration_minutes,
    buffer_before_minutes: 0,
    buffer_after_minutes: 0,
  };
  const allSlots = getOpenSlots({ owner: req.principal, meetingType });
  const filtered = filterSlots(allSlots, hints, req.principal.timezone);
  const candidates = (filtered.length > 0 ? filtered : allSlots).slice(0, 5);

  res.json({
    contact: hints.contact ? { id: hints.contact.id, name: hints.contact.name, email: hints.contact.email } : null,
    meetingType: { id: hints.meetingType.id, name: hints.meetingType.name, slug: hints.meetingType.slug, durationMinutes: hints.meetingType.duration_minutes },
    matchedFilter: filtered.length > 0,
    candidates: candidates.map((s) => ({ startAt: s.startUtc.toISOString(), endAt: s.endUtc.toISOString() })),
  });
});

// A PA directly creating a booking is itself the approval — always lands as
// 'confirmed', regardless of the meeting type's tier, unlike the public
// booking flow. Still requires an explicit click; nothing here is automatic.
router.post('/:ownerId/ai-assist/book', requirePaAccess, (req, res) => {
  const { meetingTypeId, startAt, contactEmail, contactName } = req.body || {};
  const meetingType = db.prepare('SELECT * FROM meeting_types WHERE id = ? AND owner_id = ? AND is_active = 1').get(meetingTypeId, req.principal.id);
  if (!meetingType) return res.status(404).json({ error: 'Meeting type not found.' });
  if (!contactEmail || !EMAIL_RE.test(String(contactEmail).trim())) {
    return res.status(400).json({ error: 'A valid contact email is required.' });
  }
  const start = new Date(startAt);
  if (!startAt || Number.isNaN(start.getTime()) || start.getTime() <= Date.now()) {
    return res.status(400).json({ error: 'Please choose a valid future time.' });
  }

  const stillOpen = getOpenSlots({ owner: req.principal, meetingType }).some((s) => s.startUtc.getTime() === start.getTime());
  if (!stillOpen) return res.status(409).json({ error: 'That slot was just taken. Please pick another time.' });

  const end = new Date(start.getTime() + meetingType.duration_minutes * 60000);
  const cleanEmail = String(contactEmail).trim().toLowerCase();
  const cleanName = String(contactName || cleanEmail).trim();
  const videoRoom = meetingType.location_type === 'video' ? `kairos-${crypto.randomBytes(8).toString('hex')}` : null;
  const id = crypto.randomUUID();

  db.prepare(`
    INSERT INTO bookings (id, meeting_type_id, owner_id, booker_name, booker_email, booker_timezone, start_at, end_at, status, video_room, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?)
  `).run(id, meetingType.id, req.principal.id, cleanName, cleanEmail, req.principal.timezone, start.toISOString(), end.toISOString(), videoRoom, new Date().toISOString());

  const existingContact = db.prepare('SELECT id FROM contacts WHERE owner_id = ? AND email = ?').get(req.principal.id, cleanEmail);
  if (!existingContact) {
    db.prepare(`
      INSERT INTO contacts (id, owner_id, email, name, notes, relationship_tier, created_at, updated_at)
      VALUES (?, ?, ?, ?, '', 'professional', ?, ?)
    `).run(crypto.randomUUID(), req.principal.id, cleanEmail, cleanName, new Date().toISOString(), new Date().toISOString());
  }

  sendEmail({
    ownerId: req.principal.id, sentByUserId: req.user.id, toEmail: cleanEmail, relatedBookingId: id, category: 'transactional',
    subject: `Confirmed: ${meetingType.name} with ${req.principal.name}`,
    body: `Hi ${cleanName},\n\nYou're confirmed for ${formatForEmail(start.toISOString(), req.principal.timezone)} (${req.principal.timezone}).\n\nManage this booking: /book/manage/${id}`,
  });

  res.status(201).json({ booking: { id, startAt: start.toISOString(), endAt: end.toISOString(), videoRoom } });
});

module.exports = router;
