const crypto = require('crypto');
const db = require('./db');
const mentions = require('./mentions');
const { officeAudience } = require('./paAccess');

/**
 * The pad: where a thing you have just thought of goes.
 *
 * WHAT IT IS FOR. tasks.space_id is NOT NULL — nothing can be written down
 * until somebody has decided which space it belongs to. That is the wrong
 * order for a thought. One arrives walking out of a meeting or halfway through
 * a call, and if capturing it costs more than a line it does not get captured;
 * it goes on the back of an envelope, or nowhere. So the pad takes the line
 * first and asks nothing. Space, date, assignee, whether it is even a task —
 * all of that is a later decision, and often somebody else's.
 *
 * WHO CAN SEE A LINE — the rule this file exists to hold in one place:
 *
 *   1. Whoever wrote it. Always.
 *   2. Whoever it was handed to. Always — a line given to a person who cannot
 *      read it has not been given to anybody.
 *   3. The office, if the line was deliberately put there.
 *
 * PRIVATE IS THE DEFAULT AND THAT IS NOT A DETAIL. A principal's jottings are
 * not their office's business. "Call the lawyer", "ask about the school fees",
 * "is Kunle actually up to this" — those are the lines somebody stops writing
 * down at all if a scheduling delegate can read them, and a capture tool
 * nobody trusts is a capture tool nobody uses. The asymmetry is deliberate in
 * the same way it is for booking notes: a private line shown by mistake is
 * embarrassing, a private line that was never written is a lost thought.
 */

const VISIBILITIES = new Set(['private', 'office']);
const STATES = new Set(['open', 'done']);
const ABOUT_KINDS = new Set(['booking', 'itinerary', 'contact']);

const SELECT = `
  SELECT p.*, a.name AS author_name, s.name AS assignee_name, o.name AS owner_name
    FROM pad_items p
    JOIN users a ON a.id = p.author_user_id
    LEFT JOIN users s ON s.id = p.assignee_id
    LEFT JOIN users o ON o.id = p.owner_id
`;

/**
 * The three clauses above, as SQL, built once so no route can forget one.
 * Returns { sql, params } to drop into a WHERE.
 *
 * The office clause is a subquery rather than a set passed in from the caller:
 * a caller that computed the audience itself could pass a stale or a wrong one,
 * and this is the query where being wrong means showing somebody a line they
 * were never meant to read.
 */
function visibleTo(userId) {
  return {
    sql: `(
      p.author_user_id = ?
      OR p.assignee_id = ?
      OR (p.visibility = 'office' AND (
        p.owner_id = ?
        OR EXISTS (SELECT 1 FROM memberships m
                    WHERE m.owner_id = p.owner_id
                      AND m.member_user_id = ?
                      AND m.status = 'active')
      ))
    )`,
    params: [userId, userId, userId, userId],
  };
}

function serialize(p) {
  return {
    id: p.id,
    body: p.body,
    visibility: p.visibility,
    state: p.state,
    authorName: p.author_name,
    authorId: p.author_user_id,
    assigneeId: p.assignee_id || null,
    assigneeName: p.assignee_name || null,
    ownerId: p.owner_id,
    ownerName: p.owner_name || null,
    wakeAt: p.wake_at || null,
    // Awake means the day has come. The pad leads with these, and Today shows
    // them, because a line you asked to be reminded of is the one line on the
    // pad that is actively asking for you.
    awake: !!p.wake_at && Date.parse(p.wake_at) <= Date.now() && p.state === 'open',
    about: p.about_kind ? { kind: p.about_kind, id: p.about_id } : null,
    taskId: p.task_id || null,
    itineraryItemId: p.itinerary_item_id || null,
    createdAt: p.created_at,
    doneAt: p.done_at || null,
  };
}

/** Everything this person may see, waking lines first, then newest. */
async function list(userId, { state = 'open', about = null } = {}) {
  const seen = visibleTo(userId);
  const where = [seen.sql];
  const params = [...seen.params];

  if (state === 'open' || state === 'done') {
    where.push('p.state = ?');
    params.push(state);
  }
  if (about?.kind && about?.id) {
    where.push('p.about_kind = ? AND p.about_id = ?');
    params.push(about.kind, about.id);
  }

  const rows = await db.prepare(`
    ${SELECT} WHERE ${where.join(' AND ')} ORDER BY p.created_at DESC
  `).all(...params);

  const items = rows.map(serialize);
  // Sorted here rather than in SQL: "awake" depends on the clock, and the two
  // backends disagree about how to compare a timestamp to now in a way that is
  // not worth writing twice.
  return items.sort((a, b) => (Number(b.awake) - Number(a.awake))
    || (Date.parse(b.createdAt) - Date.parse(a.createdAt)));
}

/** One line, if this person may see it. Null rather than a throw. */
async function get(userId, id) {
  const seen = visibleTo(userId);
  const row = await db.prepare(`${SELECT} WHERE p.id = ? AND ${seen.sql}`)
    .get(id, ...seen.params);
  return row || null;
}

/**
 * Whether this person may change a line, as opposed to read it.
 *
 * Narrower than reading on purpose. Anyone in the office can read an office
 * line; rewriting or deleting somebody else's note is a different act. The
 * author owns their words; the person it was handed to may tick it off,
 * because that is the whole point of handing it to them.
 */
function canEdit(row, userId) {
  return row.author_user_id === userId;
}
function canSettle(row, userId) {
  return row.author_user_id === userId || row.assignee_id === userId;
}

async function add({
  authorUserId, ownerId, body, visibility = 'private',
  aboutKind = null, aboutId = null, wakeAt = null, assigneeId = null,
}) {
  const text = String(body || '').trim();
  if (!text) return { ok: false, status: 400, error: 'Write something first.' };
  if (!VISIBILITIES.has(visibility)) {
    return { ok: false, status: 400, error: 'A note is either private or on the office pad.' };
  }
  if (aboutKind && !ABOUT_KINDS.has(aboutKind)) {
    return { ok: false, status: 400, error: 'That is not something a note can be about.' };
  }
  if (wakeAt && Number.isNaN(Date.parse(wakeAt))) {
    return { ok: false, status: 400, error: 'That is not a time to come back to it.' };
  }

  // A private line sits on its author's own pad whatever they claim, so a
  // client cannot put a private note on somebody else's pad and hide it there.
  const owner = visibility === 'office' ? (ownerId || authorUserId) : authorUserId;

  const id = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO pad_items (id, owner_id, author_user_id, body, visibility, state,
                           assignee_id, wake_at, about_kind, about_id, created_at)
    VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?)
  `).run(id, owner, authorUserId, text.slice(0, 2000), visibility,
    assigneeId || null, wakeAt || null,
    aboutKind || null, aboutKind ? aboutId : null, new Date().toISOString());

  const row = await db.prepare(`${SELECT} WHERE p.id = ?`).get(id);
  return { ok: true, item: serialize(row) };
}

/**
 * Naming somebody in a line tells them — but only on a line they can read.
 *
 * A private note is not a way to message anybody, and a mention inside one
 * must not become a back channel that quietly delivers a line the author
 * believes only they can see. So this is called for office lines and for a
 * line handed to somebody, never for a private one.
 */
async function tell({ item, author, ownerId }) {
  if (item.visibility === 'private' && !item.assigneeId) return [];
  const audience = await officeAudience(ownerId);
  if (item.assigneeId) audience.add(item.assigneeId);
  const found = await mentions.of(item.body, {
    viewerId: author.id, ownerId, audience,
  });
  await mentions.notify({
    found,
    author,
    ownerId,
    subject: `${author.name} named you on the pad`,
    where: 'a note on the pad',
  });
  return found;
}

module.exports = {
  list, get, add, serialize, canEdit, canSettle, tell, visibleTo,
  VISIBILITIES, STATES, ABOUT_KINDS, SELECT,
};
