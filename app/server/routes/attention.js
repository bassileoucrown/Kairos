const express = require('express');
const { asyncRouter } = require('../lib/asyncRouter');
const db = require('../lib/db');
const { requireAuth } = require('../lib/auth');
const { unreadMessageCount } = require('../lib/spaceAccess');

// What is waiting for you, everywhere at once.
//
// The rail already carried two counts, each fetched by its own request from
// its own screen's endpoint. That worked while there were two. The moment
// somebody wants to open the menu and see where there is something new — which
// is the only reason a rail is worth opening on a phone — every one of them
// has to be known before the first paint, and five round trips to five
// endpoints that each compute a whole screen's worth of data to return a
// number is the wrong shape.
//
// So: one request, counts only, nothing that reveals what the thing is. A
// number is the least a badge can be built on and the least that can leak.
//
// SCOPING. Some of these belong to a principal and some belong to you.
// Approvals are the principal's queue and follow the switcher. Unread
// messages, tasks and notices are yours and follow you between principals —
// switching whose diary you are managing does not change which messages you
// have read.

const router = asyncRouter();
router.use(requireAuth);

/** Pending requests in a principal's approval queue, if you may see it. */
async function approvalsFor(userId, principalId) {
  if (!principalId) return 0;
  // The same access rule as the queue itself: your own account, or one that
  // has actively delegated to you. Anything else counts as nothing rather
  // than erroring, because a rail must not be able to fail a page.
  if (principalId !== userId) {
    const member = await db.prepare(
      "SELECT 1 FROM memberships WHERE owner_id = ? AND member_user_id = ? AND status = 'active'",
    ).get(principalId, userId);
    if (!member) return 0;
  }
  const row = await db.prepare("SELECT COUNT(*) AS n FROM bookings WHERE owner_id = ? AND status = 'pending'")
    .get(principalId);
  return Number(row?.n || 0);
}

router.get('/', async (req, res) => {
  const userId = req.user.id;
  const principalId = req.query.principalId || userId;

  const [approvals, notices, messages, tasks, requests] = await Promise.all([
    approvalsFor(userId, principalId),

    // Announcements published to you that you have not opened.
    db.prepare(`
      SELECT COUNT(*) AS n FROM announcements a
      WHERE a.published_at IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM announcement_reads r WHERE r.announcement_id = a.id AND r.user_id = ?
        )
    `).get(userId).then((r) => Number(r?.n || 0)),

    unreadMessageCount(userId),

    // Work put on you by somebody else and not yet finished. Tasks you set
    // yourself are excluded: a rail that lit up for your own to-do list would
    // be lit permanently, and a permanent light is not a signal.
    db.prepare(`
      SELECT COUNT(*) AS n FROM tasks
      WHERE assignee_id = ? AND created_by != ? AND status != 'done'
    `).get(userId, userId).then((r) => Number(r?.n || 0)),

    // Arrangements an assistant has sent for your decision. Only ever yours:
    // a proposal is addressed to the principal, so it is not the assistant's
    // attention it is waiting on.
    db.prepare("SELECT COUNT(*) AS n FROM itinerary_items WHERE owner_id = ? AND status = 'proposed'")
      .get(userId).then((r) => Number(r?.n || 0)),
  ]);

  res.json({
    principalId,
    counts: { approvals, notices, messages, tasks, requests },
    // One number for the menu button itself, which on a phone is all that is
    // on screen. Without it, a rail that has to be opened to discover there is
    // nothing in it is a rail nobody opens.
    total: approvals + notices + messages + tasks + requests,
  });
});

/**
 * Everything waiting on you, across every principal at once.
 *
 * WHY THIS EXISTS. The endpoint above answers for ONE principal, because the
 * rail follows the switcher. That is right for a principal, who has only their
 * own day, and wrong for an assistant, who has three. An assistant supporting
 * three people had to switch three times to find out whether anything was
 * waiting — and switching is not free: it re-scopes every screen, so the act of
 * checking moves you away from what you were doing.
 *
 * This is the surface an assistant-led account lands on. It answers the only
 * question they open the app to ask: whose day needs me first.
 *
 * WHAT IS COUNTED PER PRINCIPAL, and what is not. Approvals belong to a
 * principal's queue and differ between them, so they are broken out. Notices,
 * unread messages and tasks follow YOU between principals — counting them once
 * per principal would report the same four unread messages three times and turn
 * a worklist into a wrong number. They stay on the endpoint above.
 *
 * WHOSE QUEUES. Only principals with an ACTIVE membership, and yourself. A
 * revoked assistant is not a former assistant with a smaller list; they are a
 * stranger, and a stranger sees nothing. bpadesk.js breaks this deliberately to
 * prove the assertion can fail.
 */
router.get('/across', async (req, res) => {
  const userId = req.user.id;

  const mine = await db.prepare(`
    SELECT u.id, u.name, u.slug, u.timezone, m.role
    FROM memberships m
    JOIN users u ON u.id = m.owner_id
    WHERE m.member_user_id = ? AND m.status = 'active'
  `).all(userId);

  const self = await db.prepare('SELECT id, name, slug, timezone FROM users WHERE id = ?').get(userId);
  const rows = [
    { id: self.id, name: self.name, slug: self.slug, timezone: self.timezone, role: 'owner' },
    ...mine.map((m) => ({ id: m.id, name: m.name, slug: m.slug, timezone: m.timezone, role: m.role })),
  ];

  // One query per principal rather than one grouped query over every booking
  // in the table. The list is small — an assistant has a handful of principals,
  // not a page of them — and going through approvalsFor means the access rule
  // is the same function the single-principal endpoint uses. Two queries
  // answering one question is how the two drift apart.
  const principals = await Promise.all(rows.map(async (p) => ({
    ...p,
    approvals: await approvalsFor(userId, p.id),
  })));

  res.json({
    principals,
    total: principals.reduce((n, p) => n + p.approvals, 0),
    // Said plainly so a screen does not have to infer it from the length of the
    // list: an assistant with one principal and a principal with none both have
    // exactly one row here, and they are not the same account.
    supporting: mine.length,
  });
});

module.exports = router;
