const crypto = require('crypto');
const db = require('./db');

// Moving a principal on the ground, and who is allowed to know how.
//
// WHAT A MOVEMENT IS. Not a line on an itinerary. It is the thing an office
// actually arranges: leaving from here at this time, in that car, with this
// driver, followed by an escort, arriving there — and afterwards, the fact
// that they arrived. A trip is not only a flight, and in Lagos or Abuja the
// road is the part with risk in it.
//
// WHY THE ACCESS RULE IS THE VAULT'S AND NOT THE DIARY'S. An escort roster is
// a pattern of a principal's movements with names and numbers attached.
// Leaked, it is a brief for somebody planning against them. So: the principal,
// and whoever arranged it. Not the wider office. Not a Chief of Staff who can
// otherwise see everything — that rule is about work, and this is not work, it
// is somebody's safety.
//
// AND ONE DOOR OUT OF THAT, because a rule with no exception gets broken in
// the worst way. If the arranger is off sick on the morning of the movement,
// nobody can ring the driver. So access can be opened ONCE, for ONE journey,
// expiring on its own — and the stand-in gets what they need to coordinate,
// not the roster. See coordinationView.

const VEHICLE_ROLES = new Set(['lead', 'principal', 'backup']);
const PERSON_ROLES = new Set(['driver', 'aide', 'escort_lead', 'police_escort', 'other']);

// Who a stand-in is allowed to be told about. A driver to ring and an aide who
// is with the principal are coordination. An escort lead and a police escort
// are the roster, and the roster is the thing worth protecting.
const COORDINATION_ROLES = new Set(['driver', 'aide']);

// A grant lasts a day. Long enough to cover a movement and the morning around
// it; short enough that nobody accumulates standing access to somebody's
// movements by having once covered for a colleague.
const GRANT_HOURS = 24;

/**
 * What this viewer may see: 'full', 'coordination', or null.
 *
 * Deliberately three answers rather than a boolean. "May they see it" is the
 * wrong question — a stand-in may see SOME of it, and collapsing that into yes
 * would hand over the roster, while collapsing it into no would leave a
 * movement nobody can run.
 */
async function accessFor(movement, viewerId, now = Date.now()) {
  if (!movement || !viewerId) return null;
  if (movement.owner_id === viewerId) return 'full';
  if (movement.arranged_by === viewerId) return 'full';

  const grant = await db.prepare(`
    SELECT * FROM movement_grants
     WHERE movement_id = ? AND grantee_user_id = ?
       AND revoked_at IS NULL AND expires_at > ?
     ORDER BY created_at DESC LIMIT 1
  `).get(movement.id, viewerId, new Date(now).toISOString());
  return grant ? 'coordination' : null;
}

/** Everything, for the two people entitled to it. */
function fullView(movement, { vehicles, people }) {
  return {
    id: movement.id,
    access: 'full',
    title: movement.title,
    departsFrom: movement.departs_from,
    destination: movement.destination,
    departsAt: movement.departs_at,
    bufferMinutes: movement.buffer_minutes,
    arrivedAt: movement.arrived_at || null,
    notes: movement.notes,
    tripId: movement.trip_id || null,
    vehicles: vehicles.map((v) => ({
      id: v.id, vehicleId: v.vehicle_id, role: v.role,
      plate: v.plate, description: v.description,
    })),
    people: people.map((p) => ({
      id: p.id, role: p.role, name: p.name, phone: p.phone,
    })),
  };
}

/**
 * Enough to get the journey to happen, and nothing that is a safety record.
 *
 * WHAT IS WITHHELD, and why each: the escort and police escort (that is the
 * roster), the lead and backup vehicles (the shape of the convoy is the same
 * information said differently), and the notes (free text is where everything
 * that did not fit a field ends up).
 *
 * WHAT IS GIVEN: when, from where, to where, the car the principal is in, and
 * the driver to ring. A stand-in with that can do the job; a stand-in without
 * it is being asked to coordinate blind, which is how the rule gets broken by
 * somebody photographing a screen instead.
 *
 * IT SAYS THAT IT IS PARTIAL. Silently redacted data is worse than none: the
 * reader assumes they are seeing everything and reports "there is no escort"
 * to somebody who needed to know there was.
 */
function coordinationView(movement, { vehicles, people }) {
  // Derive the kept sets ONCE and count what is missing by subtraction. Counting
  // separately from filtering means the two can disagree, and the way they
  // disagree is a screen that says "2 withheld" while withholding nothing —
  // which is worse than no count at all, because it is reassuring.
  const keptVehicles = vehicles.filter((v) => v.role === 'principal');
  const keptPeople = people.filter((p) => COORDINATION_ROLES.has(p.role));
  const withheld = (people.length - keptPeople.length)
    + (vehicles.length - keptVehicles.length);
  return {
    id: movement.id,
    access: 'coordination',
    title: movement.title,
    departsFrom: movement.departs_from,
    destination: movement.destination,
    departsAt: movement.departs_at,
    bufferMinutes: movement.buffer_minutes,
    arrivedAt: movement.arrived_at || null,
    vehicles: keptVehicles.map((v) => ({
      id: v.id, vehicleId: v.vehicle_id, role: v.role,
      plate: v.plate, description: v.description,
    })),
    people: keptPeople.map((p) => ({
      id: p.id, role: p.role, name: p.name, phone: p.phone,
    })),
    // Named as partial, with a count, so nobody mistakes this for the whole.
    partial: true,
    withheld,
    note: 'You were given this to help one journey go ahead. '
      + 'Security detail and the principal\'s notes are not included.',
  };
}

/** Load a movement and shape it for whoever is asking. */
async function viewFor(movementId, viewerId, now = Date.now()) {
  const movement = await db.prepare('SELECT * FROM movements WHERE id = ?').get(movementId);
  if (!movement) return null;
  const access = await accessFor(movement, viewerId, now);
  if (!access) return null;

  const vehicles = await db.prepare(
    'SELECT * FROM movement_vehicles WHERE movement_id = ? ORDER BY created_at',
  ).all(movement.id);
  const people = await db.prepare(
    'SELECT * FROM movement_people WHERE movement_id = ? ORDER BY created_at',
  ).all(movement.id);

  return access === 'full'
    ? fullView(movement, { vehicles, people })
    : coordinationView(movement, { vehicles, people });
}

/**
 * Open one journey to one person, for a day.
 *
 * WRITTEN TO THE ACCESS LOG, beside the vault reveals. Somebody being given
 * sight of a principal's movements is exactly the kind of thing the principal
 * is entitled to find out about afterwards, and a grant made by an assistant
 * while the principal was on a plane is the case that matters.
 */
async function grant({ movement, granteeId, grantedBy, reason = '', now = Date.now() }) {
  const row = {
    id: crypto.randomUUID(),
    movement_id: movement.id,
    grantee_user_id: granteeId,
    granted_by: grantedBy,
    reason: String(reason || '').trim().slice(0, 280),
    expires_at: new Date(now + GRANT_HOURS * 3600000).toISOString(),
    created_at: new Date(now).toISOString(),
  };
  await db.prepare(`
    INSERT INTO movement_grants
      (id, movement_id, grantee_user_id, granted_by, reason, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(row.id, row.movement_id, row.grantee_user_id, row.granted_by,
    row.reason, row.expires_at, row.created_at);

  const who = await db.prepare('SELECT name FROM users WHERE id = ?').get(granteeId);
  await db.prepare(`
    INSERT INTO access_log (id, actor_id, subject_owner_id, essential_id, action, field, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(), grantedBy, movement.owner_id, movement.id, 'grant',
    `${who?.name || 'somebody'} — ${movement.title}`, row.created_at,
  );
  return row;
}

module.exports = {
  VEHICLE_ROLES, PERSON_ROLES, COORDINATION_ROLES, GRANT_HOURS,
  accessFor, viewFor, fullView, coordinationView, grant,
};
