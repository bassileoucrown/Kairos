const express = require('express');
const crypto = require('crypto');
const db = require('../lib/db');
const { requireAuth } = require('../lib/auth');
const { sendEmail } = require('../lib/email');

const router = express.Router();
router.use(requireAuth);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLES = new Set(['pa', 'delegate']);

function serialize(m) {
  return {
    id: m.id,
    invitedEmail: m.invited_email,
    memberName: m.member_name || null,
    role: m.role,
    status: m.status,
    canManageScheduling: !!m.can_manage_scheduling,
    createdAt: m.created_at,
  };
}

router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT m.*, u.name as member_name
    FROM memberships m
    LEFT JOIN users u ON u.id = m.member_user_id
    WHERE m.owner_id = ? AND m.status != 'revoked'
    ORDER BY m.created_at DESC
  `).all(req.user.id);
  res.json({ members: rows.map(serialize) });
});

router.post('/', (req, res) => {
  const { email, role } = req.body || {};
  if (!email || !EMAIL_RE.test(String(email).trim())) {
    return res.status(400).json({ error: 'Please provide a valid email address.' });
  }
  const cleanRole = ROLES.has(role) ? role : 'pa';
  const cleanEmail = String(email).trim().toLowerCase();

  if (cleanEmail === req.user.email) {
    return res.status(400).json({ error: "You can't invite yourself." });
  }
  const existing = db.prepare("SELECT 1 FROM memberships WHERE owner_id = ? AND invited_email = ? AND status != 'revoked'")
    .get(req.user.id, cleanEmail);
  if (existing) {
    return res.status(409).json({ error: 'This person already has an active invite or membership.' });
  }

  const id = crypto.randomUUID();
  const token = crypto.randomBytes(24).toString('hex');
  db.prepare(`
    INSERT INTO memberships (id, owner_id, member_user_id, invited_email, role, status, invite_token, created_at)
    VALUES (?, ?, NULL, ?, ?, 'invited', ?, ?)
  `).run(id, req.user.id, cleanEmail, cleanRole, token, new Date().toISOString());

  const roleLabel = cleanRole === 'pa' ? 'PA' : 'delegate';
  sendEmail({
    ownerId: req.user.id, toEmail: cleanEmail, category: 'invite',
    subject: `${req.user.name} invited you to Kairos as their ${roleLabel}`,
    body: `${req.user.name} added you as a ${roleLabel} on Kairos, giving you access to their scheduling — approvals, briefs, and contacts.\n\nAccept the invite: /accept-invite/${token}`,
  });

  const row = db.prepare(`
    SELECT m.*, u.name as member_name FROM memberships m LEFT JOIN users u ON u.id = m.member_user_id WHERE m.id = ?
  `).get(id);
  res.status(201).json({ member: serialize(row), inviteLink: `/accept-invite/${token}` });
});

// Availability and meeting types are delegated by default, because that is
// the job. This is how a principal who treats their own hours as personal
// takes it back — per assistant, without revoking everything else.
router.patch('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM memberships WHERE id = ? AND owner_id = ?')
    .get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Member not found.' });

  const { canManageScheduling } = req.body || {};
  if (canManageScheduling === undefined) return res.status(400).json({ error: 'Nothing to update.' });

  db.prepare('UPDATE memberships SET can_manage_scheduling = ? WHERE id = ?')
    .run(canManageScheduling ? 1 : 0, row.id);

  const updated = db.prepare(`
    SELECT m.*, u.name as member_name FROM memberships m
    LEFT JOIN users u ON u.id = m.member_user_id WHERE m.id = ?
  `).get(row.id);
  res.json({ member: serialize(updated) });
});

router.post('/:id/revoke', (req, res) => {
  const row = db.prepare('SELECT * FROM memberships WHERE id = ? AND owner_id = ?').get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Member not found.' });
  db.prepare("UPDATE memberships SET status = 'revoked' WHERE id = ?").run(row.id);
  res.status(204).end();
});

module.exports = router;
