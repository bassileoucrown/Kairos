const crypto = require('crypto');
const db = require('./db');
const mentions = require('./mentions');
const { sendEmail } = require('./email');
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
  SELECT p.*, a.name AS author_name, s.name AS assignee_name, o.name AS owner_name,
    (SELECT COUNT(*) FROM pad_replies r WHERE r.pad_item_id = p.id) AS reply_count,
    (SELECT r.author_id FROM pad_replies r WHERE r.pad_item_id = p.id
      ORDER BY r.created_at DESC LIMIT 1) AS last_reply_by,
    (SELECT r.created_at FROM pad_replies r WHERE r.pad_item_id = p.id
      ORDER BY r.created_at DESC LIMIT 1) AS last_reply_at
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

/**
 * Whose move it is.
 *
 * Worked out from who spoke last rather than from a table of what everybody
 * has read. Read-tracking answers "have you seen this", which is not the
 * question — you can read "which car?" on a bus and it is still your answer
 * that is missing. "Nobody has replied to the last thing said, and the last
 * thing said was not yours" is the same sentence somebody would use out loud,
 * needs no extra table, and cannot drift out of step with the conversation
 * because it IS the conversation.
 *
 * Only lines with two people on them can be somebody's turn. A private note
 * nobody has been handed is not waiting on anybody, and a pad that nagged
 * about your own jottings would be a pad you stopped writing on.
 */
function turnBelongsTo(p) {
  if (p.state !== 'open') return null;
  if (!p.assignee_id) return null;
  const lastSpoke = p.last_reply_by || p.author_user_id;
  // The other party to this line — whichever of the two did not speak last.
  if (lastSpoke === p.author_user_id) return p.assignee_id;
  if (lastSpoke === p.assignee_id) return p.author_user_id;
  // Somebody from the office chipped in on a shared line. It goes back to
  // whoever it was handed to, since they are the one who owes an answer.
  return p.assignee_id;
}

function serialize(p, viewerId = null, aboutOwnerId = null) {
  const turn = turnBelongsTo(p);
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
    // WHOSE appointment, not just which one. The note's own owner is the
    // wrong answer and was the bug: a private line sits on its AUTHOR's pad,
    // so an assistant jotting against their principal's meeting produced a
    // link to /appointments/<their own id>/<booking>, which finds nothing and
    // reads as a note that opens no page. Resolved from the booking itself in
    // present() below, so it is right by construction rather than by guess.
    about: p.about_kind ? { kind: p.about_kind, id: p.about_id, ownerId: aboutOwnerId } : null,
    taskId: p.task_id || null,
    itineraryItemId: p.itinerary_item_id || null,
    createdAt: p.created_at,
    doneAt: p.done_at || null,
    // The conversation this line has grown, if any.
    replyCount: Number(p.reply_count || 0),
    lastReplyAt: p.last_reply_at || null,
    turnBelongsTo: turn,
    yoursToAnswer: !!viewerId && turn === viewerId,
  };
}

/**
 * Rows, ready to be sent.
 *
 * THE ONLY WAY a pad row should reach a response. serialize() cannot do this
 * on its own — it is synchronous and holds no database — and the six routes
 * that each called it separately are exactly the shape of drift this codebase
 * has already been bitten by twice: one of them forgets, and a link somewhere
 * quietly points at nothing.
 *
 * Takes one row or many, and answers in kind.
 */
async function present(rows, viewerId = null) {
  const many = Array.isArray(rows);
  const all = (many ? rows : [rows]).filter(Boolean);
  if (all.length === 0) return many ? [] : null;

  // One query for every appointment mentioned, however many lines mention it.
  const bookingIds = [...new Set(
    all.filter((r) => r.about_kind === 'booking' && r.about_id).map((r) => r.about_id),
  )];
  const owners = new Map();
  if (bookingIds.length > 0) {
    const holes = bookingIds.map(() => '?').join(',');
    for (const b of await db.prepare(
      `SELECT id, owner_id FROM bookings WHERE id IN (${holes})`,
    ).all(...bookingIds)) {
      owners.set(b.id, b.owner_id);
    }
  }

  // A missing owner means the appointment is gone. The line keeps its words
  // and loses its link, rather than offering one that leads to a refusal.
  const out = all.map((r) => serialize(r, viewerId, owners.get(r.about_id) || null));
  return many ? out : out[0];
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

  const items = await present(rows, userId);
  // Sorted here rather than in SQL: "awake" depends on the clock, and the two
  // backends disagree about how to compare a timestamp to now in a way that is
  // not worth writing twice.
  // Waiting on you first, then what you asked to be reminded of, then the
  // rest newest-first. Somebody else being held up outranks your own reminder.
  return items.sort((a, b) => (Number(b.yoursToAnswer) - Number(a.yoursToAnswer))
    || (Number(b.awake) - Number(a.awake))
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
  // Through present() like every other path, so the freshly-made line
  // carries the same resolved about-owner the list would give it.
  return { ok: true, item: await present(row) };
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

/**
 * Telling somebody a line is now theirs.
 *
 * SEPARATE FROM MENTIONS, and that separation is a bug fix. Handing used to go
 * through mentions.notify, which only reaches @handles written in the text —
 * so handing "Book the car" to somebody with no "@kit" in it told them
 * NOTHING. The line appeared on their pad and they found out by opening a
 * screen they had no reason to open. Being given work is not a mention of you;
 * it is the thing itself, and it has to knock.
 *
 * A knock, not a transcript: the words stay in Kairos, where the answer can
 * land beside them, rather than starting a conversation in an inbox that never
 * comes back. Same rule as a booking follow-up.
 */
async function knock({ toUserId, ownerId, author, subject, line }) {
  try {
    if (!toUserId || toUserId === author.id) return;
    const to = await db.prepare('SELECT email FROM users WHERE id = ?').get(toUserId);
    if (!to?.email) return;
    await sendEmail({
      ownerId,
      sentByUserId: author.id,
      toEmail: to.email,
      category: 'mention',
      subject,
      body: `${author.name} ${line}\n\nOpen the pad in Kairos to read it and reply.`,
    });
  } catch { /* Something already saved does not fail over its mail. */ }
}

/** Everything said about a line, oldest first, for somebody who may see it. */
async function replies(padItemId) {
  return db.prepare(`
    SELECT r.*, u.name AS author_name
      FROM pad_replies r
      JOIN users u ON u.id = r.author_id
     WHERE r.pad_item_id = ?
     ORDER BY r.created_at ASC
  `).all(padItemId);
}

function serializeReply(r) {
  return {
    id: r.id,
    body: r.body,
    authorId: r.author_id,
    authorName: r.author_name,
    createdAt: r.created_at,
  };
}

/**
 * Saying something back.
 *
 * No visibility of its own. A reply is readable by exactly whoever can read
 * the line, so it cannot widen an audience or leak a private note into the
 * office by being written in the wrong register — there is no register to get
 * wrong. The permission was decided once, above, on the line.
 */
async function addReply({ padItemId, authorId, body }) {
  const text = String(body || '').trim();
  if (!text) return { ok: false, status: 400, error: 'Write something first.' };
  const id = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO pad_replies (id, pad_item_id, author_id, body, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, padItemId, authorId, text.slice(0, 2000), new Date().toISOString());
  const row = await db.prepare(`
    SELECT r.*, u.name AS author_name FROM pad_replies r
    JOIN users u ON u.id = r.author_id WHERE r.id = ?
  `).get(id);
  return { ok: true, reply: serializeReply(row) };
}

module.exports = {
  list, get, add, serialize, present, canEdit, canSettle, tell, visibleTo, knock,
  replies, addReply, serializeReply, turnBelongsTo,
  VISIBILITIES, STATES, ABOUT_KINDS, SELECT,
};
