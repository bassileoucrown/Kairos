const express = require('express');
const { asyncRouter } = require('../lib/asyncRouter');
const crypto = require('crypto');
const db = require('../lib/db');
const { requireAuth, verifyPassword } = require('../lib/auth');
const { requirePaAccess } = require('../lib/paAccess');
const { encrypt, decrypt, mask, isConfigured } = require('../lib/secretBox');
const { CATEGORIES, findField, canSee, expiryState, daysUntil } = require('../lib/essentials');
const { limit, clientIp } = require('../lib/rateLimit');

// The essentials of a person: passport, preferences, policies, sizes.
//
// Scoped to a principal like everything else in the PA layer, and to a
// *subject* within that — the principal themselves, or someone in their
// contacts, because a PA books for the spouse and the children too.
//
// Two rules run through every handler here. Sensitive values are never
// returned in the clear by a list; you get a mask and must ask. And asking is
// recorded.

const router = asyncRouter();
router.use(requireAuth);

const revealLimiter = limit({
  limit: 30,
  windowMs: 60 * 60 * 1000,
  keys: (req) => [`reveal:${req.user.id}`, `reveal-ip:${clientIp(req)}`],
  message: 'Too many reveals in a short time. Try again later.',
});

/** The viewer's standing on this principal, as the catalogue expects it. */
function viewerContext(req) {
  return { isOwner: req.paRole === 'owner', role: req.paRole };
}

async function logAccess({ actorId, ownerId, essentialId, action, field }) {
  await db.prepare(`
    INSERT INTO access_log (id, actor_id, subject_owner_id, essential_id, action, field, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(crypto.randomUUID(), actorId, ownerId, essentialId || null, action, field || '', new Date().toISOString());
}

function serialize(row, { revealed = null } = {}) {
  const sensitive = row.sensitivity === 'sensitive';
  const plain = sensitive ? null : row.value;
  return {
    id: row.id,
    category: row.category,
    field: row.field,
    label: row.label,
    sensitivity: row.sensitivity,
    // A sensitive value goes out masked unless this response is a deliberate
    // reveal. `•••• 4821` is enough to confirm the right document, never
    // enough to use it.
    value: sensitive ? (revealed ?? mask(decrypt(row.value_enc))) : plain,
    masked: sensitive && revealed === null,
    subjectUserId: row.subject_user_id,
    subjectContactId: row.subject_contact_id,
    subjectName: row.subject_name || null,
    expiresOn: row.expires_on,
    expiryState: expiryState(row.expires_on),
    daysUntilExpiry: daysUntil(row.expires_on),
    verifiedAt: row.verified_at,
    verifiedByName: row.verified_by_name || null,
    notes: row.notes,
    updatedAt: row.updated_at,
  };
}

const SELECT = `
  SELECT e.*,
         COALESCE(su.name, sc.name, sc.email) AS subject_name,
         vb.name AS verified_by_name
  FROM essentials e
  LEFT JOIN users su ON su.id = e.subject_user_id
  LEFT JOIN contacts sc ON sc.id = e.subject_contact_id
  LEFT JOIN users vb ON vb.id = e.verified_by
`;

/** The catalogue, so the client never hard-codes the field list. */
router.get('/catalogue', async (req, res) => {
  res.json({ categories: CATEGORIES, encryptionConfigured: isConfigured() });
});

router.get('/:ownerId', requirePaAccess, async (req, res) => {
  const ctx = viewerContext(req);
  const rows = await db.prepare(`${SELECT} WHERE e.owner_id = ? ORDER BY e.category, e.label`)
    .all(req.principal.id);

  // A delegate is not told that a passport exists and is being withheld —
  // it simply is not in the response. Same reasoning as spaces returning 404
  // rather than 403.
  const visible = rows.filter((r) => canSee(r.sensitivity, ctx));

  res.json({
    principal: { id: req.principal.id, name: req.principal.name },
    canSeeSensitive: canSee('sensitive', ctx),
    encryptionConfigured: isConfigured(),
    essentials: visible.map((r) => serialize(r)),
  });
});

router.post('/:ownerId', requirePaAccess, async (req, res) => {
  const ctx = viewerContext(req);
  const { category, field, label, value, expiresOn, notes, subjectContactId } = req.body || {};

  const spec = findField(category, field);
  if (!spec) return res.status(400).json({ error: 'Unknown field.' });
  if (!canSee(spec.sensitivity, ctx)) {
    return res.status(403).json({ error: 'You do not have access to that kind of detail.' });
  }
  if (!String(value || '').trim()) return res.status(400).json({ error: 'Give it a value.' });

  const sensitive = spec.sensitivity === 'sensitive';
  if (sensitive && !isConfigured()) {
    return res.status(503).json({
      error: 'This deployment has no encryption key, so identity details cannot be stored yet.',
    });
  }

  // Either the principal, or one of their contacts — never someone else's.
  let subjectUserId = req.principal.id;
  let contactId = null;
  if (subjectContactId) {
    const contact = await db.prepare('SELECT id FROM contacts WHERE id = ? AND owner_id = ?')
      .get(subjectContactId, req.principal.id);
    if (!contact) return res.status(404).json({ error: 'That person is not in your contacts.' });
    subjectUserId = null;
    contactId = contact.id;
  }

  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO essentials
      (id, owner_id, subject_user_id, subject_contact_id, category, field, label,
       value, value_enc, sensitivity, expires_on, verified_at, verified_by, notes,
       created_by, updated_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, req.principal.id, subjectUserId, contactId, category, field,
    String(label || spec.field.label).trim(),
    sensitive ? null : String(value).trim(),
    sensitive ? encrypt(String(value).trim()) : null,
    spec.sensitivity,
    expiresOn || null,
    // Entering it is asserting it, so the person entering it is the verifier.
    now, req.user.id,
    String(notes || '').trim(),
    req.user.id, req.user.id, now, now,
  );

  await logAccess({
    actorId: req.user.id, ownerId: req.principal.id, essentialId: id, action: 'create', field,
  });

  const row = await db.prepare(`${SELECT} WHERE e.id = ?`).get(id);
  res.status(201).json({ essential: serialize(row) });
});

router.patch('/:ownerId/:id', requirePaAccess, async (req, res) => {
  const ctx = viewerContext(req);
  const row = await db.prepare('SELECT * FROM essentials WHERE id = ? AND owner_id = ?')
    .get(req.params.id, req.principal.id);
  if (!row || !canSee(row.sensitivity, ctx)) return res.status(404).json({ error: 'Not found.' });

  const { value, expiresOn, notes, label, verified } = req.body || {};
  const updates = [];
  const values = [];
  const sensitive = row.sensitivity === 'sensitive';

  if (value !== undefined) {
    if (!String(value).trim()) return res.status(400).json({ error: 'Give it a value.' });
    if (sensitive) { updates.push('value_enc = ?'); values.push(encrypt(String(value).trim())); }
    else { updates.push('value = ?'); values.push(String(value).trim()); }
  }
  if (expiresOn !== undefined) { updates.push('expires_on = ?'); values.push(expiresOn || null); }
  if (notes !== undefined) { updates.push('notes = ?'); values.push(String(notes || '').trim()); }
  if (label !== undefined && String(label).trim()) { updates.push('label = ?'); values.push(String(label).trim()); }

  // "I have just held the document and this is still what it says." The
  // reason the screen can be trusted a year from now.
  if (verified || value !== undefined) {
    updates.push('verified_at = ?', 'verified_by = ?');
    values.push(new Date().toISOString(), req.user.id);
  }
  // A changed expiry deserves a fresh run at the reminders.
  if (expiresOn !== undefined) { updates.push('reminder_stage = ?'); values.push(null); }

  if (!updates.length) return res.status(400).json({ error: 'Nothing to update.' });

  updates.push('updated_by = ?', 'updated_at = ?');
  values.push(req.user.id, new Date().toISOString(), row.id);
  await db.prepare(`UPDATE essentials SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  await logAccess({
    actorId: req.user.id, ownerId: req.principal.id, essentialId: row.id,
    action: 'update', field: row.field,
  });

  const updated = await db.prepare(`${SELECT} WHERE e.id = ?`).get(row.id);
  res.json({ essential: serialize(updated) });
});

// Seeing the actual number is an act, not a page load.
//
// It costs a password, it is rate limited, and it is written to the log the
// principal can read. Nothing else in this file matters as much as this
// handler doing all three.
router.post('/:ownerId/:id/reveal', requirePaAccess, revealLimiter, async (req, res) => {
  const ctx = viewerContext(req);
  const row = await db.prepare('SELECT * FROM essentials WHERE id = ? AND owner_id = ?')
    .get(req.params.id, req.principal.id);
  if (!row || !canSee(row.sensitivity, ctx)) return res.status(404).json({ error: 'Not found.' });

  if (row.sensitivity !== 'sensitive') {
    return res.status(400).json({ error: 'That value is not hidden.' });
  }

  const me = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!req.body?.password || !verifyPassword(String(req.body.password), me.password_hash)) {
    return res.status(401).json({ error: 'Enter your password to reveal this.' });
  }

  const plain = decrypt(row.value_enc);
  if (plain === null) {
    return res.status(500).json({
      error: 'This value cannot be decrypted — the encryption key has changed since it was stored.',
    });
  }

  await logAccess({
    actorId: req.user.id, ownerId: req.principal.id, essentialId: row.id,
    action: 'reveal', field: row.field,
  });

  const full = await db.prepare(`${SELECT} WHERE e.id = ?`).get(row.id);
  res.json({ essential: serialize(full, { revealed: plain }) });
});

// Everything an airline or agent asks for, in one block to paste.
//
// This is where the feature earns its keep: the value is seconds at a booking
// desk, not tidiness. Sensitive values are included in full — assembling this
// IS a reveal, so it costs a password and is logged the same way.
router.post('/:ownerId/travel-block', requirePaAccess, revealLimiter, async (req, res) => {
  const ctx = viewerContext(req);
  const me = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!req.body?.password || !verifyPassword(String(req.body.password), me.password_hash)) {
    return res.status(401).json({ error: 'Enter your password to assemble travel details.' });
  }

  const subjectContactId = req.body?.subjectContactId || null;
  const rows = (await db.prepare(`${SELECT} WHERE e.owner_id = ?`).all(req.principal.id))
    .filter((r) => canSee(r.sensitivity, ctx))
    .filter((r) => (subjectContactId
      ? r.subject_contact_id === subjectContactId
      : !!r.subject_user_id));

  const WANTED = ['travel_identity', 'loyalty', 'preferences'];
  const lines = [];
  for (const category of WANTED) {
    for (const r of rows.filter((x) => x.category === category)) {
      const value = r.sensitivity === 'sensitive' ? decrypt(r.value_enc) : r.value;
      if (!value) continue;
      lines.push(`${r.label}: ${value}${r.expires_on ? ` (expires ${r.expires_on})` : ''}`);
    }
  }

  await logAccess({
    actorId: req.user.id, ownerId: req.principal.id, essentialId: null,
    action: 'reveal', field: 'travel-block',
  });

  res.json({ text: lines.join('\n'), lineCount: lines.length });
});

// Is this person actually able to travel on that date?
//
// The check a PA does in their head and occasionally forgets: a passport must
// usually be valid six months beyond arrival, and "not expired" is nowhere
// near good enough. Answered without revealing a single number.
router.get('/:ownerId/trip-ready', requirePaAccess, async (req, res) => {
  const ctx = viewerContext(req);
  const on = String(req.query.date || '').trim();
  const at = /^\d{4}-\d{2}-\d{2}$/.test(on) ? Date.parse(`${on}T00:00:00Z`) : Date.now();

  const rows = (await db.prepare(`${SELECT} WHERE e.owner_id = ?`).all(req.principal.id))
    .filter((r) => canSee(r.sensitivity, ctx));

  const checks = [];
  const passport = rows.find((r) => r.field === 'passport_number');
  if (!passport) {
    checks.push({ id: 'passport', state: 'missing', message: 'No passport on file.' });
  } else if (!passport.expires_on) {
    checks.push({ id: 'passport', state: 'unknown', message: 'Passport has no expiry recorded.' });
  } else {
    const days = Math.floor((Date.parse(`${passport.expires_on}T00:00:00Z`) - at) / 86400000);
    if (days < 0) checks.push({ id: 'passport', state: 'blocked', message: 'Passport has expired.' });
    else if (days < 180) {
      checks.push({
        id: 'passport',
        state: 'warning',
        message: `Passport expires ${days} days after this date — many countries require six months.`,
      });
    } else checks.push({ id: 'passport', state: 'ok', message: 'Passport valid well beyond this date.' });
  }

  for (const [field, label] of [['travel_insurance', 'Travel insurance'], ['visa', 'Visa']]) {
    const row = rows.find((r) => r.field === field);
    if (!row) continue;
    if (row.expires_on) {
      const days = Math.floor((Date.parse(`${row.expires_on}T00:00:00Z`) - at) / 86400000);
      checks.push(days < 0
        ? { id: field, state: 'blocked', message: `${label} has expired.` }
        : { id: field, state: 'ok', message: `${label} valid.` });
    }
  }

  // Verified long ago is its own risk: the number may be from the previous
  // passport, and nobody discovers that until check-in.
  const stale = rows.filter((r) => r.verified_at
    && Date.now() - Date.parse(r.verified_at) > 365 * 86400000);
  if (stale.length) {
    checks.push({
      id: 'stale',
      state: 'warning',
      message: `${stale.length} detail${stale.length === 1 ? '' : 's'} not confirmed in over a year.`,
    });
  }

  const worst = ['blocked', 'missing', 'warning', 'unknown', 'ok']
    .find((s) => checks.some((c) => c.state === s)) || 'ok';
  res.json({ date: on || null, overall: worst, checks });
});

router.delete('/:ownerId/:id', requirePaAccess, async (req, res) => {
  const ctx = viewerContext(req);
  const row = await db.prepare('SELECT * FROM essentials WHERE id = ? AND owner_id = ?')
    .get(req.params.id, req.principal.id);
  if (!row || !canSee(row.sensitivity, ctx)) return res.status(404).json({ error: 'Not found.' });

  await db.prepare('DELETE FROM essentials WHERE id = ?').run(row.id);
  await logAccess({
    actorId: req.user.id, ownerId: req.principal.id, essentialId: row.id,
    action: 'delete', field: row.field,
  });
  res.status(204).end();
});

module.exports = { router, logAccess };
