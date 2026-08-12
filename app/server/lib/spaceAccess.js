const crypto = require('crypto');
const db = require('./db');

// Access resolution for the collaboration layer. Every read and write of a
// space, thread, or message goes through here — there is deliberately no
// second path, because the isolation rules in docs/collaboration-spec.html
// (section 03) are only worth anything if they can't be routed around.

const CONTEXTS = new Set(['work', 'personal', 'private']);
const ASSISTANT_ROLES = new Set(['pa', 'ea', 'chief_of_staff']);

// Role sets the opening position, not a ceiling: these are the roles
// auto-granted access when a space is created, which the owner then tunes per
// space. A PA routinely runs household logistics, so Personal is deliberately
// opt-in rather than forbidden — and Private is unreachable for everyone.
const DEFAULT_DELEGATE_ROLES = {
  work: 'pa,ea,chief_of_staff',
  personal: '',
  private: '',
};

function parseRoles(csv) {
  return String(csv || '').split(',').map((r) => r.trim()).filter(Boolean);
}

// Only a Chief of Staff can hand out and withdraw other assistants' access —
// the single genuinely hierarchical capability among the assistant roles.
function roleCanDelegate(accountCategory) {
  return accountCategory === 'chief_of_staff';
}

async function getSpace(spaceId) {
  return await db.prepare('SELECT * FROM spaces WHERE id = ?').get(spaceId);
}

/**
 * Resolves what `userId` may do in `spaceId`.
 * Returns null when the space doesn't exist OR the user can't see it — the
 * caller must not distinguish those two cases to the client, since the mere
 * existence of a space is itself information the owner hasn't shared
 * (isolation rule 7).
 */
async function resolveAccess(spaceId, userId) {
  const space = await getSpace(spaceId);
  if (!space) return null;

  if (space.owner_id === userId) {
    return { space, role: 'owner', canRead: true, canWrite: true, canManageMembers: true };
  }

  // A private space has no members by construction. Short-circuit before even
  // consulting space_members so that a stray row — from a migration, a bug, a
  // future refactor — still can't open a door that is supposed not to exist.
  if (space.context === 'private') return null;

  const member = await db.prepare('SELECT * FROM space_members WHERE space_id = ? AND user_id = ?')
    .get(spaceId, userId);
  if (!member) return null;

  return {
    space,
    role: member.role,
    canRead: true,
    canWrite: member.role !== 'guest',
    canManageMembers: !!member.can_delegate,
  };
}

/** Every space the user can see: those they own, plus those they're a member of. */
async function listVisibleSpaces(userId) {
  return await db.prepare(`
    SELECT s.*, 'owner' AS viewer_role
    FROM spaces s
    WHERE s.owner_id = ?
    UNION ALL
    SELECT s.*, sm.role AS viewer_role
    FROM spaces s
    JOIN space_members sm ON sm.space_id = s.id
    WHERE sm.user_id = ? AND s.owner_id != ? AND s.context != 'private'
    ORDER BY context, created_at DESC
  `).all(userId, userId, userId);
}

/**
 * Seeds membership for a newly created space from the owner's active
 * assistants, filtered by the space's auto_delegate_roles. Private spaces are
 * skipped outright.
 */
async function applyRoleDefaults(space) {
  if (space.context === 'private') return 0;
  const roles = parseRoles(space.auto_delegate_roles);
  if (roles.length === 0) return 0;

  // The existing principal<->assistant relationship (memberships) is what
  // makes someone an assistant at all; space_members is the per-space grant
  // layered on top of it.
  const assistants = await db.prepare(`
    SELECT u.id, u.account_category
    FROM memberships m
    JOIN users u ON u.id = m.member_user_id
    WHERE m.owner_id = ? AND m.status = 'active' AND m.member_user_id IS NOT NULL
  `).all(space.owner_id);

  // ON CONFLICT DO NOTHING is the portable spelling; SQLite understands it too,
  // where INSERT OR IGNORE would not survive the move to Postgres.
  const insert = db.prepare(`
    INSERT INTO space_members (id, space_id, user_id, role, can_delegate, created_at)
    VALUES (?, ?, ?, 'member', ?, ?)
    ON CONFLICT (space_id, user_id) DO NOTHING
  `);

  let added = 0;
  for (const a of assistants) {
    if (!roles.includes(a.account_category)) continue;
    await insert.run(
      crypto.randomUUID(), space.id, a.id,
      roleCanDelegate(a.account_category) ? 1 : 0,
      new Date().toISOString(),
    );
    added += 1;
  }
  return added;
}

/** Express guard: attaches req.access for :spaceId, 404s when not visible. */
async function requireSpaceAccess(req, res, next) {
  const access = await resolveAccess(req.params.spaceId, req.user.id);
  // 404 rather than 403 — see resolveAccess: never confirm a space exists to
  // someone who isn't in it.
  if (!access) return res.status(404).json({ error: 'Space not found.' });
  req.access = access;
  req.space = access.space;
  next();
}

function requireSpaceWrite(req, res, next) {
  if (!req.access?.canWrite) {
    return res.status(403).json({ error: 'You have read-only access to this space.' });
  }
  next();
}

module.exports = {
  CONTEXTS,
  ASSISTANT_ROLES,
  DEFAULT_DELEGATE_ROLES,
  parseRoles,
  roleCanDelegate,
  resolveAccess,
  listVisibleSpaces,
  applyRoleDefaults,
  requireSpaceAccess,
  requireSpaceWrite,
};
