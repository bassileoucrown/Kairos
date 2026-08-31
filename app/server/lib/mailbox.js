const crypto = require('crypto');
const db = require('./db');

// The correspondence itself: what arrives, how it is worked, and what a delete
// leaves behind.
//
// WHAT AN ASSISTANT ACTUALLY DOES ALL DAY is not "read email". It is deciding
// what needs the principal, what they can answer themselves, what is waiting on
// somebody else, and what has gone quiet and needs chasing. A mail client
// models none of that — it has read and unread. So the useful part of this
// file is the state a thread carries, not the storage.
//
// AND WHAT A DELETE LEAVES. "Gone, with a record that it existed": the words
// go, the envelope stays. Who wrote to whom, about what, when, and who deleted
// it survive for the principal to read. An assistant clearing an inbox is
// doing routine work and should not have to hesitate; a principal finding out
// six months later that something once existed and being unable to learn
// anything about it is the failure this shape exists to avoid.

const STATES = new Set(['open', 'waiting', 'done']);

const MAX_BODY = 100000;

function token() {
  return crypto.randomBytes(18).toString('base64url');
}

// --- Getting mail in ------------------------------------------------------------

/**
 * Take one delivered message.
 *
 * WHERE IT LANDS is decided by the account's own token, not by the To address
 * as written — a forwarded message keeps the original recipient in its
 * headers, so trusting To would file the principal's mail into whichever
 * account happened to share the address.
 *
 * QUARANTINED WHEN THE SENDER IS A STRANGER, rather than dropped or accepted.
 * Dropped silently loses a first approach from somebody who matters. Accepted
 * lets anybody who learns the address put things in front of a principal, and
 * a forwarding address is not a secret for long. Held, and an assistant
 * decides — which is the job.
 *
 * DEDUPED ON THE SENDER'S OWN MESSAGE-ID. A forward that arrives twice because
 * a rule fired twice is one message, not two, and a thread that shows it twice
 * is a thread somebody stops trusting.
 */
async function deliver({ account, fromName, fromEmail, toEmail, subject, body, externalId, at }) {
  const from = String(fromEmail || '').trim().toLowerCase();
  if (!from) return { ok: false, status: 400, error: 'No sender.' };

  const ext = String(externalId || '').trim() || crypto.randomUUID();
  const already = await db.prepare(
    'SELECT id FROM mail_messages WHERE account_id = ? AND external_id = ?',
  ).get(account.id, ext);
  if (already) return { ok: true, duplicate: true };

  // Known to the office? contacts is the office's own address book, so this
  // asks a question the office has already answered rather than inventing a
  // second list of who matters.
  const contact = await db.prepare(
    'SELECT id, name, relationship_tier FROM contacts WHERE owner_id = ? AND lower(email) = ?',
  ).get(account.owner_id, from);

  const when = at || new Date().toISOString();
  const subj = String(subject || '').trim().slice(0, 500);

  // Threaded on subject and correspondent. Deliberately simple: a real
  // References/In-Reply-To chain is only available from a full sync, and this
  // has to work for a message a principal forwarded by hand, which carries
  // none of it.
  const stripped = subj.replace(/^((re|fwd?|fw)\s*:\s*)+/i, '').trim();
  let thread = await db.prepare(`
    SELECT * FROM mail_threads
     WHERE account_id = ? AND correspondent_email = ? AND deleted_at IS NULL
       AND replace(replace(subject, 'Re: ', ''), 'Fwd: ', '') = ?
     ORDER BY last_at DESC LIMIT 1
  `).get(account.id, from, stripped);

  if (!thread) {
    const id = crypto.randomUUID();
    await db.prepare(`
      INSERT INTO mail_threads (id, account_id, owner_id, subject, correspondent_name,
                                correspondent_email, state, last_at, quarantined, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)
    `).run(id, account.id, account.owner_id, stripped || '(no subject)',
      contact?.name || String(fromName || '').trim(), from, when,
      contact ? 0 : 1, new Date().toISOString());
    thread = await db.prepare('SELECT * FROM mail_threads WHERE id = ?').get(id);
  } else {
    // Anything new on a finished thread reopens it. A reply arriving on a
    // thread somebody marked done is exactly the thing that gets missed.
    await db.prepare(
      "UPDATE mail_threads SET last_at = ?, state = CASE WHEN state = 'done' THEN 'open' ELSE state END WHERE id = ?",
    ).run(when, thread.id);
  }

  const mid = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO mail_messages (id, thread_id, account_id, direction, from_name, from_email,
                               to_email, subject, body, external_id, at, created_at)
    VALUES (?, ?, ?, 'in', ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(mid, thread.id, account.id, String(fromName || '').trim(), from,
    String(toEmail || '').trim(), subj, String(body || '').slice(0, MAX_BODY),
    ext, when, new Date().toISOString());

  return { ok: true, threadId: thread.id, messageId: mid, quarantined: !contact };
}

// --- Working it -----------------------------------------------------------------

function serializeThread(t, extra = {}) {
  return {
    id: t.id,
    accountId: t.account_id,
    subject: t.subject,
    correspondentName: t.correspondent_name || t.correspondent_email,
    correspondentEmail: t.correspondent_email,
    state: t.state,
    assignedTo: t.assigned_to || null,
    snoozedUntil: t.snoozed_until || null,
    lastAt: t.last_at,
    quarantined: !!t.quarantined,
    deletedAt: t.deleted_at || null,
    ...extra,
  };
}

function serializeMessage(m) {
  const gone = !!m.deleted_at;
  return {
    id: m.id,
    direction: m.direction,
    fromName: m.from_name,
    fromEmail: m.from_email,
    toEmail: m.to_email,
    subject: m.subject,
    // THE ENVELOPE SURVIVES, THE WORDS DO NOT. Said as a flag rather than an
    // empty string, so a screen can show "this was deleted by Ngozi on the
    // 4th" instead of a message that looks like it was sent blank.
    body: gone ? '' : m.body,
    deleted: gone,
    deletedAt: m.deleted_at || null,
    deletedBy: m.deleted_by || null,
    sentByUserId: m.sent_by_user_id || null,
    sentAs: m.sent_as || null,
    at: m.at,
  };
}

async function threads(accountId, { state = null, includeDeleted = false, quarantined = false } = {}) {
  const rows = await db.prepare(`
    SELECT * FROM mail_threads
     WHERE account_id = ?
       AND quarantined = ?
       ${state ? 'AND state = ?' : ''}
       ${includeDeleted ? '' : 'AND deleted_at IS NULL'}
     ORDER BY last_at DESC LIMIT 200
  `).all(...[accountId, quarantined ? 1 : 0, ...(state ? [state] : [])]);
  return rows.map((t) => serializeThread(t));
}

async function messagesIn(threadId) {
  const rows = await db.prepare(
    'SELECT * FROM mail_messages WHERE thread_id = ? ORDER BY at',
  ).all(threadId);
  return rows.map(serializeMessage);
}

async function organise(threadId, { state, assignedTo, snoozedUntil, releaseQuarantine }) {
  const sets = [];
  const args = [];
  if (state !== undefined) {
    if (!STATES.has(state)) return { ok: false, status: 400, error: 'Not a state.' };
    sets.push('state = ?'); args.push(state);
  }
  if (assignedTo !== undefined) { sets.push('assigned_to = ?'); args.push(assignedTo || null); }
  if (snoozedUntil !== undefined) { sets.push('snoozed_until = ?'); args.push(snoozedUntil || null); }
  if (releaseQuarantine) { sets.push('quarantined = 0'); }
  if (!sets.length) return { ok: false, status: 400, error: 'Nothing to change.' };
  args.push(threadId);
  await db.prepare(`UPDATE mail_threads SET ${sets.join(', ')} WHERE id = ?`).run(...args);
  return { ok: true };
}

/**
 * Delete: the words go, the envelope stays.
 *
 * Written to the access log as well as stamped on the row, because the two
 * answer different questions. The row answers "what happened to this message";
 * the log answers "what has been deleted from my correspondence", which is the
 * question a principal asks without having a specific message in mind.
 */
async function remove({ thread, actorId, ownerId }) {
  const now = new Date().toISOString();
  await db.prepare(`
    UPDATE mail_messages SET body = '', deleted_at = ?, deleted_by = ?
     WHERE thread_id = ? AND deleted_at IS NULL
  `).run(now, actorId, thread.id);
  await db.prepare('UPDATE mail_threads SET deleted_at = ?, deleted_by = ? WHERE id = ?')
    .run(now, actorId, thread.id);

  await db.prepare(`
    INSERT INTO access_log (id, actor_id, subject_owner_id, essential_id, action, field, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(crypto.randomUUID(), actorId, ownerId, thread.id, 'mail_delete',
    `${thread.correspondent_email} — ${thread.subject}`, now);
  return { ok: true };
}

/**
 * Purge: the envelope goes too. The principal only.
 *
 * The one act with no way back, which is why lib/mailAccess.js never grants it
 * to an assistant however trusted. Still logged — a principal clearing their
 * own record is entitled to do it, and the fact that a purge happened is not
 * itself a secret from them.
 */
async function purge({ thread, actorId, ownerId }) {
  await db.prepare(`
    INSERT INTO access_log (id, actor_id, subject_owner_id, essential_id, action, field, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(crypto.randomUUID(), actorId, ownerId, thread.id, 'mail_purge',
    `${thread.correspondent_email} — ${thread.subject}`, new Date().toISOString());
  await db.prepare('DELETE FROM mail_threads WHERE id = ?').run(thread.id);
  return { ok: true };
}

module.exports = {
  STATES, MAX_BODY, token,
  deliver, threads, messagesIn, organise, remove, purge,
  serializeThread, serializeMessage,
};
