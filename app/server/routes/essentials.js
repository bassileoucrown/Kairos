const express = require('express');
const { asyncRouter } = require('../lib/asyncRouter');
const crypto = require('crypto');
const db = require('../lib/db');
const { requireAuth, verifyPassword } = require('../lib/auth');
const { requirePaAccess } = require('../lib/paAccess');
const { requirePlan } = require('../lib/plans');
const { encrypt, decrypt, mask, isConfigured } = require('../lib/secretBox');
const { CATEGORIES, findField, canSee, expiryState, daysUntil } = require('../lib/essentials');
const { limit, clientIp } = require('../lib/rateLimit');
const { verifyStepUp, factorFor } = require('../lib/stepUp');
const documents = require('../lib/documents');

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

/**
 * The vault is shut on a record nobody has claimed yet.
 *
 * Everywhere else in Kairos, essentials are protected by the principal's own
 * second factor — that is the whole promise, and the reason a stolen password
 * reaches a calendar and no further. A held record has no principal on the app,
 * so there is no second factor of theirs to stand behind the documents; they
 * would rest on the assistant's instead. That is a materially weaker thing, and
 * selling it as the same thing is how a custody product loses the only argument
 * it has.
 *
 * So there is nothing to weaken: the vault does not open on a held record at
 * all, and says why rather than appearing empty. When the principal joins and
 * sets their own second factor, they keep their papers in their own account.
 */
async function notWhileHeld(req, res, next) {
  if (req.principal?.kept_by) {
    return res.status(409).json({
      error: 'Essentials are shut while this record is held. There is no second factor of '
        + 'theirs to protect documents with until they join and set one.',
      held: true,
    });
  }
  return next();
}

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

/**
 * What may be attached as a document, and what may not.
 *
 * ABOVE THE /:ownerId ROUTES ON PURPOSE — a literal path and a parameter of
 * the same shape are decided by which was declared first, and `/formats`
 * declared after them is a principal whose id is "formats".
 *
 * The refusals are served alongside the acceptances rather than kept for an
 * error, so a screen can say what will not go in before somebody spends a
 * minute choosing a file that was never going to be taken.
 */
router.get('/formats', async (req, res) => {
  res.json({
    accepted: documents.offered(),
    refused: documents.notOffered(),
    maxBytes: documents.MAX_BYTES,
    available: documents.isAvailable(),
    unavailable: documents.isAvailable() ? '' : documents.UNAVAILABLE,
  });
});

router.get('/:ownerId', requirePaAccess, notWhileHeld, async (req, res) => {
  const ctx = viewerContext(req);
  const rows = await db.prepare(
    `${SELECT} WHERE e.owner_id = ? AND e.archived_at IS NULL ORDER BY e.category, e.label`,
  ).all(req.principal.id);

  // A delegate is not told that a passport exists and is being withheld —
  // it simply is not in the response. Same reasoning as spaces returning 404
  // rather than 403.
  const visible = rows.filter((r) => canSee(r.sensitivity, ctx));

  // WHAT IS ATTACHED, NOT WHAT IS IN IT. These are filenames and sizes; the
  // bytes cost a second factor and come from their own endpoint. Filtered
  // again on the document's own sensitivity, because a scan can be stricter
  // than the entry it hangs on — see flagFor in lib/documents.js.
  const attached = new Map();
  if (visible.length) {
    for (const r of visible) {
      const docs = (await documents.forEssential(r.id))
        .filter((d) => canSee(d.sensitivity, ctx));
      if (docs.length) attached.set(r.id, docs);
    }
  }

  res.json({
    principal: { id: req.principal.id, name: req.principal.name },
    canSeeSensitive: canSee('sensitive', ctx),
    encryptionConfigured: isConfigured(),
    // Said once for the whole screen rather than per entry: whether this
    // deployment can hold a file at all.
    documentsAvailable: documents.isAvailable(),
    // What a reveal will cost, so the screen asks for the right thing rather
    // than prompting for a password and then discovering it wanted a code.
    stepUpFactor: await factorFor(req.user.id),
    essentials: visible.map((r) => ({ ...serialize(r), documents: attached.get(r.id) || [] })),
    // Said here so the live list can offer the way through to them. A count
    // rather than the rows: an archived document is still a passport number,
    // and shipping every one of them to a screen that only wants to say
    // "3 archived" would put them on the wire for nothing.
    archivedCount: await countArchived(req.principal.id, ctx),
  });
});

/** How many put-away documents this viewer is allowed to know about. */
async function countArchived(ownerId, ctx) {
  const rows = await db.prepare(
    'SELECT sensitivity FROM essentials WHERE owner_id = ? AND archived_at IS NOT NULL',
  ).all(ownerId);
  return rows.filter((r) => canSee(r.sensitivity, ctx)).length;
}

/**
 * The documents put away.
 *
 * Served by the same route as the live ones, through the same serializer and
 * the same sensitivity filter, because an archived passport is not a less
 * sensitive passport. Reading a value here still costs a step-up and is still
 * logged: /reveal does not ask whether a row is archived, which is exactly
 * the property that makes this safe to add.
 */
router.get('/:ownerId/archived', requirePaAccess, notWhileHeld, async (req, res) => {
  const ctx = viewerContext(req);
  const rows = await db.prepare(
    `${SELECT} WHERE e.owner_id = ? AND e.archived_at IS NOT NULL ORDER BY e.archived_at DESC`,
  ).all(req.principal.id);

  res.json({
    principal: { id: req.principal.id, name: req.principal.name },
    canSeeSensitive: canSee('sensitive', ctx),
    stepUpFactor: await factorFor(req.user.id),
    essentials: rows
      .filter((r) => canSee(r.sensitivity, ctx))
      .map((r) => ({ ...serialize(r), archivedAt: r.archived_at })),
  });
});

/**
 * Put a document away, or take it back out.
 *
 * WHAT THIS IS FOR. The old passport, the visa for a country already visited,
 * the policy that lapsed when the broker changed. Deleting them is wrong —
 * a superseded passport number is exactly what a form asks for when it wants
 * your travel history — but leaving them in the live list is worse than
 * clutter: two passport numbers side by side, one of them dead, is how the
 * wrong one gets read out at a check-in desk.
 *
 * SO IT ALSO STOPS THE NUDGES. An archived document leaves the expiry sweep,
 * Today's "about to lapse" list, and the travel warnings on a trip. Otherwise
 * putting away an expired passport would buy silence on the screen and a
 * monthly email about renewing something nobody intends to renew — and an
 * office that learns to ignore expiry mail is an office that misses the one
 * that mattered.
 */
router.post('/:ownerId/:id/archive', requirePaAccess, notWhileHeld, async (req, res) => {
  const ctx = viewerContext(req);
  const row = await db.prepare('SELECT * FROM essentials WHERE id = ? AND owner_id = ?')
    .get(req.params.id, req.principal.id);
  if (!row || !canSee(row.sensitivity, ctx)) return res.status(404).json({ error: 'Not found.' });

  const at = row.archived_at || new Date().toISOString();
  await db.prepare('UPDATE essentials SET archived_at = ? WHERE id = ?').run(at, row.id);
  await logAccess({
    actorId: req.user.id, ownerId: req.principal.id, essentialId: row.id,
    action: 'archive', field: row.field,
  });
  res.json({ archivedAt: at });
});

router.delete('/:ownerId/:id/archive', requirePaAccess, notWhileHeld, async (req, res) => {
  const ctx = viewerContext(req);
  const row = await db.prepare('SELECT * FROM essentials WHERE id = ? AND owner_id = ?')
    .get(req.params.id, req.principal.id);
  if (!row || !canSee(row.sensitivity, ctx)) return res.status(404).json({ error: 'Not found.' });

  // The expiry ladder resets with it. A document that sat archived through its
  // own expiry has already had whatever nudges it was going to get; brought
  // back, it is live again and the office should be told about it again.
  await db.prepare('UPDATE essentials SET archived_at = NULL, reminder_stage = NULL WHERE id = ?')
    .run(row.id);
  res.json({ archivedAt: null });
});

// Adding is gated; reading is not. A principal who drops a plan keeps every
// document they put in and simply cannot add more — losing sight of your own
// passport number because a card expired is not a product behaviour.
router.post('/:ownerId', requirePaAccess, notWhileHeld, requirePlan('vault'), async (req, res) => {
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

router.patch('/:ownerId/:id', requirePaAccess, notWhileHeld, async (req, res) => {
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
// It costs a second factor, it is rate limited, and it is written to the log
// the principal can read. Nothing else in this file matters as much as this
// handler doing all three.
//
// The second factor, rather than the password, because the attacker this vault
// has to survive is the one who already knows the password. See lib/stepUp.js.
router.post('/:ownerId/:id/reveal', requirePaAccess, notWhileHeld, revealLimiter, async (req, res) => {
  const ctx = viewerContext(req);
  const row = await db.prepare('SELECT * FROM essentials WHERE id = ? AND owner_id = ?')
    .get(req.params.id, req.principal.id);
  if (!row || !canSee(row.sensitivity, ctx)) return res.status(404).json({ error: 'Not found.' });

  if (row.sensitivity !== 'sensitive') {
    return res.status(400).json({ error: 'That value is not hidden.' });
  }

  const step = await verifyStepUp(req, {
    code: req.body?.code,
    password: req.body?.password,
  });
  if (!step.ok) {
    return res.status(step.status).json({ error: step.error, needs: step.needs });
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
router.post('/:ownerId/travel-block', requirePaAccess, notWhileHeld, revealLimiter, async (req, res) => {
  const ctx = viewerContext(req);
  // Assembling this hands over everything an airline asks for in one paste, so
  // it is a reveal in every sense and is gated identically.
  const step = await verifyStepUp(req, {
    code: req.body?.code,
    password: req.body?.password,
  });
  if (!step.ok) {
    return res.status(step.status).json({ error: step.error, needs: step.needs });
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
router.get('/:ownerId/trip-ready', requirePaAccess, notWhileHeld, async (req, res) => {
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

router.delete('/:ownerId/:id', requirePaAccess, notWhileHeld, async (req, res) => {
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

// ============================================================
// Documents
// ============================================================
//
// The file behind the field. Everything above this line is about values a
// person types; this is about the passport page itself.
//
// IT HANGS ON AN ESSENTIAL, ALWAYS, and that is what makes it safe rather than
// what makes it tidy. The entry it hangs on has already decided who may see
// it, that opening it costs a second factor, and that opening it is written to
// the trail the principal reads. A document endpoint that answered those
// questions for itself would be a second copy of the vault's rule — and the
// copy that drifts is the one that hands somebody a passport.
//
// So there is exactly one new decision here: attaching is filing, and opening
// is revealing. Attaching costs what creating an entry costs. Opening costs
// what revealing a number costs, to the letter.

// The upload body skips the global 100 KB parser — see index.js — so this is
// the ceiling that actually applies at the door. The real cap is enforced in
// lib/documents.js, which refuses by name and says the size; this only has to
// be wide enough that a legitimate file reaches that refusal instead of dying
// here as an unexplained 413.
const documentJson = express.json({ limit: '25mb' });

/**
 * A one-time pass to fetch bytes, held for sixty seconds.
 *
 * WHY NOT JUST DOWNLOAD IT FROM THE POST. Opening a document costs a second
 * factor, and a second factor cannot travel in a URL — so the act has to be a
 * POST. But a browser saves a file properly only from a plain navigation with
 * the server naming it, which has to be a GET. (The report export learned this
 * the same way: a blob built in JavaScript often does not save on a phone.)
 *
 * So the POST is the act — it takes the factor, writes the trail line, and
 * hands back a pass — and the GET is the delivery. The pass is single-use, it
 * is bound to the person and the document, and it dies in a minute, so a URL
 * that leaks into a history or a log is a URL that no longer opens anything.
 *
 * In memory, like the rate limiter: on a restart every outstanding pass is
 * forgotten, which costs somebody one extra press and cannot fail open.
 */
const passes = new Map();
const PASS_TTL_MS = 60 * 1000;

function issuePass(userId, documentId) {
  const ticket = crypto.randomBytes(24).toString('base64url');
  passes.set(ticket, { userId, documentId, expiresAt: Date.now() + PASS_TTL_MS });
  // Swept opportunistically rather than on a timer, so the process has nothing
  // running when nobody is using this.
  for (const [k, v] of passes) if (v.expiresAt < Date.now()) passes.delete(k);
  return ticket;
}

function spendPass(ticket, userId, documentId) {
  const held = passes.get(String(ticket || ''));
  if (!held) return false;
  passes.delete(String(ticket || ''));
  if (held.expiresAt < Date.now()) return false;
  return held.userId === userId && held.documentId === documentId;
}

/** The entry a document is being hung on, or null if this viewer has no such entry. */
async function essentialFor(req) {
  const row = await db.prepare('SELECT * FROM essentials WHERE id = ? AND owner_id = ?')
    .get(req.params.id, req.principal.id);
  if (!row || !canSee(row.sensitivity, viewerContext(req))) return null;
  return row;
}

// Attaching is filing, so it costs what filing costs: the same plan gate as an
// entry, the same access-log line, and no second factor. Handing a document IN
// gives nothing away — it is taking one out that has to be paid for.
router.post('/:ownerId/:id/documents', requirePaAccess, notWhileHeld, requirePlan('vault'),
  documentJson, async (req, res) => {
    const row = await essentialFor(req);
    if (!row) return res.status(404).json({ error: 'Not found.' });

    const { filename, mimeType, data } = req.body || {};
    const bytes = Buffer.from(String(data || ''), 'base64');

    const result = await documents.attach({
      ownerId: req.principal.id,
      essentialId: row.id,
      uploadedBy: req.user.id,
      filename,
      mimeType,
      bytes,
      fieldSensitivity: row.sensitivity,
      label: row.label,
    });
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error, code: result.code });
    }

    await logAccess({
      actorId: req.user.id, ownerId: req.principal.id, essentialId: row.id,
      action: 'create', field: row.field,
    });
    res.status(201).json({ document: result.document });
  });

// Opening one is a reveal in every sense — it is the document, not a mask of
// it — so it is gated identically: the second factor, the same limiter, and a
// line in the trail naming who opened what.
router.post('/:ownerId/:id/documents/:docId/open', requirePaAccess, notWhileHeld, revealLimiter,
  async (req, res) => {
    const row = await essentialFor(req);
    if (!row) return res.status(404).json({ error: 'Not found.' });

    const doc = await db.prepare('SELECT * FROM documents WHERE id = ? AND essential_id = ?')
      .get(req.params.docId, row.id);
    // A DOCUMENT CAN BE STRICTER THAN THE ENTRY IT HANGS ON. A scan filed
    // under an ordinary field that is plainly a passport is stored sensitive,
    // and this is where that costs something — a delegate who can read the
    // field still cannot open the file.
    if (!doc || !canSee(doc.sensitivity, viewerContext(req))) {
      return res.status(404).json({ error: 'Not found.' });
    }

    const step = await verifyStepUp(req, {
      code: req.body?.code,
      password: req.body?.password,
    });
    if (!step.ok) return res.status(step.status).json({ error: step.error, needs: step.needs });

    await logAccess({
      actorId: req.user.id, ownerId: req.principal.id, essentialId: row.id,
      action: 'reveal', field: row.field,
    });
    res.json({ ticket: issuePass(req.user.id, doc.id), expiresInSeconds: PASS_TTL_MS / 1000 });
  });

// The delivery half. The act was the POST above; this only spends the pass it
// handed out.
//
// SERVED AS AN ATTACHMENT, ALWAYS, with nosniff. Nothing in the accepted list
// is a document a browser will execute — the ones that are, are refused by
// name in lib/documents.js — but a store that serves user bytes inline is one
// bad allow-list entry away from running somebody's script on this origin, and
// the header costs nothing.
router.get('/:ownerId/:id/documents/:docId', requirePaAccess, notWhileHeld, async (req, res) => {
  const row = await essentialFor(req);
  if (!row) return res.status(404).json({ error: 'Not found.' });

  const doc = await db.prepare('SELECT * FROM documents WHERE id = ? AND essential_id = ?')
    .get(req.params.docId, row.id);
  if (!doc || !canSee(doc.sensitivity, viewerContext(req))) {
    return res.status(404).json({ error: 'Not found.' });
  }
  if (!spendPass(req.query.ticket, req.user.id, doc.id)) {
    return res.status(403).json({
      error: 'That pass has been used or has run out. Open the document again.',
      code: 'pass_spent',
    });
  }

  const opened = await documents.open(doc.id);
  if (!opened) {
    return res.status(500).json({
      error: 'This document cannot be decrypted — the encryption key has changed since it '
        + 'was stored.',
    });
  }
  res.set('Content-Type', opened.mimeType || 'application/octet-stream');
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Content-Disposition',
    `attachment; filename="${opened.filename.replace(/[^A-Za-z0-9._-]+/g, '-')}"`);
  res.send(opened.bytes);
});

router.delete('/:ownerId/:id/documents/:docId', requirePaAccess, notWhileHeld, async (req, res) => {
  const row = await essentialFor(req);
  if (!row) return res.status(404).json({ error: 'Not found.' });

  const doc = await db.prepare('SELECT * FROM documents WHERE id = ? AND essential_id = ?')
    .get(req.params.docId, row.id);
  if (!doc || !canSee(doc.sensitivity, viewerContext(req))) {
    return res.status(404).json({ error: 'Not found.' });
  }

  await documents.remove(doc.id);
  await logAccess({
    actorId: req.user.id, ownerId: req.principal.id, essentialId: row.id,
    action: 'delete', field: row.field,
  });
  res.status(204).end();
});

module.exports = { router, logAccess };
