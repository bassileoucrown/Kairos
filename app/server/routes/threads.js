const express = require('express');
const { asyncRouter } = require('../lib/asyncRouter');
const crypto = require('crypto');
const db = require('../lib/db');
const { requireAuth } = require('../lib/auth');
const { resolveAccess, spaceAudience, markThreadRead } = require('../lib/spaceAccess');
const { syncStageFromRecords } = require('../lib/stageStatus');
const voice = require('../lib/voiceNotes');
const mentions = require('../lib/mentions');
const webPush = require('../lib/webPush');
const keep = require('../lib/keep');

const router = asyncRouter();
router.use(requireAuth);

const RECORD_TYPES = new Set(['decision', 'approval', 'request', 'update', 'sign_off', 'blocker']);
const OPEN_STATUS_BY_TYPE = {
  decision: 'accepted',
  update: 'accepted',
  approval: 'open',
  request: 'open',
  sign_off: 'open',
  blocker: 'open',
};

// Resolves the thread and the caller's access to its space in one step. Same
// rule as spaces: invisible and non-existent are indistinguishable to the
// client.
async function loadThread(req, res, next) {
  const thread = await db.prepare('SELECT * FROM threads WHERE id = ?').get(req.params.threadId);
  if (!thread) return res.status(404).json({ error: 'Thread not found.' });
  const access = await resolveAccess(thread.space_id, req.user.id);
  if (!access) return res.status(404).json({ error: 'Thread not found.' });
  req.thread = thread;
  req.access = access;
  next();
}

/**
 * An archived room is readable and closed.
 *
 * ONE GUARD, EVERY WAY IN. There are nine ways to put something into a thread
 * — typed, spoken, promoted, acknowledged, edited, taken back, made into a
 * task — and a rule enforced on some of them is not a rule. "Archived" would
 * otherwise mean "hidden from the list", which is a promise the app could not
 * keep the first time somebody deep-linked into an old room and carried on.
 *
 * READING is untouched, deliberately: the whole point of archiving rather than
 * deleting is that every word stays there to be looked up.
 */
function refuseIfArchived(req, res) {
  if (!req.thread.archived_at) return false;
  res.status(409).json({
    error: 'This conversation is archived. Take it out of the archive to add to it.',
    archivedAt: req.thread.archived_at,
  });
  return true;
}

/**
 * What a reply is answering, as a stub rather than the whole message.
 *
 * Enough to recognise the line without loading it twice — the full message is
 * already somewhere in the same response, and shipping a second copy of it
 * would mean two versions of one message travelling together, which is the
 * shape every drift bug in this codebase has had. A stub cannot disagree with
 * the original because it is obviously not the original.
 *
 * Null when the answered message has been deleted. The reply keeps its words
 * and loses its anchor, which is the honest state of affairs.
 */
function replyStub(m) {
  if (!m) return null;
  return {
    id: m.id,
    authorName: m.author_name,
    register: m.register,
    recordType: m.record_type,
    // A voice note has no body. Say so, rather than quoting an empty line.
    body: String(m.body || '').trim() || null,
  };
}

function serializeMessage(m, acks, voiceByMessage, mentionsForMessage, byId, tasksByMessage, keptIds) {
  return {
    id: m.id,
    body: m.body,
    // Already taken out and kept. Said on the message so the screen offers
    // "Keep" once and "Kept" thereafter, rather than a button whose second
    // press appears to do nothing.
    kept: !!keptIds?.has(m.id),
    // The line this one is answering. Present on any format — a note, a
    // record, a recording — because the point of replies is that none of them
    // is a dead end.
    replyTo: replyStub(byId?.get(m.reply_to_id)),
    // What this message became, if somebody turned it into work. Carried on
    // the message rather than only in a list at the foot of the screen: a task
    // assigned off the back of a line is part of that line's story, and the
    // conversation about it belongs beside it rather than in a place with a
    // status dropdown and nowhere to speak.
    tasks: tasksByMessage?.get(m.id) || [],
    // What each @ in the body turned out to be, resolved once on the way out.
    // The screen must not re-derive this: it cannot see who is in the space,
    // and guessing would be exactly the mistake — a contact drawn like a
    // colleague who was told.
    mentions: mentionsForMessage || [],
    // Present only when there is a recording, and metadata only — the audio
    // itself is fetched one message at a time.
    voice: voiceByMessage?.get(m.id) || null,
    register: m.register,
    authorId: m.author_id,
    authorName: m.author_name,
    recordType: m.record_type,
    recordStatus: m.record_status,
    recordSeq: m.record_seq,
    promotedFromId: m.promoted_from_id,
    promotedByName: m.promoted_by_name,
    supersedesId: m.supersedes_id,
    locked: !!m.locked_at,
    createdAt: m.created_at,
    editedAt: m.edited_at,
    acks: acks.filter((a) => a.message_id === m.id).map((a) => ({ userId: a.user_id, name: a.name, ackedAt: a.acked_at })),
    // Carried out. Deliberately separate from acks: acknowledging a decision
    // and having done the thing are different facts about different registers.
    doneAt: m.done_at || null,
    doneBy: m.done_by || null,
    doneByName: m.done_by_name || null,
  };
}

/**
 * Put a conversation away, or take it back out.
 *
 * WHAT ARCHIVING IS FOR. A piece of work finishes and its room stops being
 * live — but the office may be asked about it in a year, and deleting it to
 * tidy a list is how a decision trail disappears. An archived thread leaves
 * the space's live list, accepts no new messages, and stays readable in full.
 *
 * REVERSIBLE, because "finished" is a judgement and judgements get revisited.
 * That is also what makes this the thing to reach for instead of deleting: the
 * cost of being wrong is one tap, not a year of records.
 *
 * WHOEVER CAN WRITE HERE CAN CLOSE IT. Not owner-only: the point is that the
 * person who finishes the work can put the room away when they finish it, and
 * a rule that sends them to find the principal first is a rule that leaves
 * every finished room open forever.
 */
router.post('/:threadId/archive', loadThread, async (req, res) => {
  if (!req.access.canWrite) return res.status(403).json({ error: 'You have read-only access here.' });
  if (req.thread.archived_at) return res.json({ archivedAt: req.thread.archived_at });
  const at = new Date().toISOString();
  await db.prepare('UPDATE threads SET archived_at = ? WHERE id = ?').run(at, req.thread.id);
  res.json({ archivedAt: at });
});

router.delete('/:threadId/archive', loadThread, async (req, res) => {
  if (!req.access.canWrite) return res.status(403).json({ error: 'You have read-only access here.' });
  await db.prepare('UPDATE threads SET archived_at = NULL WHERE id = ?').run(req.thread.id);
  res.json({ archivedAt: null });
});

router.get('/:threadId/messages', loadThread, async (req, res) => {
  // Opening a thread is what reading it means. Stamped before the rows are
  // read so a message that lands mid-request is still counted as unread next
  // time rather than being marked seen by somebody who never saw it.
  await markThreadRead(req.thread.id, req.user.id);

  const rows = await db.prepare(`
    SELECT m.*, u.name AS author_name, p.name AS promoted_by_name,
           d.name AS done_by_name
    FROM messages m
    JOIN users u ON u.id = m.author_id
    LEFT JOIN users p ON p.id = m.promoted_by_id
    LEFT JOIN users d ON d.id = m.done_by
    WHERE m.thread_id = ?
    ORDER BY m.created_at ASC
  `).all(req.thread.id);

  const acks = await db.prepare(`
    SELECT a.*, u.name FROM message_acks a
    JOIN users u ON u.id = a.user_id
    WHERE a.message_id IN (SELECT id FROM messages WHERE thread_id = ?)
  `).all(req.thread.id);

  // When a thread belongs to a stage, hand back enough context to show the
  // breadcrumb and the live status the records here are driving.
  let stage = null;
  if (req.thread.stage_id) {
    stage = await db.prepare(`
      SELECT s.id, s.name, s.status, s.due_at, p.id AS project_id, p.name AS project_name
      FROM project_stages s JOIN projects p ON p.id = s.project_id
      WHERE s.id = ?
    `).get(req.thread.stage_id);
  }

  const voiceByMessage = await voice.forThread(req.thread.id);

  // Every message in the thread, by id, so a reply can name what it answers
  // without a query per reply. The answered message is always in the same
  // thread, which is what makes one map enough.
  const byId = new Map(rows.map((m) => [m.id, m]));

  // The work this conversation produced, hung back on the lines that produced
  // it. One query for the thread; the alternative — a list at the foot of the
  // screen and nothing on the message — is exactly how a task came to be a
  // place a conversation stopped.
  //
  // FINISHED WORK LEAVES. A thread is the live state of a conversation, and a
  // room carrying every task the office has ever closed becomes a room you
  // scroll past rather than read. The task itself is not deleted — it is on the
  // space's list and in My Tasks, where a completed thing belongs — it simply
  // stops taking up room in a conversation that has moved on. Reopening it
  // brings it back, because the filter is the task's own state rather than a
  // second flag that could disagree with it.
  const tasksByMessage = new Map();
  for (const t of await db.prepare(`
    SELECT t.id, t.title, t.status, t.source_message_id, u.name AS assignee_name
      FROM tasks t
      LEFT JOIN users u ON u.id = t.assignee_id
     WHERE t.source_message_id IN (SELECT id FROM messages WHERE thread_id = ?)
       AND t.status != 'done'
     ORDER BY t.created_at ASC
  `).all(req.thread.id)) {
    const list = tasksByMessage.get(t.source_message_id) || [];
    list.push({ id: t.id, title: t.title, status: t.status, assigneeName: t.assignee_name });
    tasksByMessage.set(t.source_message_id, list);
  }

  // One resolution pass for the whole thread rather than one per message: the
  // same handles repeat heavily down a conversation, and a screen should not
  // cost a query per @.
  const audience = await spaceAudience(req.access.space);
  const mentionsPerMessage = await mentions.forBodies(
    rows.map((m) => m.body),
    { viewerId: req.user.id, ownerId: req.access.space.owner_id, audience },
  );

  const keptIds = await keep.keptIdsInThread(req.thread.id);

  res.json({
    thread: {
      id: req.thread.id, name: req.thread.name, spaceId: req.thread.space_id,
      // Said at the top so the screen can close the composer and say why,
      // rather than offering a box whose every submission is refused.
      archivedAt: req.thread.archived_at || null,
    },
    stage: stage && {
      id: stage.id, name: stage.name, status: stage.status, dueAt: stage.due_at,
      projectId: stage.project_id, projectName: stage.project_name,
    },
    canWrite: req.access.canWrite,
    viewerId: req.user.id,
    // Said once, at the top, so the composer knows whether to offer a
    // microphone or explain why it cannot.
    voice: {
      available: voice.isAvailable(),
      unavailableReason: voice.isAvailable() ? null : voice.UNAVAILABLE,
      maxSeconds: voice.MAX_SECONDS,
      retentionDays: voice.RETENTION_DAYS,
    },
    messages: rows.map((m, i) => serializeMessage(
      m, acks, voiceByMessage, mentionsPerMessage[i], byId, tasksByMessage, keptIds,
    )),
  });
});

/** Tell whoever a message was addressed to. The rule itself is in lib/mentions. */
async function tellAddressed({ body, thread, space, author }) {
  const audience = await spaceAudience(space);
  const found = await mentions.of(body, {
    viewerId: author.id, ownerId: space.owner_id, audience,
  });
  await mentions.notify({
    found,
    author,
    ownerId: space.owner_id,
    subject: `${author.name} mentioned you in ${thread.name}`,
    where: `"${thread.name}" (${space.name})`,
    url: `/threads/${thread.id}`,
  });
  return found;
}

/**
 * The direct line rings; a project thread does not.
 *
 * ONLY THE ROOM THAT REPLACED WHATSAPP. The direct line exists because the
 * traffic between a principal and whoever runs their diary — "car's outside",
 * "he's running late" — was going somewhere Kairos could not see, and it went
 * there because that place buzzes. A room that has to be opened to be read has
 * not replaced anything. So every message here reaches everyone else in it.
 *
 * Everywhere else, being told is what an @ is for. A project space with four
 * threads and a working afternoon in it would otherwise produce a notification
 * a minute, and the reliable end of that is somebody turning notifications off
 * — after which the direct line stops buzzing too, and the thing this is for
 * is lost to the thing it is not.
 *
 * Whoever was already told by name is skipped, so being @-ed in the direct line
 * is one buzz rather than two.
 */
async function ringTheRoom({ thread, space, author, alreadyTold, preview }) {
  if (thread.kind !== 'dm') return;
  const audience = await spaceAudience(space);
  const named = new Set((alreadyTold || [])
    .filter((m) => m.kind === 'person' && m.notified).map((m) => m.id));

  // Everybody at once. Sending is on the path of saving the message, and a push
  // service that has stopped answering must cost one timeout for the room
  // rather than one per person in it.
  await Promise.all([...audience]
    .filter((id) => id !== author.id && !named.has(id))
    // No email. This is a chat room, and a message a minute in an inbox is how
    // somebody comes to filter Kairos out of their mail entirely — which would
    // also lose them the notices that genuinely need an inbox. The push is the
    // buzz; the words are in Kairos.
    .map((id) => webPush.notify(id, {
      title: `${author.name} · ${thread.name}`,
      body: preview,
      url: `/threads/${thread.id}`,
      // One line per room. A phone that has been in a pocket through twenty
      // messages should light up saying the latest, not stack twenty cards.
      tag: `thread-${thread.id}`,
    })));
}

/**
 * What a notification is allowed to say about a message.
 *
 * NOT THE MESSAGE. A notification is read by whoever is holding the phone, on a
 * lock screen, in a car or across a table — and in this product the message is
 * quite likely to be where the principal will be at three o'clock. So the buzz
 * carries who and where, and the words stay behind a session.
 */
function previewOf(body) {
  return String(body || '').trim() ? 'Sent you a message.' : 'Sent you a voice note.';
}

/**
 * Whether a reply may be pinned to that message.
 *
 * One function because there are two composers — typed and spoken — and a
 * reply is a reply whichever one it came out of. Two copies of this check
 * would be the third time in this codebase that two queries answering one
 * question drifted apart.
 *
 * Returns the id to store, or false if it names something outside this thread.
 */
async function resolveReplyTo(replyToId, threadId) {
  if (replyToId === undefined || replyToId === null || replyToId === '') return null;
  const target = await db.prepare('SELECT id FROM messages WHERE id = ? AND thread_id = ?')
    .get(replyToId, threadId);
  return target ? target.id : false;
}

async function nextRecordSeq(threadId) {
  const row = await db.prepare("SELECT MAX(record_seq) AS max FROM messages WHERE thread_id = ? AND register = 'record'")
    .get(threadId);
  return (row?.max || 0) + 1;
}

router.post('/:threadId/messages', loadThread, async (req, res) => {
  if (!req.access.canWrite) return res.status(403).json({ error: 'You have read-only access here.' });
  if (refuseIfArchived(req, res)) return;

  const { body, register, recordType, replyToId } = req.body || {};
  if (!body || !String(body).trim()) return res.status(400).json({ error: 'Write something first.' });

  const isRecord = register === 'record';
  if (isRecord && !RECORD_TYPES.has(recordType)) {
    return res.status(400).json({ error: 'Choose what kind of record this is.' });
  }

  // Answering something in particular. Checked to be in THIS thread rather
  // than trusted: an id from another room would render as a quotation of a
  // conversation the reader has no right to see, which is a leak dressed up
  // as a convenience. Refused plainly rather than silently dropped, because a
  // reply that quietly loses its anchor reads to the sender as one that landed.
  const answers = await resolveReplyTo(replyToId, req.thread.id);
  if (answers === false) return res.status(400).json({ error: 'That message is not in this conversation.' });

  const id = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO messages (id, thread_id, author_id, body, register, record_type, record_status, record_seq, reply_to_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, req.thread.id, req.user.id, String(body).trim(),
    isRecord ? 'record' : 'note',
    isRecord ? recordType : null,
    isRecord ? OPEN_STATUS_BY_TYPE[recordType] : null,
    isRecord ? await nextRecordSeq(req.thread.id) : null,
    answers,
    new Date().toISOString(),
  );

  const told = await tellAddressed({
    body: String(body).trim(),
    thread: req.thread,
    space: req.access.space,
    author: req.user,
  });
  await ringTheRoom({
    thread: req.thread,
    space: req.access.space,
    author: req.user,
    alreadyTold: told,
    preview: previewOf(body),
  });

  const stage = isRecord ? await syncStageFromRecords(req.thread.stage_id) : null;
  res.status(201).json({ id, stage });
});

// Voice notes get their own endpoint, and their own body limit.
//
// The global limit is 100 KB, which is a deliberate guard: an ordinary JSON
// endpoint has no business accepting megabytes. Raising it everywhere to suit
// one route would trade that guard away for the convenience of a shared
// handler. So the larger ceiling lives here and nowhere else, and the audio
// itself is still capped well below it by lib/voiceNotes.
const audioBody = express.json({ limit: '4mb' });

router.post('/:threadId/voice', loadThread, audioBody, async (req, res) => {
  if (!req.access.canWrite) return res.status(403).json({ error: 'You have read-only access here.' });
  if (refuseIfArchived(req, res)) return;
  if (!voice.isAvailable()) return res.status(503).json({ error: voice.UNAVAILABLE });

  const { audio, mimeType, durationMs, body, replyToId } = req.body || {};
  if (!audio) return res.status(400).json({ error: 'Record something first.' });

  // Spoken answers get to answer something too. "Which Thursday?" is a
  // question somebody is at least as likely to ask out loud as to type.
  const answers = await resolveReplyTo(replyToId, req.thread.id);
  if (answers === false) return res.status(400).json({ error: 'That message is not in this conversation.' });

  // A voice note is an ordinary message that happens to carry a recording, so
  // everything already built on messages — the direct line, unread counts,
  // tasks from a message — keeps working without knowing voice exists. Any
  // text the sender typed alongside becomes the body; an empty body is what a
  // recording with no transcript honestly looks like until one arrives.
  const messageId = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO messages (id, thread_id, author_id, body, register, reply_to_id, created_at)
    VALUES (?, ?, ?, ?, 'note', ?, ?)
  `).run(messageId, req.thread.id, req.user.id, String(body || '').trim(), answers, new Date().toISOString());

  const result = await voice.attach({
    messageId,
    threadId: req.thread.id,
    authorId: req.user.id,
    base64: audio,
    mimeType,
    durationMs,
  });

  if (result.error) {
    // The message only exists to hang the recording on. If the recording was
    // refused, leaving the empty shell behind would put a blank bubble in
    // somebody's direct line.
    await db.prepare('DELETE FROM messages WHERE id = ?').run(messageId);
    return res.status(result.status || 400).json({ error: result.error });
  }

  // A recording is the case that most needs the buzz: nobody types "the car is
  // downstairs" while walking to it.
  await ringTheRoom({
    thread: req.thread,
    space: req.access.space,
    author: req.user,
    preview: previewOf(''),
  });

  res.status(201).json({ id: messageId, voice: result.voice });
});

// The recording itself. Same access rule as the thread it lives in: a stranger
// gets "not found" rather than a refusal, and never learns a recording exists.
router.get('/:threadId/messages/:messageId/audio', loadThread, async (req, res) => {
  const owns = await db.prepare('SELECT id FROM messages WHERE id = ? AND thread_id = ?')
    .get(req.params.messageId, req.thread.id);
  if (!owns) return res.status(404).json({ error: 'Not found.' });

  const found = await voice.open(req.params.messageId);
  if (!found) return res.status(404).json({ error: 'That recording is no longer available.' });

  res.set('Content-Type', found.mimeType);
  res.set('Content-Length', String(found.buffer.length));
  // Never cached by a shared proxy: this is somebody's voice, fetched with a
  // session cookie, and it should not sit in an intermediary.
  res.set('Cache-Control', 'private, no-store');
  res.send(found.buffer);
});

// Promotion is clerical, not authoritative: anyone who can write may file a
// record, and the record carries the ORIGINAL author, with the promoter noted
// separately. A record's weight comes from whose words it captures — which is
// exactly why an assistant filing their principal's decision is the intended
// use, not a loophole.
router.post('/:threadId/messages/:messageId/promote', loadThread, async (req, res) => {
  if (!req.access.canWrite) return res.status(403).json({ error: 'You have read-only access here.' });
  if (refuseIfArchived(req, res)) return;

  const note = await db.prepare('SELECT * FROM messages WHERE id = ? AND thread_id = ?')
    .get(req.params.messageId, req.thread.id);
  if (!note) return res.status(404).json({ error: 'Message not found.' });
  if (note.register !== 'note') return res.status(400).json({ error: 'That is already a record.' });

  // A record is a frozen line of text that people acknowledge and later cite.
  // A recording with no transcript cannot be that — promoting one would file
  // an empty body and an acknowledgement of nothing. Refused plainly rather
  // than filed as a record whose content nobody can read.
  if (!String(note.body || '').trim()) {
    return res.status(400).json({
      error: 'A voice note can\'t be filed as a record until it has a transcript. '
        + 'Write out what was said and file that instead.',
    });
  }

  const { recordType } = req.body || {};
  if (!RECORD_TYPES.has(recordType)) {
    return res.status(400).json({ error: 'Choose what kind of record this is.' });
  }

  const already = await db.prepare('SELECT id FROM messages WHERE promoted_from_id = ?').get(note.id);
  if (already) return res.status(409).json({ error: 'That note has already been promoted.' });

  const id = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO messages
      (id, thread_id, author_id, body, register, record_type, record_status, record_seq,
       promoted_from_id, promoted_by_id, created_at)
    VALUES (?, ?, ?, ?, 'record', ?, ?, ?, ?, ?, ?)
  `).run(
    id, req.thread.id, note.author_id, note.body,
    recordType, OPEN_STATUS_BY_TYPE[recordType], await nextRecordSeq(req.thread.id),
    note.id, req.user.id, new Date().toISOString(),
  );

  res.status(201).json({ id, stage: await syncStageFromRecords(req.thread.stage_id) });
});

// First acknowledgement freezes the body. After that a decision can only be
// changed by superseding it, so what people agreed to can't be edited out from
// under them.
router.post('/:threadId/messages/:messageId/ack', loadThread, async (req, res) => {
  if (refuseIfArchived(req, res)) return;
  const message = await db.prepare('SELECT * FROM messages WHERE id = ? AND thread_id = ?')
    .get(req.params.messageId, req.thread.id);
  if (!message) return res.status(404).json({ error: 'Message not found.' });
  if (message.register !== 'record') return res.status(400).json({ error: 'Only records are acknowledged.' });

  const now = new Date().toISOString();
  try {
    await db.prepare('INSERT INTO message_acks (id, message_id, user_id, acked_at) VALUES (?, ?, ?, ?)')
      .run(crypto.randomUUID(), message.id, req.user.id, now);
  } catch {
    return res.status(409).json({ error: 'You have already acknowledged this.' });
  }

  if (!message.locked_at) {
    await db.prepare('UPDATE messages SET locked_at = ? WHERE id = ?').run(now, message.id);
  }
  res.json({ ok: true, locked: true });
});

// "That is done" — which is not the same claim as "I have seen it".
//
// A voice note saying "book the car for six tomorrow" had nowhere to record
// that the car was booked. The two things that already existed both miss it:
// an acknowledgement means somebody read a decision and agreed to it, and a
// task is the heavy path, right for something with a deadline and an owner and
// wrong for an instruction worth thirty seconds. So the light one is here.
//
// Only notes. A record is a decision people acknowledge and later cite, not an
// errand somebody runs — keeping done off records is what stops the two
// registers collapsing into one list of things with ticks against them.
//
// Anyone in the thread may mark it, including the author: the assistant who
// said "I will book the car" is exactly the person who then booked it. And it
// is reversible, because "done" gets pressed on the wrong line.

router.post('/:threadId/messages/:messageId/done', loadThread, async (req, res) => {
  if (refuseIfArchived(req, res)) return;
  const message = await db.prepare('SELECT * FROM messages WHERE id = ? AND thread_id = ?')
    .get(req.params.messageId, req.thread.id);
  if (!message) return res.status(404).json({ error: 'Message not found.' });
  if (message.register === 'record') {
    return res.status(400).json({
      error: 'A record is acknowledged, not carried out. Mark the note it came from, or file what happened as a new record.',
    });
  }
  if (message.done_at) return res.status(409).json({ error: 'That is already marked done.' });

  const now = new Date().toISOString();
  await db.prepare('UPDATE messages SET done_at = ?, done_by = ? WHERE id = ?')
    .run(now, req.user.id, message.id);
  res.json({ doneAt: now, doneBy: req.user.id, doneByName: req.user.name });
});

router.delete('/:threadId/messages/:messageId/done', loadThread, async (req, res) => {
  if (refuseIfArchived(req, res)) return;
  const message = await db.prepare('SELECT id FROM messages WHERE id = ? AND thread_id = ?')
    .get(req.params.messageId, req.thread.id);
  if (!message) return res.status(404).json({ error: 'Message not found.' });
  await db.prepare('UPDATE messages SET done_at = NULL, done_by = NULL WHERE id = ?').run(message.id);
  res.json({ doneAt: null });
});

router.patch('/:threadId/messages/:messageId', loadThread, async (req, res) => {
  if (refuseIfArchived(req, res)) return;
  const message = await db.prepare('SELECT * FROM messages WHERE id = ? AND thread_id = ?')
    .get(req.params.messageId, req.thread.id);
  if (!message) return res.status(404).json({ error: 'Message not found.' });
  if (message.author_id !== req.user.id) {
    return res.status(403).json({ error: 'You can only edit your own messages.' });
  }
  if (message.locked_at) {
    return res.status(409).json({
      error: 'This record was acknowledged and can no longer be edited. Supersede it instead.',
    });
  }

  const { body } = req.body || {};
  if (!body || !String(body).trim()) return res.status(400).json({ error: 'Write something first.' });
  const text = String(body).trim();

  await db.prepare('UPDATE messages SET body = ?, edited_at = ? WHERE id = ?')
    .run(text, new Date().toISOString(), message.id);

  // ONLY WHOEVER THE EDIT NEWLY NAMED. Adding "@kit, can you take this" to a
  // line you already sent has to reach Kit — otherwise the only way to address
  // somebody is to get it right first time, and a typo in a handle is
  // unrecoverable. But re-running the whole notification would knock everybody
  // already in the message every time a comma moved. Same rule as retitling a
  // task; see routes/tasks.js.
  const before = new Set(mentions.parse(message.body));
  const audience = await spaceAudience(req.access.space);
  const found = await mentions.of(text, {
    viewerId: req.user.id, ownerId: req.access.space.owner_id, audience,
  });
  await mentions.notify({
    found: found.filter((m) => !before.has(m.handle)),
    author: req.user,
    ownerId: req.access.space.owner_id,
    subject: `${req.user.name} mentioned you in ${req.thread.name}`,
    where: `"${req.thread.name}" (${req.access.space.name})`,
    url: `/threads/${req.thread.id}`,
  });

  res.json({ ok: true });
});

// The escape hatch from immutability: a new record that replaces a locked one,
// leaving both in the history.
/**
 * Taking back something you said.
 *
 * A TOMBSTONE, NOT A DELETE, and in this product that is not squeamishness.
 * People type the wrong thing into a chat and reasonably want it gone — but
 * this is the same product that freezes a record on acknowledgement and keeps
 * an immutable trail against every appointment, and a room where a line can
 * vanish without trace is a room whose history nobody can rely on. Anyone who
 * already read it read it; erasing the row would have Kairos assert something
 * untrue about what happened.
 *
 * So the words go and the fact stays: who, when, and that there was something
 * here. The body is overwritten in the row rather than hidden at render time,
 * because a body that still exists is a body that leaks the first time
 * somebody writes a query that forgets to check.
 *
 * ONLY YOUR OWN, and never a record. A record is the thing other people have
 * agreed to and cited; withdrawing one would be exactly the edit the lock
 * exists to prevent, wearing a different name. Supersede is how a record
 * changes.
 */
router.delete('/:threadId/messages/:messageId', loadThread, async (req, res) => {
  if (refuseIfArchived(req, res)) return;
  const message = await db.prepare('SELECT * FROM messages WHERE id = ? AND thread_id = ?')
    .get(req.params.messageId, req.thread.id);
  if (!message) return res.status(404).json({ error: 'Message not found.' });
  if (message.author_id !== req.user.id) {
    return res.status(403).json({ error: 'You can only take back your own messages.' });
  }
  if (message.register === 'record') {
    return res.status(400).json({
      error: 'A record cannot be taken back — people have acknowledged and cited it. '
        + 'Supersede it instead, which leaves both in the history.',
    });
  }
  // TAKING SOMETHING BACK MEANS IT IS GONE. This left a tombstone for a while
  // — the row stayed, the words were emptied, and the line read "Message
  // withdrawn". The argument for that was that a conversation with holes in it
  // is hard to read. The argument against it won: a row saying somebody said
  // something and thought better of it is an invitation to ask what it was,
  // which is worse in a principal's office than a gap nobody notices. Take it
  // back and there is nothing to point at.

  // Two pointers have no ON DELETE rule of their own, because neither is a
  // relationship the schema wants broken casually. A promoted record holds its
  // own copy of the words, so what is lost here is a link, not the content —
  // and refusing the delete because somebody else filed a record would leave
  // the author unable to retract a line whose text has already been kept
  // elsewhere regardless.
  await db.prepare('UPDATE messages SET promoted_from_id = NULL WHERE promoted_from_id = ?')
    .run(message.id);
  await db.prepare('UPDATE messages SET supersedes_id = NULL WHERE supersedes_id = ?')
    .run(message.id);

  // The recording first, explicitly, rather than trusting the cascade: the row
  // is the only handle on the ciphertext, and a voice note whose message is
  // gone but whose audio still plays would be the loudest possible version of
  // not having taken it back.
  await voice.remove(message.id).catch(() => {});

  // Acknowledgements go with it by cascade. Replies that quoted it and tasks
  // made from it survive with a null pointer — ON DELETE SET NULL, decided
  // when those columns were written: a question somebody asked about this line
  // is still their question, and a task somebody is doing is still their task.
  await db.prepare('DELETE FROM messages WHERE id = ?').run(message.id);

  res.json({ ok: true });
});

/**
 * Take one line out of a conversation and keep it.
 *
 * THIS IS NOT refuseIfArchived's BUSINESS, and the omission is the feature.
 * Every other verb on a message is refused once the room is archived, because
 * an archived room does not change. Keeping changes nothing here — it writes a
 * copy somewhere else — and it is needed precisely when a room is on its way
 * out. Blocking it on an archived thread would mean the one moment you most
 * want to save something is the one moment you cannot: you archive a finished
 * matter, then come to close it, and the sensitive things inside are stranded.
 *
 * WHOEVER CAN WRITE HERE CAN KEEP. Reading it is already permitted, so copying
 * it into the principal's own archive escalates nothing. The bar is
 * participation rather than ownership for the same reason archiving a thread
 * has that bar: the person closing the work is the person who knows what in it
 * mattered, and sending them to find the principal first means nothing gets
 * kept at all.
 */
router.post('/:threadId/messages/:messageId/keep', loadThread, async (req, res) => {
  if (!req.access.canWrite) return res.status(403).json({ error: 'You have read-only access here.' });
  const message = await db.prepare(`
    SELECT m.*, u.name AS author_name FROM messages m
    JOIN users u ON u.id = m.author_id
    WHERE m.id = ? AND m.thread_id = ?
  `).get(req.params.messageId, req.thread.id);
  if (!message) return res.status(404).json({ error: 'Message not found.' });

  const { item } = await keep.keepMessage({
    message,
    thread: req.thread,
    space: req.access.space,
    keeper: req.user,
    note: req.body?.note,
  });
  res.json({ kept: true, keptId: item.id });
});

/**
 * Changed your mind about keeping it.
 *
 * Addressed by the message rather than by the archive entry, because that is
 * where the button is. The archive has its own way to remove an item, which is
 * the only one left once the room is gone.
 */
router.delete('/:threadId/messages/:messageId/keep', loadThread, async (req, res) => {
  if (!req.access.canWrite) return res.status(403).json({ error: 'You have read-only access here.' });
  await db.prepare('DELETE FROM kept_items WHERE owner_id = ? AND source_message_id = ?')
    .run(req.access.space.owner_id, req.params.messageId);
  res.json({ kept: false });
});

router.post('/:threadId/messages/:messageId/supersede', loadThread, async (req, res) => {
  if (!req.access.canWrite) return res.status(403).json({ error: 'You have read-only access here.' });
  if (refuseIfArchived(req, res)) return;

  const old = await db.prepare("SELECT * FROM messages WHERE id = ? AND thread_id = ? AND register = 'record'")
    .get(req.params.messageId, req.thread.id);
  if (!old) return res.status(404).json({ error: 'Record not found.' });

  const { body, recordType } = req.body || {};
  if (!body || !String(body).trim()) return res.status(400).json({ error: 'Write the replacement first.' });
  if (recordType !== undefined && !RECORD_TYPES.has(recordType)) {
    return res.status(400).json({ error: 'Choose what kind of record the replacement is.' });
  }

  // The replacement keeps the original's type unless told otherwise. That
  // matters most for Blockers: superseding one with another Blocker restates
  // the obstacle and the stage stays blocked, while superseding it with an
  // Update clears it. Forcing the type to carry over would make a blocker
  // impossible to lift this way.
  const newType = recordType || old.record_type;

  const id = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO messages
      (id, thread_id, author_id, body, register, record_type, record_status, record_seq, supersedes_id, created_at)
    VALUES (?, ?, ?, ?, 'record', ?, ?, ?, ?, ?)
  `).run(id, req.thread.id, req.user.id, String(body).trim(), newType,
    OPEN_STATUS_BY_TYPE[newType], await nextRecordSeq(req.thread.id), old.id, new Date().toISOString());

  await db.prepare("UPDATE messages SET record_status = 'superseded' WHERE id = ?").run(old.id);
  res.status(201).json({ id, stage: await syncStageFromRecords(req.thread.stage_id) });
});

router.post('/:threadId/messages/:messageId/status', loadThread, async (req, res) => {
  if (!req.access.canWrite) return res.status(403).json({ error: 'You have read-only access here.' });
  if (refuseIfArchived(req, res)) return;
  const { status } = req.body || {};
  // 'resolved' exists for Blockers, where "accepted" and "declined" are both
  // the wrong word for the thing that actually happens to them.
  if (!['accepted', 'declined', 'resolved'].includes(status)) {
    return res.status(400).json({ error: 'Status must be accepted, declined, or resolved.' });
  }
  const message = await db.prepare("SELECT * FROM messages WHERE id = ? AND thread_id = ? AND register = 'record'")
    .get(req.params.messageId, req.thread.id);
  if (!message) return res.status(404).json({ error: 'Record not found.' });

  await db.prepare('UPDATE messages SET record_status = ? WHERE id = ?').run(status, message.id);
  res.json({ ok: true, stage: await syncStageFromRecords(req.thread.stage_id) });
});

module.exports = router;
