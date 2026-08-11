const express = require('express');
const crypto = require('crypto');
const db = require('../lib/db');
const { requireAuth } = require('../lib/auth');
const { resolveAccess } = require('../lib/spaceAccess');
const { syncStageFromRecords } = require('../lib/stageStatus');

const router = express.Router();
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
function loadThread(req, res, next) {
  const thread = db.prepare('SELECT * FROM threads WHERE id = ?').get(req.params.threadId);
  if (!thread) return res.status(404).json({ error: 'Thread not found.' });
  const access = resolveAccess(thread.space_id, req.user.id);
  if (!access) return res.status(404).json({ error: 'Thread not found.' });
  req.thread = thread;
  req.access = access;
  next();
}

function serializeMessage(m, acks) {
  return {
    id: m.id,
    body: m.body,
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
  };
}

router.get('/:threadId/messages', loadThread, (req, res) => {
  const rows = db.prepare(`
    SELECT m.*, u.name AS author_name, p.name AS promoted_by_name
    FROM messages m
    JOIN users u ON u.id = m.author_id
    LEFT JOIN users p ON p.id = m.promoted_by_id
    WHERE m.thread_id = ?
    ORDER BY m.created_at ASC
  `).all(req.thread.id);

  const acks = db.prepare(`
    SELECT a.*, u.name FROM message_acks a
    JOIN users u ON u.id = a.user_id
    WHERE a.message_id IN (SELECT id FROM messages WHERE thread_id = ?)
  `).all(req.thread.id);

  // When a thread belongs to a stage, hand back enough context to show the
  // breadcrumb and the live status the records here are driving.
  let stage = null;
  if (req.thread.stage_id) {
    stage = db.prepare(`
      SELECT s.id, s.name, s.status, s.due_at, p.id AS project_id, p.name AS project_name
      FROM project_stages s JOIN projects p ON p.id = s.project_id
      WHERE s.id = ?
    `).get(req.thread.stage_id);
  }

  res.json({
    thread: { id: req.thread.id, name: req.thread.name, spaceId: req.thread.space_id },
    stage: stage && {
      id: stage.id, name: stage.name, status: stage.status, dueAt: stage.due_at,
      projectId: stage.project_id, projectName: stage.project_name,
    },
    canWrite: req.access.canWrite,
    viewerId: req.user.id,
    messages: rows.map((m) => serializeMessage(m, acks)),
  });
});

function nextRecordSeq(threadId) {
  const row = db.prepare("SELECT MAX(record_seq) AS max FROM messages WHERE thread_id = ? AND register = 'record'")
    .get(threadId);
  return (row?.max || 0) + 1;
}

router.post('/:threadId/messages', loadThread, (req, res) => {
  if (!req.access.canWrite) return res.status(403).json({ error: 'You have read-only access here.' });

  const { body, register, recordType } = req.body || {};
  if (!body || !String(body).trim()) return res.status(400).json({ error: 'Write something first.' });

  const isRecord = register === 'record';
  if (isRecord && !RECORD_TYPES.has(recordType)) {
    return res.status(400).json({ error: 'Choose what kind of record this is.' });
  }

  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO messages (id, thread_id, author_id, body, register, record_type, record_status, record_seq, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, req.thread.id, req.user.id, String(body).trim(),
    isRecord ? 'record' : 'note',
    isRecord ? recordType : null,
    isRecord ? OPEN_STATUS_BY_TYPE[recordType] : null,
    isRecord ? nextRecordSeq(req.thread.id) : null,
    new Date().toISOString(),
  );

  const stage = isRecord ? syncStageFromRecords(req.thread.stage_id) : null;
  res.status(201).json({ id, stage });
});

// Promotion is clerical, not authoritative: anyone who can write may file a
// record, and the record carries the ORIGINAL author, with the promoter noted
// separately. A record's weight comes from whose words it captures — which is
// exactly why an assistant filing their principal's decision is the intended
// use, not a loophole.
router.post('/:threadId/messages/:messageId/promote', loadThread, (req, res) => {
  if (!req.access.canWrite) return res.status(403).json({ error: 'You have read-only access here.' });

  const note = db.prepare('SELECT * FROM messages WHERE id = ? AND thread_id = ?')
    .get(req.params.messageId, req.thread.id);
  if (!note) return res.status(404).json({ error: 'Message not found.' });
  if (note.register !== 'note') return res.status(400).json({ error: 'That is already a record.' });

  const { recordType } = req.body || {};
  if (!RECORD_TYPES.has(recordType)) {
    return res.status(400).json({ error: 'Choose what kind of record this is.' });
  }

  const already = db.prepare('SELECT id FROM messages WHERE promoted_from_id = ?').get(note.id);
  if (already) return res.status(409).json({ error: 'That note has already been promoted.' });

  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO messages
      (id, thread_id, author_id, body, register, record_type, record_status, record_seq,
       promoted_from_id, promoted_by_id, created_at)
    VALUES (?, ?, ?, ?, 'record', ?, ?, ?, ?, ?, ?)
  `).run(
    id, req.thread.id, note.author_id, note.body,
    recordType, OPEN_STATUS_BY_TYPE[recordType], nextRecordSeq(req.thread.id),
    note.id, req.user.id, new Date().toISOString(),
  );

  res.status(201).json({ id, stage: syncStageFromRecords(req.thread.stage_id) });
});

// First acknowledgement freezes the body. After that a decision can only be
// changed by superseding it, so what people agreed to can't be edited out from
// under them.
router.post('/:threadId/messages/:messageId/ack', loadThread, (req, res) => {
  const message = db.prepare('SELECT * FROM messages WHERE id = ? AND thread_id = ?')
    .get(req.params.messageId, req.thread.id);
  if (!message) return res.status(404).json({ error: 'Message not found.' });
  if (message.register !== 'record') return res.status(400).json({ error: 'Only records are acknowledged.' });

  const now = new Date().toISOString();
  try {
    db.prepare('INSERT INTO message_acks (id, message_id, user_id, acked_at) VALUES (?, ?, ?, ?)')
      .run(crypto.randomUUID(), message.id, req.user.id, now);
  } catch {
    return res.status(409).json({ error: 'You have already acknowledged this.' });
  }

  if (!message.locked_at) {
    db.prepare('UPDATE messages SET locked_at = ? WHERE id = ?').run(now, message.id);
  }
  res.json({ ok: true, locked: true });
});

router.patch('/:threadId/messages/:messageId', loadThread, (req, res) => {
  const message = db.prepare('SELECT * FROM messages WHERE id = ? AND thread_id = ?')
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

  db.prepare('UPDATE messages SET body = ?, edited_at = ? WHERE id = ?')
    .run(String(body).trim(), new Date().toISOString(), message.id);
  res.json({ ok: true });
});

// The escape hatch from immutability: a new record that replaces a locked one,
// leaving both in the history.
router.post('/:threadId/messages/:messageId/supersede', loadThread, (req, res) => {
  if (!req.access.canWrite) return res.status(403).json({ error: 'You have read-only access here.' });

  const old = db.prepare("SELECT * FROM messages WHERE id = ? AND thread_id = ? AND register = 'record'")
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
  db.prepare(`
    INSERT INTO messages
      (id, thread_id, author_id, body, register, record_type, record_status, record_seq, supersedes_id, created_at)
    VALUES (?, ?, ?, ?, 'record', ?, ?, ?, ?, ?)
  `).run(id, req.thread.id, req.user.id, String(body).trim(), newType,
    OPEN_STATUS_BY_TYPE[newType], nextRecordSeq(req.thread.id), old.id, new Date().toISOString());

  db.prepare("UPDATE messages SET record_status = 'superseded' WHERE id = ?").run(old.id);
  res.status(201).json({ id, stage: syncStageFromRecords(req.thread.stage_id) });
});

router.post('/:threadId/messages/:messageId/status', loadThread, (req, res) => {
  if (!req.access.canWrite) return res.status(403).json({ error: 'You have read-only access here.' });
  const { status } = req.body || {};
  // 'resolved' exists for Blockers, where "accepted" and "declined" are both
  // the wrong word for the thing that actually happens to them.
  if (!['accepted', 'declined', 'resolved'].includes(status)) {
    return res.status(400).json({ error: 'Status must be accepted, declined, or resolved.' });
  }
  const message = db.prepare("SELECT * FROM messages WHERE id = ? AND thread_id = ? AND register = 'record'")
    .get(req.params.messageId, req.thread.id);
  if (!message) return res.status(404).json({ error: 'Record not found.' });

  db.prepare('UPDATE messages SET record_status = ? WHERE id = ?').run(status, message.id);
  res.json({ ok: true, stage: syncStageFromRecords(req.thread.stage_id) });
});

module.exports = router;
