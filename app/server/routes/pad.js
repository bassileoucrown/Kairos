const crypto = require('crypto');
const { asyncRouter } = require('../lib/asyncRouter');
const db = require('../lib/db');
const { requireAuth } = require('../lib/auth');
const { requirePaAccess } = require('../lib/paAccess');
const { resolveAccess, spaceAudience } = require('../lib/spaceAccess');
const pad = require('../lib/pad');
const mentions = require('../lib/mentions');
const reachable = require('../lib/reachable');

/**
 * The pad, and the four things a line on it can become.
 *
 * Capture is one field and nothing else — see lib/pad.js for why that is the
 * whole point. Everything below is the second half: a line that turns out to
 * matter stops being a loose end without being retyped somewhere.
 *
 * A promoted line is NOT deleted. It keeps a pointer to whatever it became, so
 * the pad can say "this is a task now" and lead you there. Deleting it would
 * be tidier and would lose the only record that the thought started here.
 */
const router = asyncRouter();
router.use(requireAuth);

router.get('/', async (req, res) => {
  res.json({
    items: await pad.list(req.user.id, {
      state: req.query.state || 'open',
      about: req.query.aboutKind && req.query.aboutId
        ? { kind: req.query.aboutKind, id: req.query.aboutId }
        : null,
    }),
  });
});

router.post('/', async (req, res) => {
  const result = await pad.add({
    authorUserId: req.user.id,
    ownerId: req.body?.ownerId,
    body: req.body?.body,
    // Private unless somebody says otherwise. The safer of the two defaults,
    // and the one that keeps the pad worth writing on at all.
    visibility: req.body?.visibility || 'private',
    aboutKind: req.body?.aboutKind || null,
    aboutId: req.body?.aboutId || null,
    wakeAt: req.body?.wakeAt || null,
  });
  if (!result.ok) return res.status(result.status).json({ error: result.error });

  const found = await pad.tell({
    item: result.item, author: req.user, ownerId: result.item.ownerId,
  });
  res.status(201).json({ item: result.item, mentions: found });
});

async function loadItem(req, res, next) {
  const row = await pad.get(req.user.id, req.params.id);
  if (!row) return res.status(404).json({ error: 'That note is not on your pad.' });
  req.item = row;
  next();
}

/**
 * Change a line: its words, whether it is done, when to come back to it.
 *
 * Two different permissions, because they are two different acts. The author
 * owns their words. The person a line was handed to may tick it off — that is
 * the whole point of handing it to them — but may not rewrite it into
 * something else and call it finished.
 */
router.patch('/:id', loadItem, async (req, res) => {
  const { body, state, wakeAt, visibility } = req.body || {};
  const fields = [];
  const values = [];

  if (body !== undefined || visibility !== undefined) {
    if (!pad.canEdit(req.item, req.user.id)) {
      return res.status(403).json({ error: 'Only whoever wrote it can change it.' });
    }
  }
  if (body !== undefined) {
    const text = String(body).trim();
    if (!text) return res.status(400).json({ error: 'Write something first.' });
    fields.push('body = ?');
    values.push(text.slice(0, 2000));
  }
  if (visibility !== undefined) {
    if (!pad.VISIBILITIES.has(visibility)) {
      return res.status(400).json({ error: 'A note is either private or on the office pad.' });
    }
    fields.push('visibility = ?');
    values.push(visibility);
  }
  if (state !== undefined) {
    if (!pad.STATES.has(state)) return res.status(400).json({ error: 'Unknown state.' });
    if (!pad.canSettle(req.item, req.user.id)) {
      return res.status(403).json({ error: 'That is not yours to settle.' });
    }
    fields.push('state = ?', 'done_at = ?');
    values.push(state, state === 'done' ? new Date().toISOString() : null);
  }
  if (wakeAt !== undefined) {
    if (!pad.canSettle(req.item, req.user.id)) {
      return res.status(403).json({ error: 'That is not yours to settle.' });
    }
    if (wakeAt !== null && Number.isNaN(Date.parse(wakeAt))) {
      return res.status(400).json({ error: 'That is not a time to come back to it.' });
    }
    fields.push('wake_at = ?');
    values.push(wakeAt || null);
  }
  if (fields.length === 0) return res.status(400).json({ error: 'Nothing to change.' });

  await db.prepare(`UPDATE pad_items SET ${fields.join(', ')} WHERE id = ?`)
    .run(...values, req.item.id);
  const row = await db.prepare(`${pad.SELECT} WHERE p.id = ?`).get(req.item.id);
  res.json({ item: pad.serialize(row) });
});

router.delete('/:id', loadItem, async (req, res) => {
  if (!pad.canEdit(req.item, req.user.id)) {
    return res.status(403).json({ error: 'Only whoever wrote it can remove it.' });
  }
  await db.prepare('DELETE FROM pad_items WHERE id = ?').run(req.item.id);
  res.status(204).end();
});

// --- Handing it to somebody ---------------------------------------------

/**
 * A line becomes somebody else's problem, explicitly.
 *
 * The handed-to person can see it whatever the visibility says — that is in
 * lib/pad.js — so this is the one action that widens who can read a private
 * note, and it is therefore deliberate rather than a side effect of typing a
 * name. Only someone who already shares an office with you can be handed one:
 * the pad is not a way to message strangers.
 */
router.post('/:id/hand', loadItem, async (req, res) => {
  if (!pad.canEdit(req.item, req.user.id)) {
    return res.status(403).json({ error: 'Only whoever wrote it can hand it on.' });
  }
  const toUserId = req.body?.toUserId;
  if (!toUserId) return res.status(400).json({ error: 'Say who it is for.' });

  // Through lib/reachable.js, which is also what fills the picker this choice
  // was made from. They used to be two queries: the picker offered accepted
  // peer connections and this refused them, so choosing a name the product
  // had just suggested produced a flat denial.
  if (!await reachable.canReach(req.user.id, toUserId)) {
    // "You do not share an office with them" was true and useless. By far the
    // commonest cause is an invite nobody has accepted — the principal added
    // them on the Team screen, which reads as putting them on your team, and
    // no link between the accounts exists until they accept. Say that, since
    // it is both the likely reason and the thing to go and do.
    const pending = await db.prepare(`
      SELECT 1 AS ok FROM memberships m
       JOIN users u ON lower(u.email) = lower(m.invited_email)
       WHERE u.id = ? AND m.owner_id = ? AND m.status = 'invited'
       LIMIT 1
    `).get(toUserId, req.user.id);
    return res.status(400).json({
      error: pending
        ? 'They have not accepted your invitation yet, so there is nothing linking your accounts. Team, under Account, can send it again.'
        : 'You do not share an office with them.',
    });
  }

  await db.prepare('UPDATE pad_items SET assignee_id = ? WHERE id = ?').run(toUserId, req.item.id);
  const row = await db.prepare(`${pad.SELECT} WHERE p.id = ?`).get(req.item.id);
  const item = pad.serialize(row, req.user.id);

  // Two different things, and it used to only do the second. Being handed work
  // is not a mention of you — mentions.notify only reaches @handles written in
  // the text, so handing somebody "Book the car" with no "@kit" in it told
  // them nothing at all, and the line sat on a screen they had no reason to
  // open. The knock is the fix; the mention still fires for anybody named.
  await pad.knock({
    toUserId,
    ownerId: item.ownerId,
    author: req.user,
    subject: `${req.user.name} handed you something`,
    line: 'has passed you a note on the pad.',
  });
  await pad.tell({ item, author: req.user, ownerId: item.ownerId });
  res.json({ item });
});

// --- Saying something back ------------------------------------------------
//
// A handed line starts a conversation whether the product wants one or not:
// "book the car" is answered with "for what time?". See the pad_replies
// comment in schema.sql for why that lives here rather than in a thread.

router.get('/:id/replies', loadItem, async (req, res) => {
  const rows = await pad.replies(req.item.id);
  res.json({ replies: rows.map(pad.serializeReply) });
});

router.post('/:id/replies', loadItem, async (req, res) => {
  // No permission of its own: loadItem already refused anybody who cannot see
  // the line, and being able to read it is exactly the right to answer it.
  const result = await pad.addReply({
    padItemId: req.item.id,
    authorId: req.user.id,
    body: req.body?.body,
  });
  if (!result.ok) return res.status(result.status).json({ error: result.error });

  // Whoever is now waiting. Worked out after the reply is in, so it names the
  // person the ball has just moved to rather than the one who had it before.
  const row = await db.prepare(`${pad.SELECT} WHERE p.id = ?`).get(req.item.id);
  await pad.knock({
    toUserId: pad.turnBelongsTo(row),
    ownerId: row.owner_id,
    author: req.user,
    subject: `${req.user.name} replied on the pad`,
    line: 'has answered on a note you are part of.',
  });

  res.status(201).json({
    reply: result.reply,
    item: pad.serialize(row, req.user.id),
  });
});

// --- Becoming a task ------------------------------------------------------

/**
 * The line grows up. Where the space is chosen — LATER, which is the point.
 *
 * The pad exists because tasks.space_id is NOT NULL and a thought does not
 * arrive knowing which space it belongs to. This is where that question
 * finally gets asked, by somebody who has had time to think about it.
 */
router.post('/:id/task', loadItem, async (req, res) => {
  if (!pad.canEdit(req.item, req.user.id)) {
    return res.status(403).json({ error: 'Only whoever wrote it can promote it.' });
  }
  if (req.item.task_id) {
    return res.status(400).json({ error: 'That note is already a task.' });
  }
  const { spaceId, projectId, dueAt, assigneeId } = req.body || {};
  if (!spaceId) return res.status(400).json({ error: 'Which space does it belong in?' });

  const access = await resolveAccess(spaceId, req.user.id);
  if (!access) return res.status(404).json({ error: 'Space not found.' });
  if (!access.canWrite) return res.status(403).json({ error: 'You have read-only access here.' });

  const title = String(req.item.body).trim().slice(0, 300);
  const taskId = crypto.randomUUID();

  // YOURS UNLESS YOU SAY OTHERWISE. An unassigned task is on /tasks in a space
  // and on nobody's own list, so promoting a pad line into one moved a loose
  // end from a place you look at to a place you do not — the exact failure the
  // pad exists to prevent. You wrote it down because it was yours to do; the
  // space can reassign it afterwards, which is a decision somebody makes on
  // purpose rather than a hole to fall into.
  const assignee = assigneeId || req.item.assignee_id || req.user.id;
  if (assignee !== req.user.id && !await resolveAccess(spaceId, assignee)) {
    return res.status(400).json({ error: "That person doesn't have access to this space." });
  }

  await db.prepare(`
    INSERT INTO tasks (id, space_id, project_id, stage_id, source_message_id, title,
                       assignee_id, created_by, due_at, priority, status, created_at)
    VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?, 'normal', 'open', ?)
  `).run(taskId, spaceId, projectId || null, title, assignee, req.user.id,
    // A line you asked to be reminded of already carries a date. Carrying it
    // across means the reminder survives the promotion instead of being
    // quietly dropped on the way.
    dueAt || req.item.wake_at || null, new Date().toISOString());

  // The line is kept, pointing at what it became. Deleting it would be tidier
  // and would lose the only record that the thought started on the pad.
  await db.prepare('UPDATE pad_items SET task_id = ?, state = ?, done_at = ? WHERE id = ?')
    .run(taskId, 'done', new Date().toISOString(), req.item.id);

  const audience = await spaceAudience(access.space);
  const found = await mentions.of(title, {
    viewerId: req.user.id, ownerId: access.space.owner_id, audience,
  });
  await mentions.notify({
    found,
    author: req.user,
    ownerId: access.space.owner_id,
    subject: `${req.user.name} named you in a task`,
    where: `a task in "${access.space.name}"`,
  });

  const row = await db.prepare(`${pad.SELECT} WHERE p.id = ?`).get(req.item.id);
  res.status(201).json({ item: pad.serialize(row, req.user.id), taskId });
});

// --- Becoming something on the diary --------------------------------------

/**
 * "Lunch with the auditors" turns into a real thing on a real day.
 *
 * Deliberately the plainest possible item — a title, a start, maybe an end.
 * Everything else an itinerary item can carry (a trip, a flight number, a
 * driver's phone) is edited on the itinerary itself, where those fields live
 * and are validated properly. Reproducing that form here would be a second
 * copy of rules that are already written once.
 */
router.post('/:id/itinerary', requirePaAccessForBody, async (req, res) => {
  const item = await pad.get(req.user.id, req.params.id);
  if (!item) return res.status(404).json({ error: 'That note is not on your pad.' });
  if (!pad.canEdit(item, req.user.id)) {
    return res.status(403).json({ error: 'Only whoever wrote it can promote it.' });
  }
  if (item.itinerary_item_id) {
    return res.status(400).json({ error: 'That note is already on the diary.' });
  }

  const start = new Date(req.body?.startAt);
  if (!req.body?.startAt || Number.isNaN(start.getTime())) {
    return res.status(400).json({ error: 'A valid start time is required.' });
  }
  let end = null;
  if (req.body?.endAt) {
    end = new Date(req.body.endAt);
    if (Number.isNaN(end.getTime())) return res.status(400).json({ error: 'That end time is not valid.' });
    if (end < start) return res.status(400).json({ error: 'It cannot end before it starts.' });
  }

  // The same rule the itinerary itself uses: a principal entering their own
  // plan means it, an assistant's starts as a draft so nothing reaches the
  // principal's day until they say so.
  const status = req.principal.id === req.user.id ? 'confirmed' : 'draft';
  const itemId = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO itinerary_items
      (id, owner_id, created_by, kind, title, start_at, end_at, start_timezone, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(itemId, req.principal.id, req.user.id, 'meeting',
    String(item.body).trim().slice(0, 200), start.toISOString(),
    end ? end.toISOString() : null, req.principal.timezone || 'UTC',
    status, new Date().toISOString());

  await db.prepare('UPDATE pad_items SET itinerary_item_id = ?, state = ?, done_at = ? WHERE id = ?')
    .run(itemId, 'done', new Date().toISOString(), item.id);

  const row = await db.prepare(`${pad.SELECT} WHERE p.id = ?`).get(item.id);
  res.status(201).json({ item: pad.serialize(row, req.user.id), itineraryItemId: itemId, status });
});

/**
 * Whose diary the line is going on.
 *
 * An assistant putting something on a principal's day must have that
 * principal's access, so the ownerId is checked rather than trusted. Defaults
 * to your own diary, which is what a principal writing on their own pad means.
 */
function requirePaAccessForBody(req, res, next) {
  req.params.ownerId = req.body?.ownerId || req.user.id;
  return requirePaAccess(req, res, next);
}

module.exports = router;
