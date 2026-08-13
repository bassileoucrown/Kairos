const express = require('express');
const { asyncRouter } = require('../lib/asyncRouter');
const db = require('../lib/db');
const { requireAuth } = require('../lib/auth');
const { roleLabel } = require('../lib/roles');
const { ensureDirectLine } = require('../lib/directLine');

const router = asyncRouter();

// Household staff are invited from a different table, but arriving at a link
// and being told it is invalid because it is the wrong *kind* of invitation
// would be nonsense to the person holding it. One URL, both rosters.
async function findHouseholdInvite(token) {
  return db.prepare(`
    SELECT h.*, u.name as owner_name FROM household_members h
    JOIN users u ON u.id = h.owner_id
    WHERE h.invite_token = ?
  `).get(token);
}

router.get('/:token', async (req, res) => {
  const household = await findHouseholdInvite(req.params.token);
  if (household) {
    if (household.status === 'revoked') return res.status(410).json({ error: 'This invite has been revoked.' });
    return res.json({
      invite: {
        ownerName: household.owner_name,
        invitedEmail: household.invited_email,
        role: 'household',
        roleLabel: household.job_title || 'Household',
        status: household.status,
        // Said on the page they accept from, not buried in terms. Somebody
        // joining a stranger's household account deserves to know the shape
        // of it before they agree.
        scope: 'You will see what you have been asked to do, and can confirm you have it. '
          + 'You will not see their calendar, their contacts, or anything else.',
      },
    });
  }

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
  const household = await findHouseholdInvite(req.params.token);
  if (household) {
    if (household.status === 'revoked') return res.status(410).json({ error: 'This invite has been revoked.' });
    if (household.invited_email !== req.user.email) {
      return res.status(403).json({ error: `This invite was sent to ${household.invited_email}. Log in with that email to accept it.` });
    }
    await db.prepare(`
      UPDATE household_members SET member_user_id = ?, status = 'active', name = ? WHERE id = ?
    `).run(req.user.id, household.name || req.user.name, household.id);

    // Onboarding is "set up your bookable calendar", and a driver accepting a
    // household post has no use for a meeting type. Making them name one
    // before they can read what they have been asked to do is the app talking
    // about itself. Their handle was assigned at signup, so nothing is
    // skipped that they actually need.
    if (req.user.onboarding_step !== 'done') {
      await db.prepare("UPDATE users SET onboarding_step = 'done' WHERE id = ?").run(req.user.id);
    }
    // No direct line, no space, no membership row. Accepting a household post
    // grants exactly one thing: the instructions addressed to you.
    return res.json({ ok: true, kind: 'household' });
  }

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
