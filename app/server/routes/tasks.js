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
         pt.title AS parent_title,
         pi.id AS source_pad_item_id
  FROM tasks t
  LEFT JOIN users u ON u.id = t.assignee_id
  JOIN users c ON c.id = t.created_by
  JOIN spaces s ON s.id = t.space_id
  LEFT JOIN projects p ON p.id = t.project_id
  LEFT JOIN project_stages st ON st.id = t.stage_id
  LEFT JOIN messages msg ON msg.id = t.source_message_id
  LEFT JOIN threads th ON th.id = msg.thread_id
  -- The task this one is a step of, for the sake of My Tasks: a step read
  -- outside its parent is a sentence with its subject missing.
  LEFT JOIN tasks pt ON pt.id = t.parent_task_id
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
    // A step, and the task it is a step of. The title comes with it because
    // My Tasks spans every space and shows steps alongside whole tasks — and
    // "Chase the surveyor" on its own does not say what it is part of.
    parentTaskId: t.parent_task_id || null,
    parentTitle: t.parent_title || null,
    // Filled in by withSteps for the lists that nest. Always present, so a
    // renderer never has to tell "no steps" from "not asked for".
    subtasks: [],
    steps: { done: 0, total: 0 },
    // Where the talking about this happens. A task is not a conversation and
    // should never try to be one — it is a title, an owner and a date — but it
    // must always be able to say where the conversation is, or assigning work
    // becomes the moment the discussion of it stops.
    sourceMessageId: t.source_message_id,
    sourceThreadId: t.source_thread_id,
    sourcePadItemId: t.source_pad_item_id || null,
    completedAt: t.completed_at,
    // Put away rather than thrown away, and separate from status on purpose:
    // a screen needs to tell "done and filed" from "abandoned and filed".
    archivedAt: t.archived_at || null,
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

/**
 * Hang each task's steps under it, and count them.
 *
 * TOP LEVEL MEANS TOP LEVEL. The scoped lists — a space, a project, a stage —
 * show whole tasks with their steps underneath, never steps loose among them:
 * a five-step task would otherwise be six rows that all look equally like work
 * somebody has been given, and the board would read as five times the load.
 *
 * My Tasks does the opposite, deliberately. A step assigned to you IS your
 * work, and the one list that answers "what have I got" must not hide it
 * because somebody happened to file it inside something. It arrives flat there,
 * carrying its parent's title.
 */
async function withSteps(parents, viewerId) {
  if (parents.length === 0) return [];
  const ids = parents.map((t) => t.id);
  const kids = await db.prepare(`
    ${SELECT_TASK} WHERE t.parent_task_id IN (${ids.map(() => '?').join(',')})
    ORDER BY t.created_at ASC
  `).all(...ids);

  const shaped = await serializeAll([...parents, ...kids], viewerId);
  const byId = new Map(shaped.map((t) => [t.id, t]));
  const out = [];
  for (const t of shaped) {
    if (!t.parentTaskId) { out.push(t); continue; }
    const owner = byId.get(t.parentTaskId);
    if (owner) owner.subtasks.push(t);
  }
  for (const t of out) {
    t.steps = {
      done: t.subtasks.filter((k) => k.status === 'done').length,
      total: t.subtasks.length,
    };
  }
  return out;
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
  // Archived work leaves the list. That is the whole point of archiving it —
  // and `?archived=1` is how it is found again, so putting something away is
  // never the same as losing it.
  const shelf = req.query.archived === '1'
    ? 't.archived_at IS NOT NULL' : 't.archived_at IS NULL';
  const rows = await db.prepare(`${SELECT_TASK} WHERE t.assignee_id = ? AND ${shelf} ORDER BY
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

  // Steps are fetched by withSteps and hung under their task, so they are
  // excluded here rather than filtered afterwards: a stage with four tasks of
  // five steps each should be four rows and four queries, not twenty-four rows
  // whittled down in memory.
  where.push('t.parent_task_id IS NULL');
  where.push(req.query.archived === '1' ? 't.archived_at IS NOT NULL' : 't.archived_at IS NULL');

  const rows = await db.prepare(`${SELECT_TASK} WHERE ${where.join(' AND ')} ORDER BY
    CASE t.status WHEN 'done' THEN 1 ELSE 0 END,
    CASE WHEN t.due_at IS NULL THEN 1 ELSE 0 END,
    t.due_at ASC, t.created_at DESC
  `).all(...values);
  res.json({ tasks: await withSteps(rows, req.user.id) });
});

router.post('/', async (req, res) => {
  const {
    spaceId, projectId, stageId, sourceMessageId, parentTaskId,
    title, assigneeId, dueAt, priority,
  } = req.body || {};
  if (!title || !String(title).trim()) return res.status(400).json({ error: 'Give the task a title.' });

  /**
   * WHERE THE TASK LIVES, decided once.
   *
   * Three doors lead here — a step inside another task, a line somebody said
   * in a thread, and a box on a project or stage screen — and each of them
   * knows the answer in a different way. Working it out per door is how the
   * three drift: the project box used to send no stage at all, so tasks added
   * on the screen that shows the stages belonged to none of them, which is a
   * large part of why a stage looked like it stood alone.
   *
   * The inherited cases win outright rather than being merged with what the
   * caller sent. A step belongs where its parent belongs; a task made from a
   * message belongs where the message was said. Otherwise a caller could name
   * a stage in a space they cannot reach and smuggle work into it.
   */
  let resolvedSpaceId = spaceId;
  let resolvedStageId = stageId || null;
  let resolvedProjectId = projectId || null;
  let parent = null;

  if (parentTaskId) {
    parent = await db.prepare('SELECT * FROM tasks WHERE id = ?').get(parentTaskId);
    if (!parent) return res.status(404).json({ error: 'That task no longer exists.' });
    if (!await resolveAccess(parent.space_id, req.user.id)) {
      return res.status(404).json({ error: 'That task no longer exists.' });
    }
    // ONE LEVEL. Depth beyond a step is a project with stages, which this app
    // already has, and a tree nobody can see the shape of is how a list of
    // work stops being a list of work.
    if (parent.parent_task_id) {
      return res.status(400).json({
        error: 'A step cannot have steps of its own. Break the task up differently, '
          + 'or make this a task of its own on the same stage.',
      });
    }
    resolvedSpaceId = parent.space_id;
    resolvedProjectId = parent.project_id;
    resolvedStageId = parent.stage_id;
  } else if (sourceMessageId) {
    const src = await db.prepare(`
      SELECT th.space_id, th.project_id, th.stage_id FROM messages m
      JOIN threads th ON th.id = m.thread_id WHERE m.id = ?
    `).get(sourceMessageId);
    if (!src) return res.status(404).json({ error: 'Source message not found.' });
    resolvedSpaceId = src.space_id;
    resolvedStageId = src.stage_id;
    resolvedProjectId = src.project_id;
  } else if (resolvedStageId) {
    // A stage names its own project, so asking the caller for both is asking
    // for two answers to one question — and the pair can disagree.
    const st = await db.prepare(`
      SELECT s.id, s.project_id, p.space_id FROM project_stages s
      JOIN projects p ON p.id = s.project_id WHERE s.id = ?
    `).get(resolvedStageId);
    if (!st) return res.status(404).json({ error: 'Stage not found.' });
    resolvedProjectId = st.project_id;
    // Checked, not trusted. Nothing else here proves the stage is in the space
    // the caller named, and without this a stage id is a way into a project in
    // a space they can reach — carrying work with it.
    if (resolvedSpaceId && resolvedSpaceId !== st.space_id) {
      return res.status(400).json({ error: 'That stage belongs to another space.' });
    }
    resolvedSpaceId = st.space_id;
  }

  const access = resolvedSpaceId && await resolveAccess(resolvedSpaceId, req.user.id);
  if (!access) return res.status(404).json({ error: 'Space not found.' });
  if (!access.canWrite) return res.status(403).json({ error: 'You have read-only access here.' });

  if (priority !== undefined && !PRIORITIES.has(priority)) {
    return res.status(400).json({ error: 'Priority must be low, normal, or high.' });
  }
  /**
   * NAMING SOMEBODY IN A TASK IS HANDING IT TO THEM.
   *
   * The project screen's box says "New task — @ to name someone", opens a
   * mention picker to help you type it, and then posted the title alone. The
   * task arrived unassigned, having invited you to assign it — which is worse
   * than not offering the @ at all, because the work looks handed over and
   * nobody has it.
   *
   * Fixed on the server rather than in that one form, so the thread's task
   * composer, the project box and anything added later cannot disagree about
   * what an @ means.
   *
   * THE THREE-WAY DISTINCTION MATTERS. A caller that sends no assigneeId is
   * not deciding, so the @ decides. A caller that sends null has decided:
   * nobody. A caller that sends an id has decided: them. Only the first of
   * those reads the title, so picking "Unassigned" from a dropdown is never
   * quietly overruled by an @ left in the text.
   */
  const audience = await spaceAudience(access.space);
  const found = await mentions.of(String(title).trim(), {
    viewerId: req.user.id, ownerId: access.space.owner_id, audience,
  });
  // The first person named who can actually see this space. Not a contact —
  // `notified` is already the app's word for "a real account inside the
  // audience", and work cannot be handed to somebody who cannot open it.
  // A second @ in the same sentence stays a mention: "confirm cars with @femi"
  // names one owner and one bystander, and guessing between them would be
  // worse than the sentence's own order.
  const named = found.find((m) => m.kind === 'person' && m.notified && m.id !== req.user.id)
    || found.find((m) => m.kind === 'person' && m.notified);
  const wanted = assigneeId === undefined ? (named?.id || null) : (assigneeId || null);

  // Only someone who can already see the space may be assigned work in it.
  // Applied to the derived answer as well as the given one, so the rule lives
  // in one place rather than being trusted to whoever resolved the mention.
  if (wanted && !await resolveAccess(resolvedSpaceId, wanted)) {
    return res.status(400).json({ error: "That person doesn't have access to this space." });
  }

  const id = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO tasks (id, space_id, project_id, stage_id, source_message_id, parent_task_id,
                       title, assignee_id, created_by, due_at, priority, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)
  `).run(id, resolvedSpaceId, resolvedProjectId, resolvedStageId, sourceMessageId || null,
    parent?.id || null,
    String(title).trim().slice(0, 300), wanted, req.user.id,
    dueAt || null, priority || 'normal', new Date().toISOString());

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
  const { title, status, priority, dueAt, assigneeId, stageId } = req.body || {};
  const updates = [];
  const values = [];

  /**
   * Moving a task from one stage to another.
   *
   * The stage names its project, so both move together — a task sitting on a
   * stage of one project while claiming to belong to another is a state with
   * no meaning that every screen would then have to decide how to draw.
   *
   * A STEP DOES NOT MOVE ON ITS OWN. It is part of its task, and a step on a
   * different stage from the task it belongs to is exactly the loose work this
   * whole change exists to stop.
   */
  if (stageId !== undefined) {
    if (req.task.parent_task_id) {
      return res.status(400).json({
        error: 'A step follows the task it belongs to. Move the task instead.',
      });
    }
    if (stageId) {
      const st = await db.prepare(`
        SELECT s.id, s.project_id, p.space_id FROM project_stages s
        JOIN projects p ON p.id = s.project_id WHERE s.id = ?
      `).get(stageId);
      if (!st) return res.status(404).json({ error: 'Stage not found.' });
      if (st.space_id !== req.task.space_id) {
        return res.status(400).json({ error: 'That stage belongs to another space.' });
      }
      updates.push('stage_id = ?'); values.push(st.id);
      updates.push('project_id = ?'); values.push(st.project_id);
    } else {
      // Off every stage, but still on the project it was on. "Not yet placed"
      // is a real answer and the project screen has a place to show it.
      updates.push('stage_id = ?'); values.push(null);
    }
    // Steps live where their task lives, so they come along. Two rows
    // answering "which stage is this work on" is two rows that will disagree.
    await db.prepare('UPDATE tasks SET stage_id = ? WHERE parent_task_id = ?')
      .run(stageId || null, req.task.id);
  }

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

  /**
   * Finishing a task finishes its steps.
   *
   * A task marked done with three of its steps still open is two records of
   * one fact, and two records of one fact always end up disagreeing — the same
   * reason the stage's status is driven by its records rather than kept
   * alongside them. Somebody ticking the task means the work is finished; the
   * steps were how it got finished.
   *
   * NOT THE REVERSE. Reopening a task does not reopen its steps: which of them
   * came undone is a thing only the person reopening it knows, and guessing
   * would hand somebody back work they had genuinely completed.
   */
  let closedSteps = 0;
  if (status === 'done' && !req.task.parent_task_id) {
    const res2 = await db.prepare(`
      UPDATE tasks SET status = 'done', completed_at = ?
      WHERE parent_task_id = ? AND status != 'done'
    `).run(new Date().toISOString(), req.task.id);
    closedSteps = res2?.changes ?? 0;
  }

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

  res.json({ task: serialize(row, found), closedSteps });
});

/**
 * Put it away, rather than throw it away.
 *
 * The cheap verb, and the one that should be reached for first: a finished
 * task that stays on the list forever makes the list useless, and deleting it
 * to tidy up destroys the only record that the work was ever done.
 *
 * Archiving does NOT touch status. "Done and filed" and "abandoned and filed"
 * are different things, and somebody will need to know which — see the column
 * comment in lib/db.js.
 *
 * Whoever can write here can do it, like archiving a thread: the person who
 * finishes the work is the person holding the list, and a rule that sends them
 * to find the principal first is a rule that leaves every finished task on it.
 */
router.post('/:taskId/archive', loadTask, async (req, res) => {
  if (!req.access.canWrite) return res.status(403).json({ error: 'You have read-only access here.' });
  if (req.task.archived_at) return res.json({ archivedAt: req.task.archived_at });
  const at = new Date().toISOString();
  await db.prepare('UPDATE tasks SET archived_at = ? WHERE id = ?').run(at, req.task.id);
  // A task's steps go with it. Leaving them live on the list under an archived
  // parent is how a list acquires rows nobody can account for.
  await db.prepare('UPDATE tasks SET archived_at = ? WHERE parent_task_id = ? AND archived_at IS NULL')
    .run(at, req.task.id);
  res.json({ archivedAt: at });
});

router.delete('/:taskId/archive', loadTask, async (req, res) => {
  if (!req.access.canWrite) return res.status(403).json({ error: 'You have read-only access here.' });
  await db.prepare('UPDATE tasks SET archived_at = NULL WHERE id = ? OR parent_task_id = ?')
    .run(req.task.id, req.task.id);
  res.json({ archivedAt: null });
});

/** What deleting this would take with it, asked before it is asked for. */
router.get('/:taskId/deletion', loadTask, async (req, res) => {
  const steps = await db.prepare(
    'SELECT COUNT(*) AS n FROM tasks WHERE parent_task_id = ?',
  ).get(req.task.id);
  res.json({ steps: Number(steps?.n || 0) });
});

router.delete('/:taskId', loadTask, async (req, res) => {
  if (!req.access.canWrite) return res.status(403).json({ error: 'You have read-only access here.' });

  // A step exists only as part of its task, so deleting the task deletes the
  // steps — which is right, and is exactly why it has to be said first. The
  // same shape as removing a contact who has documents against their name: the
  // confirmation IS the count, because somebody who has read "3 steps" has
  // been told the thing that matters.
  const row = await db.prepare('SELECT COUNT(*) AS n FROM tasks WHERE parent_task_id = ?')
    .get(req.task.id);
  const steps = Number(row?.n || 0);
  if (steps && req.body?.alsoDelete !== steps) {
    return res.status(409).json({
      error: `"${req.task.title}" has ${steps} step${steps === 1 ? '' : 's'} under it. `
        + 'Deleting the task deletes those too.',
      code: 'task_has_steps',
      steps,
    });
  }

  await db.prepare('DELETE FROM tasks WHERE id = ?').run(req.task.id);
  res.status(204).end();
});

module.exports = router;
