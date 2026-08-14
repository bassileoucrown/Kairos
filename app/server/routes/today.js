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
const { serializeInstruction } = require('../lib/household');
const { dueBand } = require('../lib/reminders');
const { timezoneOn: tripTimezoneOn, tripOn } = require('../lib/trips');

const router = asyncRouter();
router.use(requireAuth);

// The landing screen assembled server-side in one request. Doing this in the
// client would mean five round-trips and five loading states for a screen
// whose whole job is answering "what needs me right now" at a glance.
router.get('/:ownerId', requirePaAccess, async (req, res) => {
  const homeTz = req.principal.timezone || 'UTC';
  const now = new Date();

  // Which day it is depends on where they are standing.
  //
  // This used to be the timezone on the principal's profile, always — so a
  // week in London was drawn in Lagos time: the day began and ended at the
  // wrong moment, a 09:00 meeting showed as 08:00, and the delay cascade
  // reasoned about gaps against the wrong wall clock. A confirmed trip moves
  // it. Nothing else does: a draft is an assistant's working copy and must not
  // silently redraw the principal's week.
  //
  // Deliberately resolved twice — the home day first, because "which local
  // date is it" is itself a question that needs a zone to answer, and only a
  // trip covering that date changes it.
  const homeKey = new Intl.DateTimeFormat('en-CA', { timeZone: homeTz }).format(now);
  const tz = await tripTimezoneOn(req.principal.id, homeKey, homeTz);
  const todayKey = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now);
  const nowIso = now.toISOString();
  const awayTrip = tz !== homeTz ? await tripOn(req.principal.id, todayKey) : null;

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

  // --- My tasks: close to due, past due, and due today, across every context ---
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

  // A deadline is worth surfacing BEFORE it passes.
  //
  // This used to list only tasks already overdue, which meant the first time a
  // principal saw one in "what needs you" it was too late to do anything but
  // apologise. The vault has warned six months ahead of a passport expiry from
  // the beginning, on exactly this reasoning; a task that costs something to
  // miss deserves the same courtesy.
  //
  // How far ahead depends on what missing it costs, via lib/reminders — three
  // days for a high priority, a day for an ordinary one, eight hours for a low
  // one — so the same definition of "close" drives the screen and the emails.
  const nowMs = now.getTime();
  const dueTasks = taskRows
    .filter((t) => visible.has(t.space_id))
    .map((t) => ({ t, band: dueBand(t.due_at, nowMs, t.priority) }))
    .filter(({ band }) => band === 'due_soon' || band === 'overdue')
    .map(({ t, band }) => ({ ...mapTask(t), band }));

  const alreadyListed = new Set(dueTasks.map((t) => t.id));
  // Anything already sitting in "what needs you" is not repeated in the
  // day's task list — one screen showing the same task twice is noise.
  const todayTasks = taskRows.filter((t) => visible.has(t.space_id) && !alreadyListed.has(t.id)
    && t.due_at > nowIso
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

  // Household instructions nobody has confirmed seeing. Silent until it is
  // too late — an unread word to the driver is a missed flight — so it earns
  // a place in what needs you rather than a screen you have to think to open.
  // Only the principal and their full-access assistants see this; a delegate's
  // remit is the diary, and the household is not the diary.
  const householdCanSee = viewerIsPrincipal || ['pa', 'ea', 'chief_of_staff'].includes(req.paRole);
  const unconfirmedInstructions = householdCanSee ? (await db.prepare(`
    SELECT i.*, u.name AS author_name, hm.name AS member_name, hm.job_title
    FROM household_instructions i
    JOIN household_members hm ON hm.id = i.member_id
    JOIN users u ON u.id = i.author_id
    WHERE i.owner_id = ? AND i.status = 'open'
    ORDER BY i.due_at IS NULL, i.due_at ASC
    LIMIT 10
  `).all(req.principal.id)).map((i) => serializeInstruction(i)) : [];

  const needsYouCount = approvals.length + recordsAwaiting.length + dueTasks.length
    + blockedStages.length + itineraryRequests.length + expiring.length
    + unconfirmedInstructions.length;

  const directLine = await directLineFor(req.principal.id, req.user.id);

  res.json({
    date: todayKey,
    directLine,
    timezone: tz,
    homeTimezone: homeTz,
    // Set only when the two differ, so the screen can say "you are on
    // London time" rather than leaving somebody to wonder why their day
    // starts at an odd hour.
    away: awayTrip && { tripId: awayTrip.id, name: awayTrip.name, destination: awayTrip.destination },
    principal: { id: req.principal.id, name: req.principal.name },
    isSelf: req.principal.id === req.user.id,
    viewerIsPrincipal,
    schedule,
    nextUp,
    needsYou: {
      approvals, recordsAwaiting, dueTasks, blockedStages, itineraryRequests,
      // Kept under the old name so an older client still shows something
      // sensible rather than an empty section during a rolling deploy.
      overdueTasks: dueTasks.filter((t) => t.band === 'overdue'),
      expiring, unconfirmedInstructions,
      count: needsYouCount,
    },
    todayTasks,
    relationships,
  });
});

module.exports = router;
