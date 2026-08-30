const express = require('express');
const { asyncRouter } = require('../lib/asyncRouter');
const crypto = require('crypto');
const db = require('../lib/db');
const { BRAND_FULL } = require('../lib/brand');
const { ensureDirectLine } = require('../lib/directLine');
const { requireAuth } = require('../lib/auth');
const { sendEmail } = require('../lib/email');
const { isAssistantRole, roleLabel, roleForAccountCategory, ASSISTANT_ROLES } = require('../lib/roles');
const { normalizeHandle, handleProblem } = require('../lib/handles');
const { limit, clientIp } = require('../lib/rateLimit');

const router = asyncRouter();
router.use(requireAuth);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function serialize(m) {
  return {
    id: m.id,
    invitedEmail: m.invited_email,
    memberName: m.member_name || null,
    // The account behind the invitation, once it has been accepted. Null while
    // the invite is outstanding — there is nobody to name yet. Needed by any
    // screen that has to say "this person", rather than "this invitation":
    // sharing a private trip is the first, and it takes a user id.
    memberUserId: m.member_user_id || null,
    role: m.role,
    roleLabel: roleLabel(m.role),
    status: m.status,
    canManageScheduling: !!m.can_manage_scheduling,
    createdAt: m.created_at,
  };
}

// So the invite form offers the same titles onboarding asked about, from one
// definition, rather than a hard-coded list in the client drifting from the
// one the server will accept.
router.get('/roles', async (req, res) => {
  res.json({
    roles: Object.entries(ASSISTANT_ROLES).map(([id, r]) => ({
      id, label: r.label, description: r.description, fullAccess: r.fullAccess,
    })),
  });
});

router.get('/', async (req, res) => {
  const rows = await db.prepare(`
    SELECT m.*, u.name as member_name
    FROM memberships m
    LEFT JOIN users u ON u.id = m.member_user_id
    WHERE m.owner_id = ? AND m.status != 'revoked'
    ORDER BY m.created_at DESC
  `).all(req.user.id);
  res.json({ members: rows.map(serialize) });
});

/**
 * Name the person you work with, by their handle.
 *
 * WHICH WAY THIS GOES IS DECIDED BY WHO IS ASKING, not by a toggle on the
 * form. A principal naming their assistant is appointing them. An assistant
 * naming their principal is asking to be taken on — they cannot appoint
 * themselves to somebody else's account, and a screen that let them try would
 * be promising something the rest of the product would refuse. So:
 *
 *   principal names an assistant  -> an invitation, as though from Team
 *   assistant names a principal   -> a request, which the principal approves
 *
 * THE ANSWER IS THE SAME EITHER WAY AND WHETHER OR NOT THE HANDLE EXISTS.
 * Handles are deliberately not a directory — resolving one for a stranger
 * returns nothing, indistinguishable from a typo — and an endpoint that said
 * "no such handle" would hand back exactly the lookup the rest of the design
 * refuses. Same reasoning as the connection request and the password reset.
 */
// Both directions of this send mail with somebody's name on it to an address
// the caller need not know, so it is limited per caller and per source. This
// is also what keeps a declined request from becoming a way to pester
// somebody: asking again is allowed, asking twenty times an hour is not.
const connectLimiter = limit({
  limit: 20,
  windowMs: 60 * 60 * 1000,
  keys: (req) => [`connect-member:${req.user.id}`, `connect-member-ip:${clientIp(req)}`],
  message: 'Too many invitations for one hour. Try again later.',
});

router.post('/connect', connectLimiter, async (req, res) => {
  const handle = normalizeHandle(req.body?.handle);
  const now = new Date().toISOString();

  const same = () => res.status(202).json({
    ok: true,
    message: `Sent. If @${handle} belongs to someone, they will see it.`,
  });

  if (handleProblem(handle)) return same();

  // Looked up directly rather than through resolveVisibleHandle: at onboarding
  // there is by definition no relationship yet, which is the whole point of
  // the step. Nothing about the result reaches the caller.
  const person = await db.prepare('SELECT id, name, email, account_category FROM users WHERE slug = ?')
    .get(handle);
  if (!person) return same();
  if (person.id === req.user.id) {
    // Safe to say plainly — they know their own handle.
    return res.status(400).json({ error: 'That is your own handle.' });
  }

  const iAmAssistant = isAssistantRole(req.user.account_category);
  const ownerId = iAmAssistant ? person.id : req.user.id;
  const assistant = iAmAssistant ? req.user : person;

  const existing = await db.prepare(
    "SELECT status FROM memberships WHERE owner_id = ? AND invited_email = ? AND status != 'revoked'",
  ).get(ownerId, assistant.email);
  // Answered plainly: a membership already existing means the caller knows
  // about this person, so precision reveals nothing new.
  if (existing) {
    return res.status(409).json({
      error: existing.status === 'active'
        ? 'You already work together.'
        : 'There is already an invitation or request between you.',
    });
  }

  const role = isAssistantRole(req.body?.role)
    ? req.body.role
    : roleForAccountCategory(assistant.account_category);
  const label = roleLabel(role);
  const id = crypto.randomUUID();

  if (iAmAssistant) {
    // A request. member_user_id is set from the start because we know exactly
    // who is asking — there is nobody to invite by email, they are already
    // here. It stays out of every 'active' query until the principal agrees.
    //
    // The token is filled in and never used. A request has no invite link to
    // follow — the principal approves it in place — but invite_token is NOT
    // NULL UNIQUE, so a row without one is rejected outright. The access-code
    // path already does the same for a membership that starts out active.
    await db.prepare(`
      INSERT INTO memberships (id, owner_id, member_user_id, invited_email, role, status, invite_token, created_at)
      VALUES (?, ?, ?, ?, ?, 'requested', ?, ?)
    `).run(id, ownerId, req.user.id, req.user.email, role,
      crypto.randomBytes(24).toString('hex'), now);

    await sendEmail({
      ownerId, toEmail: person.email, category: 'invite',
      subject: `${req.user.name} would like to work with you on ${BRAND_FULL}`,
      body: `${req.user.name} says they are your ${label} and has asked for access to your `
        + 'scheduling — approvals, briefs, contacts and itinerary.'
        + '\n\nNothing has been granted. Approve or decline it from your Team screen.',
    });
    return same();
  }

  const token = crypto.randomBytes(24).toString('hex');
  await db.prepare(`
    INSERT INTO memberships (id, owner_id, member_user_id, invited_email, role, status, invite_token, created_at)
    VALUES (?, ?, NULL, ?, ?, 'invited', ?, ?)
  `).run(id, ownerId, person.email, role, token, now);

  await sendEmail({
    ownerId, toEmail: person.email, category: 'invite',
    subject: `${req.user.name} invited you to ${BRAND_FULL} as their ${label}`,
    body: `${req.user.name} added you as their ${label} on ${BRAND_FULL}, giving you access to their `
      + `scheduling — approvals, briefs, and contacts.\n\nAccept the invite: /accept-invite/${token}`,
  });
  return same();
});

/**
 * The principal's answer to a request.
 *
 * Approving is what actually grants access; until then a 'requested' row sits
 * outside every query that means "may act for this principal", so a pending
 * request is worth exactly nothing.
 *
 * Declining marks the row revoked rather than deleting it, which leaves the
 * decline on the record without making it a life sentence: a revoked row does
 * not block a fresh request, because people move jobs and principals change
 * their minds. What stops that becoming a way to pester somebody is the rate
 * limit on the asking, not a permanent bar.
 */
// Two named routes rather than one with a pattern in the parameter. A
// generic '/:id/:decision' sits in front of '/:id/revoke' and '/:id/role',
// and would swallow both the moment the pattern stopped being honoured —
// which is exactly the kind of breakage that looks like a permissions bug.
async function loadRequest(req, res, next) {
  const row = await db.prepare("SELECT * FROM memberships WHERE id = ? AND owner_id = ? AND status = 'requested'")
    .get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'No such request.' });
  req.request = row;
  next();
}

router.post('/:id/decline', loadRequest, async (req, res) => {
  await db.prepare("UPDATE memberships SET status = 'revoked' WHERE id = ?").run(req.request.id);
  res.json({ ok: true });
});

router.post('/:id/approve', loadRequest, async (req, res) => {
  const row = req.request;
  await db.prepare("UPDATE memberships SET status = 'active' WHERE id = ?").run(row.id);
  // The same thing accepting an invitation does, for the same reason: a
  // working relationship needs the direct line to exist.
  await ensureDirectLine(row.owner_id);
  await sendEmail({
    ownerId: row.owner_id, toEmail: row.invited_email, category: 'invite',
    subject: `${req.user.name} approved your request on ${BRAND_FULL}`,
    body: `You now have access to ${req.user.name}'s scheduling on ${BRAND_FULL}.`,
  });
  res.json({ ok: true });
});

router.post('/', async (req, res) => {
  const { email, role } = req.body || {};
  if (!email || !EMAIL_RE.test(String(email).trim())) {
    return res.status(400).json({ error: 'Please provide a valid email address.' });
  }
  const cleanEmail = String(email).trim().toLowerCase();

  // If this address already belongs to someone who told us at signup that
  // they are an EA or a Chief of Staff, default the invitation to that. Being
  // appointed under a title you didn't choose is a small thing that lands
  // every single time they open the app.
  let cleanRole;
  if (isAssistantRole(role)) {
    cleanRole = role;
  } else {
    const invitee = await db.prepare('SELECT account_category FROM users WHERE email = ?').get(cleanEmail);
    cleanRole = roleForAccountCategory(invitee?.account_category);
  }

  if (cleanEmail === req.user.email) {
    return res.status(400).json({ error: "You can't invite yourself." });
  }
  const existing = await db.prepare("SELECT 1 FROM memberships WHERE owner_id = ? AND invited_email = ? AND status != 'revoked'")
    .get(req.user.id, cleanEmail);
  if (existing) {
    return res.status(409).json({ error: 'This person already has an active invite or membership.' });
  }

  const id = crypto.randomUUID();
  const token = crypto.randomBytes(24).toString('hex');
  await db.prepare(`
    INSERT INTO memberships (id, owner_id, member_user_id, invited_email, role, status, invite_token, created_at)
    VALUES (?, ?, NULL, ?, ?, 'invited', ?, ?)
  `).run(id, req.user.id, cleanEmail, cleanRole, token, new Date().toISOString());

  const label = roleLabel(cleanRole);
  await sendEmail({
    ownerId: req.user.id, toEmail: cleanEmail, category: 'invite',
    subject: `${req.user.name} invited you to ${BRAND_FULL} as their ${label}`,
    body: `${req.user.name} added you as their ${label} on ${BRAND_FULL}, giving you access to their scheduling — approvals, briefs, and contacts.\n\nAccept the invite: /accept-invite/${token}`,
  });

  const row = await db.prepare(`
    SELECT m.*, u.name as member_name FROM memberships m LEFT JOIN users u ON u.id = m.member_user_id WHERE m.id = ?
  `).get(id);
  res.status(201).json({ member: serialize(row), inviteLink: `/accept-invite/${token}` });
});

// Availability and meeting types are delegated by default, because that is
// the job. This is how a principal who treats their own hours as personal
// takes it back — per assistant, without revoking everything else.
router.patch('/:id', async (req, res) => {
  const row = await db.prepare('SELECT * FROM memberships WHERE id = ? AND owner_id = ?')
    .get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Member not found.' });

  const { canManageScheduling, role } = req.body || {};
  if (canManageScheduling === undefined && role === undefined) {
    return res.status(400).json({ error: 'Nothing to update.' });
  }
  if (role !== undefined && !isAssistantRole(role)) {
    return res.status(400).json({ error: 'Unknown role.' });
  }

  if (canManageScheduling !== undefined) {
    await db.prepare('UPDATE memberships SET can_manage_scheduling = ? WHERE id = ?')
      .run(canManageScheduling ? 1 : 0, row.id);
  }
  // Titles change — someone promoted from EA to Chief of Staff shouldn't have
  // to be revoked and re-invited to be called the right thing.
  if (role !== undefined) {
    await db.prepare('UPDATE memberships SET role = ? WHERE id = ?').run(role, row.id);
  }

  const updated = await db.prepare(`
    SELECT m.*, u.name as member_name FROM memberships m
    LEFT JOIN users u ON u.id = m.member_user_id WHERE m.id = ?
  `).get(row.id);
  res.json({ member: serialize(updated) });
});

/**
 * Send the invitation again, and hand back the link.
 *
 * An invite lived only in an email. When that mail went astray the invitation
 * was unreachable by everybody: the invitee never saw it, and the principal
 * had no way to try again short of revoking and re-inviting. The link comes
 * back in the response too, so it can be pasted into WhatsApp — which is how
 * this actually gets resolved between a principal and their PA.
 */
router.post('/:id/resend', async (req, res) => {
  const row = await db.prepare('SELECT * FROM memberships WHERE id = ? AND owner_id = ?')
    .get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Member not found.' });
  if (row.status !== 'invited') {
    return res.status(400).json({ error: 'They have already accepted.' });
  }

  const label = roleLabel(row.role);
  await sendEmail({
    ownerId: req.user.id, toEmail: row.invited_email, category: 'invite',
    subject: `Reminder: ${req.user.name} invited you to ${BRAND_FULL} as their ${label}`,
    body: `${req.user.name} added you as their ${label} on ${BRAND_FULL}.`
      + `\n\nAccept the invite: /accept-invite/${row.invite_token}`,
  });
  res.json({ inviteLink: `/accept-invite/${row.invite_token}` });
});

router.post('/:id/revoke', async (req, res) => {
  const row = await db.prepare('SELECT * FROM memberships WHERE id = ? AND owner_id = ?').get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Member not found.' });
  await db.prepare("UPDATE memberships SET status = 'revoked' WHERE id = ?").run(row.id);
  // A revoked assistant keeping a live line into the principal's team would
  // be a quiet and serious leak, so membership is resynced immediately.
  await ensureDirectLine(req.user.id);
  res.status(204).end();
});

module.exports = router;
