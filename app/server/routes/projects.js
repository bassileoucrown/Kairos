const express = require('express');
const { asyncRouter } = require('../lib/asyncRouter');
const crypto = require('crypto');
const db = require('../lib/db');
const { requireAuth } = require('../lib/auth');
const { resolveAccess } = require('../lib/spaceAccess');
const { syncStageFromRecords } = require('../lib/stageStatus');

const router = asyncRouter();
router.use(requireAuth);

const STAGE_STATUSES = new Set(['not_started', 'active', 'blocked', 'done']);

// A project has no access rules of its own — it inherits its space's, which is
// the whole point of everything living in exactly one space.
async function loadProject(req, res, next) {
  const project = await db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.projectId);
  if (!project) return res.status(404).json({ error: 'Project not found.' });
  const access = await resolveAccess(project.space_id, req.user.id);
  if (!access) return res.status(404).json({ error: 'Project not found.' });
  req.project = project;
  req.access = access;
  next();
}

async function loadStage(req, res, next) {
  const stage = await db.prepare('SELECT * FROM project_stages WHERE id = ?').get(req.params.stageId);
  if (!stage) return res.status(404).json({ error: 'Stage not found.' });
  const project = await db.prepare('SELECT * FROM projects WHERE id = ?').get(stage.project_id);
  const access = await resolveAccess(project.space_id, req.user.id);
  if (!access) return res.status(404).json({ error: 'Stage not found.' });
  req.stage = stage;
  req.project = project;
  req.access = access;
  next();
}

async function stagesFor(projectId) {
  return (await db.prepare(`
    SELECT s.*, u.name AS owner_name, t.id AS thread_id,
      (SELECT COUNT(*) FROM messages m WHERE m.thread_id = t.id) AS message_count,
      (SELECT COUNT(*) FROM messages m WHERE m.thread_id = t.id AND m.register = 'record') AS record_count,
      (SELECT COUNT(*) FROM messages m WHERE m.thread_id = t.id
        AND m.record_type = 'blocker' AND m.record_status = 'open') AS open_blockers
    FROM project_stages s
    LEFT JOIN users u ON u.id = s.owner_user_id
    LEFT JOIN threads t ON t.stage_id = s.id
    WHERE s.project_id = ?
    ORDER BY s.position, s.created_at
  `).all(projectId)).map((s) => ({
    id: s.id,
    name: s.name,
    position: s.position,
    status: s.status,
    ownerName: s.owner_name,
    ownerUserId: s.owner_user_id,
    dueAt: s.due_at,
    threadId: s.thread_id,
    messageCount: s.message_count || 0,
    recordCount: s.record_count || 0,
    openBlockers: s.open_blockers || 0,
  }));
}

router.get('/:projectId', loadProject, async (req, res) => {
  const space = await db.prepare('SELECT id, name, context FROM spaces WHERE id = ?').get(req.project.space_id);
  res.json({
    project: {
      id: req.project.id,
      name: req.project.name,
      description: req.project.description,
      status: req.project.status,
      spaceId: req.project.space_id,
    },
    space: { id: space.id, name: space.name, context: space.context },
    canWrite: req.access.canWrite,
    stages: await stagesFor(req.project.id),
  });
});

router.patch('/:projectId', loadProject, async (req, res) => {
  if (!req.access.canWrite) return res.status(403).json({ error: 'You have read-only access here.' });
  const { name, description, status } = req.body || {};
  const updates = [];
  const values = [];
  if (name !== undefined) {
    if (!String(name).trim()) return res.status(400).json({ error: 'Give the project a name.' });
    updates.push('name = ?'); values.push(String(name).trim());
  }
  if (description !== undefined) { updates.push('description = ?'); values.push(String(description)); }
  if (status !== undefined) {
    if (!['active', 'done', 'archived'].includes(status)) {
      return res.status(400).json({ error: 'Invalid project status.' });
    }
    updates.push('status = ?'); values.push(status);
  }
  if (updates.length === 0) return res.status(400).json({ error: 'Nothing to update.' });

  values.push(req.project.id);
  await db.prepare(`UPDATE projects SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  const project = await db.prepare('SELECT * FROM projects WHERE id = ?').get(req.project.id);
  res.json({ project: { id: project.id, name: project.name, description: project.description, status: project.status } });
});

// Every stage gets its own thread at creation — a stage without somewhere to
// talk about it is the exact split this product is trying to close.
router.post('/:projectId/stages', loadProject, async (req, res) => {
  if (!req.access.canWrite) return res.status(403).json({ error: 'You have read-only access here.' });
  const { name, dueAt, ownerUserId } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Give the stage a name.' });

  const maxPos = (await db.prepare('SELECT MAX(position) AS max FROM project_stages WHERE project_id = ?')
    .get(req.project.id))?.max;
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await db.prepare(`
    INSERT INTO project_stages (id, project_id, name, position, status, owner_user_id, due_at, created_at)
    VALUES (?, ?, ?, ?, 'not_started', ?, ?, ?)
  `).run(id, req.project.id, String(name).trim(), (maxPos === null || maxPos === undefined ? -1 : maxPos) + 1,
    ownerUserId || null, dueAt || null, now);

  await db.prepare(`
    INSERT INTO threads (id, space_id, project_id, stage_id, name, kind, created_at)
    VALUES (?, ?, ?, ?, ?, 'stage', ?)
  `).run(crypto.randomUUID(), req.project.space_id, req.project.id, id, String(name).trim(), now);

  res.status(201).json({ stages: await stagesFor(req.project.id) });
});

router.patch('/stages/:stageId', loadStage, async (req, res) => {
  if (!req.access.canWrite) return res.status(403).json({ error: 'You have read-only access here.' });
  const { name, status, dueAt, ownerUserId } = req.body || {};
  const updates = [];
  const values = [];

  if (name !== undefined) {
    if (!String(name).trim()) return res.status(400).json({ error: 'Give the stage a name.' });
    updates.push('name = ?'); values.push(String(name).trim());
  }
  if (status !== undefined) {
    if (!STAGE_STATUSES.has(status)) return res.status(400).json({ error: 'Invalid stage status.' });
    // An open blocker outranks a manual status change — otherwise the board
    // could claim "active" while a blocker everyone can read sits in the
    // thread, which is the disconnect this is meant to remove.
    const openBlockers = (await db.prepare(`
      SELECT COUNT(*) AS n FROM messages m JOIN threads t ON t.id = m.thread_id
      WHERE t.stage_id = ? AND m.record_type = 'blocker' AND m.record_status = 'open'
    `).get(req.stage.id))?.n || 0;
    if (openBlockers > 0 && status !== 'blocked') {
      return res.status(409).json({
        error: 'This stage has an open Blocker record. Resolve or supersede it before changing the status.',
      });
    }
    updates.push('status = ?'); values.push(status);
  }
  if (dueAt !== undefined) { updates.push('due_at = ?'); values.push(dueAt || null); }
  if (ownerUserId !== undefined) { updates.push('owner_user_id = ?'); values.push(ownerUserId || null); }
  if (updates.length === 0) return res.status(400).json({ error: 'Nothing to update.' });

  values.push(req.stage.id);
  await db.prepare(`UPDATE project_stages SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  res.json({ stages: await stagesFor(req.project.id) });
});

/** What deleting a project would take with it. */
async function projectContents(projectId) {
  const stages = await db.prepare('SELECT COUNT(*) AS n FROM project_stages WHERE project_id = ?')
    .get(projectId);
  const tasks = await db.prepare('SELECT COUNT(*) AS n FROM tasks WHERE project_id = ?')
    .get(projectId);
  const threads = await db.prepare('SELECT COUNT(*) AS n FROM threads WHERE project_id = ?')
    .get(projectId);
  return {
    stages: Number(stages?.n || 0),
    tasks: Number(tasks?.n || 0),
    threads: Number(threads?.n || 0),
  };
}

router.get('/:projectId/deletion', loadProject, async (req, res) => {
  res.json({ contents: await projectContents(req.project.id) });
});

/**
 * Deleting a project, which was not possible at all until now.
 *
 * A project could be marked 'archived' and never removed, so a duplicate
 * created by mistake stayed on the books forever with no way to be rid of it.
 *
 * The stages and the tasks go with it, by cascade — that is what the schema
 * says and it is right, a stage has no meaning outside its project. Which is
 * exactly why it is counted and refused first: the confirmation IS the count,
 * the same as removing somebody who has documents against their name.
 *
 * THE THREADS DO NOT GO. A conversation is linked to a project, not owned by
 * it — people said those things and they survive the plan being abandoned. So
 * they are unlinked and left in their space, and the count says how many, so
 * nobody expects them to vanish and nobody expects them to stay by accident.
 */
router.delete('/:projectId', loadProject, async (req, res) => {
  if (req.access.role !== 'owner') {
    return res.status(403).json({ error: 'Only the space owner can delete a project.' });
  }
  const contents = await projectContents(req.project.id);
  const agreed = req.body?.alsoDelete;
  const going = contents.stages + contents.tasks;
  if (going && agreed !== going) {
    return res.status(409).json({
      error: `"${req.project.name}" has ${contents.stages} stage${contents.stages === 1 ? '' : 's'} `
        + `and ${contents.tasks} task${contents.tasks === 1 ? '' : 's'}. Deleting the project deletes those too.`
        + (contents.threads
          ? ` ${contents.threads} conversation${contents.threads === 1 ? '' : 's'} will stay in the space.`
          : ''),
      code: 'project_has_contents',
      contents,
    });
  }

  // Unlinked before the delete rather than left to a cascade, because there
  // is no cascade to leave it to: threads.project_id is SET NULL only if the
  // database says so, and saying it here makes the intention readable.
  await db.prepare('UPDATE threads SET project_id = NULL, stage_id = NULL WHERE project_id = ?')
    .run(req.project.id);
  await db.prepare('DELETE FROM projects WHERE id = ?').run(req.project.id);
  res.json({ ok: true, deleted: contents });
});

router.delete('/stages/:stageId', loadStage, async (req, res) => {
  if (!req.access.canWrite) return res.status(403).json({ error: 'You have read-only access here.' });
  await db.prepare('DELETE FROM project_stages WHERE id = ?').run(req.stage.id);
  res.json({ stages: await stagesFor(req.project.id) });
});

router.post('/stages/:stageId/move', loadStage, async (req, res) => {
  if (!req.access.canWrite) return res.status(403).json({ error: 'You have read-only access here.' });
  const { direction } = req.body || {};
  if (!['up', 'down'].includes(direction)) {
    return res.status(400).json({ error: 'Direction must be up or down.' });
  }

  const siblings = await db.prepare('SELECT * FROM project_stages WHERE project_id = ? ORDER BY position, created_at')
    .all(req.project.id);
  const index = siblings.findIndex((s) => s.id === req.stage.id);
  const swapWith = direction === 'up' ? index - 1 : index + 1;
  if (swapWith < 0 || swapWith >= siblings.length) {
    return res.json({ stages: await stagesFor(req.project.id) });
  }

  // Rewrite the whole ordering rather than swapping two values, so positions
  // stay dense even if earlier edits left gaps.
  const reordered = [...siblings];
  [reordered[index], reordered[swapWith]] = [reordered[swapWith], reordered[index]];
  const setPos = db.prepare('UPDATE project_stages SET position = ? WHERE id = ?');
  for (let i = 0; i < reordered.length; i++) await setPos.run(i, reordered[i].id);

  res.json({ stages: await stagesFor(req.project.id) });
});

// Recomputes from records — useful after data changes and as the honest
// source of truth for the board.
router.post('/stages/:stageId/sync', loadStage, async (req, res) => {
  const result = await syncStageFromRecords(req.stage.id);
  res.json({ result, stages: await stagesFor(req.project.id) });
});

module.exports = router;
