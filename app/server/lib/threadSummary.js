const db = require('./db');

/**
 * What a room looks like from the outside: the last thing said, and how much
 * of it is waiting on you.
 *
 * ONE ANSWER, THREE CALLERS. Today shows the direct line, the switcher on a
 * thread shows every line you have, and the rail counts what is unanswered.
 * Those were about to be three copies of the same three queries, and this
 * codebase has been bitten by that shape often enough to know how it ends —
 * one of them learns about voice notes and the others do not, or one counts
 * from a different moment and two rooms disagree about the same number.
 *
 * "UNANSWERED" IS DELIBERATELY NOT "UNREAD". There is no read-receipt table,
 * and adding one would answer a question nobody asks — you can read "which
 * car?" on a bus and it is still your answer that is missing. Counting what
 * has been said by other people since the last thing YOU said is the number
 * that matters to somebody glancing at a list: has anything happened here that
 * I have not answered.
 */

/**
 * The words a one-line preview should show.
 *
 * A voice note carries no text until somebody transcribes it, and a blank line
 * beside a name reads as a bug rather than as a recording waiting to be played
 * — so it is described instead. Same for a message that has been withdrawn:
 * the preview says so rather than showing an empty row.
 */
function preview(last) {
  if (!last) return '';
  if (last.withdrawn_at) return 'Message withdrawn';
  const body = String(last.body || '').trim();
  if (body) return body.length > 140 ? `${body.slice(0, 140)}…` : body;
  if (last.duration_ms === null || last.duration_ms === undefined) return '';
  const secs = Math.max(1, Math.round(Number(last.duration_ms) / 1000));
  return `Voice note · ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
}

/** { lastMessage, unanswered } for one thread, as one person sees it. */
async function summarise(threadId, viewerId) {
  const last = await db.prepare(`
    SELECT m.id, m.body, m.created_at, m.withdrawn_at, u.name AS author_name, v.duration_ms
    FROM messages m
    JOIN users u ON u.id = m.author_id
    LEFT JOIN voice_notes v ON v.message_id = m.id
    WHERE m.thread_id = ?
    ORDER BY m.created_at DESC LIMIT 1
  `).get(threadId);

  const mine = await db.prepare(`
    SELECT created_at FROM messages WHERE thread_id = ? AND author_id = ?
    ORDER BY created_at DESC LIMIT 1
  `).get(threadId, viewerId);

  const since = await db.prepare(`
    SELECT COUNT(*) AS n FROM messages
    WHERE thread_id = ? AND author_id != ? AND created_at > ?
  `).get(threadId, viewerId, mine?.created_at || '');

  return {
    lastMessage: last ? {
      body: preview(last),
      isVoice: last.duration_ms !== null && last.duration_ms !== undefined,
      authorName: last.author_name,
      at: last.created_at,
    } : null,
    unanswered: Number(since?.n || 0),
  };
}

module.exports = { summarise, preview };
