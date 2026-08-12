const express = require('express');
const { asyncRouter } = require('../lib/asyncRouter');
const db = require('../lib/db');
const { requireAuth } = require('../lib/auth');
const { roleLabel } = require('../lib/roles');
const { buildDay } = require('./itinerary');
const { directLineFor } = require('../lib/directLine');

const router = asyncRouter();
router.use(requireAuth);

// The assistant's own dashboard.
//
// Deliberately not the principal's screen with a different name on it. An
// assistant's question is "what is outstanding across everyone I support" —
// which principal is not something they should have to pick before the app
// will tell them anything. So this is one screen, spanning every principal,
// and the switcher is for going *into* one of them rather than a prerequisite
// for seeing anything at all.
router.get('/', async (req, res) => {
  const now = new Date();
  const nowIso = now.toISOString();

  const memberships = await db.prepare(`
    SELECT m.role, m.can_manage_scheduling, u.id, u.name, u.slug, u.timezone
    FROM memberships m
    JOIN users u ON u.id = m.owner_id
    WHERE m.member_user_id = ? AND m.status = 'active'
    ORDER BY u.name
  `).all(req.user.id);

  const principals = [];
  for (const m of memberships) {
    const tz = m.timezone || 'UTC';
    const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now);
    // The assistant's view, so drafts are included — this is their work queue.
    const entries = await buildDay({ id: m.id, timezone: tz }, dayKey, { viewerIsPrincipal: false });
    const confirmed = entries.filter((e) => e.status === 'confirmed');

    const pendingApprovals = await db.prepare(
      "SELECT COUNT(*) AS n FROM bookings WHERE owner_id = ? AND status = 'pending'",
    ).get(m.id);

    principals.push({
      id: m.id,
      name: m.name,
      slug: m.slug,
      timezone: tz,
      role: m.role,
      roleLabel: roleLabel(m.role),
      canManageScheduling: !!m.can_manage_scheduling,
      localDate: dayKey,
      localTime: new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(now),
      itemsToday: confirmed.length,
      nextUp: confirmed.find((e) => new Date(e.startAt) > now) || null,
      pendingApprovals: pendingApprovals?.n || 0,
      directLine: await directLineFor(m.id, req.user.id),
    });
  }

  const principalIds = principals.map((p) => p.id);
  const placeholders = principalIds.map(() => '?').join(',');

  // Everything this assistant has in flight, across all of them. Drafts are
  // theirs; proposals are with the principal and the wait is the point, so
  // both are worth showing and they are worth showing apart.
  let drafts = [];
  let awaitingDecision = [];
  let recentlyDecided = [];
  if (principalIds.length > 0) {
    const rows = await db.prepare(`
      SELECT i.*, u.name AS principal_name FROM itinerary_items i
      JOIN users u ON u.id = i.owner_id
      WHERE i.owner_id IN (${placeholders}) AND i.created_by = ?
      ORDER BY i.start_at ASC
    `).all(...principalIds, req.user.id);

    const map = (i) => ({
      id: i.id,
      principalId: i.owner_id,
      principalName: i.principal_name,
      kind: i.kind,
      title: i.title,
      startAt: i.start_at,
      endAt: i.end_at,
      location: i.location,
      destination: i.destination,
      status: i.status,
      proposalNote: i.proposal_note,
      proposedAt: i.proposed_at,
      decisionNote: i.decision_note,
      decidedAt: i.decided_at,
    });

    drafts = rows.filter((i) => i.status === 'draft' && !i.decided_at).map(map);
    awaitingDecision = rows.filter((i) => i.status === 'proposed').map(map);
    // A decline lands the item back in drafts with a note attached. Surfacing
    // those separately is the difference between "the principal said no" and
    // an item that quietly reappears in a list of forty.
    recentlyDecided = rows
      .filter((i) => i.decided_at && (i.status === 'confirmed' || i.decision_note))
      .sort((a, b) => (b.decided_at || '').localeCompare(a.decided_at || ''))
      .slice(0, 10)
      .map((i) => ({ ...map(i), approved: i.status === 'confirmed' }));
  }

  // The assistant's own tasks — their work, not a principal's.
  const myTasks = (await db.prepare(`
    SELECT t.id, t.title, t.due_at, t.status, t.priority, s.name AS space_name
    FROM tasks t
    JOIN spaces s ON s.id = t.space_id
    WHERE t.assignee_id = ? AND t.status != 'done'
    ORDER BY t.due_at IS NULL, t.due_at ASC
    LIMIT 20
  `).all(req.user.id)).map((t) => ({
    id: t.id, title: t.title, dueAt: t.due_at, status: t.status,
    priority: t.priority, spaceName: t.space_name,
    overdue: !!(t.due_at && t.due_at <= nowIso),
  }));

  res.json({
    user: { id: req.user.id, name: req.user.name, accountCategory: req.user.account_category },
    principals,
    drafts,
    awaitingDecision,
    recentlyDecided,
    myTasks,
    counts: {
      principals: principals.length,
      drafts: drafts.length,
      awaitingDecision: awaitingDecision.length,
      approvalsAcrossPrincipals: principals.reduce((n, p) => n + p.pendingApprovals, 0),
      overdueTasks: myTasks.filter((t) => t.overdue).length,
    },
  });
});

module.exports = router;
