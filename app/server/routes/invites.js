const express = require('express');
const { asyncRouter } = require('../lib/asyncRouter');
const db = require('../lib/db');
const { requireAuth } = require('../lib/auth');
const { roleLabel } = require('../lib/roles');
const { ensureDirectLine } = require('../lib/directLine');

const router = asyncRouter();

router.get('/:token', async (req, res) => {
  const invite = await db.prepare(`
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
      roleLabel: roleLabel(invite.role),
      status: invite.status,
    },
  });
});

router.post('/:token/accept', requireAuth, async (req, res) => {
  const invite = await db.prepare('SELECT * FROM memberships WHERE invite_token = ?').get(req.params.token);
  if (!invite) return res.status(404).json({ error: 'This invite link is invalid.' });
  if (invite.status === 'revoked') return res.status(410).json({ error: 'This invite has been revoked.' });
  if (invite.invited_email !== req.user.email) {
    return res.status(403).json({ error: `This invite was sent to ${invite.invited_email}. Log in with that email to accept it.` });
  }

  // Let the person accepting correct their own title.
  //
  // An invitation usually goes out before the invitee has an account, so
  // there was nothing to read their title from and it defaulted to PA. Now
  // they are here and have told us what they are, so a Chief of Staff stops
  // being addressed as somebody's PA.
  //
  // Strictly limited to the three titles that carry identical access. A
  // `delegate` invitation is narrower on purpose, and letting the invitee
  // swap it for a full-access title would be privilege escalation by
  // self-description — the principal decides remit, the person decides only
  // what they are called.
  const EQUAL_ACCESS = new Set(['pa', 'ea', 'chief_of_staff']);
  const claimed = req.user.account_category;
  const adoptTitle = EQUAL_ACCESS.has(invite.role) && EQUAL_ACCESS.has(claimed) && claimed !== invite.role;

  await db.prepare(`
    UPDATE memberships SET member_user_id = ?, status = 'active', role = ? WHERE id = ?
  `).run(req.user.id, adoptTitle ? claimed : invite.role, invite.id);

  // They can talk to the principal from this moment, without anyone having
  // to think about setting a room up.
  await ensureDirectLine(invite.owner_id);

  res.json({ ok: true });
});

module.exports = router;
