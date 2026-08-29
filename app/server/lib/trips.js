const crypto = require('crypto');
const db = require('./db');
const tripPrivacy = require('./tripPrivacy');

// A journey as an object, and the two things that follow from having one.
//
// FIRST: the principal's day is drawn where they are.
//
// /api/today computed the whole day in the timezone on the principal's
// profile — their home zone, always. A week in London was therefore rendered
// in Lagos time: "today" began and ended at the wrong moment, a 09:00 meeting
// showed as 08:00, and the delay cascade reasoned about gaps against the wrong
// wall clock. The itinerary row could always express a leg that crosses zones
// (start_timezone, end_timezone have been there from the beginning); nothing
// read them, because nothing knew where the principal was on a given date.
// A trip knows.
//
// SECOND: a leg can say who is meeting the principal.
//
// An itinerary item could name exactly one person — household_member_id, the
// driver or the cook. That is a household relation and by definition exists
// only at home. Land in London and the arrival transfer has a person-shaped
// hole, which the trip builder used to paper over with a title and nobody
// attached. Away from home the car is a hired service with a dispatcher, a
// hotel transfer that needs your flight number, a host sending someone, or a
// deliberate decision to make your own way — and each has a different thing
// that goes wrong and a different number to call at 2am.

const ARRANGEMENTS = {
  own_driver: {
    label: 'Own driver',
    hint: 'Your household driver. Only at home.',
    needsContact: false,
  },
  hired: {
    label: 'Hired car',
    hint: 'A car service. Needs a booking reference and a dispatcher to call.',
    needsContact: true,
  },
  hotel: {
    label: 'Hotel transfer',
    hint: 'Arranged by the hotel. They need the flight number, or nobody comes.',
    needsContact: true,
  },
  host: {
    label: 'Host is sending someone',
    hint: 'The office or host at the other end.',
    needsContact: true,
  },
  own_way: {
    label: 'Making their own way',
    hint: 'A decision, recorded — so nobody is improvising in an arrivals hall.',
    needsContact: false,
  },
};

const STATUSES = ['draft', 'proposed', 'confirmed', 'cancelled'];

function isArrangement(value) {
  return Object.prototype.hasOwnProperty.call(ARRANGEMENTS, value);
}

/** A leg away from home that claims a household driver is almost always wrong. */
function arrangementProblem({ arrangement, contactName, contactPhone }) {
  if (!arrangement) return null;
  if (!isArrangement(arrangement)) return 'That is not a way of arranging a car.';
  const spec = ARRANGEMENTS[arrangement];
  if (spec.needsContact && !String(contactName || '').trim() && !String(contactPhone || '').trim()) {
    return `${spec.label} needs a name or a number — somebody has to be callable when the flight lands late.`;
  }
  return null;
}

function serializeTrip(row, extras = {}) {
  return {
    id: row.id,
    name: row.name,
    destination: row.destination,
    destinationTimezone: row.destination_timezone,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    status: row.status,
    notes: row.notes,
    // 'office' for everything that existed before private trips did.
    visibility: row.visibility || 'office',
    createdAt: row.created_at,
    ...extras,
  };
}

async function create({ ownerId, createdBy, name, destination, destinationTimezone, startsOn, endsOn, status, notes, visibility }) {
  if (!String(name || '').trim()) return { error: 'Give the trip a name.' };
  if (!startsOn || !endsOn) return { error: 'A trip needs a first and last day.' };
  if (endsOn < startsOn) return { error: 'The trip ends before it starts.' };
  if (destinationTimezone && !isTimezone(destinationTimezone)) {
    return { error: `${destinationTimezone} is not a timezone this server knows.` };
  }
  const chosen = STATUSES.includes(status) ? status : 'draft';

  const row = {
    id: crypto.randomUUID(),
    owner_id: ownerId,
    created_by: createdBy,
    name: String(name).trim(),
    destination: String(destination || '').trim(),
    destination_timezone: destinationTimezone || null,
    starts_on: startsOn,
    ends_on: endsOn,
    status: chosen,
    notes: String(notes || '').trim(),
    // Only the principal may create a journey the office cannot see. An
    // assistant marking one private on creation is the same mistake as an
    // assistant marking one private later, and it is refused in the same way.
    visibility: (visibility === 'private' && ownerId === createdBy)
      ? 'private' : 'office',
    created_at: new Date().toISOString(),
  };
  await db.prepare(`
    INSERT INTO trips (id, owner_id, created_by, name, destination, destination_timezone,
                       starts_on, ends_on, status, notes, visibility, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(row.id, row.owner_id, row.created_by, row.name, row.destination, row.destination_timezone,
    row.starts_on, row.ends_on, row.status, row.notes, row.visibility, row.created_at);
  return { trip: serializeTrip(row) };
}

/** Whether a zone name is real, asked of the runtime rather than a list. */
function isTimezone(name) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: String(name) });
    return true;
  } catch { return false; }
}

/**
 * The timezone the principal is actually in on a given local date.
 *
 * Only a confirmed trip moves them. A draft is an assistant's working copy and
 * must not silently redraw the principal's week, and a proposal is a question
 * rather than a fact — answering it by shifting their clock would be deciding
 * it for them.
 */
// Both of these take a viewer, and for the same reason: a clock is evidence.
// Draw an assistant's view of the principal's Thursday in Dubai time and you
// have told them the principal is in the Gulf, without ever showing them the
// trip. So for somebody who may not see the journey, the day stays in the
// principal's home zone and reads as an ordinary Thursday.
async function timezoneOn(ownerId, dateKey, fallback = 'UTC', viewerId = null) {
  const trip = await db.prepare(`
    SELECT id, owner_id, created_by, visibility, destination_timezone FROM trips
    WHERE owner_id = ? AND status = 'confirmed'
      AND destination_timezone IS NOT NULL
      AND starts_on <= ? AND ends_on >= ?
    ORDER BY starts_on DESC LIMIT 1
  `).get(ownerId, dateKey, dateKey);
  if (!trip) return fallback;
  if (!await tripPrivacy.maySeeTrip(trip, viewerId ?? ownerId)) return fallback;
  return trip.destination_timezone || fallback;
}

/** The trip covering a date, whatever its status — for showing context. */
async function tripOn(ownerId, dateKey, viewerId = null) {
  const row = await db.prepare(`
    SELECT * FROM trips
    WHERE owner_id = ? AND status IN ('confirmed', 'proposed')
      AND starts_on <= ? AND ends_on >= ?
    ORDER BY status = 'confirmed' DESC, starts_on DESC LIMIT 1
  `).get(ownerId, dateKey, dateKey);
  if (!row) return null;
  if (!await tripPrivacy.maySeeTrip(row, viewerId ?? ownerId)) return null;
  return serializeTrip(row);
}

// PRIVACY IS APPLIED HERE, not at the eleven call sites above this file.
//
// `viewerId` has no default on purpose. A caller that forgets it passes
// undefined, which matches nobody, so a private trip disappears rather than
// leaking — the failure lands on the safe side and shows up as a missing trip
// in a test, instead of as somebody's family holiday on an assistant's screen.
async function listFor(ownerId, viewerId, { includeDrafts = true } = {}) {
  const rows = await db.prepare(`
    SELECT * FROM trips WHERE owner_id = ?
      ${includeDrafts ? '' : "AND status != 'draft'"}
    ORDER BY starts_on DESC LIMIT 50
  `).all(ownerId);
  const hidden = await tripPrivacy.hiddenTripIds(ownerId, viewerId);
  return rows.filter((r) => !hidden.has(r.id)).map((r) => serializeTrip(r));
}

async function get(ownerId, tripId, viewerId) {
  const row = await db.prepare('SELECT * FROM trips WHERE id = ? AND owner_id = ?').get(tripId, ownerId);
  if (!row) return null;
  // A trip the viewer may not see answers exactly as one that does not exist,
  // the same way every other lookup in this app refuses: "not yours to see"
  // and "not there" must be one answer, or the difference between them is the
  // leak.
  if (!await tripPrivacy.maySeeTrip(row, viewerId)) return null;
  return serializeTrip(row);
}

/**
 * Documents that will have lapsed, or be too close to lapsing, by the time the
 * principal travels.
 *
 * Six months of validity beyond arrival is what much of the world asks for, so
 * a passport that is merely "in date" on the day of the flight can still turn
 * somebody away at check-in. Checked against the trip's own dates rather than
 * today, because that is the question actually being asked.
 */
const SIX_MONTHS_DAYS = 180;

async function documentWarnings(ownerId, trip) {
  const rows = await db.prepare(`
    SELECT id, field, label, expires_on, sensitivity FROM essentials
    WHERE owner_id = ? AND expires_on IS NOT NULL AND archived_at IS NULL
      AND category IN ('travel_identity', 'protection')
  `).all(ownerId);

  const end = Date.parse(`${trip.endsOn}T00:00:00Z`);
  const warnings = [];
  for (const r of rows) {
    const expiry = Date.parse(`${r.expires_on}T00:00:00Z`);
    if (Number.isNaN(expiry)) continue;
    const daysAfterTrip = Math.floor((expiry - end) / 86400000);
    if (daysAfterTrip < 0) {
      warnings.push({ ...warn(r), severity: 'expired', daysAfterTrip });
    } else if (r.field === 'passport_number' && daysAfterTrip < SIX_MONTHS_DAYS) {
      // The one where "still valid" is not the test anybody applies.
      warnings.push({ ...warn(r), severity: 'short', daysAfterTrip });
    }
  }
  return warnings;
}

function warn(row) {
  return { essentialId: row.id, field: row.field, label: row.label, expiresOn: row.expires_on };
}

module.exports = {
  ARRANGEMENTS, STATUSES, isArrangement, arrangementProblem, isTimezone,
  create, listFor, get, timezoneOn, tripOn, documentWarnings, serializeTrip,
  SIX_MONTHS_DAYS,
};
