const express = require('express');
const crypto = require('crypto');
const db = require('../lib/db');
const { requireAuth } = require('../lib/auth');
const {
  CONTEXTS, DEFAULT_DELEGATE_ROLES, ASSISTANT_ROLES, parseRoles, roleCanDelegate,
  listVisibleSpaces, applyRoleDefaults, requireSpaceAccess,
} = require('../lib/spaceAccess');

const router = express.Router();
router.use(requireAuth);

function serializeSpace(s, viewerRole) {
  return {
    id: s.id,
    name: s.name,
    context: s.context,
    autoDelegateRoles: parseRoles(s.auto_delegate_roles),
    viewerRole: viewerRole || s.viewer_role,
    isOwner: (viewerRole || s.viewer_role) === 'owner',
    createdAt: s.created_at,
  };
}

router.get('/', (req, res) => {
  const spaces = listVisibleSpaces(req.user.id);
  const counts = db.prepare(`
    SELECT t.space_id, COUNT(*) AS thread_count
    FROM threads t GROUP BY t.space_id
  `).all();
  const countBySpace = Object.fromEntries(counts.map((c) => [c.space_id, c.thread_count]));

  res.json({
    spaces: spaces.map((s) => ({
      ...serializeSpace(s),
      threadCount: countBySpace[s.id] || 0,
    })),
  });
});

router.post('/', (req, res) => {
  const { name, context } = req.body || {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'Give the space a name.' });
  }
  if (!CONTEXTS.has(context)) {
    return res.status(400).json({ error: 'Choose Work, Personal, or Private.' });
  }

  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO spaces (id, owner_id, name, context, auto_delegate_roles, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, req.user.id, String(name).trim(), context, DEFAULT_DELEGATE_ROLES[context], new Date().toISOString());

  const space = db.prepare('SELECT * FROM spaces WHERE id = ?').get(id);
  applyRoleDefaults(space);

  res.status(201).json({ space: serializeSpace(space, 'owner') });
});

router.get('/:spaceId', requireSpaceAccess, (req, res) => {
  const threads = db.prepare('SELECT * FROM threads WHERE space_id = ? ORDER BY created_at').all(req.space.id);
  const members = db.prepare(`
    SELECT sm.*, u.name, u.email, u.account_category
    FROM space_members sm JOIN users u ON u.id = sm.user_id
    WHERE sm.space_id = ?
  `).all(req.space.id);
  const owner = db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(req.space.owner_id);

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
    threads: threads.map((t) => ({ id: t.id, name: t.name, kind: t.kind, createdAt: t.created_at })),
  });
});

// Tuning which assistant roles are auto-granted. Owner only — this is the
// "principal adjusts per space" half of role-sets-the-default.
router.patch('/:spaceId', requireSpaceAccess, (req, res) => {
  if (req.access.role !== 'owner') {
    return res.status(403).json({ error: 'Only the space owner can change delegation.' });
  }
  if (req.space.context === 'private') {
    return res.status(400).json({ error: 'Private spaces cannot be delegated to anyone.' });
  }

  const { autoDelegateRoles, name } = req.body || {};
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
  db.prepare(`UPDATE spaces SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  const space = db.prepare('SELECT * FROM spaces WHERE id = ?').get(req.space.id);
  applyRoleDefaults(space); // newly-included roles gain access immediately
  res.json({ space: serializeSpace(space, 'owner') });
});

router.post('/:spaceId/members', requireSpaceAccess, (req, res) => {
  // The structural guarantee: there is no path to a member row on a private
  // space, so "only you" can't be undone by a permission mistake later.
  if (req.space.context === 'private') {
    return res.status(400).json({ error: 'Private spaces are yours alone — they cannot be shared.' });
  }
  if (!req.access.canManageMembers) {
    return res.status(403).json({ error: 'You cannot manage members of this space.' });
  }

  const { email, role } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').trim().toLowerCase());
  if (!user) return res.status(404).json({ error: 'No Kairos account with that email.' });
  if (user.id === req.space.owner_id) return res.status(400).json({ error: 'They already own this space.' });

  const memberRole = role === 'guest' ? 'guest' : 'member';
  try {
    db.prepare(`
      INSERT INTO space_members (id, space_id, user_id, role, can_delegate, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(crypto.randomUUID(), req.space.id, user.id, memberRole,
      roleCanDelegate(user.account_category) ? 1 : 0, new Date().toISOString());
  } catch {
    return res.status(409).json({ error: 'They already have access to this space.' });
  }

  res.status(201).json({ ok: true });
});

router.delete('/:spaceId/members/:memberId', requireSpaceAccess, (req, res) => {
  if (!req.access.canManageMembers) {
    return res.status(403).json({ error: 'You cannot manage members of this space.' });
  }
  const member = db.prepare('SELECT * FROM space_members WHERE id = ? AND space_id = ?')
    .get(req.params.memberId, req.space.id);
  if (!member) return res.status(404).json({ error: 'Member not found.' });

  db.prepare('DELETE FROM space_members WHERE id = ?').run(member.id);
  res.status(204).end();
});

router.post('/:spaceId/threads', requireSpaceAccess, (req, res) => {
  if (!req.access.canWrite) return res.status(403).json({ error: 'You have read-only access here.' });
  const { name } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Give the thread a name.' });

  const id = crypto.randomUUID();
  db.prepare('INSERT INTO threads (id, space_id, name, kind, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, req.space.id, String(name).trim(), 'group', new Date().toISOString());

  const thread = db.prepare('SELECT * FROM threads WHERE id = ?').get(id);
  res.status(201).json({ thread: { id: thread.id, name: thread.name, kind: thread.kind, createdAt: thread.created_at } });
});

module.exports = router;
