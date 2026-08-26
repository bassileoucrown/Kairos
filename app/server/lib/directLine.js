const crypto = require('crypto');
const db = require('./db');
const { roleCanDelegate } = require('./spaceAccess');
const { summarise } = require('./threadSummary');

// The room that is already there.
//
// Spaces, threads and messages already exist, and a principal *could* create a
// space and invite their assistants into it. Nobody does. The message that
// needs sending — "car's outside", "he's running twenty minutes late", "can
// you confirm the Thursday dinner" — is worth thirty seconds, not a setup
// flow, so it ends up on WhatsApp and out of the record entirely.
//
// So every principal has exactly one direct line, created the moment they
// have somebody to talk to, containing them and every active assistant.
// One room rather than a DM per pair, because that is the actual shape of the
// work: two assistants covering the same principal need to see each other's
// traffic, not conduct parallel private conversations about the same diary.
//
// It is an ordinary space and an ordinary thread, so notes, records,
// acknowledgement and task-from-message all work here for free.

/** spaces.kind, not the name — a principal is free to rename the room. */
async function findDirectSpace(principalId) {
  return db.prepare(`
    SELECT * FROM spaces
    WHERE owner_id = ? AND kind = 'direct'
    ORDER BY created_at
    LIMIT 1
  `).get(principalId);
}

/**
 * Makes sure the room exists and its membership matches who currently works
 * for this principal. Safe to call repeatedly — it is called on every invite
 * acceptance and every revoke, and both must land exactly.
 */
async function ensureDirectLine(principalId) {
  const principal = await db.prepare('SELECT id, name FROM users WHERE id = ?').get(principalId);
  if (!principal) return null;

  const assistants = await db.prepare(`
    SELECT u.id, u.account_category
    FROM memberships m
    JOIN users u ON u.id = m.member_user_id
    WHERE m.owner_id = ? AND m.status = 'active' AND m.member_user_id IS NOT NULL
  `).all(principalId);

  let space = await findDirectSpace(principalId);

  // No room until there is somebody to talk to. A principal working alone
  // does not need an empty chat cluttering their Spaces list.
  if (!space && assistants.length === 0) return null;

  const now = new Date().toISOString();
  if (!space) {
    const spaceId = crypto.randomUUID();
    // auto_delegate_roles stays empty: membership here is not the usual
    // role-based default, it is a mirror of the memberships table maintained
    // below. Two mechanisms writing the same rows would eventually disagree.
    await db.prepare(`
      INSERT INTO spaces (id, owner_id, name, context, auto_delegate_roles, kind, created_at)
      VALUES (?, ?, ?, 'work', '', 'direct', ?)
    `).run(spaceId, principalId, `${principal.name} — direct line`, now);
    await db.prepare(`
      INSERT INTO space_members (id, space_id, user_id, role, can_delegate, created_at)
      VALUES (?, ?, ?, 'owner', 1, ?)
    `).run(crypto.randomUUID(), spaceId, principalId, now);
    await db.prepare(`
      INSERT INTO threads (id, space_id, name, kind, created_at)
      VALUES (?, ?, 'Direct line', 'dm', ?)
    `).run(crypto.randomUUID(), spaceId, now);
    space = await db.prepare('SELECT * FROM spaces WHERE id = ?').get(spaceId);
  }

  // Membership follows the memberships table, in both directions: someone
  // who accepts an invite appears here, and someone revoked disappears. A
  // revoked assistant keeping a live line to the principal's team would be a
  // quiet and serious leak.
  const current = await db.prepare('SELECT user_id FROM space_members WHERE space_id = ?').all(space.id);
  const shouldBeIn = new Set([principalId, ...assistants.map((a) => a.id)]);

  for (const a of assistants) {
    if (current.some((c) => c.user_id === a.id)) continue;
    await db.prepare(`
      INSERT INTO space_members (id, space_id, user_id, role, can_delegate, created_at)
      VALUES (?, ?, ?, 'member', ?, ?)
    `).run(crypto.randomUUID(), space.id, a.id, roleCanDelegate(a.account_category) ? 1 : 0, now);
  }
  for (const c of current) {
    if (shouldBeIn.has(c.user_id)) continue;
    await db.prepare('DELETE FROM space_members WHERE space_id = ? AND user_id = ?')
      .run(space.id, c.user_id);
  }

  return space;
}

/** The thread to open, plus how much has happened since this person last looked. */
async function directLineFor(principalId, viewerId) {
  // Self-healing rather than only created on invite: every principal who
  // already had a team before this existed would otherwise be waiting for
  // their next hire to get a room. ensureDirectLine is a no-op once it is
  // there, and returns nothing at all for a principal working alone.
  const space = (await findDirectSpace(principalId)) || (await ensureDirectLine(principalId));
  if (!space) return null;

  const member = await db.prepare('SELECT 1 FROM space_members WHERE space_id = ? AND user_id = ?')
    .get(space.id, viewerId);
  if (!member) return null;

  const thread = await db.prepare("SELECT * FROM threads WHERE space_id = ? AND kind = 'dm' ORDER BY created_at LIMIT 1")
    .get(space.id);
  if (!thread) return null;

  // Through lib/threadSummary.js, which is also what the switcher and the
  // rail read. Three copies of "what was said last and how much is waiting"
  // would eventually disagree about the same room.
  const { lastMessage, unanswered } = await summarise(thread.id, viewerId);

  return { spaceId: space.id, threadId: thread.id, lastMessage, unanswered };
}

module.exports = { ensureDirectLine, directLineFor, findDirectSpace };
