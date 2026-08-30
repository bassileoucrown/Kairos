const crypto = require('crypto');
const db = require('./db');

// Taking something out of a conversation and keeping it.
//
// The rule this file exists to hold in one place: keeping COPIES. Everything
// a kept item needs to make sense — the words, who said them, which room, when
// — is written into kept_items at the moment somebody presses Keep, because
// the room is expected to be deleted afterwards. That is not a side effect of
// the design, it is the request: "before deleting, let me move the sensitive
// things to an archive."
//
// See the table comment in schema.sql for why the provenance columns are
// deliberately not foreign keys.

/**
 * Keep a message.
 *
 * IDEMPOTENT ON THE SOURCE. Pressing Keep twice — a double tap, a stale
 * screen, two assistants tidying the same room before it closes — must not
 * produce two entries saying the same thing, because an archive with silent
 * duplicates in it is one nobody trusts to be a full list. The second press
 * returns the first item rather than refusing, so the button's promise ("this
 * is kept") is true either way.
 */
async function keepMessage({ message, thread, space, keeper, note = '', kind = 'message' }) {
  const existing = await db.prepare(
    'SELECT * FROM kept_items WHERE owner_id = ? AND source_message_id = ?',
  ).get(space.owner_id, message.id);
  if (existing) return { item: existing, created: false };

  const row = {
    id: crypto.randomUUID(),
    owner_id: space.owner_id,
    kind,
    // Carried on the copy, because once the room is deleted there is nothing
    // left to join to. An archive that cannot tell a decision from a blocker
    // is a pile of sentences.
    record_type: message.register === 'record' ? (message.record_type || '') : '',
    // A voice note has no body. Say what it was rather than filing a blank —
    // the recording itself is not copied, and an archive entry that looked
    // empty would read as a bug rather than as "there was a recording here".
    body: String(message.body || '').trim() || '(a voice note)',
    note: String(note || '').trim(),
    source_message_id: message.id,
    source_thread_id: thread.id,
    source_space_id: space.id,
    said_by_name: message.author_name || '',
    said_at: message.created_at,
    thread_name: thread.name || '',
    space_name: space.name || '',
    kept_by: keeper.id,
    kept_by_name: keeper.name || '',
    kept_at: new Date().toISOString(),
  };

  await db.prepare(`
    INSERT INTO kept_items (
      id, owner_id, kind, record_type, body, note,
      source_message_id, source_thread_id, source_space_id,
      said_by_name, said_at, thread_name, space_name,
      kept_by, kept_by_name, kept_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.id, row.owner_id, row.kind, row.record_type, row.body, row.note,
    row.source_message_id, row.source_thread_id, row.source_space_id,
    row.said_by_name, row.said_at, row.thread_name, row.space_name,
    row.kept_by, row.kept_by_name, row.kept_at,
  );

  return { item: row, created: true };
}

/**
 * Which messages in a thread are already kept.
 *
 * One query for the whole thread, in the shape acks and tasks already use
 * here. The alternative — asking per message — is a query per line of a
 * conversation, and the screen needs this on every message to know whether to
 * offer Keep or say Kept.
 */
async function keptIdsInThread(threadId) {
  const rows = await db.prepare(
    'SELECT source_message_id FROM kept_items WHERE source_thread_id = ?',
  ).all(threadId);
  return new Set(rows.map((r) => r.source_message_id).filter(Boolean));
}

function serialize(row) {
  return {
    id: row.id,
    kind: row.kind,
    recordType: row.record_type || null,
    body: row.body,
    note: row.note,
    saidByName: row.said_by_name || null,
    saidAt: row.said_at || null,
    threadName: row.thread_name || null,
    spaceName: row.space_name || null,
    keptByName: row.kept_by_name || null,
    keptAt: row.kept_at,
    // Whether the conversation this came from is still there to open. Answered
    // by looking, not assumed: the whole point of the copy is that the answer
    // is often no, and offering a link to a deleted room would be the one
    // dead end an archive must not have.
    sourceThreadId: row.source_thread_id || null,
    sourceLive: !!row.source_live,
  };
}

/** Everything in a principal's archive, newest first. */
async function forOwner(ownerId) {
  const rows = await db.prepare(`
    SELECT k.*, CASE WHEN t.id IS NULL THEN 0 ELSE 1 END AS source_live
      FROM kept_items k
      LEFT JOIN threads t ON t.id = k.source_thread_id
     WHERE k.owner_id = ?
     ORDER BY k.kept_at DESC
  `).all(ownerId);
  return rows.map(serialize);
}

/**
 * Save the record before the room goes.
 *
 * THE ASYMMETRY THIS EXISTS FOR. A conversation is a room, and rooms get made
 * by mistake and want deleting. A record is not a room — it is a decision an
 * office took, an approval somebody gave, a sign-off people are working under.
 * Losing the first is tidying up. Losing the second is losing the thing this
 * product is for, and it happened for the same reason both times: they were
 * stored together, so one delete took both.
 *
 * They are separable because the archive was already built as COPIES rather
 * than references — see the note at the top of this file and the schema. A
 * kept item never depended on its room surviving, so a record moved here
 * before the delete simply carries on existing, with its author, its date, the
 * room it was said in and what kind of record it was.
 *
 * KEPT AUTOMATICALLY, AND SAID SO. The note is not the keeper's words, because
 * there was no keeper — nobody chose this, the app did, on the way past. An
 * archive of unexplained fragments is a pile, and "why is this here" must be
 * answerable for a row nobody filed.
 *
 * ALREADY-KEPT RECORDS ARE LEFT ALONE. keepMessage dedupes on the source
 * message, so a record somebody kept deliberately keeps their note and their
 * name rather than having it overwritten by this.
 */
async function keepRecordsFrom({ thread, space, actor }) {
  const records = await db.prepare(`
    SELECT m.*, u.name AS author_name
      FROM messages m JOIN users u ON u.id = m.author_id
     WHERE m.thread_id = ? AND m.register = 'record'
     ORDER BY m.created_at ASC
  `).all(thread.id);

  let preserved = 0;
  for (const message of records) {
    const { created } = await keepMessage({
      message,
      thread,
      space,
      keeper: actor,
      kind: 'record',
      note: `Kept automatically when "${thread.name}" was deleted.`,
    });
    if (created) preserved += 1;
  }
  return { preserved, records: records.length };
}

module.exports = { keepMessage, keepRecordsFrom, keptIdsInThread, forOwner, serialize };
