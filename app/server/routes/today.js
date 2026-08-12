const express = require('express');
const { asyncRouter } = require('../lib/asyncRouter');
const db = require('../lib/db');
const { requireAuth } = require('../lib/auth');
const { requirePaAccess } = require('../lib/paAccess');
const { listVisibleSpaces } = require('../lib/spaceAccess');
const { daysUntilNextOccurrence } = require('../lib/relationships');
const { buildDay } = require('./itinerary');
const { canSee, expiryState, daysUntil } = require('../lib/essentials');
const { directLineFor } = require('../lib/directLine');

const router = asyncRouter();
router.use(requireAuth);

// The landing screen assembled server-side in one request. Doing this in the
// client would mean five round-trips and five loading states for a screen
// whose whole job is answering "what needs me right now" at a glance.
router.get('/:ownerId', requirePaAccess, async (req, res) => {
  const tz = req.principal.timezone || 'UTC';
  const now = new Date();
  const todayKey = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now);
  const nowIso = now.toISOString();

  // --- The day itself: itinerary + bookings, merged ---
  const viewerIsPrincipal = req.paRole === 'owner';
  const schedule = await buildDay(req.principal, todayKey, { viewerIsPrincipal });
  const nextUp = schedule.find((e) => new Date(e.startAt) > now && e.status === 'confirmed') || null;

  // --- Bookings held for approval (Tier 3/4) ---
  const approvals = (await db.prepare(`
    SELECT b.id, b.booker_name, b.start_at, mt.name AS meeting_type_name, mt.access_tier
    FROM bookings b JOIN meeting_types mt ON mt.id = b.meeting_type_id
    WHERE b.owner_id = ? AND b.status = 'pending'
    ORDER BY b.start_at ASC
  `).all(req.principal.id)).map((b) => ({
    id: b.id, bookerName: b.booker_name, startAt: b.start_at,
    meetingTypeName: b.meeting_type_name, accessTier: b.access_tier,
  }));

  // --- Records in spaces I can see that I haven't acknowledged ---
  const visibleSpaceIds = (await listVisibleSpaces(req.user.id)).map((s) => s.id);
  let recordsAwaiting = [];
  if (visibleSpaceIds.length > 0) {
    const placeholders = visibleSpaceIds.map(() => '?').join(',');
    recordsAwaiting = (await db.prepare(`
      SELECT m.id, m.body, m.record_type, m.record_seq, m.created_at,
             t.id AS thread_id, t.name AS thread_name, s.context AS space_context, u.name AS author_name
      FROM messages m
      JOIN threads t ON t.id = m.thread_id
      JOIN spaces s ON s.id = t.space_id
      JOIN users u ON u.id = m.author_id
      WHERE t.space_id IN (${placeholders})
        AND m.register = 'record'
        AND m.record_status = 'open'
        AND NOT EXISTS (SELECT 1 FROM message_acks a WHERE a.message_id = m.id AND a.user_id = ?)
      ORDER BY m.created_at DESC
      LIMIT 20
    `).all(...visibleSpaceIds, req.user.id)).map((m) => ({
      id: m.id, body: m.body, recordType: m.record_type, recordSeq: m.record_seq,
      threadId: m.thread_id, threadName: m.thread_name,
      spaceContext: m.space_context, authorName: m.author_name, createdAt: m.created_at,
    }));
  }

  // --- My tasks: overdue and due today, across every context ---
  const taskRows = await db.prepare(`
    SELECT t.*, s.name AS space_name, s.context AS space_context, p.name AS project_name
    FROM tasks t
    JOIN spaces s ON s.id = t.space_id
    LEFT JOIN projects p ON p.id = t.project_id
    WHERE t.assignee_id = ? AND t.status != 'done' AND t.due_at IS NOT NULL
    ORDER BY t.due_at ASC
  `).all(req.user.id);

  const visible = new Set(visibleSpaceIds);
  const mapTask = (t) => ({
    id: t.id, title: t.title, dueAt: t.due_at, status: t.status, priority: t.priority,
    spaceId: t.space_id, spaceName: t.space_name, spaceContext: t.space_context,
    projectId: t.project_id, projectName: t.project_name,
  });
  const overdueTasks = taskRows.filter((t) => visible.has(t.space_id) && t.due_at <= nowIso).map(mapTask);
  const todayTasks = taskRows.filter((t) => visible.has(t.space_id) && t.due_at > nowIso
    && new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(t.due_at)) === todayKey).map(mapTask);

  // --- Stages blocked or overdue on this principal's work ---
  const blockedStages = (await db.prepare(`
    SELECT st.id, st.name, st.status, st.due_at, p.id AS project_id, p.name AS project_name
    FROM project_stages st
    JOIN projects p ON p.id = st.project_id
    JOIN spaces s ON s.id = p.space_id
    WHERE s.owner_id = ? AND st.status = 'blocked'
    ORDER BY st.due_at IS NULL, st.due_at ASC
    LIMIT 10
  `).all(req.principal.id)).map((s) => ({
    id: s.id, name: s.name, dueAt: s.due_at, projectId: s.project_id, projectName: s.project_name,
  }));

  // --- Relationship dates worth a nudge (already-built Contact Intelligence) ---
  const relationships = [];
  for (const c of await db.prepare(`
    SELECT * FROM contacts WHERE owner_id = ? AND (birthday IS NOT NULL OR anniversary IS NOT NULL)
  `).all(req.principal.id)) {
    for (const kind of ['birthday', 'anniversary']) {
      const md = c[kind];
      if (!md) continue;
      const days = daysUntilNextOccurrence(md);
      if (days !== null && days <= 7) {
        relationships.push({
          contactId: c.id, name: c.name || c.email, kind, daysUntil: days,
          relationshipTier: c.relationship_tier,
        });
      }
    }
  }
  relationships.sort((a, b) => a.daysUntil - b.daysUntil);

  // --- Itinerary an assistant has sent over for a decision ---
  //
  // These are already on the schedule above, marked pending. Listing them
  // again here is deliberate: "somewhere on today's timeline there is a thing
  // waiting on you" is not something anyone should have to scan for.
  const itineraryRequests = (await db.prepare(`
    SELECT i.id, i.kind, i.title, i.start_at, i.end_at, i.location, i.destination,
           i.proposal_note, i.proposed_at, u.name AS created_by_name
    FROM itinerary_items i
    LEFT JOIN users u ON u.id = i.created_by
    WHERE i.owner_id = ? AND i.status = 'proposed'
    ORDER BY i.start_at ASC
  `).all(req.principal.id)).map((i) => ({
    id: i.id, kind: i.kind, title: i.title, startAt: i.start_at, endAt: i.end_at,
    location: i.location, destination: i.destination,
    proposalNote: i.proposal_note, proposedAt: i.proposed_at,
    requestedBy: i.created_by_name,
  }));

  // --- Documents about to lapse ---
  //
  // The most expensive thing on the whole list to forget: a passport under
  // six months' validity turns someone away at check-in, and by the time it
  // has actually expired the trip is already lost. Never carries a value —
  // only that something needs renewing.
  const viewerCtx = { isOwner: viewerIsPrincipal, role: req.paRole };
  const expiring = (await db.prepare(`
    SELECT id, label, field, expires_on, sensitivity
    FROM essentials
    WHERE owner_id = ? AND expires_on IS NOT NULL
    ORDER BY expires_on ASC
  `).all(req.principal.id))
    .filter((e) => canSee(e.sensitivity, viewerCtx))
    .filter((e) => expiryState(e.expires_on))
    .map((e) => ({
      id: e.id,
      label: e.label,
      field: e.field,
      expiresOn: e.expires_on,
      daysUntil: daysUntil(e.expires_on),
      state: expiryState(e.expires_on),
    }));

  const needsYouCount = approvals.length + recordsAwaiting.length + overdueTasks.length
    + blockedStages.length + itineraryRequests.length + expiring.length;

  const directLine = await directLineFor(req.principal.id, req.user.id);

  res.json({
    date: todayKey,
    directLine,
    timezone: tz,
    principal: { id: req.principal.id, name: req.principal.name },
    isSelf: req.principal.id === req.user.id,
    viewerIsPrincipal,
    schedule,
    nextUp,
    needsYou: {
      approvals, recordsAwaiting, overdueTasks, blockedStages, itineraryRequests,
      expiring,
      count: needsYouCount,
    },
    todayTasks,
    relationships,
  });
});

module.exports = router;
