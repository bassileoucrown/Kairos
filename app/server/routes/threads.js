const express = require('express');
const { asyncRouter } = require('../lib/asyncRouter');
const crypto = require('crypto');
const db = require('../lib/db');
const { requireAuth } = require('../lib/auth');
const { resolveAccess } = require('../lib/spaceAccess');
const { syncStageFromRecords } = require('../lib/stageStatus');
const voice = require('../lib/voiceNotes');

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

function serializeMessage(m, acks, voiceByMessage) {
  return {
    id: m.id,
    body: m.body,
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

router.get('/:threadId/messages', loadThread, async (req, res) => {
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

  res.json({
    thread: { id: req.thread.id, name: req.thread.name, spaceId: req.thread.space_id },
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
    messages: rows.map((m) => serializeMessage(m, acks, voiceByMessage)),
  });
});

async function nextRecordSeq(threadId) {
  const row = await db.prepare("SELECT MAX(record_seq) AS max FROM messages WHERE thread_id = ? AND register = 'record'")
    .get(threadId);
  return (row?.max || 0) + 1;
}

router.post('/:threadId/messages', loadThread, async (req, res) => {
  if (!req.access.canWrite) return res.status(403).json({ error: 'You have read-only access here.' });

  const { body, register, recordType } = req.body || {};
  if (!body || !String(body).trim()) return res.status(400).json({ error: 'Write something first.' });

  const isRecord = register === 'record';
  if (isRecord && !RECORD_TYPES.has(recordType)) {
    return res.status(400).json({ error: 'Choose what kind of record this is.' });
  }

  const id = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO messages (id, thread_id, author_id, body, register, record_type, record_status, record_seq, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, req.thread.id, req.user.id, String(body).trim(),
    isRecord ? 'record' : 'note',
    isRecord ? recordType : null,
    isRecord ? OPEN_STATUS_BY_TYPE[recordType] : null,
    isRecord ? await nextRecordSeq(req.thread.id) : null,
    new Date().toISOString(),
  );

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
  if (!voice.isAvailable()) return res.status(503).json({ error: voice.UNAVAILABLE });

  const { audio, mimeType, durationMs, body } = req.body || {};
  if (!audio) return res.status(400).json({ error: 'Record something first.' });

  // A voice note is an ordinary message that happens to carry a recording, so
  // everything already built on messages — the direct line, unanswered counts,
  // tasks from a message — keeps working without knowing voice exists. Any
  // text the sender typed alongside becomes the body; an empty body is what a
  // recording with no transcript honestly looks like until one arrives.
  const messageId = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO messages (id, thread_id, author_id, body, register, created_at)
    VALUES (?, ?, ?, ?, 'note', ?)
  `).run(messageId, req.thread.id, req.user.id, String(body || '').trim(), new Date().toISOString());

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
  const message = await db.prepare('SELECT id FROM messages WHERE id = ? AND thread_id = ?')
    .get(req.params.messageId, req.thread.id);
  if (!message) return res.status(404).json({ error: 'Message not found.' });
  await db.prepare('UPDATE messages SET done_at = NULL, done_by = NULL WHERE id = ?').run(message.id);
  res.json({ doneAt: null });
});

router.patch('/:threadId/messages/:messageId', loadThread, async (req, res) => {
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

  await db.prepare('UPDATE messages SET body = ?, edited_at = ? WHERE id = ?')
    .run(String(body).trim(), new Date().toISOString(), message.id);
  res.json({ ok: true });
});

// The escape hatch from immutability: a new record that replaces a locked one,
// leaving both in the history.
router.post('/:threadId/messages/:messageId/supersede', loadThread, async (req, res) => {
  if (!req.access.canWrite) return res.status(403).json({ error: 'You have read-only access here.' });

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
