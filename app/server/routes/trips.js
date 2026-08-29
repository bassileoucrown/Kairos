const crypto = require('crypto');
const { asyncRouter } = require('../lib/asyncRouter');
const db = require('../lib/db');
const { requireAuth } = require('../lib/auth');
const { requirePaAccess } = require('../lib/paAccess');
const trips = require('../lib/trips');
const tripPrivacy = require('../lib/tripPrivacy');
const visas = require('../lib/visas');
const pickup = require('../lib/pickup');
const pickupSignal = require('../lib/pickupSignal');
const { limit, clientIp } = require('../lib/rateLimit');
const { requirePlan } = require('../lib/plans');

const router = asyncRouter();

// The driver's card comes first and takes no session.
//
// It is mounted before requireAuth deliberately: the person opening it is a
// driver on their phone, who has no Kairos account and never will. What
// protects it is that the address is 24 random bytes, it stops working a day
// after the pickup, and it carries nothing worth stealing — no surname, no
// number for the principal, no destination, nothing from the vault.
//
// A wrong token and an expired one answer identically, for the same reason
// every other lookup in this app does.
router.get('/pickup/:token', async (req, res) => {
  const item = await pickup.byToken(req.params.token);
  if (!item) return res.status(404).json({ error: 'This pickup is not available.' });

  // The flight this car is meeting, if the assistant linked them. A driver
  // watching the right flight number leaves at the right time by themselves.
  const flight = item.serves_id
    ? await db.prepare("SELECT * FROM itinerary_items WHERE id = ? AND kind = 'flight'").get(item.serves_id)
    : null;

  const owner = await db.prepare('SELECT name FROM users WHERE id = ?').get(item.owner_id);
  // First name only, and only so a greeting is possible. A surname on an
  // unauthenticated page is the name board again, forwardable.
  const firstName = String(owner?.name || '').trim().split(/\s+/)[0] || '';

  res.json({
    pickup: pickup.driverCard(item, {
      flight,
      principalFirstName: firstName,
      assistantPhone: item.contact_phone || '',
    }),
  });
});

// What the driver holds up, and whether he has been spotted yet.
//
// Polled from a phone in an arrivals hall, by both sides, for as long as
// somebody is standing there. The limit is generous because that is normal
// use — several devices behind one airport network is ordinary, and a driver
// whose screen stops updating is a driver holding up the wrong colour.
const signalLimiter = limit({
  limit: 240,
  windowMs: 60 * 1000,
  keys: (req) => [`signal-ip:${clientIp(req)}`, `signal:${req.params.token}`],
  message: 'Too many requests. Wait a moment.',
});

router.get('/pickup/:token/signal', signalLimiter, async (req, res) => {
  const item = await pickup.byToken(req.params.token);
  if (!item) return res.status(404).json({ error: 'This pickup is not available.' });
  // Colour and shape only. The address that produced them stays on the server;
  // a driver's phone never holds the seed, only this minute's answer.
  res.json({ signal: await pickupSignal.currentFor(item) });
});

router.use(requireAuth);

// --- Trips ---------------------------------------------------------------

router.get('/:ownerId', requirePaAccess, async (req, res) => {
  res.json({
    trips: await trips.listFor(req.principal.id, req.user.id),
    arrangements: Object.entries(trips.ARRANGEMENTS).map(([id, a]) => ({
      id, label: a.label, hint: a.hint, needsContact: a.needsContact,
    })),
  });
});

router.post('/:ownerId', requirePaAccess, requirePlan('trips'), async (req, res) => {
  const { name, destination, destinationTimezone, startsOn, endsOn, status, notes } = req.body || {};
  const result = await trips.create({
    ownerId: req.principal.id,
    createdBy: req.user.id,
    name, destination, destinationTimezone, startsOn, endsOn, notes,
    visibility: req.body?.visibility,
    // A principal planning their own travel means it; an assistant starts in
    // draft, exactly as with a single itinerary item.
    status: req.paRole === 'owner' ? (status || 'confirmed') : (status || 'draft'),
  });
  if (result.error) return res.status(400).json({ error: result.error });
  res.status(201).json(result);
});

/** One trip, with everything hanging off it. */
router.get('/:ownerId/:tripId', requirePaAccess, async (req, res) => {
  const trip = await trips.get(req.principal.id, req.params.tripId, req.user.id);
  if (!trip) return res.status(404).json({ error: 'Not found.' });

  const items = await db.prepare(`
    SELECT i.*, u.name AS created_by_name FROM itinerary_items i
    LEFT JOIN users u ON u.id = i.created_by
    WHERE i.trip_id = ? ORDER BY i.start_at ASC
  `).all(trip.id);

  const travellers = await db.prepare('SELECT * FROM trip_travellers WHERE trip_id = ? ORDER BY created_at')
    .all(trip.id);
  const contacts = await db.prepare('SELECT * FROM trip_contacts WHERE trip_id = ? ORDER BY created_at')
    .all(trip.id);

  res.json({
    trip,
    // Checked against the trip's own dates rather than today, because "will
    // this passport still be good when I land" is the question being asked.
    documentWarnings: await trips.documentWarnings(req.principal.id, trip),
    // Whether the visas on file cover THIS journey. Never whether one is
    // required — see lib/visas.js.
    visa: await visas.coverageFor(req.principal.id, trip),
    travellers: travellers.map((t) => ({
      id: t.id, name: t.name, role: t.role, contactId: t.contact_id,
    })),
    contacts: contacts.map((c) => ({
      id: c.id, name: c.name, role: c.role, phone: c.phone, notes: c.notes,
    })),
    items: items.map((i) => ({
      id: i.id, kind: i.kind, title: i.title, startAt: i.start_at, endAt: i.end_at,
      startTimezone: i.start_timezone, endTimezone: i.end_timezone,
      location: i.location, destination: i.destination, reference: i.reference,
      terminal: i.terminal || '', seat: i.seat || '',
      arrangement: i.arrangement || '', provider: i.provider || '',
      contactName: i.contact_name || '', contactPhone: i.contact_phone || '',
      pickupCode: i.pickup_code || '', pickupArmed: !!i.pickup_token,
      status: i.status, notes: i.notes,
    })),
  });
});

/**
 * Whose business this journey is — and only the principal may say.
 *
 * Not the arranger, not a Chief of Staff, however much of the office they can
 * otherwise see. An assistant who could mark a trip private could hide a
 * principal's movements from the principal's own office, and an assistant who
 * could mark one public could put a family holiday in front of everybody. Both
 * are the same mistake: this is the principal's call about their own life.
 */
router.patch('/:ownerId/:tripId/visibility', requirePaAccess, async (req, res) => {
  if (req.paRole !== 'owner') {
    return res.status(403).json({ error: 'Only the principal decides whether a trip is private.' });
  }
  const trip = await trips.get(req.principal.id, req.params.tripId, req.user.id);
  if (!trip) return res.status(404).json({ error: 'Not found.' });

  const { visibility } = req.body || {};
  if (!tripPrivacy.VISIBILITIES.has(visibility)) {
    return res.status(400).json({ error: 'A trip is either the office\'s or private.' });
  }
  await db.prepare('UPDATE trips SET visibility = ? WHERE id = ? AND owner_id = ?')
    .run(visibility, trip.id, req.principal.id);
  res.json({ trip: await trips.get(req.principal.id, trip.id, req.user.id) });
});

/** Who the principal has let in, and letting somebody in. Principal only. */
router.get('/:ownerId/:tripId/shares', requirePaAccess, async (req, res) => {
  const trip = await trips.get(req.principal.id, req.params.tripId, req.user.id);
  if (!trip) return res.status(404).json({ error: 'Not found.' });
  const shares = await db.prepare(`
    SELECT s.id, s.user_id, s.created_at, u.name, u.email
      FROM trip_shares s JOIN users u ON u.id = s.user_id
     WHERE s.trip_id = ? ORDER BY s.created_at
  `).all(trip.id);
  res.json({
    shares: shares.map((s) => ({
      id: s.id, userId: s.user_id, name: s.name, email: s.email, createdAt: s.created_at,
    })),
  });
});

router.post('/:ownerId/:tripId/shares', requirePaAccess, async (req, res) => {
  if (req.paRole !== 'owner') {
    return res.status(403).json({ error: 'Only the principal decides who knows about a private trip.' });
  }
  const trip = await trips.get(req.principal.id, req.params.tripId, req.user.id);
  if (!trip) return res.status(404).json({ error: 'Not found.' });

  const { userId } = req.body || {};
  // Only somebody already in the office. Sharing a private journey with a
  // stranger is not a smaller version of sharing it with an assistant, it is
  // a different act, and this is not the route for it.
  const member = await db.prepare(`
    SELECT member_user_id FROM memberships
     WHERE owner_id = ? AND member_user_id = ? AND status = 'active'
  `).get(req.principal.id, userId || '');
  if (!member) {
    return res.status(400).json({ error: 'That is not somebody in your office.' });
  }
  await db.prepare(
    'INSERT INTO trip_shares (id, trip_id, user_id, created_at) VALUES (?, ?, ?, ?)',
  ).run(crypto.randomUUID(), trip.id, userId, new Date().toISOString())
    .catch(() => {});  // Already told. Telling them twice is not an error.
  res.status(201).json({ ok: true });
});

router.delete('/:ownerId/:tripId/shares/:userId', requirePaAccess, async (req, res) => {
  if (req.paRole !== 'owner') {
    return res.status(403).json({ error: 'Only the principal decides who knows about a private trip.' });
  }
  const trip = await trips.get(req.principal.id, req.params.tripId, req.user.id);
  if (!trip) return res.status(404).json({ error: 'Not found.' });
  await db.prepare('DELETE FROM trip_shares WHERE trip_id = ? AND user_id = ?')
    .run(trip.id, req.params.userId);
  res.status(204).end();
});

router.patch('/:ownerId/:tripId', requirePaAccess, async (req, res) => {
  const trip = await trips.get(req.principal.id, req.params.tripId, req.user.id);
  if (!trip) return res.status(404).json({ error: 'Not found.' });

  const { name, destination, destinationTimezone, startsOn, endsOn, status, notes } = req.body || {};
  const updates = [];
  const values = [];
  if (name !== undefined) { updates.push('name = ?'); values.push(String(name).trim()); }
  if (destination !== undefined) { updates.push('destination = ?'); values.push(String(destination).trim()); }
  if (destinationTimezone !== undefined) {
    if (destinationTimezone && !trips.isTimezone(destinationTimezone)) {
      return res.status(400).json({ error: `${destinationTimezone} is not a timezone this server knows.` });
    }
    updates.push('destination_timezone = ?'); values.push(destinationTimezone || null);
  }
  if (startsOn !== undefined) { updates.push('starts_on = ?'); values.push(startsOn); }
  if (endsOn !== undefined) { updates.push('ends_on = ?'); values.push(endsOn); }
  if (notes !== undefined) { updates.push('notes = ?'); values.push(String(notes).trim()); }
  if (status !== undefined) {
    if (!trips.STATUSES.includes(status)) return res.status(400).json({ error: 'Unknown status.' });
    // Confirming a trip moves the principal's clock, so it is theirs to do —
    // the same reasoning as confirming an individual item.
    if (status === 'confirmed' && req.paRole !== 'owner') {
      return res.status(403).json({
        error: 'Only the principal confirms a trip — it changes which timezone their days are drawn in.',
      });
    }
    updates.push('status = ?'); values.push(status);
  }
  if (!updates.length) return res.status(400).json({ error: 'Nothing to change.' });

  values.push(trip.id);
  await db.prepare(`UPDATE trips SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  res.json({ trip: await trips.get(req.principal.id, trip.id, req.user.id) });
});

// --- Who else is going, and who to call there -----------------------------

/**
 * Removing a trip, which is two different intentions and so two operations.
 *
 * CANCEL says the journey is not happening. It keeps everything: the flight
 * stays in the diary because a cancelled trip is exactly when somebody still
 * has to ring the airline, and quietly clearing it from the day would hide
 * work that is still owed. The trip stops moving the principal's clock,
 * because that is tied to being confirmed.
 *
 * DELETE says the record should not exist — it was a duplicate, or a plan that
 * never became real. That takes the legs with it, because they were built as
 * part of it, and leaving four orphans scattered through the diary to be
 * removed one at a time is not what anybody means by deleting a trip.
 *
 * Which is why both exist. Cancel is the safe one and it is the default the
 * screen offers first.
 */
router.post('/:ownerId/:tripId/cancel', requirePaAccess, async (req, res) => {
  const trip = await trips.get(req.principal.id, req.params.tripId, req.user.id);
  if (!trip) return res.status(404).json({ error: 'Not found.' });
  if (trip.status === 'cancelled') {
    return res.status(409).json({ error: 'That trip is already cancelled.' });
  }
  await db.prepare('UPDATE trips SET status = ? WHERE id = ?').run('cancelled', trip.id);
  res.json({ trip: await trips.get(req.principal.id, trip.id, req.user.id) });
});

router.delete('/:ownerId/:tripId', requirePaAccess, async (req, res) => {
  const trip = await trips.get(req.principal.id, req.params.tripId, req.user.id);
  if (!trip) return res.status(404).json({ error: 'Not found.' });

  // A confirmed trip is drawing the principal's days in another timezone.
  // Undoing that is theirs, for the same reason confirming it was.
  if (trip.status === 'confirmed' && req.paRole !== 'owner') {
    return res.status(403).json({
      error: 'Only the principal deletes a confirmed trip — it is drawing their days in another timezone. Cancel it instead, or ask them.',
    });
  }

  // travellers and contacts go with the trip through ON DELETE CASCADE.
  // Itinerary items carry a plain trip_id with no constraint behind it, so
  // they have to be removed here or they would survive pointing at nothing.
  const removed = await db.prepare('SELECT COUNT(*) AS n FROM itinerary_items WHERE owner_id = ? AND trip_id = ?')
    .get(req.principal.id, trip.id);
  await db.prepare('DELETE FROM itinerary_items WHERE owner_id = ? AND trip_id = ?')
    .run(req.principal.id, trip.id);
  await db.prepare('DELETE FROM trips WHERE id = ?').run(trip.id);

  res.json({ deleted: true, itemsRemoved: Number(removed?.n || 0) });
});

/** What deleting would take with it, so the screen can say so before it asks. */
router.get('/:ownerId/:tripId/deletion', requirePaAccess, async (req, res) => {
  const trip = await trips.get(req.principal.id, req.params.tripId, req.user.id);
  if (!trip) return res.status(404).json({ error: 'Not found.' });
  const [items, travellers, contacts] = await Promise.all([
    db.prepare('SELECT COUNT(*) AS n FROM itinerary_items WHERE owner_id = ? AND trip_id = ?').get(req.principal.id, trip.id),
    db.prepare('SELECT COUNT(*) AS n FROM trip_travellers WHERE trip_id = ?').get(trip.id),
    db.prepare('SELECT COUNT(*) AS n FROM trip_contacts WHERE trip_id = ?').get(trip.id),
  ]);
  res.json({
    items: Number(items?.n || 0),
    travellers: Number(travellers?.n || 0),
    contacts: Number(contacts?.n || 0),
    needsPrincipal: trip.status === 'confirmed' && req.paRole !== 'owner',
  });
});

router.post('/:ownerId/:tripId/travellers', requirePaAccess, async (req, res) => {
  const trip = await trips.get(req.principal.id, req.params.tripId, req.user.id);
  if (!trip) return res.status(404).json({ error: 'Not found.' });
  const { name, role, contactId } = req.body || {};
  if (!String(name || '').trim()) return res.status(400).json({ error: 'Who is coming?' });

  if (contactId) {
    const contact = await db.prepare('SELECT id FROM contacts WHERE id = ? AND owner_id = ?')
      .get(contactId, req.principal.id);
    if (!contact) return res.status(404).json({ error: 'That person is not in your contacts.' });
  }

  const id = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO trip_travellers (id, trip_id, contact_id, name, role, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, trip.id, contactId || null, String(name).trim(), String(role || '').trim(),
    new Date().toISOString());
  res.status(201).json({ id });
});

router.delete('/:ownerId/:tripId/travellers/:id', requirePaAccess, async (req, res) => {
  const trip = await trips.get(req.principal.id, req.params.tripId, req.user.id);
  if (!trip) return res.status(404).json({ error: 'Not found.' });
  await db.prepare('DELETE FROM trip_travellers WHERE id = ? AND trip_id = ?').run(req.params.id, trip.id);
  res.status(204).end();
});

router.post('/:ownerId/:tripId/contacts', requirePaAccess, async (req, res) => {
  const trip = await trips.get(req.principal.id, req.params.tripId, req.user.id);
  if (!trip) return res.status(404).json({ error: 'Not found.' });
  const { name, role, phone, notes } = req.body || {};
  if (!String(name || '').trim()) return res.status(400).json({ error: 'Give the contact a name.' });

  const id = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO trip_contacts (id, trip_id, name, role, phone, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, trip.id, String(name).trim(), String(role || '').trim(),
    String(phone || '').trim(), String(notes || '').trim(), new Date().toISOString());
  res.status(201).json({ id });
});

router.delete('/:ownerId/:tripId/contacts/:id', requirePaAccess, async (req, res) => {
  const trip = await trips.get(req.principal.id, req.params.tripId, req.user.id);
  if (!trip) return res.status(404).json({ error: 'Not found.' });
  await db.prepare('DELETE FROM trip_contacts WHERE id = ? AND trip_id = ?').run(req.params.id, trip.id);
  res.status(204).end();
});

module.exports = router;
