const express = require('express');
const { asyncRouter } = require('../lib/asyncRouter');
const crypto = require('crypto');
const db = require('../lib/db');
const formats = require('../lib/meetingFormats');
const events = require('../lib/bookingEvents');
const { getOpenSlots, windowDaysFor } = require('../lib/availability');
const { isValidTimeZone } = require('../lib/timezone');
const { sendEmail } = require('../lib/email');
const { formatForEmail, rangeForEmail } = require('../lib/format');
const notes = require('../lib/bookingNotes');
const { limit, clientIp } = require('../lib/rateLimit');

const router = asyncRouter();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Anyone holding a manage link can write here, without an account, and every
// note mails the office. That is a small open door and it gets a limit.
const bookerNoteLimiter = limit({
  limit: 20,
  windowMs: 60 * 60 * 1000,
  keys: (req) => [`booking-note:${req.params.id}`, `booking-note-ip:${clientIp(req)}`],
  message: 'Too many notes for one hour. Try again later.',
});

async function getOwnerBySlug(slug) {
  return await db.prepare('SELECT * FROM users WHERE slug = ?').get(slug);
}

async function getActiveMeetingType(ownerId, meetingSlug) {
  return await db.prepare('SELECT * FROM meeting_types WHERE owner_id = ? AND slug = ? AND is_active = 1')
    .get(ownerId, meetingSlug);
}

router.get('/:slug', async (req, res) => {
  const owner = await getOwnerBySlug(req.params.slug);
  if (!owner) return res.status(404).json({ error: 'This booking page does not exist.' });

  const meetingTypes = await db.prepare('SELECT id, name, slug, duration_minutes, description, location_type, access_tier FROM meeting_types WHERE owner_id = ? AND is_active = 1 ORDER BY created_at')
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
      locationLabel: formats.label(mt.location_type),
      formats: formats.offer(mt.location_type),
      // Whether this one is answered by a person, as a plain yes or no. The
      // tier number itself stays private — it is the office's own grading of
      // who someone is, and a booker has no business reading it. Whether they
      // are about to make a request rather than a booking is different: they
      // find that out one click later regardless, and knowing before they
      // fill the form in is simply better manners.
      needsApproval: (mt.access_tier || 1) >= 3,
    })),
  });
});

router.get('/:slug/:meetingSlug/slots', async (req, res) => {
  const owner = await getOwnerBySlug(req.params.slug);
  if (!owner) return res.status(404).json({ error: 'This booking page does not exist.' });
  const meetingType = await getActiveMeetingType(owner.id, req.params.meetingSlug);
  if (!meetingType) return res.status(404).json({ error: 'This meeting type is not available.' });

  // excludeBookingId: when rescheduling, omit the booking's own current slot
  // from the conflict check so it doesn't block moving to a new time.
  const slots = await getOpenSlots({ owner, meetingType, excludeBookingId: req.query.excludeBookingId || null });
  res.json({
    ownerTimezone: owner.timezone,
    // How far ahead this diary is open, so an empty grid can say "in the next
    // week" rather than a hard-coded "two weeks" that stopped being true the
    // moment the principal chose something else.
    windowDays: windowDaysFor(owner),
    slots: slots.map((s) => ({ startAt: s.startUtc.toISOString(), endAt: s.endUtc.toISOString() })),
  });
});

router.post('/:slug/:meetingSlug/book', async (req, res) => {
  const owner = await getOwnerBySlug(req.params.slug);
  if (!owner) return res.status(404).json({ error: 'This booking page does not exist.' });
  const meetingType = await getActiveMeetingType(owner.id, req.params.meetingSlug);
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
  const stillOpen = (await getOpenSlots({ owner, meetingType }))
    .some((s) => s.startUtc.getTime() === start.getTime());
  if (!stillOpen) {
    return res.status(409).json({ error: 'That slot was just taken. Please pick another time.' });
  }

  const id = crypto.randomUUID();
  const cleanEmail = String(email).trim().toLowerCase();
  const cleanName = String(name).trim();

  // How the booker would like to meet. Left out entirely, the principal's own
  // format stands and nothing about this booking is new.
  const chosen = formats.isFormat(req.body?.format) ? req.body.format : meetingType.location_type;
  const noteProblem = formats.problem(chosen, req.body?.formatNote);
  if (noteProblem) return res.status(400).json({ error: noteProblem });
  const formatNote = String(req.body?.formatNote || '').trim() || null;

  // One reason a booking might not go straight on the diary: the meeting
  // type's access tier. The format is not a second one.
  //
  // It used to be. Asking to meet in person when the type said video held the
  // booking until somebody agreed, which made a Tier 1 booking pending because
  // the booker preferred the telephone — offering four ways to meet and then
  // treating three of them as an imposition. The choice is allowed; the office
  // can still suggest otherwise afterwards, which is the counter flow below.
  const status = meetingType.access_tier >= 3 ? 'pending' : 'confirmed';
  const formatState = formats.STATES.agreed;

  // The room follows the format that will actually be used, not the one the
  // meeting type happens to name. Creating one for a booking that turns out to
  // be in person would put a dead video link in a confirmation email.
  const videoRoom = chosen === 'video'
    ? `kairos-${crypto.randomBytes(8).toString('hex')}`
    : null;

  await db.prepare(`
    INSERT INTO bookings (id, meeting_type_id, owner_id, booker_name, booker_email, booker_timezone, start_at, end_at, status, video_room, format, format_note, format_state, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, meetingType.id, owner.id, cleanName, cleanEmail, bookerTimezone,
    start.toISOString(), end.toISOString(), status, videoRoom,
    chosen, formatNote, formatState, new Date().toISOString());

  // The booker has no account, so they are recorded by the name they gave.
  await events.record({
    bookingId: id, ownerId: owner.id, kind: events.KINDS.booked,
    actorLabel: cleanName, toValue: chosen,
  });
  // A departure from the principal's usual format is worth a line of its own
  // in the trail — the office is regularly asked whether somebody was given an
  // exception, and "booked" alone does not answer it. Recorded as agreed
  // rather than proposed, because that is what it is: the choice stands, and
  // nobody is being asked for anything.
  if (formats.isDeparture(chosen, meetingType.location_type)) {
    await events.record({
      bookingId: id, ownerId: owner.id, kind: events.KINDS.format_agreed,
      actorLabel: cleanName, fromValue: meetingType.location_type, toValue: chosen,
      note: formatNote || '',
    });
  }

  // Upsert a lightweight contact record so Contact Intelligence has
  // something to show even before a PA has added notes.
  const existingContact = await db.prepare('SELECT id FROM contacts WHERE owner_id = ? AND email = ?').get(owner.id, cleanEmail);
  if (!existingContact) {
    await db.prepare(`
      INSERT INTO contacts (id, owner_id, email, name, notes, relationship_tier, created_at, updated_at)
      VALUES (?, ?, ?, ?, '', 'professional', ?, ?)
    `).run(crypto.randomUUID(), owner.id, cleanEmail, cleanName,
      new Date().toISOString(), new Date().toISOString());
  }

  const when = rangeForEmail(start.toISOString(), end.toISOString(), bookerTimezone);
  const departed = formats.isDeparture(chosen, meetingType.location_type);
  // Said the same way in both branches: what they are doing, not what they
  // have requested. Nobody is being asked to agree to it.
  const howTheyAreMeeting = departed
    ? ` They are meeting by ${formats.label(chosen)}${formatNote ? ` — ${formatNote}` : ''}, rather than the usual ${formats.label(meetingType.location_type)}.`
    : '';

  if (status === 'pending') {
    await sendEmail({
      ownerId: owner.id, toEmail: cleanEmail, relatedBookingId: id, category: 'transactional',
      subject: `Request received: ${meetingType.name} with ${owner.name}`,
      body: `Hi ${cleanName},\n\nYour request for ${when} (${bookerTimezone}) is awaiting ${owner.name}'s confirmation. We'll email you as soon as it's approved.\n\nManage this request: /book/manage/${id}`,
    });
    await sendEmail({
      ownerId: owner.id, toEmail: owner.email, relatedBookingId: id, category: 'transactional',
      subject: `Approval needed: ${cleanName} wants to book ${meetingType.name}`,
      body: `${cleanName} (${cleanEmail}) requested ${when} (${bookerTimezone}) for ${meetingType.name}.`
        + howTheyAreMeeting
        + ' Review it in your Approval Queue.',
    });
  } else {
    await sendEmail({
      ownerId: owner.id, toEmail: cleanEmail, relatedBookingId: id, category: 'transactional',
      subject: `Confirmed: ${meetingType.name} with ${owner.name}`,
      body: `Hi ${cleanName},\n\nYou're confirmed for ${when} (${bookerTimezone}).\n\nManage this booking: /book/manage/${id}`,
    });
    // The office hears about this one too, and only this one.
    //
    // A booking that takes the usual format needs no announcement — it is on
    // the diary and that is the whole point of an open tier. But a booking
    // that departs from it used to be held until somebody agreed, and the
    // office found out because it was sitting in their queue. Now it goes
    // straight through, so without this the first they would know of somebody
    // arriving in person is the person arriving.
    if (departed) {
      await sendEmail({
        ownerId: owner.id, toEmail: owner.email, relatedBookingId: id, category: 'transactional',
        subject: `Booked in person: ${cleanName} — ${meetingType.name}`.replace('in person', formats.label(chosen).toLowerCase()),
        body: `${cleanName} (${cleanEmail}) booked ${when} (${bookerTimezone}) for ${meetingType.name}.`
          + howTheyAreMeeting
          + ' Their choice stands; suggest another format from Bookings if it does not suit.',
      });
    }
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
      // The confirmation screen says back what was asked for, and whether
      // anybody still has to agree to it — otherwise "Request sent" leaves the
      // booker guessing which part of their request was the unusual one.
      format: chosen,
      formatLabel: formats.label(chosen),
      formatNote,
      formatState,
      usualFormatLabel: formats.label(meetingType.location_type),
    },
  });
});

async function getBookingDetail(id) {
  return await db.prepare(`
    SELECT
      b.id, b.owner_id, b.status, b.start_at, b.end_at, b.booker_name, b.booker_email, b.booker_timezone, b.video_room,
      b.format, b.format_note, b.format_state, b.counter_format, b.counter_format_note,
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
    format: b.format || b.location_type,
    formatLabel: formats.label(b.format || b.location_type),
    formatNote: b.format_note || null,
    formatState: b.format_state || 'agreed',
    counterFormat: b.counter_format || null,
    counterFormatLabel: b.counter_format ? formats.label(b.counter_format) : null,
    counterFormatNote: b.counter_format_note || null,
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
router.get('/bookings/:id', async (req, res) => {
  const booking = await getBookingDetail(req.params.id);
  if (!booking) return res.status(404).json({ error: 'Booking not found.' });
  res.json({
    booking: serializeBookingDetail(booking),
    // Shared notes only, and enforced in lib/bookingNotes rather than here:
    // this endpoint needs no password, so an office note reaching it would be
    // readable by anyone the link was ever forwarded to.
    notes: (await notes.forBooker(booking.id)).map(notes.serialize),
  });
});

/**
 * The booker's half of the line.
 *
 * OPEN FOR AS LONG AS THE APPOINTMENT IS. A meeting that has been cancelled is
 * over as a conversation too — anything after that is a new arrangement, not a
 * message about this one — so the line closes with it rather than staying open
 * on a dead booking for anybody still holding the link.
 *
 * The office is emailed, because a message nobody sees is worse than no
 * message: the booker has said something and is now waiting.
 */
router.post('/bookings/:id/notes', bookerNoteLimiter, async (req, res) => {
  const booking = await getBookingDetail(req.params.id);
  if (!booking) return res.status(404).json({ error: 'Booking not found.' });
  if (booking.status === 'cancelled' || booking.status === 'declined') {
    return res.status(400).json({ error: 'This appointment is closed. Book a new time to get in touch.' });
  }

  const owner = await db.prepare('SELECT * FROM users WHERE slug = ?').get(booking.owner_slug);
  const result = await notes.add({
    bookingId: booking.id,
    ownerId: owner.id,
    visibility: 'shared',
    // No account, so no author id — the booking says who they are.
    authorUserId: null,
    body: req.body?.body,
  });
  if (!result.ok) return res.status(result.status).json({ error: result.error });

  await sendEmail({
    ownerId: owner.id,
    toEmail: owner.email,
    relatedBookingId: booking.id,
    category: 'transactional',
    subject: `${booking.booker_name} left a note about ${booking.meeting_type_name}`,
    body: `${booking.booker_name} (${booking.booker_email}) wrote:`
      + `\n\n${result.note.body}`,
  });
  res.status(201).json({ note: result.note });
});

// The booker's half of the negotiation.
//
// Withdrawing is just cancelling, which already exists — so the only new verb
// is accepting what the office suggested. Refusing to accept anything other
// than a live counter-offer keeps this from becoming a way to change the
// format of a booking that was already settled.
router.post('/bookings/:id/accept-format', async (req, res) => {
  const booking = await getBookingDetail(req.params.id);
  if (!booking) return res.status(404).json({ error: 'Booking not found.' });
  if (booking.format_state !== formats.STATES.countered || !booking.counter_format) {
    return res.status(400).json({ error: 'There is nothing to accept on this booking.' });
  }

  // Accepting the office's suggestion settles the thing the booking was
  // waiting on, so it goes on the diary — unless the meeting type's own tier
  // still wants a human, in which case it stays pending for that reason and
  // the queue shows it with the format already agreed.
  const mt = await db.prepare('SELECT access_tier FROM meeting_types WHERE id = (SELECT meeting_type_id FROM bookings WHERE id = ?)')
    .get(booking.id);
  const stillNeedsApproval = (mt?.access_tier || 1) >= 3;
  const room = booking.counter_format === 'video' && !booking.video_room
    ? `kairos-${crypto.randomBytes(8).toString('hex')}`
    : booking.video_room;

  await db.prepare(
    'UPDATE bookings SET format = ?, format_note = ?, format_state = ?, status = ?,'
    + ' video_room = ?, counter_format = NULL, counter_format_note = NULL WHERE id = ?',
  ).run(
    booking.counter_format,
    booking.counter_format_note,
    formats.STATES.agreed,
    stillNeedsApproval ? 'pending' : 'confirmed',
    room,
    booking.id,
  );

  await events.record({
    bookingId: booking.id, ownerId: booking.owner_id, kind: events.KINDS.format_agreed,
    actorLabel: booking.booker_name,
    fromValue: booking.format, toValue: booking.counter_format,
    note: booking.counter_format_note || '',
  });

  const fresh = await getBookingDetail(booking.id);
  await sendEmail({
    ownerId: booking.owner_id,
    toEmail: booking.booker_email, relatedBookingId: booking.id, category: 'transactional',
    subject: `Agreed: ${booking.meeting_type_name} with ${booking.owner_name}`,
    body: `Hi ${booking.booker_name},\n\nYou have accepted ${formats.label(booking.counter_format)}`
      + `${booking.counter_format_note ? ` — ${booking.counter_format_note}` : ''}.`
      + (stillNeedsApproval
        ? ' The office still has to confirm the time itself.'
        : ` You're confirmed for ${rangeForEmail(booking.start_at, booking.end_at, booking.booker_timezone)} (${booking.booker_timezone}).`)
      + `\n\nManage this booking: /book/manage/${booking.id}`,
  });

  res.json({ booking: serializeBookingDetail(fresh) });
});

router.post('/bookings/:id/cancel', async (req, res) => {
  const booking = await getBookingDetail(req.params.id);
  if (!booking) return res.status(404).json({ error: 'Booking not found.' });
  if (booking.status === 'cancelled') {
    return res.json({ booking: serializeBookingDetail(booking) });
  }
  await db.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ?").run(booking.id);
  await events.record({
    bookingId: booking.id, ownerId: booking.owner_id, kind: events.KINDS.cancelled,
    actorLabel: booking.booker_name, fromValue: booking.status, toValue: 'cancelled',
  });

  const owner = await db.prepare('SELECT * FROM users WHERE slug = ?').get(booking.owner_slug);
  await sendEmail({
    ownerId: owner.id, toEmail: owner.email, relatedBookingId: booking.id, category: 'transactional',
    subject: `Cancelled: ${booking.booker_name} — ${booking.meeting_type_name}`,
    body: `${booking.booker_name} (${booking.booker_email}) cancelled their ${rangeForEmail(booking.start_at, booking.end_at, owner.timezone)} booking for ${booking.meeting_type_name}.`,
  });

  res.json({ booking: serializeBookingDetail(await getBookingDetail(booking.id)) });
});

router.post('/bookings/:id/reschedule', async (req, res) => {
  const booking = await getBookingDetail(req.params.id);
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

  const owner = await db.prepare('SELECT * FROM users WHERE slug = ?').get(booking.owner_slug);
  const meetingType = await getActiveMeetingType(owner.id, booking.meeting_type_slug);
  if (!meetingType) {
    return res.status(409).json({ error: 'This meeting type is no longer available for booking.' });
  }

  const stillOpen = (await getOpenSlots({ owner, meetingType, excludeBookingId: booking.id }))
    .some((s) => s.startUtc.getTime() === start.getTime());
  if (!stillOpen) {
    return res.status(409).json({ error: 'That slot was just taken. Please pick another time.' });
  }

  const end = new Date(start.getTime() + meetingType.duration_minutes * 60000);
  // Recorded before the update, because after it the old time no longer
  // exists anywhere — which is the loss booking_events was added to stop.
  await events.record({
    bookingId: booking.id, ownerId: owner.id, kind: events.KINDS.rescheduled,
    actorLabel: booking.booker_name,
    fromValue: booking.start_at, toValue: start.toISOString(),
  });
  await db.prepare('UPDATE bookings SET start_at = ?, end_at = ? WHERE id = ?')
    .run(start.toISOString(), end.toISOString(), booking.id);

  const when = rangeForEmail(start.toISOString(), end.toISOString(), booking.booker_timezone);
  await sendEmail({
    ownerId: owner.id, toEmail: booking.booker_email, relatedBookingId: booking.id, category: 'transactional',
    subject: `Rescheduled: ${meetingType.name} with ${owner.name}`,
    body: `Hi ${booking.booker_name},\n\nYour meeting is now ${when} (${booking.booker_timezone}).\n\nManage this booking: /book/manage/${booking.id}`,
  });
  await sendEmail({
    ownerId: owner.id, toEmail: owner.email, relatedBookingId: booking.id, category: 'transactional',
    subject: `Rescheduled: ${booking.booker_name} moved ${meetingType.name}`,
    body: `${booking.booker_name} (${booking.booker_email}) moved their booking to ${rangeForEmail(start.toISOString(), end.toISOString(), owner.timezone)} (${owner.timezone}).`,
  });

  res.json({ booking: serializeBookingDetail(await getBookingDetail(booking.id)) });
});

module.exports = router;
