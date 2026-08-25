const express = require('express');
const { asyncRouter } = require('../lib/asyncRouter');
const crypto = require('crypto');
const db = require('../lib/db');
const mentions = require('../lib/mentions');
const formats = require('../lib/meetingFormats');
const { requireAuth } = require('../lib/auth');
const { requirePaAccess, requireSchedulingAccess, officeAudience } = require('../lib/paAccess');
const {
  replaceAvailability, getAvailability, setBookingWindow, setRhythm, listMeetingTypes,
  createMeetingType, updateMeetingType, deleteMeetingType, handle,
} = require('../lib/scheduling');
const { sendEmail } = require('../lib/email');
const { formatForEmail, rangeForEmail } = require('../lib/format');
const { daysUntilNextOccurrence } = require('../lib/relationships');
const { getOpenSlots } = require('../lib/availability');
const { parseRequest, filterSlots, draftMessage } = require('../lib/aiAssist');
const history = require('../lib/bookingHistory');
const { cancelBooking } = require('../lib/cancelBooking');
const { rescheduleBooking, setDuration } = require('../lib/rescheduleBooking');
const bookingNotes = require('../lib/bookingNotes');
const events = require('../lib/bookingEvents');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const BRIEF_SECTION_KEYS = ['who', 'why', 'background', 'talkingPoints', 'desiredOutcome', 'logistics', 'sensitiveNotes'];

const router = asyncRouter();
router.use(requireAuth);

router.get('/principals', async (req, res) => {
  // Timezone travels with the principal because their diary is read in it. An
  // assistant in Lagos looking at a principal in London must see the
  // principal's day, not their own clock applied to it.
  const self = await db.prepare('SELECT id, name, slug, timezone FROM users WHERE id = ?').get(req.user.id);
  const memberships = await db.prepare(`
    SELECT u.id, u.name, u.slug, u.timezone, m.role, m.can_manage_scheduling
    FROM memberships m
    JOIN users u ON u.id = m.owner_id
    WHERE m.member_user_id = ? AND m.status = 'active'
  `).all(req.user.id);

  res.json({
    principals: [
      {
        id: self.id, name: self.name, slug: self.slug, timezone: self.timezone,
        role: 'owner', canManageScheduling: true,
      },
      ...memberships.map((m) => ({
        id: m.id, name: m.name, slug: m.slug, timezone: m.timezone, role: m.role,
        canManageScheduling: !!m.can_manage_scheduling,
      })),
    ],
  });
});

// --- The principal's bookable hours and meeting types -----------------
// Same operations as /availability and /meeting-types, scoped to a principal
// and gated on the delegation flag. Both paths call lib/scheduling.js, so the
// validation and error messages are literally the same code.

router.get('/:ownerId/availability', requirePaAccess, requireSchedulingAccess, handle(async (req, res) => {
  res.json(await getAvailability(req.principal.id));
}));

router.put('/:ownerId/availability', requirePaAccess, requireSchedulingAccess, handle(async (req, res) => {
  await setBookingWindow(req.principal.id, req.body?.windowDays);
  await setRhythm(req.principal.id, req.body || {});
  await replaceAvailability(req.principal.id, req.body?.rules);
  res.json(await getAvailability(req.principal.id));
}));

router.get('/:ownerId/meeting-types', requirePaAccess, requireSchedulingAccess, handle(async (req, res) => {
  res.json({ meetingTypes: await listMeetingTypes(req.principal.id) });
}));

router.post('/:ownerId/meeting-types', requirePaAccess, requireSchedulingAccess, handle(async (req, res) => {
  res.status(201).json({ meetingType: await createMeetingType(req.principal.id, req.body) });
}));

router.patch('/:ownerId/meeting-types/:id', requirePaAccess, requireSchedulingAccess, handle(async (req, res) => {
  res.json({ meetingType: await updateMeetingType(req.principal.id, req.params.id, req.body) });
}));

router.delete('/:ownerId/meeting-types/:id', requirePaAccess, requireSchedulingAccess, handle(async (req, res) => {
  await deleteMeetingType(req.principal.id, req.params.id);
  res.status(204).end();
}));

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
    // What the booker asked for, and whether anybody has agreed to it yet.
    format: b.format || null,
    formatLabel: b.format ? formats.label(b.format) : null,
    formatNote: b.format_note || null,
    formatState: b.format_state || 'agreed',
    counterFormat: b.counter_format || null,
    counterFormatLabel: b.counter_format ? formats.label(b.counter_format) : null,
    counterFormatNote: b.counter_format_note || null,
    // The principal's own format, so the screen can say what is unusual
    // about this request rather than making somebody remember.
    usualFormat: b.location_type || null,
    usualFormatLabel: b.location_type ? formats.label(b.location_type) : null,
    formats: formats.offer(b.location_type),
    createdAt: b.created_at,
  };
}

router.get('/:ownerId/approvals', requirePaAccess, async (req, res) => {
  const rows = await db.prepare(`
    SELECT b.*, mt.name as meeting_type_name, mt.access_tier, mt.location_type
    FROM bookings b
    JOIN meeting_types mt ON mt.id = b.meeting_type_id
    WHERE b.owner_id = ? AND b.status = 'pending'
    ORDER BY b.start_at ASC
  `).all(req.principal.id);
  res.json({ bookings: rows.map(serializeBooking) });
});

router.post('/:ownerId/approvals/:bookingId/approve', requirePaAccess, async (req, res) => {
  const booking = await db.prepare(`
    SELECT b.*, mt.name as meeting_type_name FROM bookings b
    JOIN meeting_types mt ON mt.id = b.meeting_type_id
    WHERE b.id = ? AND b.owner_id = ?
  `).get(req.params.bookingId, req.principal.id);
  if (!booking) return res.status(404).json({ error: 'Request not found.' });
  if (booking.status !== 'pending') return res.status(400).json({ error: 'This request was already resolved.' });

  // Approving settles both questions at once. The office is looking at the
  // request and saying yes to it — asking them to agree the format in a
  // second click would be ceremony, not consent.
  //
  // A video room is created here rather than at booking time, because until
  // now nobody knew whether this meeting would be a video call at all.
  const room = booking.format === 'video' && !booking.video_room
    ? `kairos-${crypto.randomBytes(8).toString('hex')}`
    : booking.video_room;
  await db.prepare(
    "UPDATE bookings SET status = 'confirmed', format_state = 'agreed', video_room = ?,"
    + ' counter_format = NULL, counter_format_note = NULL WHERE id = ?',
  ).run(room, booking.id);

  // Two things happened in one click when a format was in question, and the
  // trail says both rather than making somebody infer the second.
  if (booking.format_state && booking.format_state !== 'agreed') {
    await events.record({
      bookingId: booking.id, ownerId: req.principal.id, kind: events.KINDS.format_agreed,
      actorUserId: req.user.id, toValue: booking.format,
    });
  }
  await events.record({
    bookingId: booking.id, ownerId: req.principal.id, kind: events.KINDS.approved,
    actorUserId: req.user.id, fromValue: 'pending', toValue: 'confirmed',
  });

  await sendEmail({
    ownerId: req.principal.id, sentByUserId: req.user.id, toEmail: booking.booker_email, relatedBookingId: booking.id,
    category: 'transactional',
    subject: `Confirmed: ${booking.meeting_type_name} with ${req.principal.name}`,
    body: `Hi ${booking.booker_name},\n\nYou're confirmed for ${rangeForEmail(booking.start_at, booking.end_at, booking.booker_timezone)} (${booking.booker_timezone}).\n\nManage this booking: /book/manage/${booking.id}`,
  });

  res.json({ ok: true });
});

// Suggest a different way of meeting.
//
// Accept-or-decline is a poor pair of choices when the real answer is
// usually 'not video, come in' — so the office can answer with a format of
// its own and the booker replies. The booking stays pending and keeps its
// slot while that happens: releasing the time on a counter-offer would mean
// the booker accepts and finds it gone.
router.post('/:ownerId/approvals/:bookingId/counter', requirePaAccess, async (req, res) => {
  const booking = await db.prepare(`
    SELECT b.*, mt.name as meeting_type_name FROM bookings b
    JOIN meeting_types mt ON mt.id = b.meeting_type_id
    WHERE b.id = ? AND b.owner_id = ?
  `).get(req.params.bookingId, req.principal.id);
  if (!booking) return res.status(404).json({ error: 'Request not found.' });
  // Confirmed as well as pending, and that is the point of the change.
  //
  // The booker's choice no longer holds the booking, so a Tier 1 booking made
  // in person when the type says video is confirmed on arrival. This used to
  // refuse anything not pending, which would have left the office able to
  // suggest another format only for the bookings that were already waiting —
  // that is, never for the ones this change lets through. Cancelled and
  // declined are still refused: there is nothing left to arrange.
  if (booking.status !== 'pending' && booking.status !== 'confirmed') {
    return res.status(400).json({ error: 'That booking is not happening, so there is nothing to suggest.' });
  }

  const { format, formatNote } = req.body || {};
  if (!formats.isFormat(format)) return res.status(400).json({ error: 'Choose a way of meeting.' });
  const problem = formats.problem(format, formatNote);
  if (problem) return res.status(400).json({ error: problem });
  if (format === booking.format) {
    return res.status(400).json({ error: 'That is what they already asked for. Approve it instead.' });
  }

  const note = String(formatNote || '').trim() || null;
  await db.prepare(
    "UPDATE bookings SET format_state = 'countered', counter_format = ?, counter_format_note = ? WHERE id = ?",
  ).run(format, note, booking.id);

  await events.record({
    bookingId: booking.id, ownerId: req.principal.id, kind: events.KINDS.format_countered,
    actorUserId: req.user.id, fromValue: booking.format, toValue: format, note,
  });

  await sendEmail({
    ownerId: req.principal.id, sentByUserId: req.user.id, toEmail: booking.booker_email,
    relatedBookingId: booking.id, category: 'transactional',
    subject: `A suggestion about your ${booking.meeting_type_name} with ${req.principal.name}`,
    body: `Hi ${booking.booker_name},\n\nYou asked to meet by ${formats.label(booking.format)}`
      + `${booking.format_note ? ` (${booking.format_note})` : ''}.`
      + ` ${req.principal.name}'s office suggests ${formats.label(format)} instead`
      + `${note ? ` — ${note}` : ''}.`
      + `\n\nThe time is still held for you. Accept or withdraw here: /book/manage/${booking.id}`,
  });

  res.json({ ok: true });
});

router.post('/:ownerId/approvals/:bookingId/decline', requirePaAccess, async (req, res) => {
  const booking = await db.prepare('SELECT * FROM bookings WHERE id = ? AND owner_id = ?').get(req.params.bookingId, req.principal.id);
  if (!booking) return res.status(404).json({ error: 'Request not found.' });
  if (booking.status !== 'pending') return res.status(400).json({ error: 'This request was already resolved.' });

  await db.prepare("UPDATE bookings SET status = 'declined' WHERE id = ?").run(booking.id);
  await events.record({
    bookingId: booking.id, ownerId: req.principal.id, kind: events.KINDS.declined,
    actorUserId: req.user.id, fromValue: 'pending', toValue: 'declined',
    note: String(req.body?.note || '').trim(),
  });

  await sendEmail({
    ownerId: req.principal.id, sentByUserId: req.user.id, toEmail: booking.booker_email, relatedBookingId: booking.id,
    category: 'transactional',
    subject: `Update on your request with ${req.principal.name}`,
    body: `Hi ${booking.booker_name},\n\n${req.principal.name} wasn't able to accept your request for ${rangeForEmail(booking.start_at, booking.end_at, booking.booker_timezone)} (${booking.booker_timezone}). Feel free to pick another time: /book/${req.principal.slug}`,
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
    // Their username, when they have one — which means when they hold a
    // Kairos account. A username is made by the person it belongs to, so a
    // contact who is not on Kairos has none, and this stays null rather than
    // inventing something from their name. See lib/mentions.js.
    handle: c.account_handle || null,
    meetingCount: c.meeting_count,
    lastMeetingAt: c.last_meeting_at,
  };
}

router.get('/:ownerId/contacts', requirePaAccess, async (req, res) => {
  const rows = await db.prepare(`
    SELECT c.*,
      COUNT(b.id) as meeting_count,
      MAX(b.start_at) as last_meeting_at,
      -- A username belongs to whoever holds the account. If this contact is
      -- somebody on Kairos, theirs is shown; if not, there is none to show and
      -- none is invented. See serializeContact.
      u.slug AS account_handle
    FROM contacts c
    LEFT JOIN bookings b ON b.owner_id = c.owner_id AND b.booker_email = c.email AND b.status = 'confirmed'
    LEFT JOIN users u ON lower(u.email) = lower(c.email)
    WHERE c.owner_id = ?
    GROUP BY c.id, u.slug
    -- Repeat the aggregate rather than referring to its alias: Postgres
    -- allows a bare alias in ORDER BY but not one nested inside an
    -- expression, where SQLite is happy either way.
    ORDER BY COALESCE(MAX(b.start_at), c.created_at) DESC
  `).all(req.principal.id);
  res.json({ contacts: rows.map(serializeContact) });
});

const RELATIONSHIP_TIERS = new Set(['inner_circle', 'close', 'professional']);
const MONTH_DAY_RE = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

// Most contacts appear automatically the first time someone books, but a PA
// also needs to add people the principal knows who haven't booked yet —
// board members, family, an assistant reaching out cold on the principal's
// behalf — so this is a manual, PA-initiated entry point.
router.post('/:ownerId/contacts', requirePaAccess, async (req, res) => {
  const { email, name, notes, relationshipTier, birthday, anniversary } = req.body || {};
  if (!email || !EMAIL_RE.test(String(email).trim())) {
    return res.status(400).json({ error: 'Please provide a valid email address.' });
  }
  const cleanEmail = String(email).trim().toLowerCase();
  const tier = relationshipTier && RELATIONSHIP_TIERS.has(relationshipTier) ? relationshipTier : 'professional';
  if (birthday && !MONTH_DAY_RE.test(birthday)) return res.status(400).json({ error: 'Birthday must be MM-DD.' });
  if (anniversary && !MONTH_DAY_RE.test(anniversary)) return res.status(400).json({ error: 'Anniversary must be MM-DD.' });

  const existing = await db.prepare('SELECT id FROM contacts WHERE owner_id = ? AND email = ?').get(req.principal.id, cleanEmail);
  if (existing) return res.status(409).json({ error: 'A contact with that email already exists.' });

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.prepare(`
    INSERT INTO contacts (id, owner_id, email, name, notes, relationship_tier, birthday, anniversary, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, req.principal.id, cleanEmail, String(name || '').trim(), String(notes || '').trim(), tier, birthday || null, anniversary || null, now, now);

  const row = await db.prepare(`
    SELECT c.*, COUNT(b.id) as meeting_count, MAX(b.start_at) as last_meeting_at,
      u.slug AS account_handle
    FROM contacts c
    LEFT JOIN bookings b ON b.owner_id = c.owner_id AND b.booker_email = c.email AND b.status = 'confirmed'
    LEFT JOIN users u ON lower(u.email) = lower(c.email)
    WHERE c.id = ?
    -- u.slug is selected, so it is grouped. SQLite tolerates a bare column
    -- beside an aggregate; Postgres does not, and the whole request became a
    -- 500 on the backend production actually runs.
    GROUP BY c.id, u.slug
  `).get(id);
  res.status(201).json({ contact: serializeContact(row) });
});

router.patch('/:ownerId/contacts/:id', requirePaAccess, async (req, res) => {
  const row = await db.prepare('SELECT * FROM contacts WHERE id = ? AND owner_id = ?').get(req.params.id, req.principal.id);
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
  await db.prepare(`UPDATE contacts SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  const updated = await db.prepare(`
    SELECT c.*, COUNT(b.id) as meeting_count, MAX(b.start_at) as last_meeting_at,
      u.slug AS account_handle
    FROM contacts c
    LEFT JOIN bookings b ON b.owner_id = c.owner_id AND b.booker_email = c.email AND b.status = 'confirmed'
    LEFT JOIN users u ON lower(u.email) = lower(c.email)
    WHERE c.id = ?
    -- u.slug is selected, so it is grouped. SQLite tolerates a bare column
    -- beside an aggregate; Postgres does not, and the whole request became a
    -- 500 on the backend production actually runs.
    GROUP BY c.id, u.slug
  `).get(row.id);
  res.json({ contact: serializeContact(updated) });
});

router.get('/:ownerId/relationships/upcoming', requirePaAccess, async (req, res) => {
  const rows = await db.prepare(`
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
// The principal's bookings, in whatever scope is asked for. Defaults to the
// upcoming confirmed ones, which is what the Brief Builder has always read
// from here and must keep getting without asking for it.
router.get('/:ownerId/bookings', requirePaAccess, async (req, res) => {
  res.json({
    bookings: await history.list(req.principal.id, {
      scope: req.query.scope, q: req.query.q, from: req.query.from, to: req.query.to,
    }),
  });
});

// What was said about one booking, and by whom. See lib/bookingHistory.js for
// why this returns subject lines and not the letters themselves.
router.get('/:ownerId/bookings/:bookingId/trail', requirePaAccess, async (req, res) => {
  const booking = await history.get(req.principal.id, req.params.bookingId);
  if (!booking) return res.status(404).json({ error: 'Booking not found.' });
  res.json({ trail: await history.trail(req.principal.id, req.params.bookingId) });
});

// Calling off a meeting that was already confirmed. Declining, in the approval
// queue, is the answer to something still being asked; this is the answer to
// something already agreed, and the person who booked has to be told.
router.post('/:ownerId/bookings/:bookingId/cancel', requirePaAccess, async (req, res) => {
  const row = await db.prepare('SELECT * FROM bookings WHERE id = ? AND owner_id = ?')
    .get(req.params.bookingId, req.principal.id);
  if (!row) return res.status(404).json({ error: 'Booking not found.' });
  if (row.status === 'declined') {
    return res.status(400).json({ error: 'That request was declined — there is nothing to cancel.' });
  }
  await cancelBooking({ booking: row, cancelledByUserId: req.user.id, note: req.body?.note });
  res.json({ booking: await history.get(req.principal.id, row.id) });
});

// Moving one, which is the other half of calling it off. An assistant whose
// only options are "leave it" and "cancel it" will cancel and rebook, and the
// booker gets two emails and a lost thread for what was a change of time.
router.post('/:ownerId/bookings/:bookingId/reschedule', requirePaAccess, async (req, res) => {
  const row = await db.prepare('SELECT * FROM bookings WHERE id = ? AND owner_id = ?')
    .get(req.params.bookingId, req.principal.id);
  if (!row) return res.status(404).json({ error: 'Booking not found.' });

  const result = await rescheduleBooking({
    booking: row,
    owner: req.principal,
    startAt: req.body?.startAt,
    movedByUserId: req.user.id,
    note: String(req.body?.note || '').trim().slice(0, 280),
  });
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  res.json({ booking: await history.get(req.principal.id, row.id) });
});

// The same three, delegated. An assistant preparing a principal for a meeting
// is the ordinary case rather than the exception, so this is not a narrower
// version of the owner's — it is the same one, reached differently.
async function loadPrincipalBooking(req, res, next) {
  const row = await db.prepare('SELECT * FROM bookings WHERE id = ? AND owner_id = ?')
    .get(req.params.bookingId, req.principal.id);
  if (!row) return res.status(404).json({ error: 'Booking not found.' });
  req.booking = row;
  next();
}

router.get('/:ownerId/bookings/:bookingId/notes', requirePaAccess, loadPrincipalBooking, async (req, res) => {
  const rows = await bookingNotes.forOffice(req.principal.id, req.booking.id);
  res.json({ notes: rows.map(bookingNotes.serialize) });
});

router.post('/:ownerId/bookings/:bookingId/notes', requirePaAccess, loadPrincipalBooking, async (req, res) => {
  const result = await bookingNotes.add({
    bookingId: req.booking.id,
    ownerId: req.principal.id,
    visibility: req.body?.visibility || 'office',
    authorUserId: req.user.id,
    body: req.body?.body,
  });
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  res.status(201).json({ note: result.note });
});

router.post('/:ownerId/bookings/:bookingId/follow-up', requirePaAccess, loadPrincipalBooking, async (req, res) => {
  const result = await bookingNotes.followUp({
    booking: req.booking,
    owner: req.principal,
    authorUserId: req.user.id,
    body: req.body?.body,
  });
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  res.status(201).json({ note: result.note });
});

router.post('/:ownerId/bookings/:bookingId/duration', requirePaAccess, loadPrincipalBooking, async (req, res) => {
  const result = await setDuration({
    booking: req.booking,
    owner: req.principal,
    minutes: req.body?.minutes,
    movedByUserId: req.user.id,
    note: String(req.body?.note || '').trim().slice(0, 280),
  });
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  res.json({ booking: await history.get(req.principal.id, req.booking.id) });
});

// The one page an assistant needs for an appointment, same as the owner's.
//
// The principal's timezone travels with it. Everything on that page is a time,
// and the assistant reading it is frequently not in the same country as the
// diary they are keeping — a page that quietly rendered in the browser's zone
// would move every appointment on screen by the offset between them.
router.get('/:ownerId/bookings/:bookingId', requirePaAccess, loadPrincipalBooking, async (req, res) => {
  res.json({
    booking: await history.get(req.principal.id, req.booking.id),
    notes: (await bookingNotes.forOffice(req.principal.id, req.booking.id)).map(bookingNotes.serialize),
    trail: await history.trail(req.principal.id, req.booking.id),
    timezone: req.principal.timezone || 'UTC',
    principal: { id: req.principal.id, name: req.principal.name },
  });
});

function emptySections() {
  return Object.fromEntries(BRIEF_SECTION_KEYS.map((k) => [k, '']));
}

router.get('/:ownerId/briefs/:bookingId', requirePaAccess, async (req, res) => {
  const booking = await db.prepare('SELECT * FROM bookings WHERE id = ? AND owner_id = ?').get(req.params.bookingId, req.principal.id);
  if (!booking) return res.status(404).json({ error: 'Booking not found.' });

  const brief = await db.prepare('SELECT * FROM briefs WHERE booking_id = ?').get(booking.id);
  const sections = brief ? { ...emptySections(), ...JSON.parse(brief.sections) } : emptySections();
  res.json({
    sections,
    // One list for the whole brief rather than one per section. Every section
    // is rendered against a lookup keyed by handle, so splitting it seven ways
    // would only mean resolving the same names seven times.
    mentions: await mentions.of(
      Object.values(sections).join('\n'),
      { ...officeContext(req), audience: await officeAudience(req.principal.id) },
    ),
    updatedAt: brief?.updated_at || null,
  });
});

// Pre-fills brief sections from whatever the system already knows about
// this contact and booking — meeting history, relationship tier, PA notes,
// upcoming birthday/anniversary — so the PA edits a first draft instead of
// filling seven blank textareas per meeting. Doesn't touch sections the PA
// has already written (only fills ones that are still empty), and never
// saves on its own — the PA still hits "Save brief" explicitly.
router.post('/:ownerId/briefs/:bookingId/draft', requirePaAccess, async (req, res) => {
  const booking = await db.prepare(`
    SELECT b.*, mt.name as meeting_type_name FROM bookings b
    JOIN meeting_types mt ON mt.id = b.meeting_type_id
    WHERE b.id = ? AND b.owner_id = ?
  `).get(req.params.bookingId, req.principal.id);
  if (!booking) return res.status(404).json({ error: 'Booking not found.' });

  const contact = await db.prepare(`
    SELECT c.*, COUNT(pb.id) as meeting_count, MAX(pb.start_at) as last_meeting_at
    FROM contacts c
    LEFT JOIN bookings pb ON pb.owner_id = c.owner_id AND pb.booker_email = c.email AND pb.status = 'confirmed' AND pb.id != ?
    WHERE c.owner_id = ? AND c.email = ?
    GROUP BY c.id
  `).get(booking.id, req.principal.id, booking.booker_email);

  const TIER_LABELS = { inner_circle: 'Inner Circle', close: 'Close', professional: 'Professional' };
  const who = contact?.name || booking.booker_name;
  const tierLabel = contact ? TIER_LABELS[contact.relationship_tier] : null;
  const priorCount = contact?.meeting_count || 0;

  const whoLines = [`${who} (${booking.booker_email}), meeting for: ${booking.meeting_type_name}.`];
  if (tierLabel) whoLines.push(`Relationship tier: ${tierLabel}.`);

  const backgroundLines = [];
  if (priorCount > 0) {
    backgroundLines.push(`${priorCount} prior confirmed meeting${priorCount === 1 ? '' : 's'}${contact.last_meeting_at ? `, most recently ${formatForEmail(contact.last_meeting_at, req.principal.timezone)}` : ''}.`);
  } else {
    backgroundLines.push('No prior meetings on record — this looks like a first meeting.');
  }
  if (contact?.notes) backgroundLines.push(`PA notes: ${contact.notes}`);
  if (contact?.birthday) backgroundLines.push(`Birthday on file: ${contact.birthday}.`);
  if (contact?.anniversary) backgroundLines.push(`Anniversary on file: ${contact.anniversary}.`);

  const draftSections = {
    who: whoLines.join(' '),
    background: backgroundLines.join(' '),
    logistics: `${formatForEmail(booking.start_at, req.principal.timezone)} (${req.principal.timezone}).`,
  };

  const existing = await db.prepare('SELECT sections FROM briefs WHERE booking_id = ?').get(booking.id);
  const currentSections = existing ? JSON.parse(existing.sections) : {};
  const merged = { ...emptySections(), ...currentSections };
  for (const key of Object.keys(draftSections)) {
    if (!merged[key] || !merged[key].trim()) merged[key] = draftSections[key];
  }

  res.json({ sections: merged });
});

router.put('/:ownerId/briefs/:bookingId', requirePaAccess, async (req, res) => {
  const booking = await db.prepare('SELECT * FROM bookings WHERE id = ? AND owner_id = ?').get(req.params.bookingId, req.principal.id);
  if (!booking) return res.status(404).json({ error: 'Booking not found.' });

  const { sections } = req.body || {};
  if (!sections || typeof sections !== 'object') {
    return res.status(400).json({ error: 'Expected brief sections.' });
  }
  const clean = {};
  for (const key of BRIEF_SECTION_KEYS) clean[key] = String(sections[key] || '').slice(0, 4000);

  const existing = await db.prepare('SELECT id, sections FROM briefs WHERE booking_id = ?').get(booking.id);
  const now = new Date().toISOString();
  if (existing) {
    await db.prepare('UPDATE briefs SET sections = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(clean), now, existing.id);
  } else {
    await db.prepare(`
      INSERT INTO briefs (id, booking_id, owner_id, sections, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(crypto.randomUUID(), booking.id, req.principal.id, JSON.stringify(clean), req.user.id, now, now);
  }

  const audience = await officeAudience(req.principal.id);
  const found = await mentions.of(Object.values(clean).join('\n'), {
    ...officeContext(req), audience,
  });

  // Only whoever is newly named.
  //
  // A brief is saved over and over while it is being written — that is what
  // the Save button is for — and a message that already reached you the first
  // time is noise every time after. So the handles that were there before are
  // subtracted, and somebody is told once, when they are first named.
  const before = new Set(existing
    ? mentions.parse(Object.values(JSON.parse(existing.sections)).join('\n'))
    : []);
  await mentions.notify({
    found: found.filter((m) => !before.has(m.handle)),
    author: req.user,
    ownerId: req.principal.id,
    subject: `${req.user.name} named you in a brief`,
    where: `a brief for ${req.principal.name}`,
  });

  res.json({ sections: clean, mentions: found, updatedAt: now });
});

function serializeInstruction(i, found) {
  return {
    id: i.id,
    text: i.text,
    // What each @ in the text is. Resolved here because only the server can
    // see who is in the office; a screen guessing at it would draw a contact
    // like a colleague who was told.
    mentions: found || [],
    priority: i.priority,
    status: i.status,
    createdBy: i.created_by_name,
    createdAt: i.created_at,
  };
}

/** The office an @ in a brief or an instruction can reach. */
function officeContext(req) {
  return { viewerId: req.user.id, ownerId: req.principal.id };
}

router.get('/:ownerId/instructions', requirePaAccess, async (req, res) => {
  const rows = await db.prepare(`
    SELECT i.*, u.name as created_by_name
    FROM instructions i
    JOIN users u ON u.id = i.created_by
    WHERE i.owner_id = ?
    ORDER BY (i.status = 'open') DESC, (i.priority = 'urgent') DESC, i.created_at DESC
  `).all(req.principal.id);

  // One pass for the whole list. The same names recur down a vault of
  // instructions, and a screen should not cost a query per @.
  const audience = await officeAudience(req.principal.id);
  const found = await mentions.forBodies(
    rows.map((i) => i.text), { ...officeContext(req), audience },
  );
  res.json({ instructions: rows.map((i, n) => serializeInstruction(i, found[n])) });
});

router.post('/:ownerId/instructions', requirePaAccess, async (req, res) => {
  const { text, priority } = req.body || {};
  if (!text || !String(text).trim()) {
    return res.status(400).json({ error: 'Instruction text is required.' });
  }
  const cleanPriority = priority === 'urgent' ? 'urgent' : 'normal';
  const id = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO instructions (id, owner_id, created_by, text, priority, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'open', ?)
  `).run(id, req.principal.id, req.user.id, String(text).trim(), cleanPriority, new Date().toISOString());

  const row = await db.prepare(`
    SELECT i.*, u.name as created_by_name FROM instructions i JOIN users u ON u.id = i.created_by WHERE i.id = ?
  `).get(id);

  const audience = await officeAudience(req.principal.id);
  const found = await mentions.of(row.text, { ...officeContext(req), audience });
  await mentions.notify({
    found,
    author: req.user,
    ownerId: req.principal.id,
    subject: `${req.user.name} named you in an instruction`,
    where: `an instruction for ${req.principal.name}`,
  });
  res.status(201).json({ instruction: serializeInstruction(row, found) });
});

router.patch('/:ownerId/instructions/:id', requirePaAccess, async (req, res) => {
  const row = await db.prepare('SELECT * FROM instructions WHERE id = ? AND owner_id = ?').get(req.params.id, req.principal.id);
  if (!row) return res.status(404).json({ error: 'Instruction not found.' });

  const { status } = req.body || {};
  if (status !== 'open' && status !== 'done') {
    return res.status(400).json({ error: 'Invalid status.' });
  }
  await db.prepare('UPDATE instructions SET status = ? WHERE id = ?').run(status, row.id);

  const updated = await db.prepare(`
    SELECT i.*, u.name as created_by_name FROM instructions i JOIN users u ON u.id = i.created_by WHERE i.id = ?
  `).get(row.id);
  const audience = await officeAudience(req.principal.id);
  const found = await mentions.of(updated.text, { ...officeContext(req), audience });
  res.json({ instruction: serializeInstruction(updated, found) });
});

router.get('/:ownerId/comms', requirePaAccess, async (req, res) => {
  const rows = await db.prepare(`
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

router.post('/:ownerId/comms', requirePaAccess, async (req, res) => {
  const { toEmail, subject, body } = req.body || {};
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!toEmail || !EMAIL_RE.test(String(toEmail).trim())) {
    return res.status(400).json({ error: 'Please provide a valid recipient email.' });
  }
  if (!subject || !String(subject).trim()) return res.status(400).json({ error: 'Subject is required.' });
  if (!body || !String(body).trim()) return res.status(400).json({ error: 'Message body is required.' });

  await sendEmail({
    ownerId: req.principal.id,
    sentByUserId: req.user.id,
    toEmail: String(toEmail).trim().toLowerCase(),
    subject: String(subject).trim(),
    body: String(body).trim(),
    category: 'comms',
  });

  res.status(201).json({ ok: true });
});

router.post('/:ownerId/ai-assist/parse', requirePaAccess, async (req, res) => {
  const { message } = req.body || {};
  if (!message || !String(message).trim()) {
    return res.status(400).json({ error: 'Please describe what you want to schedule.' });
  }

  const contacts = await db.prepare('SELECT id, name, email FROM contacts WHERE owner_id = ?').all(req.principal.id);
  const meetingTypes = await db.prepare('SELECT id, name, slug, duration_minutes, location_type FROM meeting_types WHERE owner_id = ? AND is_active = 1 ORDER BY created_at').all(req.principal.id);

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
  const allSlots = await getOpenSlots({ owner: req.principal, meetingType });
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
router.post('/:ownerId/ai-assist/book', requirePaAccess, async (req, res) => {
  const { meetingTypeId, startAt, contactEmail, contactName } = req.body || {};
  const meetingType = await db.prepare('SELECT * FROM meeting_types WHERE id = ? AND owner_id = ? AND is_active = 1').get(meetingTypeId, req.principal.id);
  if (!meetingType) return res.status(404).json({ error: 'Meeting type not found.' });
  if (!contactEmail || !EMAIL_RE.test(String(contactEmail).trim())) {
    return res.status(400).json({ error: 'A valid contact email is required.' });
  }
  const start = new Date(startAt);
  if (!startAt || Number.isNaN(start.getTime()) || start.getTime() <= Date.now()) {
    return res.status(400).json({ error: 'Please choose a valid future time.' });
  }

  const stillOpen = (await getOpenSlots({ owner: req.principal, meetingType })).some((s) => s.startUtc.getTime() === start.getTime());
  if (!stillOpen) return res.status(409).json({ error: 'That slot was just taken. Please pick another time.' });

  const end = new Date(start.getTime() + meetingType.duration_minutes * 60000);
  const cleanEmail = String(contactEmail).trim().toLowerCase();
  const cleanName = String(contactName || cleanEmail).trim();
  const videoRoom = meetingType.location_type === 'video' ? `kairos-${crypto.randomBytes(8).toString('hex')}` : null;
  const id = crypto.randomUUID();

  await db.prepare(`
    INSERT INTO bookings (id, meeting_type_id, owner_id, booker_name, booker_email, booker_timezone, start_at, end_at, status, video_room, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?)
  `).run(id, meetingType.id, req.principal.id, cleanName, cleanEmail, req.principal.timezone, start.toISOString(), end.toISOString(), videoRoom, new Date().toISOString());

  // Booked from inside the office, so the office member is the actor — the
  // contact did not ask for this, somebody put it in for them.
  await events.record({
    bookingId: id, ownerId: req.principal.id, kind: events.KINDS.booked,
    actorUserId: req.user.id, toValue: meetingType.location_type,
    note: `on behalf of ${cleanName}`,
  });

  const existingContact = await db.prepare('SELECT id FROM contacts WHERE owner_id = ? AND email = ?').get(req.principal.id, cleanEmail);
  if (!existingContact) {
    await db.prepare(`
      INSERT INTO contacts (id, owner_id, email, name, notes, relationship_tier, created_at, updated_at)
      VALUES (?, ?, ?, ?, '', 'professional', ?, ?)
    `).run(crypto.randomUUID(), req.principal.id, cleanEmail, cleanName,
      new Date().toISOString(), new Date().toISOString());
  }

  await sendEmail({
    ownerId: req.principal.id, sentByUserId: req.user.id, toEmail: cleanEmail, relatedBookingId: id, category: 'transactional',
    subject: `Confirmed: ${meetingType.name} with ${req.principal.name}`,
    body: `Hi ${cleanName},\n\nYou're confirmed for ${formatForEmail(start.toISOString(), req.principal.timezone)} (${req.principal.timezone}).\n\nManage this booking: /book/manage/${id}`,
  });

  res.status(201).json({ booking: { id, startAt: start.toISOString(), endAt: end.toISOString(), videoRoom } });
});

// Drafts an email (subject + body) for the PA to review, edit, and send via
// the Comms endpoint above — the AI assistant's second job beyond finding
// times: taking a first pass at the writing itself so the PA edits instead
// of starting from a blank box. Optional contactId/bookingId pull in real
// names and times; without them the draft stays generic.
router.post('/:ownerId/ai-assist/draft-message', requirePaAccess, async (req, res) => {
  const { instruction, contactId, bookingId } = req.body || {};
  if (!instruction || !String(instruction).trim()) {
    return res.status(400).json({ error: 'Describe what the message needs to say.' });
  }

  let contact = null;
  if (contactId) {
    contact = await db.prepare('SELECT * FROM contacts WHERE id = ? AND owner_id = ?').get(contactId, req.principal.id);
  }

  let booking = null;
  if (bookingId) {
    booking = await db.prepare(`
      SELECT b.*, mt.name as meeting_type_name FROM bookings b
      JOIN meeting_types mt ON mt.id = b.meeting_type_id
      WHERE b.id = ? AND b.owner_id = ?
    `).get(bookingId, req.principal.id);
    if (booking && !contact) {
      contact = await db.prepare('SELECT * FROM contacts WHERE owner_id = ? AND email = ?').get(req.principal.id, booking.booker_email);
    }
  }

  const draft = draftMessage(String(instruction), {
    contactName: contact?.name || booking?.booker_name || '',
    principalName: req.principal.name,
    principalSlug: req.principal.slug,
    meetingTypeName: booking?.meeting_type_name || '',
    bookingWhen: booking ? formatForEmail(booking.start_at, req.principal.timezone) : '',
  });

  res.json({
    intent: draft.intent,
    subject: draft.subject,
    body: draft.body,
    toEmail: contact?.email || booking?.booker_email || '',
  });
});

module.exports = router;
