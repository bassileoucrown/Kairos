const express = require('express');
const { asyncRouter } = require('../lib/asyncRouter');
const crypto = require('crypto');
const db = require('../lib/db');
const { BRAND_SHORT } = require('../lib/brand');
const { resolveVisibleHandle } = require('../lib/handles');
const { requireAuth } = require('../lib/auth');
const {
  CONTEXTS, DEFAULT_DELEGATE_ROLES, ASSISTANT_ROLES, parseRoles, roleCanDelegate,
  listVisibleSpaces, applyRoleDefaults, requireSpaceAccess, unreadBySpace,
} = require('../lib/spaceAccess');
const { summariseMany } = require('../lib/threadSummary');

const router = asyncRouter();
router.use(requireAuth);

function serializeSpace(s, viewerRole) {
  return {
    id: s.id,
    name: s.name,
    context: s.context,
    kind: s.kind || 'standard',
    autoDelegateRoles: parseRoles(s.auto_delegate_roles),
    viewerRole: viewerRole || s.viewer_role,
    isOwner: (viewerRole || s.viewer_role) === 'owner',
    archivedAt: s.archived_at || null,
    createdAt: s.created_at,
  };
}

router.get('/', async (req, res) => {
  const all = await listVisibleSpaces(req.user.id);
  // A room that has been put away leaves the list. `?archived=1` is where it
  // went — filtered here rather than inside listVisibleSpaces, which is also
  // what decides whether a TASK is visible: an archived room should drop off
  // this screen without quietly removing work somebody was still assigned.
  const wantArchived = req.query.archived === '1';
  const spaces = all.filter((sp) => (wantArchived ? !!sp.archived_at : !sp.archived_at));
  const counts = await db.prepare(`
    SELECT t.space_id, COUNT(*) AS thread_count
    FROM threads t GROUP BY t.space_id
  `).all();
  const countBySpace = Object.fromEntries(counts.map((c) => [c.space_id, c.thread_count]));

  // WHICH SPACE THE WAITING MESSAGES ARE IN. The rail could say "3 messages"
  // and this screen was the next place to look — and it said nothing, so the
  // only way to find them was to open rooms one at a time until the number
  // went down. A count that tells you something is waiting but not where is
  // half a notification.
  const { bySpace } = await unreadBySpace(req.user.id);

  res.json({
    spaces: spaces.map((s) => ({
      ...serializeSpace(s),
      threadCount: countBySpace[s.id] || 0,
      unread: bySpace.get(s.id) || 0,
    })),
  });
});

router.post('/', async (req, res) => {
  const { name, context } = req.body || {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'Give the space a name.' });
  }
  if (!CONTEXTS.has(context)) {
    return res.status(400).json({ error: 'Choose Work, Personal, or Private.' });
  }

  const id = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO spaces (id, owner_id, name, context, auto_delegate_roles, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, req.user.id, String(name).trim(), context, DEFAULT_DELEGATE_ROLES[context], new Date().toISOString());

  const space = await db.prepare('SELECT * FROM spaces WHERE id = ?').get(id);
  await applyRoleDefaults(space);

  res.status(201).json({ space: serializeSpace(space, 'owner') });
});

router.get('/:spaceId', requireSpaceAccess, async (req, res) => {
  const threads = await db.prepare('SELECT * FROM threads WHERE space_id = ? ORDER BY created_at').all(req.space.id);
  const members = await db.prepare(`
    SELECT sm.*, u.name, u.email, u.account_category
    FROM space_members sm JOIN users u ON u.id = sm.user_id
    WHERE sm.space_id = ?
  `).all(req.space.id);
  const owner = await db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(req.space.owner_id);
  // One pair of queries for the whole space, not two per room. See
  // summariseMany in lib/threadSummary.js.
  const summaries = await summariseMany(threads.map((t) => t.id), req.user.id);

  res.json({
    space: serializeSpace(req.space, req.access.role),
    canManageMembers: req.access.canManageMembers,
    canWrite: req.access.canWrite,
    owner: { id: owner.id, name: owner.name, email: owner.email },
    members: members.map((m) => ({
      id: m.id,
      userId: m.user_id,
      name: m.name,
      email: m.email,
      accountCategory: m.account_category,
      role: m.role,
      canDelegate: !!m.can_delegate,
    })),
    threads: threads.map((t) => ({
      id: t.id, name: t.name, kind: t.kind,
      archivedAt: t.archived_at || null,
      createdAt: t.created_at,
      // What is in the room, rather than only when it was made. "Started 3
      // June" is true of a thread forever and says nothing about whether
      // anybody needs to open it; the last thing said and how much of it is
      // unread is the whole reason a person is looking at this list.
      ...(summaries.get(t.id) || { lastMessage: null, unread: 0 }),
    })),
  });
});

// Tuning which assistant roles are auto-granted. Owner only — this is the
// "principal adjusts per space" half of role-sets-the-default.
router.patch('/:spaceId', requireSpaceAccess, async (req, res) => {
  if (req.access.role !== 'owner') {
    return res.status(403).json({ error: 'Only the space owner can change this.' });
  }

  const { autoDelegateRoles, name } = req.body || {};

  // The private guard belongs to delegation and nothing else. It used to sit
  // at the top of this handler, so renaming a private space was refused with a
  // sentence about delegating it — which is both wrong and confusing, since a
  // private space is the one most likely to have been named in a hurry.
  if (autoDelegateRoles !== undefined && req.space.context === 'private') {
    return res.status(400).json({ error: 'Private spaces cannot be delegated to anyone.' });
  }
  const updates = [];
  const values = [];

  if (name !== undefined) {
    if (!String(name).trim()) return res.status(400).json({ error: 'Give the space a name.' });
    updates.push('name = ?'); values.push(String(name).trim());
  }
  if (autoDelegateRoles !== undefined) {
    if (!Array.isArray(autoDelegateRoles)) {
      return res.status(400).json({ error: 'Expected a list of roles.' });
    }
    const clean = autoDelegateRoles.filter((r) => ASSISTANT_ROLES.has(r));
    updates.push('auto_delegate_roles = ?'); values.push(clean.join(','));
  }
  if (updates.length === 0) return res.status(400).json({ error: 'Nothing to update.' });

  values.push(req.space.id);
  await db.prepare(`UPDATE spaces SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  const space = await db.prepare('SELECT * FROM spaces WHERE id = ?').get(req.space.id);
  await applyRoleDefaults(space); // newly-included roles gain access immediately
  res.json({ space: serializeSpace(space, 'owner') });
});

/**
 * Closing a space for good.
 *
 * WHY THE NAME HAS TO BE TYPED. This takes every thread, message, record,
 * project, stage and task in the space with it, by cascade, and there is no
 * undo — a confirm dialog is one mis-tap on a phone, and this is a product
 * used on phones between meetings. Typing the name is the cheapest guard that
 * cannot be passed by accident, and it is checked HERE rather than only on the
 * screen, because a guard the server does not enforce is decoration.
 *
 * WHAT IS COUNTED FIRST. The refusal and the confirmation both name what would
 * go, so nobody deletes a space to tidy up a list and finds out afterwards
 * that a year of decisions went with it. Archiving a thread is the other
 * answer, and the one to reach for when the words might be wanted again.
 *
 * ROOMS THE APP MAINTAINS ARE NOT DELETABLE. The direct line and a pair room
 * exist because two people have a relationship, not because somebody made a
 * workspace; deleting one would leave the app to recreate it on the next
 * request, emptied, which looks exactly like data loss because it is.
 */
router.get('/:spaceId/contents', requireSpaceAccess, async (req, res) => {
  res.json({ contents: await spaceContents(req.space.id) });
});

async function spaceContents(spaceId) {
  const row = await db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM threads WHERE space_id = ?) AS threads,
      (SELECT COUNT(*) FROM threads WHERE space_id = ? AND archived_at IS NOT NULL) AS archived,
      (SELECT COUNT(*) FROM messages m JOIN threads t ON t.id = m.thread_id
        WHERE t.space_id = ?) AS messages,
      (SELECT COUNT(*) FROM messages m JOIN threads t ON t.id = m.thread_id
        WHERE t.space_id = ? AND m.register = 'record') AS records,
      (SELECT COUNT(*) FROM projects WHERE space_id = ?) AS projects,
      (SELECT COUNT(*) FROM tasks WHERE space_id = ?) AS tasks
  `).get(spaceId, spaceId, spaceId, spaceId, spaceId, spaceId);
  return {
    threads: Number(row?.threads || 0),
    archivedThreads: Number(row?.archived || 0),
    messages: Number(row?.messages || 0),
    records: Number(row?.records || 0),
    projects: Number(row?.projects || 0),
    tasks: Number(row?.tasks || 0),
  };
}

/**
 * Close the room without burning it.
 *
 * This existed only as delete — type the name and everything in it goes. That
 * is the right ceremony for destroying a workspace and the wrong ONLY option
 * for finishing with one: a project that ended is not a project that should be
 * erased, and an office with no way to put a finished room away either keeps
 * every room it has ever had on the list, or starts deleting history to tidy
 * up. Both are worse than a shelf.
 *
 * An archived space leaves the live list, accepts nothing new, and stays
 * readable in full — the same bargain as an archived thread, and reversible
 * for the same reason: "finished" is a judgement, and judgements get revisited.
 *
 * Owner-only, unlike archiving a thread. A thread is one conversation and the
 * person who finished the work can put it away; a space is everybody's room,
 * and one member deciding the whole office is done with it is not their call.
 */
router.post('/:spaceId/archive', requireSpaceAccess, async (req, res) => {
  if (req.access.role !== 'owner') {
    return res.status(403).json({ error: 'Only the space owner can put this room away.' });
  }
  if (req.space.archived_at) return res.json({ archivedAt: req.space.archived_at });
  const at = new Date().toISOString();
  await db.prepare('UPDATE spaces SET archived_at = ? WHERE id = ?').run(at, req.space.id);
  res.json({ archivedAt: at });
});

router.delete('/:spaceId/archive', requireSpaceAccess, async (req, res) => {
  if (req.access.role !== 'owner') {
    return res.status(403).json({ error: 'Only the space owner can bring this room back.' });
  }
  await db.prepare('UPDATE spaces SET archived_at = NULL WHERE id = ?').run(req.space.id);
  res.json({ archivedAt: null });
});

router.delete('/:spaceId', requireSpaceAccess, async (req, res) => {
  if (req.access.role !== 'owner') {
    return res.status(403).json({ error: 'Only the space owner can close it.' });
  }
  if ((req.space.kind || 'standard') !== 'standard') {
    return res.status(400).json({
      error: 'This room is kept by Kairos because of who is in it, not as a workspace. '
        + 'Archive the conversation instead.',
    });
  }

  const contents = await spaceContents(req.space.id);
  const typed = String(req.body?.confirmName || '').trim();
  if (typed !== req.space.name) {
    return res.status(400).json({
      error: `Type the space's name to close it: "${req.space.name}".`,
      contents,
    });
  }

  await db.prepare('DELETE FROM spaces WHERE id = ?').run(req.space.id);
  res.json({ ok: true, closed: contents });
});

router.post('/:spaceId/members', requireSpaceAccess, async (req, res) => {
  // The structural guarantee: there is no path to a member row on a private
  // space, so "only you" can't be undone by a permission mistake later.
  if (req.space.context === 'private') {
    return res.status(400).json({ error: 'Private spaces are yours alone — they cannot be shared.' });
  }
  if (!req.access.canManageMembers) {
    return res.status(403).json({ error: 'You cannot manage members of this space.' });
  }
  // The direct line's membership mirrors the team, so anyone added here would
  // be removed again at the next invite or revoke. Better to say so than to
  // accept the change and silently undo it.
  if (req.space.kind === 'direct') {
    return res.status(400).json({
      error: 'The direct line always holds exactly your team. Invite them from Team instead.',
    });
  }

  // Accepts a handle or an email. The handle is the pleasanter half — you
  // know a colleague's handle, you do not always know which of their
  // addresses they signed up with — but it resolves only for people this
  // caller already works with, so it can never be used to discover anyone.
  const { email, handle, role } = req.body || {};
  let user = null;
  if (handle) {
    user = await resolveVisibleHandle(req.user.id, handle);
    if (!user) return res.status(404).json({ error: 'No one you work with has that handle.' });
    user = await db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  } else {
    user = await db.prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').trim().toLowerCase());
    if (!user) return res.status(404).json({ error: `No ${BRAND_SHORT} account with that email.` });
  }
  if (user.id === req.space.owner_id) return res.status(400).json({ error: 'They already own this space.' });

  const memberRole = role === 'guest' ? 'guest' : 'member';
  try {
    await db.prepare(`
      INSERT INTO space_members (id, space_id, user_id, role, can_delegate, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(crypto.randomUUID(), req.space.id, user.id, memberRole,
      roleCanDelegate(user.account_category) ? 1 : 0, new Date().toISOString());
  } catch {
    return res.status(409).json({ error: 'They already have access to this space.' });
  }

  res.status(201).json({ ok: true });
});

router.delete('/:spaceId/members/:memberId', requireSpaceAccess, async (req, res) => {
  if (!req.access.canManageMembers) {
    return res.status(403).json({ error: 'You cannot manage members of this space.' });
  }
  if (req.space.kind === 'direct') {
    return res.status(400).json({
      error: 'Removing someone from the direct line means ending their access in Team.',
    });
  }
  const member = await db.prepare('SELECT * FROM space_members WHERE id = ? AND space_id = ?')
    .get(req.params.memberId, req.space.id);
  if (!member) return res.status(404).json({ error: 'Member not found.' });

  await db.prepare('DELETE FROM space_members WHERE id = ?').run(member.id);
  res.status(204).end();
});

router.get('/:spaceId/projects', requireSpaceAccess, async (req, res) => {
  // EVERY project, archived or not, with archivedAt on each so the screen can
  // group them — the same bargain this route already makes for threads, where
  // the space page shows "Archived conversations" as a closed group beneath
  // the live ones.
  //
  // Filtering here instead broke exactly that: the archived ones stopped
  // arriving, so the heading that files them had nothing to render and a
  // project archived from this page appeared to vanish from it. Being in the
  // room is when you most want to see what was put away in it.
  const rows = await db.prepare(`
    SELECT p.*,
      (SELECT COUNT(*) FROM project_stages s WHERE s.project_id = p.id) AS stage_count,
      (SELECT COUNT(*) FROM project_stages s WHERE s.project_id = p.id AND s.status = 'done') AS done_count,
      (SELECT COUNT(*) FROM project_stages s WHERE s.project_id = p.id AND s.status = 'blocked') AS blocked_count
    FROM projects p WHERE p.space_id = ? ORDER BY p.created_at DESC
  `).all(req.space.id);

  res.json({
    projects: rows.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      status: p.status,
      archivedAt: p.archived_at || null,
      stageCount: p.stage_count,
      doneCount: p.done_count,
      blockedCount: p.blocked_count,
    })),
  });
});

router.post('/:spaceId/projects', requireSpaceAccess, async (req, res) => {
  if (!req.access.canWrite) return res.status(403).json({ error: 'You have read-only access here.' });
  const { name, description } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Give the project a name.' });

  const id = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO projects (id, space_id, name, description, status, created_at)
    VALUES (?, ?, ?, ?, 'active', ?)
  `).run(id, req.space.id, String(name).trim(), String(description || ''), new Date().toISOString());

  res.status(201).json({ project: { id, name: String(name).trim() } });
});

router.post('/:spaceId/threads', requireSpaceAccess, async (req, res) => {
  if (!req.access.canWrite) return res.status(403).json({ error: 'You have read-only access here.' });
  // The same bargain an archived thread makes: readable in full, closed to
  // anything new. A room put away that still accepts new conversations was
  // never put away.
  if (req.space.archived_at) {
    return res.status(409).json({
      error: 'This room is archived. Bring it back to start something new in it.',
      archivedAt: req.space.archived_at,
    });
  }
  const { name } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Give the thread a name.' });

  const id = crypto.randomUUID();
  await db.prepare('INSERT INTO threads (id, space_id, name, kind, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, req.space.id, String(name).trim(), 'group', new Date().toISOString());

  const thread = await db.prepare('SELECT * FROM threads WHERE id = ?').get(id);
  res.status(201).json({ thread: { id: thread.id, name: thread.name, kind: thread.kind, createdAt: thread.created_at } });
});

module.exports = router;
