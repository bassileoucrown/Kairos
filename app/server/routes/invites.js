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

/**
 * Invites addressed to you that you have not accepted.
 *
 * THE BUG THIS FIXES. An invite existed in exactly one place: an emailed link
 * holding a token. If that mail went to spam, or to an address somebody reads
 * once a week, or was simply skimmed past, the invitation was invisible to
 * everybody — the invitee never saw it, and the principal's Team screen said
 * "Invited" as though something had happened. A principal would then find that
 * their PA could not be @-mentioned, handed a note, or given anything at all,
 * with nothing on any screen explaining why.
 *
 * That is worst precisely where it should be easiest: when the person already
 * holds a Kairos account. They are signed in, they are one tap from accepting,
 * and we were sending them an email and hoping.
 *
 * MUST STAY ABOVE '/:token'. Express matches in order, so a literal route
 * declared after a parameter route is never reached — '/waiting' would be read
 * as a token and 404 forever.
 */
router.get('/waiting', requireAuth, async (req, res) => {
  const email = String(req.user.email || '').toLowerCase();

  const offices = await db.prepare(`
    SELECT m.id, m.role, m.invite_token, m.created_at, u.name AS owner_name
      FROM memberships m
      JOIN users u ON u.id = m.owner_id
     WHERE lower(m.invited_email) = ? AND m.status = 'invited'
     ORDER BY m.created_at DESC
  `).all(email);

  const households = await db.prepare(`
    SELECT h.id, h.job_title, h.invite_token, h.created_at, u.name AS owner_name
      FROM household_members h
      JOIN users u ON u.id = h.owner_id
     WHERE lower(h.invited_email) = ? AND h.status = 'invited'
     ORDER BY h.created_at DESC
  `).all(email);

  res.json({
    invites: [
      ...offices.map((m) => ({
        token: m.invite_token,
        ownerName: m.owner_name,
        roleLabel: roleLabel(m.role),
        kind: 'office',
        createdAt: m.created_at,
      })),
      ...households.map((h) => ({
        token: h.invite_token,
        ownerName: h.owner_name,
        roleLabel: h.job_title || 'Household',
        kind: 'household',
        createdAt: h.created_at,
      })),
    ].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
  });
});

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
  // STRICTLY LIMITED TO TITLES THAT CARRY IDENTICAL ACCESS, and that set
  // shrank. `chief_of_staff` used to be in it; it is not any more, because
  // routes/report.js now lets a Chief of Staff read the whole office's line
  // while a PA reads only their own. The moment a title started meaning
  // something, letting the invitee choose it stopped being cosmetic:
  //
  //   UPWARDS it was exactly the escalation the paragraph above says it
  //   prevents. account_category is typed at signup and verified by nobody, so
  //   somebody invited as a PA could describe themselves as Chief of Staff and
  //   arrive holding sight of every colleague's week.
  //
  //   DOWNWARDS it quietly discarded a decision the principal had made. They
  //   appoint a Chief of Staff, that person signed up as a PA months earlier,
  //   and the appointment evaporates on accept with nobody told.
  //
  // So adoption is allowed only where it changes the name and nothing else.
  // Becoming a Chief of Staff — or ceasing to be one — is the principal's act,
  // through Team, where they can see what they are granting.
  const EQUAL_ACCESS = new Set(['pa', 'ea']);
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
