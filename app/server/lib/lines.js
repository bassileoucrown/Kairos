const db = require('./db');
const { summarise } = require('./threadSummary');

/**
 * Every conversation this person has, in one list.
 *
 * WHAT WAS MISSING. Kairos grew three kinds of room at three different times
 * and never grew a place to see them together. The direct line was one tap from
 * Today. A pair room existed only if you remembered whose name to click. A peer
 * line lived on the Connections screen. So somebody in the middle of a
 * conversation with their principal had no way to see that an assistant had
 * asked them something privately half an hour ago — the message was there, in a
 * room, and nothing on screen pointed at it.
 *
 * THE ROOMS ARE NOT MERGED, AND THAT IS THE POINT. A direct line holds the
 * principal and EVERY active assistant. Folding a private line into it would
 * put a conversation between two people in front of the whole office — which is
 * both the leak the pair room exists to prevent and the end of the general room
 * being general. So this answers "where can I talk", and switching is a tap;
 * what is said in one room stays in it.
 *
 * WHAT COUNTS AS A LINE: a room with a dm thread in it that this person is in.
 *
 *   direct  the office room, one per principal — them and their assistants.
 *   pair    two people who both work in the same office. See lib/pairLine.js.
 *   peer    two principals who have connected. See lib/connections.js.
 *
 * Project spaces are deliberately absent. Those are workspaces with many
 * threads and a name of their own; they belong on Spaces, not in a list whose
 * question is "who am I talking to".
 */

const LINE_KINDS = ['direct', 'pair', 'peer'];

/**
 * Who the other people in a room are, for naming it.
 *
 * A room is named for whoever is NOT you, because "Adaeze Okonkwo — direct
 * line" is a useful label to an assistant and a strange one to Adaeze. The
 * stored space name is kept as a fallback for anything that has been renamed.
 */
async function others(spaceId, viewerId) {
  return db.prepare(`
    SELECT u.id, u.name FROM space_members sm
      JOIN users u ON u.id = sm.user_id
     WHERE sm.space_id = ? AND sm.user_id != ?
     ORDER BY u.name
  `).all(spaceId, viewerId);
}

function label(space, people, viewerId) {
  if (space.kind === 'direct') {
    // Your own office room, or somebody else's you work in.
    return space.owner_id === viewerId
      ? 'Your office'
      : `${people.find((p) => p.id === space.owner_id)?.name || space.name}'s office`;
  }
  if (people.length === 1) return people[0].name;
  if (people.length === 0) return space.name;
  return people.map((p) => p.name.split(/\s+/)[0]).join(', ');
}

/**
 * Every line, newest activity first.
 *
 * Sorted by when something last happened rather than when the room was made:
 * a list of conversations is read from the top, and the top should be the one
 * somebody is most likely to want.
 */
async function linesFor(viewerId) {
  const holes = LINE_KINDS.map(() => '?').join(',');
  const rooms = await db.prepare(`
    SELECT s.id, s.name, s.kind, s.owner_id, t.id AS thread_id, t.name AS thread_name
      FROM space_members sm
      JOIN spaces s ON s.id = sm.space_id
      JOIN threads t ON t.space_id = s.id AND t.kind = 'dm'
     WHERE sm.user_id = ? AND s.kind IN (${holes})
  `).all(viewerId, ...LINE_KINDS);

  const out = [];
  for (const room of rooms) {
    const people = await others(room.id, viewerId);
    // A pair or peer room with nobody else in it is a room whose other person
    // was revoked or closed the line. It is not a conversation any more, and
    // offering it would be offering a dead end.
    if (room.kind !== 'direct' && people.length === 0) continue;

    const { lastMessage, unanswered } = await summarise(room.thread_id, viewerId);
    out.push({
      threadId: room.thread_id,
      spaceId: room.id,
      kind: room.kind,
      name: label(room, people, viewerId),
      // Said separately from the name so a screen can draw "just the two of
      // you" differently from a room with the whole office in it, without
      // parsing a label to find out.
      isPrivate: room.kind !== 'direct',
      people: people.map((p) => ({ id: p.id, name: p.name })),
      lastMessage,
      unanswered,
    });
  }

  return out.sort((a, b) => {
    const at = a.lastMessage?.at || '';
    const bt = b.lastMessage?.at || '';
    if (at !== bt) return bt.localeCompare(at);
    // An empty room sorts under a busy one, and the office room above a pair:
    // it is the one somebody nearly always means.
    return (a.kind === 'direct' ? -1 : 0) - (b.kind === 'direct' ? -1 : 0);
  });
}

module.exports = { linesFor, LINE_KINDS };
