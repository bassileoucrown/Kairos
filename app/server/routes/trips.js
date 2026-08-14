const crypto = require('crypto');
const { asyncRouter } = require('../lib/asyncRouter');
const db = require('../lib/db');
const { requireAuth } = require('../lib/auth');
const { requirePaAccess } = require('../lib/paAccess');
const trips = require('../lib/trips');
const pickup = require('../lib/pickup');

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

router.use(requireAuth);

// --- Trips ---------------------------------------------------------------

router.get('/:ownerId', requirePaAccess, async (req, res) => {
  res.json({
    trips: await trips.listFor(req.principal.id),
    arrangements: Object.entries(trips.ARRANGEMENTS).map(([id, a]) => ({
      id, label: a.label, hint: a.hint, needsContact: a.needsContact,
    })),
  });
});

router.post('/:ownerId', requirePaAccess, async (req, res) => {
  const { name, destination, destinationTimezone, startsOn, endsOn, status, notes } = req.body || {};
  const result = await trips.create({
    ownerId: req.principal.id,
    createdBy: req.user.id,
    name, destination, destinationTimezone, startsOn, endsOn, notes,
    // A principal planning their own travel means it; an assistant starts in
    // draft, exactly as with a single itinerary item.
    status: req.paRole === 'owner' ? (status || 'confirmed') : (status || 'draft'),
  });
  if (result.error) return res.status(400).json({ error: result.error });
  res.status(201).json(result);
});

/** One trip, with everything hanging off it. */
router.get('/:ownerId/:tripId', requirePaAccess, async (req, res) => {
  const trip = await trips.get(req.principal.id, req.params.tripId);
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

router.patch('/:ownerId/:tripId', requirePaAccess, async (req, res) => {
  const trip = await trips.get(req.principal.id, req.params.tripId);
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
  res.json({ trip: await trips.get(req.principal.id, trip.id) });
});

// --- Who else is going, and who to call there -----------------------------

router.post('/:ownerId/:tripId/travellers', requirePaAccess, async (req, res) => {
  const trip = await trips.get(req.principal.id, req.params.tripId);
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
  const trip = await trips.get(req.principal.id, req.params.tripId);
  if (!trip) return res.status(404).json({ error: 'Not found.' });
  await db.prepare('DELETE FROM trip_travellers WHERE id = ? AND trip_id = ?').run(req.params.id, trip.id);
  res.status(204).end();
});

router.post('/:ownerId/:tripId/contacts', requirePaAccess, async (req, res) => {
  const trip = await trips.get(req.principal.id, req.params.tripId);
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
  const trip = await trips.get(req.principal.id, req.params.tripId);
  if (!trip) return res.status(404).json({ error: 'Not found.' });
  await db.prepare('DELETE FROM trip_contacts WHERE id = ? AND trip_id = ?').run(req.params.id, trip.id);
  res.status(204).end();
});

module.exports = router;
