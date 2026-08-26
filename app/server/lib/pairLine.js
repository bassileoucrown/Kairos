const crypto = require('crypto');
const db = require('./db');

/**
 * A room for exactly two people.
 *
 * WHY IT IS NOT THE DIRECT LINE. A principal's direct line holds them and every
 * active assistant, which is right for the traffic it was built for — "car's
 * outside" is something the whole office should see, and two assistants
 * covering one diary need each other's messages. But some things are said to
 * one person: a principal asking an assistant about another assistant, an
 * assistant checking something before they raise it in the room. Those went to
 * WhatsApp for the same reason the office's chatter used to, and for one worse
 * reason as well — there was nowhere in Kairos they could go.
 *
 * ONE ROOM PER PAIR, FOUND BY A KEY. Two people clicking each other's names at
 * the same moment must not end up with two conversations, each holding half of
 * what was said. The pair key is the two ids sorted and joined, so it is the
 * same string whichever of them asks, and the column is UNIQUE so the database
 * settles a race rather than the code hoping there isn't one.
 *
 * AN ORDINARY SPACE AND AN ORDINARY THREAD, marked spaces.kind = 'pair'. Notes,
 * records, acknowledgement, replies, tasks from a message and voice notes all
 * work in it for free — and, more to the point, none of them had to learn that
 * a two-person room exists.
 *
 * NOBODY IS THE OWNER, in the sense that matters. spaces.owner_id has to be
 * somebody, so it is whoever opened the room; but membership is both people and
 * neither can remove the other, because a pair room with one member left in it
 * is a conversation somebody has been locked out of their own half of.
 */

/** The same string whichever of the two asks for it. */
function keyFor(a, b) {
  return [a, b].sort().join(':');
}

/**
 * The room, or null.
 *
 * `create` is false by default and that default is load-bearing: reading
 * somebody's card must not mint a room. Otherwise every principal accumulates
 * an empty conversation with everyone whose name they have ever clicked, and
 * the Spaces list becomes a list of people they once glanced at.
 */
async function pairLine(viewerId, otherId, { create = false } = {}) {
  if (!viewerId || !otherId || viewerId === otherId) return null;
  const key = keyFor(viewerId, otherId);

  let space = await db.prepare("SELECT * FROM spaces WHERE pair_key = ? AND kind = 'pair'").get(key);

  if (!space) {
    if (!create) return null;

    const now = new Date().toISOString();
    const spaceId = crypto.randomUUID();
    const them = await db.prepare('SELECT name FROM users WHERE id = ?').get(otherId);
    const me = await db.prepare('SELECT name FROM users WHERE id = ?').get(viewerId);

    try {
      await db.prepare(`
        INSERT INTO spaces (id, owner_id, name, context, auto_delegate_roles, kind, pair_key, created_at)
        VALUES (?, ?, ?, 'work', '', 'pair', ?, ?)
      `).run(spaceId, viewerId, `${me?.name || 'You'} and ${them?.name || 'them'}`, key, now);
    } catch {
      // The UNIQUE on pair_key just settled a race with the other person
      // clicking your name at the same moment. Theirs won; use it.
      return pairLine(viewerId, otherId, { create: false });
    }

    // Both, as members, with the same standing.
    //
    // THESE TWO ROWS ARE THE WHOLE ACCESS CONTROL. resolveAccess reads
    // space_members and nothing else, so a room for two people is for those two
    // exactly as long as this loop writes exactly two rows. Anything that ever
    // adds a third — a well-meant "let the chief of staff see everything" —
    // hands somebody their principal's private line with a colleague, which is
    // the one thing this room exists not to do.
    //
    // auto_delegate_roles is set empty as well, but note that it is belt rather
    // than braces: applyRoleDefaults is only ever called from the Spaces routes,
    // so a pair room would not seed from it whatever it said. It is empty so
    // that stays true if that ever changes.
    for (const id of [viewerId, otherId]) {
      await db.prepare(`
        INSERT INTO space_members (id, space_id, user_id, role, can_delegate, created_at)
        VALUES (?, ?, ?, 'member', 0, ?)
      `).run(crypto.randomUUID(), spaceId, id, now);
    }

    await db.prepare(`
      INSERT INTO threads (id, space_id, name, kind, created_at)
      VALUES (?, ?, ?, 'dm', ?)
    `).run(crypto.randomUUID(), spaceId, `${me?.name || 'You'} and ${them?.name || 'them'}`, now);

    space = await db.prepare('SELECT * FROM spaces WHERE id = ?').get(spaceId);
  }

  // Belt and braces: only somebody actually in the room gets the id back. The
  // pair key already guarantees it, but this is the query that would leak a
  // conversation if the key were ever wrong.
  const member = await db.prepare('SELECT 1 AS ok FROM space_members WHERE space_id = ? AND user_id = ?')
    .get(space.id, viewerId);
  if (!member) return null;

  const thread = await db.prepare("SELECT id FROM threads WHERE space_id = ? AND kind = 'dm' ORDER BY created_at LIMIT 1")
    .get(space.id);
  if (!thread) return null;

  return { spaceId: space.id, threadId: thread.id };
}

module.exports = { pairLine, keyFor };
