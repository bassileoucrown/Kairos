const express = require('express');
const crypto = require('crypto');
const db = require('../lib/db');
const { getOpenSlots } = require('../lib/availability');
const { isValidTimeZone } = require('../lib/timezone');
const { sendEmail } = require('../lib/email');
const { formatForEmail } = require('../lib/format');

const router = express.Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function getOwnerBySlug(slug) {
  return db.prepare('SELECT * FROM users WHERE slug = ?').get(slug);
}

function getActiveMeetingType(ownerId, meetingSlug) {
  return db.prepare('SELECT * FROM meeting_types WHERE owner_id = ? AND slug = ? AND is_active = 1')
    .get(ownerId, meetingSlug);
}

router.get('/:slug', (req, res) => {
  const owner = getOwnerBySlug(req.params.slug);
  if (!owner) return res.status(404).json({ error: 'This booking page does not exist.' });

  const meetingTypes = db
    .prepare('SELECT id, name, slug, duration_minutes, description, location_type FROM meeting_types WHERE owner_id = ? AND is_active = 1 ORDER BY created_at')
    .all(owner.id);

  res.json({
    owner: { name: owner.name, slug: owner.slug },
    meetingTypes: meetingTypes.map((mt) => ({
      id: mt.id,
      name: mt.name,
      slug: mt.slug,
      durationMinutes: mt.duration_minutes,
      description: mt.description,
      locationType: mt.location_type,
    })),
  });
});

router.get('/:slug/:meetingSlug/slots', (req, res) => {
  const owner = getOwnerBySlug(req.params.slug);
  if (!owner) return res.status(404).json({ error: 'This booking page does not exist.' });
  const meetingType = getActiveMeetingType(owner.id, req.params.meetingSlug);
  if (!meetingType) return res.status(404).json({ error: 'This meeting type is not available.' });

  // excludeBookingId: when rescheduling, omit the booking's own current slot
  // from the conflict check so it doesn't block moving to a new time.
  const slots = getOpenSlots({ owner, meetingType, excludeBookingId: req.query.excludeBookingId || null });
  res.json({
    ownerTimezone: owner.timezone,
    slots: slots.map((s) => ({ startAt: s.startUtc.toISOString(), endAt: s.endUtc.toISOString() })),
  });
});

router.post('/:slug/:meetingSlug/book', (req, res) => {
  const owner = getOwnerBySlug(req.params.slug);
  if (!owner) return res.status(404).json({ error: 'This booking page does not exist.' });
  const meetingType = getActiveMeetingType(owner.id, req.params.meetingSlug);
  if (!meetingType) return res.status(404).json({ error: 'This meeting type is not available.' });

  const { name, email, timezone, startAt } = req.body || {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'Please provide your name.' });
  }
  if (!email || !EMAIL_RE.test(String(email).trim())) {
    return res.status(400).json({ error: 'Please provide a valid email address.' });
  }
  const bookerTimezone = timezone && isValidTimeZone(timezone) ? timezone : 'UTC';
  const start = new Date(startAt);
  if (!startAt || Number.isNaN(start.getTime())) {
    return res.status(400).json({ error: 'Please choose a time slot.' });
  }
  const end = new Date(start.getTime() + meetingType.duration_minutes * 60000);
  if (start.getTime() <= Date.now()) {
    return res.status(400).json({ error: 'That time has already passed. Please pick another slot.' });
  }

  // Re-validate against the live schedule to close the race between a
  // booker viewing slots and submitting — never trust the client's slot list.
  const stillOpen = getOpenSlots({ owner, meetingType })
    .some((s) => s.startUtc.getTime() === start.getTime());
  if (!stillOpen) {
    return res.status(409).json({ error: 'That slot was just taken. Please pick another time.' });
  }

  const id = crypto.randomUUID();
  const cleanEmail = String(email).trim().toLowerCase();
  const cleanName = String(name).trim();
  const needsApproval = meetingType.access_tier >= 3;
  const status = needsApproval ? 'pending' : 'confirmed';
  const videoRoom = meetingType.location_type === 'video'
    ? `kairos-${crypto.randomBytes(8).toString('hex')}`
    : null;

  db.prepare(`
    INSERT INTO bookings (id, meeting_type_id, owner_id, booker_name, booker_email, booker_timezone, start_at, end_at, status, video_room, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, meetingType.id, owner.id, cleanName, cleanEmail, bookerTimezone,
    start.toISOString(), end.toISOString(), status, videoRoom, new Date().toISOString());

  // Upsert a lightweight contact record so Contact Intelligence has
  // something to show even before a PA has added notes.
  const existingContact = db.prepare('SELECT id FROM contacts WHERE owner_id = ? AND email = ?').get(owner.id, cleanEmail);
  if (!existingContact) {
    db.prepare(`
      INSERT INTO contacts (id, owner_id, email, name, notes, relationship_tier, created_at, updated_at)
      VALUES (?, ?, ?, ?, '', 'professional', ?, ?)
    `).run(crypto.randomUUID(), owner.id, cleanEmail, cleanName, new Date().toISOString(), new Date().toISOString());
  }

  const when = formatForEmail(start.toISOString(), bookerTimezone);
  if (needsApproval) {
    sendEmail({
      ownerId: owner.id, toEmail: cleanEmail, relatedBookingId: id, category: 'transactional',
      subject: `Request received: ${meetingType.name} with ${owner.name}`,
      body: `Hi ${cleanName},\n\nYour request for ${when} (${bookerTimezone}) is awaiting ${owner.name}'s confirmation. We'll email you as soon as it's approved.\n\nManage this request: /book/manage/${id}`,
    });
    sendEmail({
      ownerId: owner.id, toEmail: owner.email, relatedBookingId: id, category: 'transactional',
      subject: `Approval needed: ${cleanName} wants to book ${meetingType.name}`,
      body: `${cleanName} (${cleanEmail}) requested ${when} (${bookerTimezone}) for ${meetingType.name}. This meeting type requires approval — review it in your Approval Queue.`,
    });
  } else {
    sendEmail({
      ownerId: owner.id, toEmail: cleanEmail, relatedBookingId: id, category: 'transactional',
      subject: `Confirmed: ${meetingType.name} with ${owner.name}`,
      body: `Hi ${cleanName},\n\nYou're confirmed for ${when} (${bookerTimezone}).\n\nManage this booking: /book/manage/${id}`,
    });
  }

  res.status(201).json({
    booking: {
      id,
      status,
      ownerName: owner.name,
      meetingTypeName: meetingType.name,
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      bookerTimezone,
      videoRoom,
    },
  });
});

function getBookingDetail(id) {
  return db.prepare(`
    SELECT
      b.id, b.status, b.start_at, b.end_at, b.booker_name, b.booker_email, b.booker_timezone, b.video_room,
      mt.name as meeting_type_name, mt.slug as meeting_type_slug, mt.duration_minutes, mt.location_type,
      u.name as owner_name, u.slug as owner_slug, u.timezone as owner_timezone
    FROM bookings b
    JOIN meeting_types mt ON mt.id = b.meeting_type_id
    JOIN users u ON u.id = b.owner_id
    WHERE b.id = ?
  `).get(id);
}

function serializeBookingDetail(b) {
  return {
    id: b.id,
    status: b.status,
    startAt: b.start_at,
    endAt: b.end_at,
    bookerName: b.booker_name,
    bookerEmail: b.booker_email,
    bookerTimezone: b.booker_timezone,
    videoRoom: b.video_room,
    meetingTypeName: b.meeting_type_name,
    meetingTypeSlug: b.meeting_type_slug,
    durationMinutes: b.duration_minutes,
    locationType: b.location_type,
    ownerName: b.owner_name,
    ownerSlug: b.owner_slug,
    ownerTimezone: b.owner_timezone,
  };
}

// Booking ids are random UUIDs (crypto.randomUUID), unguessable by
// construction, so the id itself doubles as this link's access capability —
// the same pattern most booking-confirmation "manage your reservation"
// links use. No additional token needed.
router.get('/bookings/:id', (req, res) => {
  const booking = getBookingDetail(req.params.id);
  if (!booking) return res.status(404).json({ error: 'Booking not found.' });
  res.json({ booking: serializeBookingDetail(booking) });
});

router.post('/bookings/:id/cancel', (req, res) => {
  const booking = getBookingDetail(req.params.id);
  if (!booking) return res.status(404).json({ error: 'Booking not found.' });
  if (booking.status === 'cancelled') {
    return res.json({ booking: serializeBookingDetail(booking) });
  }
  db.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ?").run(booking.id);

  const owner = db.prepare('SELECT * FROM users WHERE slug = ?').get(booking.owner_slug);
  sendEmail({
    ownerId: owner.id, toEmail: owner.email, relatedBookingId: booking.id, category: 'transactional',
    subject: `Cancelled: ${booking.booker_name} — ${booking.meeting_type_name}`,
    body: `${booking.booker_name} (${booking.booker_email}) cancelled their ${formatForEmail(booking.start_at, owner.timezone)} booking for ${booking.meeting_type_name}.`,
  });

  res.json({ booking: serializeBookingDetail(getBookingDetail(booking.id)) });
});

router.post('/bookings/:id/reschedule', (req, res) => {
  const booking = getBookingDetail(req.params.id);
  if (!booking) return res.status(404).json({ error: 'Booking not found.' });
  if (booking.status === 'cancelled') {
    return res.status(400).json({ error: 'This booking was cancelled — book a new time instead.' });
  }

  const { startAt } = req.body || {};
  const start = new Date(startAt);
  if (!startAt || Number.isNaN(start.getTime())) {
    return res.status(400).json({ error: 'Please choose a time slot.' });
  }
  if (start.getTime() <= Date.now()) {
    return res.status(400).json({ error: 'That time has already passed. Please pick another slot.' });
  }

  const owner = db.prepare('SELECT * FROM users WHERE slug = ?').get(booking.owner_slug);
  const meetingType = getActiveMeetingType(owner.id, booking.meeting_type_slug);
  if (!meetingType) {
    return res.status(409).json({ error: 'This meeting type is no longer available for booking.' });
  }

  const stillOpen = getOpenSlots({ owner, meetingType, excludeBookingId: booking.id })
    .some((s) => s.startUtc.getTime() === start.getTime());
  if (!stillOpen) {
    return res.status(409).json({ error: 'That slot was just taken. Please pick another time.' });
  }

  const end = new Date(start.getTime() + meetingType.duration_minutes * 60000);
  db.prepare('UPDATE bookings SET start_at = ?, end_at = ? WHERE id = ?')
    .run(start.toISOString(), end.toISOString(), booking.id);

  const when = formatForEmail(start.toISOString(), booking.booker_timezone);
  sendEmail({
    ownerId: owner.id, toEmail: booking.booker_email, relatedBookingId: booking.id, category: 'transactional',
    subject: `Rescheduled: ${meetingType.name} with ${owner.name}`,
    body: `Hi ${booking.booker_name},\n\nYour meeting is now ${when} (${booking.booker_timezone}).\n\nManage this booking: /book/manage/${booking.id}`,
  });
  sendEmail({
    ownerId: owner.id, toEmail: owner.email, relatedBookingId: booking.id, category: 'transactional',
    subject: `Rescheduled: ${booking.booker_name} moved ${meetingType.name}`,
    body: `${booking.booker_name} (${booking.booker_email}) moved their booking to ${formatForEmail(start.toISOString(), owner.timezone)} (${owner.timezone}).`,
  });

  res.json({ booking: serializeBookingDetail(getBookingDetail(booking.id)) });
});

module.exports = router;
