const crypto = require('crypto');
const db = require('./db');

// "I am not available then." For an hour, a day, a week, or longer.
//
// The diary could already say what the principal was DOING — meetings,
// flights, dinners — and had no way to say what they were not doing. Those are
// different instructions and the picker treats them differently on purpose: an
// itinerary item is shown and left bookable, because the office can see a
// flight at three and decide to book against it anyway, and sometimes that is
// right. This is the other instruction, the one with no nuance in it: do not
// put anything here. So it subtracts.
//
// ONE SHAPE FOR EVERY LENGTH. A morning off, a funeral, a fortnight, a
// sabbatical — all a start and an end. Nothing here knows the difference
// between a short one and a long one, which is why there is no separate
// "block a day" and "block a week" to keep in step with each other.

const OFFICE = 'office';
const PRIVATE = 'private';
const VISIBILITIES = new Set([OFFICE, PRIVATE]);

// Long enough for a sabbatical, short of anything that is really a mistake.
// A block that runs to the heat death of the diary is almost always a typo in
// a year field, and silently accepting it empties the calendar with no
// explanation anybody can find later.
const MAX_DAYS = 400;

function problemWith({ startsAt, endsAt }) {
  const start = Date.parse(startsAt);
  const end = Date.parse(endsAt);
  if (!startsAt || Number.isNaN(start)) return 'When does it start?';
  if (!endsAt || Number.isNaN(end)) return 'When does it end?';
  if (end <= start) return 'It has to end after it starts.';
  if (end - start > MAX_DAYS * 86400000) {
    return `That is longer than ${MAX_DAYS} days. Set it in shorter stretches.`;
  }
  return null;
}

async function create({ ownerId, createdBy, startsAt, endsAt, reason, visibility }) {
  const problem = problemWith({ startsAt, endsAt });
  if (problem) return { error: problem };

  const row = {
    id: crypto.randomUUID(),
    owner_id: ownerId,
    created_by: createdBy,
    starts_at: new Date(startsAt).toISOString(),
    ends_at: new Date(endsAt).toISOString(),
    reason: String(reason || '').trim().slice(0, 280),
    // Only the principal may hide the reason from their own office. An
    // assistant who blocked time and then hid why would be putting a hole in
    // the diary that nobody else can account for.
    visibility: (visibility === PRIVATE && ownerId === createdBy) ? PRIVATE : OFFICE,
    created_at: new Date().toISOString(),
  };
  await db.prepare(`
    INSERT INTO unavailable (id, owner_id, created_by, starts_at, ends_at, reason, visibility, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(row.id, row.owner_id, row.created_by, row.starts_at, row.ends_at,
    row.reason, row.visibility, row.created_at);
  return { block: serialize(row, ownerId) };
}

/**
 * What the viewer is allowed to be told about a block.
 *
 * The block itself is never hidden — that is the whole point of it, and a
 * block the office cannot see is a block the office books over. Only the
 * REASON is withheld, and then the office is told plainly that there is one
 * rather than being shown an unexplained hole: "Unavailable" is an answer,
 * a blank is a bug somebody will ring about.
 */
function serialize(row, viewerId) {
  const mayReadReason = row.visibility === OFFICE
    || row.owner_id === viewerId
    || row.created_by === viewerId;
  return {
    id: row.id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    reason: mayReadReason ? row.reason : '',
    private: row.visibility === PRIVATE,
    // What to put on a screen, decided here so that four screens cannot
    // disagree about it.
    label: (mayReadReason && row.reason) ? row.reason : 'Unavailable',
    createdAt: row.created_at,
  };
}

/** Every block overlapping a window, as rows. */
async function overlapping(ownerId, fromIso, toIso) {
  return db.prepare(`
    SELECT * FROM unavailable
     WHERE owner_id = ? AND starts_at < ? AND ends_at > ?
     ORDER BY starts_at ASC
  `).all(ownerId, toIso, fromIso);
}

async function listFor(ownerId, viewerId, { fromIso = null } = {}) {
  const rows = await db.prepare(`
    SELECT * FROM unavailable
     WHERE owner_id = ? AND ends_at > ?
     ORDER BY starts_at ASC LIMIT 200
  `).all(ownerId, fromIso || new Date().toISOString());
  return rows.map((r) => serialize(r, viewerId));
}

/** Does this stretch of time run into one? */
function blocks(rows, startMs, endMs) {
  return rows.some((b) => startMs < Date.parse(b.ends_at) && endMs > Date.parse(b.starts_at));
}

module.exports = {
  OFFICE, PRIVATE, VISIBILITIES, MAX_DAYS,
  create, serialize, overlapping, listFor, blocks, problemWith,
};
