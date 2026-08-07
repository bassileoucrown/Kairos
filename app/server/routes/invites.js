const express = require('express');
const db = require('../lib/db');
const { requireAuth } = require('../lib/auth');

const router = express.Router();

router.get('/:token', (req, res) => {
  const invite = db.prepare(`
    SELECT m.*, u.name as owner_name FROM memberships m
    JOIN users u ON u.id = m.owner_id
    WHERE m.invite_token = ?
  `).get(req.params.token);
  if (!invite) return res.status(404).json({ error: 'This invite link is invalid.' });
  if (invite.status === 'revoked') return res.status(410).json({ error: 'This invite has been revoked.' });

  res.json({
    invite: {
      ownerName: invite.owner_name,
      invitedEmail: invite.invited_email,
      role: invite.role,
      status: invite.status,
    },
  });
});

router.post('/:token/accept', requireAuth, (req, res) => {
  const invite = db.prepare('SELECT * FROM memberships WHERE invite_token = ?').get(req.params.token);
  if (!invite) return res.status(404).json({ error: 'This invite link is invalid.' });
  if (invite.status === 'revoked') return res.status(410).json({ error: 'This invite has been revoked.' });
  if (invite.invited_email !== req.user.email) {
    return res.status(403).json({ error: `This invite was sent to ${invite.invited_email}. Log in with that email to accept it.` });
  }

  db.prepare("UPDATE memberships SET member_user_id = ?, status = 'active' WHERE id = ?").run(req.user.id, invite.id);
  res.json({ ok: true });
});

module.exports = router;
