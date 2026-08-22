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

module.exports = router;
