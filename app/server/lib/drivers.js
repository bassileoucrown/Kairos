const crypto = require('crypto');
const db = require('./db');
const { expiryState } = require('./essentials');

// The people who drive, and their papers.
//
// THE CARS HAD PAPERS AND THE PEOPLE DID NOT. A vehicle carries insurance and
// roadworthiness on the expiry engine, so an office learns a certificate has
// lapsed from Today rather than from a police officer at a checkpoint. The
// driver's licence had no such place: a driver was a name and a phone number
// typed onto one journey, retyped onto the next, and their licence expired
// where nobody could see it.
//
// A DRIVER IS A PERSON THE OFFICE EMPLOYS, not a string on a journey. So they
// are a row, they are reused across movements, and their documents go through
// the SAME expiryState the vault and the fleet already use. A third idea of
// "nearly out of date" would drift from the other two, and the reader would
// have to learn which screen meant what.
//
// THEY ARE NOT USERS. A driver has no account here — see routes/driveCard.js
// for why. This table is the office's record of them, not a login.

const PAPER_KINDS = new Set(['licence', 'permit', 'medical', 'training']);

function serialize(d, papers) {
  return {
    id: d.id,
    name: d.name,
    phone: d.phone,
    notes: d.notes,
    archivedAt: d.archived_at || null,
    papers: (papers || []).map((p) => ({
      id: p.id,
      kind: p.kind,
      reference: p.reference,
      expiresOn: p.expires_on,
      state: p.expires_on ? expiryState(p.expires_on) : null,
    })),
    // Said once, here, rather than worked out by three screens from the list
    // above. "This driver should not be on the road" is the question the fleet
    // page, the movement form and the day sheet all want answered.
    lapsed: (papers || []).some((p) => p.expires_on && expiryState(p.expires_on) === 'expired'),
  };
}

async function list(ownerId, { archived = false } = {}) {
  const rows = await db.prepare(`
    SELECT * FROM drivers WHERE owner_id = ?
     AND archived_at IS ${archived ? 'NOT NULL' : 'NULL'}
     ORDER BY name
  `).all(ownerId);
  if (!rows.length) return [];
  const papers = await db.prepare(`
    SELECT * FROM driver_papers WHERE driver_id IN (${rows.map(() => '?').join(',')})
     ORDER BY expires_on IS NULL, expires_on ASC
  `).all(...rows.map((r) => r.id));
  return rows.map((d) => serialize(d, papers.filter((p) => p.driver_id === d.id)));
}

async function create(ownerId, { name, phone, notes }) {
  if (!String(name || '').trim()) return { ok: false, status: 400, error: 'Who is it?' };
  const row = {
    id: crypto.randomUUID(),
    owner_id: ownerId,
    name: String(name).trim(),
    phone: String(phone || '').trim(),
    notes: String(notes || '').trim(),
    created_at: new Date().toISOString(),
  };
  await db.prepare(`
    INSERT INTO drivers (id, owner_id, name, phone, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(row.id, row.owner_id, row.name, row.phone, row.notes, row.created_at);
  return { ok: true, driver: serialize(row, []) };
}

async function addPaper(driverId, { kind, reference, expiresOn }) {
  if (!PAPER_KINDS.has(kind)) {
    return { ok: false, status: 400, error: 'That is not a kind of driver\'s paper.' };
  }
  const id = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO driver_papers (id, driver_id, kind, reference, expires_on, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, driverId, kind, String(reference || '').trim(), expiresOn || null,
    new Date().toISOString());
  return { ok: true, id };
}

/** Put a driver away rather than delete: they are on journeys that happened. */
async function archive(driverId) {
  const d = await db.prepare('SELECT archived_at FROM drivers WHERE id = ?').get(driverId);
  const at = d?.archived_at ? null : new Date().toISOString();
  await db.prepare('UPDATE drivers SET archived_at = ? WHERE id = ?').run(at, driverId);
  return at;
}

/**
 * Drivers whose papers have lapsed, for the office's own attention.
 *
 * Deliberately NOT part of the movement gate. Which drivers the office employs
 * and whether their licences are current is ordinary office information — the
 * same standing the fleet has. It is where those drivers are TAKING somebody
 * that is the safety record.
 */
async function lapsedFor(ownerId) {
  const all = await list(ownerId);
  return all.filter((d) => d.lapsed);
}

module.exports = { PAPER_KINDS, list, create, addPaper, archive, serialize, lapsedFor };
