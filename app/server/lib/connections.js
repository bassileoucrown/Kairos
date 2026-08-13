const crypto = require('crypto');
const db = require('./db');

// Peers, across principals.
//
// Two assistants running two different executives, trying to put those two
// executives in a room. That negotiation is the single most common
// conversation in the job, and until now the app had nowhere to hold it: the
// two of them share no principal, no space and no membership, so nothing in
// the model connected them at all. It went to WhatsApp, and the confirmation
// went with it.
//
// A connection is emphatically NOT a delegation. It gives neither side any
// reach into the other's principal, calendar, contacts or team. It is a line
// of communication and nothing else, which is why it lives in its own table:
// there is no query anywhere in the app that could mistake one for the other.

const PEER_ROOM_NAME = 'Peer line';

/** Both directions, since either of them may have sent the request. */
async function findBetween(aId, bId) {
  return db.prepare(`
    SELECT * FROM connections
    WHERE (requester_id = ? AND addressee_id = ?)
       OR (requester_id = ? AND addressee_id = ?)
    LIMIT 1
  `).get(aId, bId, bId, aId);
}

/** Used by handle resolution: an accepted connection makes someone visible. */
async function areConnected(aId, bId) {
  const row = await db.prepare(`
    SELECT 1 FROM connections
    WHERE status = 'accepted'
      AND ((requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?))
    LIMIT 1
  `).get(aId, bId, bId, aId);
  return !!row;
}

/**
 * The room the two of them talk in, created on acceptance.
 *
 * An ordinary space with an ordinary thread, so the two registers come for
 * free — and that is the point of doing it here rather than in a chat app.
 * "Confirmed, Thursday 3pm at your offices" can be promoted to a record on
 * the spot, and the confirmation stops living in someone's phone.
 *
 * The space is marked `peer` so nothing treats it as a workspace: it holds
 * one conversation between two people and never projects or stages.
 */
async function ensurePeerLine(connection) {
  if (connection.space_id) {
    const existing = await db.prepare('SELECT * FROM spaces WHERE id = ?').get(connection.space_id);
    if (existing) return existing;
  }

  const requester = await db.prepare('SELECT id, name FROM users WHERE id = ?').get(connection.requester_id);
  const addressee = await db.prepare('SELECT id, name FROM users WHERE id = ?').get(connection.addressee_id);
  if (!requester || !addressee) return null;

  const now = new Date().toISOString();
  const spaceId = crypto.randomUUID();

  // auto_delegate_roles is empty and stays empty. A peer line must never pull
  // in either side's assistants by role default — the whole guarantee is that
  // this connects exactly two people and reaches nobody else's principal.
  await db.prepare(`
    INSERT INTO spaces (id, owner_id, name, context, auto_delegate_roles, kind, created_at)
    VALUES (?, ?, ?, 'work', '', 'peer', ?)
  `).run(spaceId, requester.id, `${requester.name} ↔ ${addressee.name}`, now);

  for (const [user, role] of [[requester, 'owner'], [addressee, 'member']]) {
    await db.prepare(`
      INSERT INTO space_members (id, space_id, user_id, role, can_delegate, created_at)
      VALUES (?, ?, ?, ?, 0, ?)
    `).run(crypto.randomUUID(), spaceId, user.id, role, now);
  }

  await db.prepare(`
    INSERT INTO threads (id, space_id, name, kind, created_at)
    VALUES (?, ?, ?, 'dm', ?)
  `).run(crypto.randomUUID(), spaceId, PEER_ROOM_NAME, now);

  await db.prepare('UPDATE connections SET space_id = ? WHERE id = ?').run(spaceId, connection.id);
  return db.prepare('SELECT * FROM spaces WHERE id = ?').get(spaceId);
}

/** Closing a line: the connection ends and neither can post any more. */
async function closePeerLine(connection) {
  if (!connection.space_id) return;
  await db.prepare('DELETE FROM space_members WHERE space_id = ?').run(connection.space_id);
}

/** The other person's id, whichever end of it this caller is on. */
function otherId(connection, viewerId) {
  return connection.requester_id === viewerId ? connection.addressee_id : connection.requester_id;
}

async function serialize(connection, viewerId) {
  const them = await db.prepare('SELECT id, name, slug, account_category FROM users WHERE id = ?')
    .get(otherId(connection, viewerId));

  let thread = null;
  let lastMessage = null;
  if (connection.space_id && connection.status === 'accepted') {
    thread = await db.prepare("SELECT * FROM threads WHERE space_id = ? AND kind = 'dm' ORDER BY created_at LIMIT 1")
      .get(connection.space_id);
    if (thread) {
      const last = await db.prepare(`
        SELECT m.body, m.created_at, u.name AS author_name
        FROM messages m JOIN users u ON u.id = m.author_id
        WHERE m.thread_id = ? ORDER BY m.created_at DESC LIMIT 1
      `).get(thread.id);
      if (last) {
        lastMessage = {
          body: last.body.length > 140 ? `${last.body.slice(0, 140)}…` : last.body,
          authorName: last.author_name,
          at: last.created_at,
        };
      }
    }
  }

  return {
    id: connection.id,
    status: connection.status,
    note: connection.note,
    // Never the email. A connection is a working line, not an introduction to
    // someone's inbox — the handle is the whole address here.
    person: them && { id: them.id, name: them.name, handle: them.slug },
    incoming: connection.addressee_id === viewerId,
    spaceId: connection.space_id,
    threadId: thread?.id || null,
    lastMessage,
    createdAt: connection.created_at,
  };
}

/** Everything this person has: live lines, requests waiting on them, requests they sent. */
async function listConnections(viewerId) {
  const rows = await db.prepare(`
    SELECT * FROM connections
    WHERE (requester_id = ? OR addressee_id = ?) AND status IN ('pending', 'accepted')
    ORDER BY created_at DESC
  `).all(viewerId, viewerId);

  const all = [];
  for (const r of rows) all.push(await serialize(r, viewerId));

  return {
    connected: all.filter((c) => c.status === 'accepted'),
    incoming: all.filter((c) => c.status === 'pending' && c.incoming),
    outgoing: all.filter((c) => c.status === 'pending' && !c.incoming),
  };
}

module.exports = {
  findBetween, areConnected, ensurePeerLine, closePeerLine, listConnections, serialize, otherId,
};
