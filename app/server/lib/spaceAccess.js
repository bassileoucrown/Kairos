const crypto = require('crypto');
const db = require('./db');
const { summariseMany } = require('./threadSummary');

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
//
// TAKES THE APPOINTMENT, not the self-description. The two share a vocabulary
// ('pa', 'ea', 'chief_of_staff'), which is what let the wrong one be passed in
// for as long as it was: `memberships.role` is what the principal decided and
// `users.account_category` is what somebody typed at signup. Only the first
// should ever reach this.
function roleCanDelegate(membershipRole) {
  return membershipRole === 'chief_of_staff';
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

/**
 * Everyone who can see a space, as a set of user ids.
 *
 * The mirror image of resolveAccess: that answers "may this one person read
 * it", this answers "who are they all". Used where something is about to be
 * addressed to somebody — an @ in a message — because addressing a person who
 * cannot read the thread promises a delivery that will not happen.
 *
 * A private space is a set of one by construction, and says so here for the
 * same reason resolveAccess short-circuits: a stray space_members row must not
 * be able to widen it.
 */
async function spaceAudience(space) {
  const ids = new Set([space.owner_id]);
  if (space.context === 'private') return ids;
  const rows = await db.prepare('SELECT user_id FROM space_members WHERE space_id = ?')
    .all(space.id);
  for (const r of rows) ids.add(r.user_id);
  return ids;
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

// The same visibility rule as listVisibleSpaces, as a subquery.
//
// Written once and shared rather than restated, because anything that counts
// across spaces has to obey exactly the isolation rule that governs reading
// them. A count is a leak like any other: telling somebody there are four
// unread messages in a private space they cannot open still tells them the
// space exists and that something is happening in it.
//
// Takes the user id three times, in that order.
const VISIBLE_SPACE_IDS = `
  SELECT s.id FROM spaces s WHERE s.owner_id = ?
  UNION
  SELECT s.id FROM spaces s
  JOIN space_members sm ON sm.space_id = s.id
  WHERE sm.user_id = ? AND s.owner_id != ? AND s.context != 'private'
`;

/**
 * How many messages this person has not seen, across every thread they can
 * reach.
 *
 * Their own messages never count. Somebody writing into a thread is not owed a
 * mark against their own name for it, and a rail that lit up when you spoke
 * would be lit permanently for the people who use the product most.
 */
/**
 * Every live room this person can reach, and which space each belongs to.
 *
 * A finished room is not here. Archiving is how somebody says "this is done";
 * carrying on counting it would make the act pointless.
 */
async function visibleThreads(userId) {
  return db.prepare(`
    SELECT t.id, t.space_id
    FROM threads t
    WHERE t.space_id IN (${VISIBLE_SPACE_IDS})
      AND t.archived_at IS NULL
  `).all(userId, userId, userId);
}

/**
 * Unread, totalled and broken down by space.
 *
 * ONE COUNT, COUNTED ONCE. The rail's total used to be its own SQL, with the
 * predicate for "unread" written out a second time beside the one in
 * threadSummary. Both were right, which is exactly why that arrangement is
 * dangerous: nothing fails until somebody changes one of them, and then two
 * places in the app disagree about the same number. That has already happened
 * here once — the chip on a room kept its 1 after the rail went quiet — and it
 * is the bug the user sees, not the one the tests catch.
 *
 * So the rail's total is now the sum of the same per-thread numbers the space
 * list and the thread rows show. If they are ever wrong they are wrong
 * together, which is a bug you can find.
 */
async function unreadBySpace(userId) {
  const threads = await visibleThreads(userId);
  const summaries = await summariseMany(threads.map((t) => t.id), userId);

  const bySpace = new Map();
  let total = 0;
  for (const t of threads) {
    const n = summaries.get(t.id)?.unread || 0;
    if (!n) continue;
    bySpace.set(t.space_id, (bySpace.get(t.space_id) || 0) + n);
    total += n;
  }
  return { bySpace, total };
}

async function unreadMessageCount(userId) {
  return (await unreadBySpace(userId)).total;
}

/**
 * Note that this person has now seen everything in this thread.
 *
 * Stamped from the server's clock rather than from the newest message, so a
 * message written during the same request is not marked read before it has
 * been rendered.
 */
async function markThreadRead(threadId, userId) {
  await db.prepare(`
    INSERT INTO thread_reads (thread_id, user_id, last_read_at)
    VALUES (?, ?, ?)
    ON CONFLICT (thread_id, user_id) DO UPDATE SET last_read_at = ?
  `).run(threadId, userId, new Date().toISOString(), new Date().toISOString());
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
  //
  // FILTERED ON THE MEMBERSHIP ROLE, NOT ON account_category. Those look
  // interchangeable and are not: `memberships.role` is what the PRINCIPAL
  // appointed somebody as, and `users.account_category` is what that person
  // typed about themselves at signup, verified by nobody.
  //
  // Reading the wrong one meant somebody invited as a delegate — scheduling
  // only — who had described themselves as "PA" was auto-added to every Work
  // space the principal created, and so could read every room in it. That is
  // the same defect as the one invites.js carried, in a second place: an
  // unverified self-description deciding access the principal thought they had
  // decided. The default string ('pa,ea,chief_of_staff') is unchanged and
  // means what it always read as — those three appointments in, delegate out.
  const assistants = await db.prepare(`
    SELECT m.member_user_id AS id, m.role
    FROM memberships m
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
    if (!roles.includes(a.role)) continue;
    await insert.run(
      crypto.randomUUID(), space.id, a.id,
      roleCanDelegate(a.role) ? 1 : 0,
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
  spaceAudience,
  listVisibleSpaces,
  unreadMessageCount,
  unreadBySpace,
  visibleThreads,
  markThreadRead,
  applyRoleDefaults,
  requireSpaceAccess,
  requireSpaceWrite,
};
