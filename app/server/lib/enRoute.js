const crypto = require('crypto');
const db = require('./db');

// A journey while it is happening: check calls, the card the driver holds, and
// the one button that means act now.
//
// WHY THIS IS SEPARATE FROM lib/movement.js. That file answers "who may know
// how this principal moves", which is a question about secrecy. This one
// answers "is the journey going to plan", which is a question about time and
// is asked by different people — including one who has no account at all.
// Keeping them apart stops the driver's card, which is addressed by a token
// anybody could forward, from ever reaching into the access gate.
//
// EVERYTHING HERE IS BUILT ON AN ABSENCE. A check call that was made tells you
// very little. A check call that was NOT made, twenty minutes after it was
// due, is the whole point of running a movement this way. That is the same
// shape as the arrival alarm in lib/movement.js, and it is deliberate: one
// idea, applied at three points along a journey instead of only at the end.

// Half an hour between contacts. Short enough that a problem is noticed inside
// a window somebody can act in; long enough that a driver in Lagos traffic is
// not answering a phone every ten minutes, which is how check calls stop being
// answered at all.
const CHECK_EVERY_MINUTES = 30;

// How late a check call has to be before it is missed. Deliberately shorter
// than the arrival grace: a driver who cannot confirm a check call is already
// the situation, whereas an arrival can simply be a slow last mile.
const CHECK_GRACE_MINUTES = 10;

// A card lives as long as the journey plus a margin. A link that works forever
// is a link that works after it has been forwarded twice and the driver has
// left the job.
const CARD_TTL_MS = 12 * 3600 * 1000;

const COST_KINDS = new Set(['fuel', 'toll', 'allowance', 'repair', 'other']);

/**
 * Lay out the check calls for a journey.
 *
 * Only for a journey long enough to have a middle. A twenty-minute run to the
 * office does not want a check call at the halfway point — it wants somebody
 * to notice if the car never arrives, which the arrival alarm already does.
 * Adding ceremony to short journeys is how an office learns to ignore it.
 */
async function planChecks(movement, { every = CHECK_EVERY_MINUTES } = {}) {
  const total = Number(movement.expected_minutes || 0);
  if (total <= every) return [];

  const departs = Date.parse(movement.departs_at);
  if (Number.isNaN(departs)) return [];

  const rows = [];
  for (let at = every; at < total; at += every) {
    rows.push({
      id: crypto.randomUUID(),
      movement_id: movement.id,
      due_at: new Date(departs + at * 60000).toISOString(),
      created_at: new Date().toISOString(),
    });
  }
  for (const r of rows) {
    await db.prepare(`
      INSERT INTO movement_checks (id, movement_id, due_at, created_at)
      VALUES (?, ?, ?, ?)
    `).run(r.id, r.movement_id, r.due_at, r.created_at);
  }
  return rows;
}

async function checksFor(movementId) {
  const rows = await db.prepare(
    'SELECT * FROM movement_checks WHERE movement_id = ? ORDER BY due_at',
  ).all(movementId);
  return rows.map((c) => ({
    id: c.id,
    dueAt: c.due_at,
    checkedAt: c.checked_at || null,
    note: c.note || '',
    // Said rather than left to the screen to work out from two timestamps and
    // a clock it may not agree with.
    missed: !c.checked_at
      && Date.now() > Date.parse(c.due_at) + CHECK_GRACE_MINUTES * 60000,
  }));
}

async function confirmCheck(checkId, { userId = null, note = '' } = {}) {
  const row = await db.prepare('SELECT * FROM movement_checks WHERE id = ?').get(checkId);
  if (!row) return { ok: false, status: 404, error: 'Not found.' };
  if (row.checked_at) return { ok: true, already: true };
  await db.prepare(
    'UPDATE movement_checks SET checked_at = ?, checked_by = ?, note = ? WHERE id = ?',
  ).run(new Date().toISOString(), userId, String(note || '').slice(0, 280), checkId);
  return { ok: true };
}

// --- The card the driver holds -------------------------------------------------

function generateToken() {
  return crypto.randomBytes(24).toString('base64url');
}

/** Give this movement a card address, replacing any earlier one. */
async function armCard(movementId) {
  const token = generateToken();
  await db.prepare('UPDATE movements SET card_token = ? WHERE id = ?').run(token, movementId);
  return token;
}

/** Take the card down. The driver changed, or the journey did. */
async function disarmCard(movementId) {
  await db.prepare('UPDATE movements SET card_token = NULL WHERE id = ?').run(movementId);
}

/**
 * What the person driving is shown.
 *
 * A DELIBERATELY THIN CARD, and thinner than the stand-in's coordination view.
 * The holder of this link has no account and may not be the driver at all — a
 * link forwarded twice is still a working link until somebody takes it down.
 * So it carries the journey and nothing that identifies whose journey it is:
 *
 *   NOT the principal's name. A card saying "driving Chief Okonkwo from the
 *   Ikoyi residence" is a targeting notice if it reaches the wrong phone,
 *   which is the same reasoning that keeps a name off an arrivals-hall board.
 *   See lib/pickup.js — this is that decision applied a second time.
 *
 *   NOT the escort, the convoy, or the notes. The driver of the principal's
 *   car does not need the roster to drive, and the roster is the thing worth
 *   protecting.
 *
 * WHAT IT DOES CARRY is everything needed to do the job and to close the loop:
 * when, from where, to where, which car, the check calls, and the two buttons
 * that matter — I am here, and something is wrong.
 */
async function cardFor(token) {
  if (!token || String(token).length < 24) return null;
  const m = await db.prepare('SELECT * FROM movements WHERE card_token = ?').get(String(token));
  if (!m) return null;

  // Expired by the clock rather than by a stored flag, so a card cannot
  // outlive its journey because a sweep did not run.
  const departs = Date.parse(m.departs_at);
  if (!Number.isNaN(departs) && Date.now() > departs + CARD_TTL_MS) return null;

  const car = await db.prepare(
    "SELECT plate, description FROM movement_vehicles WHERE movement_id = ? AND role = 'principal' LIMIT 1",
  ).get(m.id);

  return {
    departsAt: m.departs_at,
    departsFrom: m.departs_from,
    destination: m.destination,
    expectedMinutes: m.expected_minutes || 0,
    car: car ? { plate: car.plate, description: car.description } : null,
    arrivedAt: m.arrived_at || null,
    duressAt: m.duress_at || null,
    checks: await checksFor(m.id),
    movementId: m.id,
  };
}

// --- Something is wrong --------------------------------------------------------

/**
 * Raise duress on a journey.
 *
 * ONE DIRECTION ONLY, and that is the design. There is no "cancel duress"
 * here: a signal that can be withdrawn from the same phone that raised it is a
 * signal an attacker withdraws. Clearing it is done by somebody signed in, on
 * the movement itself, and the fact that it was raised stays on the record.
 *
 * IT DOES NOT WAIT FOR A SWEEP. Everything else in this file is noticed by the
 * reminder engine within ten minutes. Ten minutes is the wrong number here, so
 * the caller tells people immediately.
 */
async function raiseDuress(movement, { byUserId = null, note = '' } = {}) {
  if (movement.duress_at) return { ok: true, already: true };
  const now = new Date().toISOString();
  await db.prepare(
    'UPDATE movements SET duress_at = ?, duress_by = ?, duress_note = ? WHERE id = ?',
  ).run(now, byUserId, String(note || '').slice(0, 280), movement.id);
  return { ok: true, at: now };
}

/** Stand it down. Only ever by somebody signed in, and the record keeps it. */
async function clearDuress(movement, userId) {
  await db.prepare('UPDATE movements SET duress_at = NULL WHERE id = ?').run(movement.id);
  await db.prepare(`
    INSERT INTO access_log (id, actor_id, subject_owner_id, essential_id, action, field, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(crypto.randomUUID(), userId, movement.owner_id, movement.id, 'duress_cleared',
    movement.title, new Date().toISOString());
}

// --- What it cost ---------------------------------------------------------------

async function addCost({ movementId, kind, amountMinor, currency, note, userId }) {
  if (!COST_KINDS.has(kind)) return { ok: false, status: 400, error: 'Not a kind of cost.' };
  const amount = Number.parseInt(amountMinor, 10);
  if (!Number.isFinite(amount) || amount < 0) {
    return { ok: false, status: 400, error: 'That is not an amount.' };
  }
  const id = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO movement_costs (id, movement_id, kind, amount_minor, currency, note, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, movementId, kind, amount, String(currency || 'NGN').slice(0, 3).toUpperCase(),
    String(note || '').slice(0, 280), userId, new Date().toISOString());
  return { ok: true, id };
}

async function costsFor(movementId) {
  const rows = await db.prepare(
    'SELECT * FROM movement_costs WHERE movement_id = ? ORDER BY created_at',
  ).all(movementId);
  return {
    items: rows.map((c) => ({
      id: c.id, kind: c.kind, amountMinor: c.amount_minor,
      currency: c.currency, note: c.note, createdAt: c.created_at,
    })),
    // Totalled per currency rather than into one number. An office that pays a
    // Lagos driver in naira and a London one in sterling has two totals, and
    // adding them would produce a figure that is wrong in both.
    totals: rows.reduce((acc, c) => {
      acc[c.currency] = (acc[c.currency] || 0) + c.amount_minor;
      return acc;
    }, {}),
  };
}

module.exports = {
  CHECK_EVERY_MINUTES, CHECK_GRACE_MINUTES, CARD_TTL_MS, COST_KINDS,
  planChecks, checksFor, confirmCheck,
  armCard, disarmCard, cardFor, generateToken,
  raiseDuress, clearDuress,
  addCost, costsFor,
};
