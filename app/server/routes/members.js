const express = require('express');
const { asyncRouter } = require('../lib/asyncRouter');
const crypto = require('crypto');
const db = require('../lib/db');
const { requireAuth } = require('../lib/auth');
const { sendEmail } = require('../lib/email');
const { isAssistantRole, roleLabel, roleForAccountCategory, ASSISTANT_ROLES } = require('../lib/roles');

const router = asyncRouter();
router.use(requireAuth);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function serialize(m) {
  return {
    id: m.id,
    invitedEmail: m.invited_email,
    memberName: m.member_name || null,
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
    subject: `${req.user.name} invited you to Kairos as their ${label}`,
    body: `${req.user.name} added you as their ${label} on Kairos, giving you access to their scheduling — approvals, briefs, and contacts.\n\nAccept the invite: /accept-invite/${token}`,
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

router.post('/:id/revoke', async (req, res) => {
  const row = await db.prepare('SELECT * FROM memberships WHERE id = ? AND owner_id = ?').get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Member not found.' });
  await db.prepare("UPDATE memberships SET status = 'revoked' WHERE id = ?").run(row.id);
  res.status(204).end();
});

module.exports = router;
