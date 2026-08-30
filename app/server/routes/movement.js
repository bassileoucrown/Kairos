const crypto = require('crypto');
const { asyncRouter } = require('../lib/asyncRouter');
const db = require('../lib/db');
const { requireAuth } = require('../lib/auth');
const { requirePaAccess } = require('../lib/paAccess');
const movement = require('../lib/movement');
const { expiryState } = require('../lib/essentials');

// The office's cars, and the journeys the principal is moved on.
//
// Two different access rules live in this file and they are not the same, so
// they are kept visibly apart. The FLEET is ordinary office information — an
// assistant arranging a car needs to know which cars there are — and uses the
// usual PA gate. A MOVEMENT is a safety record and uses lib/movement.js, which
// admits the principal, whoever arranged it, and a one-day grant.

const router = asyncRouter();
router.use(requireAuth);

const PAPER_KINDS = new Set(['insurance', 'roadworthiness', 'licence', 'permit']);

// --- The fleet --------------------------------------------------------------

function serializeVehicle(v, papers) {
  return {
    id: v.id,
    label: v.label,
    plate: v.plate,
    makeModel: v.make_model,
    colour: v.colour,
    notes: v.notes,
    archivedAt: v.archived_at || null,
    papers: (papers || []).map((p) => ({
      id: p.id,
      kind: p.kind,
      reference: p.reference,
      expiresOn: p.expires_on,
      // The SAME verdict a passport gets. A second idea of "nearly out of
      // date" would drift from the first, and the reader would have to learn
      // two of them.
      state: p.expires_on ? expiryState(p.expires_on) : null,
    })),
  };
}

router.get('/:ownerId/vehicles', requirePaAccess, async (req, res) => {
  const wantArchived = req.query.archived === '1';
  const rows = await db.prepare(`
    SELECT * FROM vehicles WHERE owner_id = ?
     AND archived_at IS ${wantArchived ? 'NOT NULL' : 'NULL'}
     ORDER BY created_at DESC
  `).all(req.principal.id);
  const papers = rows.length
    ? await db.prepare(`
        SELECT * FROM vehicle_papers WHERE vehicle_id IN (${rows.map(() => '?').join(',')})
        ORDER BY expires_on IS NULL, expires_on ASC
      `).all(...rows.map((r) => r.id))
    : [];
  res.json({
    vehicles: rows.map((v) => serializeVehicle(v, papers.filter((p) => p.vehicle_id === v.id))),
  });
});

router.post('/:ownerId/vehicles', requirePaAccess, async (req, res) => {
  const { label, plate, makeModel, colour, notes } = req.body || {};
  if (!String(label || '').trim()) return res.status(400).json({ error: 'Give the car a name.' });
  const row = {
    id: crypto.randomUUID(),
    owner_id: req.principal.id,
    label: String(label).trim(),
    plate: String(plate || '').trim(),
    make_model: String(makeModel || '').trim(),
    colour: String(colour || '').trim(),
    notes: String(notes || '').trim(),
    created_at: new Date().toISOString(),
  };
  await db.prepare(`
    INSERT INTO vehicles (id, owner_id, label, plate, make_model, colour, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(row.id, row.owner_id, row.label, row.plate, row.make_model, row.colour,
    row.notes, row.created_at);
  res.status(201).json({ vehicle: serializeVehicle(row, []) });
});

router.post('/:ownerId/vehicles/:vehicleId/papers', requirePaAccess, async (req, res) => {
  const car = await db.prepare('SELECT * FROM vehicles WHERE id = ? AND owner_id = ?')
    .get(req.params.vehicleId, req.principal.id);
  if (!car) return res.status(404).json({ error: 'Not found.' });

  const { kind, reference, expiresOn } = req.body || {};
  if (!PAPER_KINDS.has(kind)) {
    return res.status(400).json({ error: 'That is not a kind of vehicle paper.' });
  }
  const id = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO vehicle_papers (id, vehicle_id, kind, reference, expires_on, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, car.id, kind, String(reference || '').trim(), expiresOn || null,
    new Date().toISOString());
  res.status(201).json({ ok: true, id });
});

/** Put a car away rather than delete it: it is on movements that already happened. */
router.post('/:ownerId/vehicles/:vehicleId/archive', requirePaAccess, async (req, res) => {
  const car = await db.prepare('SELECT * FROM vehicles WHERE id = ? AND owner_id = ?')
    .get(req.params.vehicleId, req.principal.id);
  if (!car) return res.status(404).json({ error: 'Not found.' });
  const at = car.archived_at ? null : new Date().toISOString();
  await db.prepare('UPDATE vehicles SET archived_at = ? WHERE id = ?').run(at, car.id);
  res.json({ archivedAt: at });
});

// --- Movements --------------------------------------------------------------

/**
 * The journeys this viewer may see.
 *
 * Not "the principal's movements" — THIS VIEWER's. An assistant sees the ones
 * they arranged plus any they hold a grant for; the principal sees all of
 * theirs. Filtered in the query rather than after it, so a long list is not
 * fetched in order to be thrown away.
 */
router.get('/:ownerId/movements', requirePaAccess, async (req, res) => {
  const now = new Date().toISOString();
  const rows = await db.prepare(`
    SELECT m.* FROM movements m
     WHERE m.owner_id = ?
       AND (
         m.owner_id = ? OR m.arranged_by = ?
         OR EXISTS (
           SELECT 1 FROM movement_grants g
            WHERE g.movement_id = m.id AND g.grantee_user_id = ?
              AND g.revoked_at IS NULL AND g.expires_at > ?
         )
       )
     ORDER BY m.departs_at DESC LIMIT 100
  `).all(req.principal.id, req.user.id, req.user.id, req.user.id, now);

  const movements = [];
  for (const m of rows) movements.push(await movement.viewFor(m.id, req.user.id));
  res.json({ movements: movements.filter(Boolean) });
});

router.post('/:ownerId/movements', requirePaAccess, async (req, res) => {
  const { title, departsFrom, destination, departsAt, bufferMinutes, notes, tripId } = req.body || {};
  if (!String(title || '').trim()) return res.status(400).json({ error: 'Give the movement a name.' });
  const when = new Date(departsAt);
  if (!departsAt || Number.isNaN(when.getTime())) {
    return res.status(400).json({ error: 'When does it leave?' });
  }
  const row = {
    id: crypto.randomUUID(),
    owner_id: req.principal.id,
    // Whoever built it, named on the row. Not a membership lookup at read
    // time: revoking somebody's PA access later must not silently change who
    // could read a movement that already happened.
    arranged_by: req.user.id,
    trip_id: tripId || null,
    title: String(title).trim(),
    departs_from: String(departsFrom || '').trim(),
    destination: String(destination || '').trim(),
    departs_at: when.toISOString(),
    buffer_minutes: Number.isInteger(bufferMinutes) ? bufferMinutes : 0,
    notes: String(notes || '').trim(),
    created_at: new Date().toISOString(),
  };
  await db.prepare(`
    INSERT INTO movements (id, owner_id, arranged_by, trip_id, title, departs_from,
                           destination, departs_at, buffer_minutes, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(row.id, row.owner_id, row.arranged_by, row.trip_id, row.title, row.departs_from,
    row.destination, row.departs_at, row.buffer_minutes, row.notes, row.created_at);
  res.status(201).json({ movement: await movement.viewFor(row.id, req.user.id) });
});

/** Loads the movement and refuses anybody without at least a grant. */
async function loadMovement(req, res, next) {
  const row = await db.prepare('SELECT * FROM movements WHERE id = ? AND owner_id = ?')
    .get(req.params.movementId, req.principal.id);
  if (!row) return res.status(404).json({ error: 'Not found.' });
  const access = await movement.accessFor(row, req.user.id);
  // Not yours to see and not there answer identically, as everywhere else.
  if (!access) return res.status(404).json({ error: 'Not found.' });
  req.movement = row;
  req.movementAccess = access;
  next();
}

/** Only the two who hold it in full may change it. */
function requireFull(req, res, nextFn) {
  if (req.movementAccess !== 'full') {
    return res.status(403).json({
      error: 'You were given this to help one journey go ahead, not to change it.',
    });
  }
  return nextFn();
}

router.get('/:ownerId/movements/:movementId', requirePaAccess, loadMovement, async (req, res) => {
  res.json({ movement: await movement.viewFor(req.movement.id, req.user.id) });
});

router.post('/:ownerId/movements/:movementId/vehicles', requirePaAccess, loadMovement,
  async (req, res) => requireFull(req, res, async () => {
    const { vehicleId, role, plate, description } = req.body || {};
    if (role && !movement.VEHICLE_ROLES.has(role)) {
      return res.status(400).json({ error: 'A car is lead, principal, or backup.' });
    }
    // The plate is copied onto the movement rather than joined at read time:
    // the car may be sold, and the record still has to say what was driven.
    let snapPlate = String(plate || '').trim();
    let snapDesc = String(description || '').trim();
    if (vehicleId) {
      const car = await db.prepare('SELECT * FROM vehicles WHERE id = ? AND owner_id = ?')
        .get(vehicleId, req.principal.id);
      if (!car) return res.status(400).json({ error: 'That car is not in the fleet.' });
      snapPlate = snapPlate || car.plate;
      snapDesc = snapDesc || [car.colour, car.make_model].filter(Boolean).join(' ') || car.label;
    }
    await db.prepare(`
      INSERT INTO movement_vehicles (id, movement_id, vehicle_id, role, plate, description, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(crypto.randomUUID(), req.movement.id, vehicleId || null, role || 'principal',
      snapPlate, snapDesc, new Date().toISOString());
    res.status(201).json({ movement: await movement.viewFor(req.movement.id, req.user.id) });
  }));

router.post('/:ownerId/movements/:movementId/people', requirePaAccess, loadMovement,
  async (req, res) => requireFull(req, res, async () => {
    const { role, name, phone } = req.body || {};
    if (!String(name || '').trim()) return res.status(400).json({ error: 'Who is it?' });
    if (role && !movement.PERSON_ROLES.has(role)) {
      return res.status(400).json({ error: 'That is not a role on a movement.' });
    }
    await db.prepare(`
      INSERT INTO movement_people (id, movement_id, role, name, phone, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(crypto.randomUUID(), req.movement.id, role || 'driver',
      String(name).trim(), String(phone || '').trim(), new Date().toISOString());
    res.status(201).json({ movement: await movement.viewFor(req.movement.id, req.user.id) });
  }));

/**
 * They arrived.
 *
 * Open to a stand-in as well as to the two who hold it in full — this is the
 * one thing somebody covering is most likely to be the person who knows, and
 * refusing it would mean the record says nobody ever arrived.
 */
router.post('/:ownerId/movements/:movementId/arrived', requirePaAccess, loadMovement,
  async (req, res) => {
    const at = req.movement.arrived_at ? null : new Date().toISOString();
    await db.prepare('UPDATE movements SET arrived_at = ?, arrived_by = ? WHERE id = ?')
      .run(at, at ? req.user.id : null, req.movement.id);
    res.json({ movement: await movement.viewFor(req.movement.id, req.user.id) });
  });

// --- Covering for somebody ---------------------------------------------------

router.post('/:ownerId/movements/:movementId/grants', requirePaAccess, loadMovement,
  async (req, res) => requireFull(req, res, async () => {
    const { userId, reason } = req.body || {};
    // Somebody already in the office. Handing a principal's movement to a
    // stranger is a different act and not one this route performs.
    const member = await db.prepare(`
      SELECT member_user_id FROM memberships
       WHERE owner_id = ? AND member_user_id = ? AND status = 'active'
    `).get(req.principal.id, userId || '');
    if (!member && userId !== req.principal.id) {
      return res.status(400).json({ error: 'That is not somebody in this office.' });
    }
    const row = await movement.grant({
      movement: req.movement, granteeId: userId, grantedBy: req.user.id, reason,
    });
    res.status(201).json({ grant: { id: row.id, expiresAt: row.expires_at } });
  }));

router.get('/:ownerId/movements/:movementId/grants', requirePaAccess, loadMovement,
  async (req, res) => requireFull(req, res, async () => {
    const rows = await db.prepare(`
      SELECT g.*, u.name, u.email FROM movement_grants g
      JOIN users u ON u.id = g.grantee_user_id
      WHERE g.movement_id = ? ORDER BY g.created_at DESC
    `).all(req.movement.id);
    res.json({
      grants: rows.map((g) => ({
        id: g.id, userId: g.grantee_user_id, name: g.name, email: g.email,
        reason: g.reason, expiresAt: g.expires_at, revokedAt: g.revoked_at || null,
        // Said rather than left to be worked out from a timestamp.
        live: !g.revoked_at && g.expires_at > new Date().toISOString(),
      })),
    });
  }));

router.delete('/:ownerId/movements/:movementId/grants/:grantId', requirePaAccess, loadMovement,
  async (req, res) => requireFull(req, res, async () => {
    await db.prepare('UPDATE movement_grants SET revoked_at = ? WHERE id = ? AND movement_id = ?')
      .run(new Date().toISOString(), req.params.grantId, req.movement.id);
    res.status(204).end();
  }));

module.exports = { router };
