const express = require('express');
const { asyncRouter } = require('../lib/asyncRouter');
const crypto = require('crypto');
const db = require('../lib/db');
const { requireAuth } = require('../lib/auth');
const { resolveAccess, spaceAudience, listVisibleSpaces } = require('../lib/spaceAccess');
const mentions = require('../lib/mentions');

const router = asyncRouter();
router.use(requireAuth);

const PRIORITIES = new Set(['low', 'normal', 'high']);
const STATUSES = new Set(['open', 'doing', 'blocked', 'done']);

const SELECT_TASK = `
  SELECT t.*, u.name AS assignee_name, c.name AS creator_name,
         s.name AS space_name, s.context AS space_context,
         p.name AS project_name, st.name AS stage_name,
         th.id AS source_thread_id,
         pi.id AS source_pad_item_id
  FROM tasks t
  LEFT JOIN users u ON u.id = t.assignee_id
  JOIN users c ON c.id = t.created_by
  JOIN spaces s ON s.id = t.space_id
  LEFT JOIN projects p ON p.id = t.project_id
  LEFT JOIN project_stages st ON st.id = t.stage_id
  LEFT JOIN messages msg ON msg.id = t.source_message_id
  LEFT JOIN threads th ON th.id = msg.thread_id
  -- The other door in. A task promoted from the pad carries no source message
  -- — that is the whole point of the pad, a thought captured before it knows
  -- which room it belongs to — so the link back lives on the pad line, which
  -- points forward at the task. Followed backwards here so the task can lead
  -- to the conversation it came out of instead of being where one stopped.
  LEFT JOIN pad_items pi ON pi.task_id = t.id
`;

function serialize(t, found) {
  return {
    id: t.id,
    title: t.title,
    // A task's text is its title, so that is where an @ lives.
    mentions: found || [],
    status: t.status,
    priority: t.priority,
    dueAt: t.due_at,
    assigneeId: t.assignee_id,
    assigneeName: t.assignee_name,
    creatorName: t.creator_name,
    spaceId: t.space_id,
    spaceName: t.space_name,
    spaceContext: t.space_context,
    projectId: t.project_id,
    projectName: t.project_name,
    stageId: t.stage_id,
    stageName: t.stage_name,
    // Where the talking about this happens. A task is not a conversation and
    // should never try to be one — it is a title, an owner and a date — but it
    // must always be able to say where the conversation is, or assigning work
    // becomes the moment the discussion of it stops.
    sourceMessageId: t.source_message_id,
    sourceThreadId: t.source_thread_id,
    sourcePadItemId: t.source_pad_item_id || null,
    completedAt: t.completed_at,
    createdAt: t.created_at,
  };
}

/**
 * Serialize a list of tasks, resolving the @s in their titles.
 *
 * Grouped by space rather than resolved in one pass, because who can be
 * addressed depends on which room the task is in — and My Tasks deliberately
 * spans every space at once. One audience for all of them would either promise
 * a delivery across a boundary or deny one inside it. The grouping keeps it to
 * a couple of passes per space rather than one per task.
 */
async function serializeAll(rows, viewerId) {
  const bySpace = new Map();
  for (const t of rows) {
    if (!bySpace.has(t.space_id)) bySpace.set(t.space_id, []);
    bySpace.get(t.space_id).push(t);
  }
  const out = new Map();
  for (const [spaceId, tasks] of bySpace) {
    const space = await db.prepare('SELECT * FROM spaces WHERE id = ?').get(spaceId);
    if (!space) continue;
    const audience = await spaceAudience(space);
    const found = await mentions.forBodies(
      tasks.map((t) => t.title),
      { viewerId, ownerId: space.owner_id, audience },
    );
    tasks.forEach((t, i) => out.set(t.id, found[i]));
  }
  return rows.map((t) => serialize(t, out.get(t.id)));
}

async function loadTask(req, res, next) {
  const task = await db.prepare(`${SELECT_TASK} WHERE t.id = ?`).get(req.params.taskId);
  if (!task) return res.status(404).json({ error: 'Task not found.' });
  const access = await resolveAccess(task.space_id, req.user.id);
  if (!access) return res.status(404).json({ error: 'Task not found.' });
  req.task = task;
  req.access = access;
  next();
}

// Everything assigned to me, across every space I can see — the one list that
// spans contexts, which is why each row carries its context to be filtered by
// rather than being silently mixed together.
router.get('/mine', async (req, res) => {
  const rows = await db.prepare(`${SELECT_TASK} WHERE t.assignee_id = ? ORDER BY
    CASE t.status WHEN 'done' THEN 1 ELSE 0 END,
    CASE WHEN t.due_at IS NULL THEN 1 ELSE 0 END,
    t.due_at ASC, t.created_at DESC
  `).all(req.user.id);

  // Belt and braces: a task is only visible if its space still is. Membership
  // can be revoked after the task was assigned.
  const visible = new Set((await listVisibleSpaces(req.user.id)).map((s) => s.id));
  res.json({
    tasks: await serializeAll(rows.filter((t) => visible.has(t.space_id)), req.user.id),
  });
});

router.get('/', async (req, res) => {
  const { spaceId, projectId, stageId } = req.query;
  if (!spaceId && !projectId && !stageId) {
    return res.status(400).json({ error: 'Ask for a space, project, or stage.' });
  }

  let scopeSpaceId = spaceId;
  if (!scopeSpaceId && projectId) {
    scopeSpaceId = (await db.prepare('SELECT space_id FROM projects WHERE id = ?').get(projectId))?.space_id;
  }
  if (!scopeSpaceId && stageId) {
    scopeSpaceId = (await db.prepare(`
      SELECT p.space_id FROM project_stages s JOIN projects p ON p.id = s.project_id WHERE s.id = ?
    `).get(stageId))?.space_id;
  }
  if (!scopeSpaceId || !await resolveAccess(scopeSpaceId, req.user.id)) {
    return res.status(404).json({ error: 'Not found.' });
  }

  const where = ['t.space_id = ?'];
  const values = [scopeSpaceId];
  if (projectId) { where.push('t.project_id = ?'); values.push(projectId); }
  if (stageId) { where.push('t.stage_id = ?'); values.push(stageId); }

  const rows = await db.prepare(`${SELECT_TASK} WHERE ${where.join(' AND ')} ORDER BY
    CASE t.status WHEN 'done' THEN 1 ELSE 0 END,
    CASE WHEN t.due_at IS NULL THEN 1 ELSE 0 END,
    t.due_at ASC, t.created_at DESC
  `).all(...values);
  res.json({ tasks: await serializeAll(rows, req.user.id) });
});

router.post('/', async (req, res) => {
  const { spaceId, projectId, stageId, sourceMessageId, title, assigneeId, dueAt, priority } = req.body || {};
  if (!title || !String(title).trim()) return res.status(400).json({ error: 'Give the task a title.' });

  // A task made from a message inherits its space and stage from that message,
  // so the caller can't smuggle work into a space they can't reach.
  let resolvedSpaceId = spaceId;
  let resolvedStageId = stageId || null;
  let resolvedProjectId = projectId || null;

  if (sourceMessageId) {
    const src = await db.prepare(`
      SELECT th.space_id, th.project_id, th.stage_id FROM messages m
      JOIN threads th ON th.id = m.thread_id WHERE m.id = ?
    `).get(sourceMessageId);
    if (!src) return res.status(404).json({ error: 'Source message not found.' });
    resolvedSpaceId = src.space_id;
    resolvedStageId = src.stage_id;
    resolvedProjectId = src.project_id;
  }

  const access = resolvedSpaceId && await resolveAccess(resolvedSpaceId, req.user.id);
  if (!access) return res.status(404).json({ error: 'Space not found.' });
  if (!access.canWrite) return res.status(403).json({ error: 'You have read-only access here.' });

  if (priority !== undefined && !PRIORITIES.has(priority)) {
    return res.status(400).json({ error: 'Priority must be low, normal, or high.' });
  }
  // Only someone who can already see the space may be assigned work in it.
  if (assigneeId && !await resolveAccess(resolvedSpaceId, assigneeId)) {
    return res.status(400).json({ error: "That person doesn't have access to this space." });
  }

  const id = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO tasks (id, space_id, project_id, stage_id, source_message_id, title,
                       assignee_id, created_by, due_at, priority, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)
  `).run(id, resolvedSpaceId, resolvedProjectId, resolvedStageId, sourceMessageId || null,
    String(title).trim().slice(0, 300), assigneeId || null, req.user.id,
    dueAt || null, priority || 'normal', new Date().toISOString());

  const audience = await spaceAudience(access.space);
  const found = await mentions.of(String(title).trim(), {
    viewerId: req.user.id, ownerId: access.space.owner_id, audience,
  });
  await mentions.notify({
    found,
    author: req.user,
    ownerId: access.space.owner_id,
    subject: `${req.user.name} named you in a task`,
    where: `a task in "${access.space.name}"`,
  });

  const row = await db.prepare(`${SELECT_TASK} WHERE t.id = ?`).get(id);
  res.status(201).json({ task: serialize(row, found) });
});

router.patch('/:taskId', loadTask, async (req, res) => {
  if (!req.access.canWrite) return res.status(403).json({ error: 'You have read-only access here.' });
  const { title, status, priority, dueAt, assigneeId } = req.body || {};
  const updates = [];
  const values = [];

  if (title !== undefined) {
    if (!String(title).trim()) return res.status(400).json({ error: 'Give the task a title.' });
    updates.push('title = ?'); values.push(String(title).trim().slice(0, 300));
  }
  if (status !== undefined) {
    if (!STATUSES.has(status)) return res.status(400).json({ error: 'Invalid task status.' });
    updates.push('status = ?'); values.push(status);
    updates.push('completed_at = ?'); values.push(status === 'done' ? new Date().toISOString() : null);
    // Reopening should be able to nudge again, so clear the reminder trail.
    if (status !== 'done') { updates.push('reminder_stage = ?'); values.push(null); }
  }
  if (priority !== undefined) {
    if (!PRIORITIES.has(priority)) return res.status(400).json({ error: 'Priority must be low, normal, or high.' });
    updates.push('priority = ?'); values.push(priority);
  }
  if (dueAt !== undefined) {
    updates.push('due_at = ?'); values.push(dueAt || null);
    // A new deadline deserves a fresh set of reminders.
    updates.push('reminder_stage = ?'); values.push(null);
  }
  if (assigneeId !== undefined) {
    if (assigneeId && !await resolveAccess(req.task.space_id, assigneeId)) {
      return res.status(400).json({ error: "That person doesn't have access to this space." });
    }
    updates.push('assignee_id = ?'); values.push(assigneeId || null);
    updates.push('reminder_stage = ?'); values.push(null);
  }
  if (updates.length === 0) return res.status(400).json({ error: 'Nothing to update.' });

  values.push(req.task.id);
  await db.prepare(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  const row = await db.prepare(`${SELECT_TASK} WHERE t.id = ?`).get(req.task.id);
  const audience = await spaceAudience(req.access.space);
  const found = await mentions.of(row.title, {
    viewerId: req.user.id, ownerId: req.access.space.owner_id, audience,
  });

  // Only whoever the edit newly named. Retitling a task should not re-announce
  // it to people who were already in the title and have long since read it.
  const before = new Set(mentions.parse(req.task.title));
  await mentions.notify({
    found: found.filter((m) => !before.has(m.handle)),
    author: req.user,
    ownerId: req.access.space.owner_id,
    subject: `${req.user.name} named you in a task`,
    where: `a task in "${req.access.space.name}"`,
  });

  res.json({ task: serialize(row, found) });
});

router.delete('/:taskId', loadTask, async (req, res) => {
  if (!req.access.canWrite) return res.status(403).json({ error: 'You have read-only access here.' });
  await db.prepare('DELETE FROM tasks WHERE id = ?').run(req.task.id);
  res.status(204).end();
});

module.exports = router;
