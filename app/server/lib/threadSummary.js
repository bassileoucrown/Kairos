const db = require('./db');

/**
 * What a room looks like from the outside: the last thing said, and how much
 * of it is waiting on you.
 *
 * ONE ANSWER, THREE CALLERS. Today shows the direct line, the switcher on a
 * thread shows every line you have, and the rail counts what is unread.
 * Those were about to be three copies of the same three queries, and this
 * codebase has been bitten by that shape often enough to know how it ends —
 * one of them learns about voice notes and the others do not, or one counts
 * from a different moment and two rooms disagree about the same number.
 *
 * IT COUNTS WHAT YOU HAVE NOT READ, and that is a correction.
 *
 * This used to count what you had not ANSWERED — everything said by other
 * people since the last thing you said — on the argument that you can read
 * "which car?" on a bus and it is still your answer that is missing. The
 * argument is sound and the number was still wrong, for a reason that beats
 * it: the app already had a second count, on the rail, built on thread_reads
 * and cleared by opening the room. So two numbers claimed to say how much was
 * waiting in the same room, and they disagreed in the way most likely to be
 * noticed — you read a message, the rail went quiet, and the chip on the room
 * kept its 1. Reported as "after messages are read, it still stays unread",
 * which is exactly what it looked like.
 *
 * This codebase has been bitten by two pieces of code answering one question
 * often enough to know how it ends. So there is one answer now, and it is the
 * one a number on a chip universally means: things you have not seen. It reads
 * from thread_reads, the same table the rail reads, stamped by the same act of
 * opening the thread.
 */

/**
 * The words a one-line preview should show.
 *
 * A voice note carries no text until somebody transcribes it, and a blank line
 * beside a name reads as a bug rather than as a recording waiting to be played
 * — so it is described instead.
 */
function preview(last) {
  if (!last) return '';
  const body = String(last.body || '').trim();
  if (body) return body.length > 140 ? `${body.slice(0, 140)}…` : body;
  if (last.duration_ms === null || last.duration_ms === undefined) return '';
  const secs = Math.max(1, Math.round(Number(last.duration_ms) / 1000));
  return `Voice note · ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
}

/** { lastMessage, unread } for one thread, as one person sees it. */
async function summarise(threadId, viewerId) {
  const last = await db.prepare(`
    SELECT m.id, m.body, m.created_at, u.name AS author_name, v.duration_ms
    FROM messages m
    JOIN users u ON u.id = m.author_id
    LEFT JOIN voice_notes v ON v.message_id = m.id
    WHERE m.thread_id = ?
    ORDER BY m.created_at DESC LIMIT 1
  `).get(threadId);

  // Never your own words: nobody has unread messages they wrote themselves.
  // A room never opened has no row here, and everything in it counts — which
  // is right, and is why the join is LEFT.
  const since = await db.prepare(`
    SELECT COUNT(*) AS n
    FROM messages m
    LEFT JOIN thread_reads r ON r.thread_id = m.thread_id AND r.user_id = ?
    WHERE m.thread_id = ?
      AND m.author_id != ?
      AND (r.last_read_at IS NULL OR m.created_at > r.last_read_at)
  `).get(viewerId, threadId, viewerId);

  return {
    lastMessage: last ? {
      body: preview(last),
      isVoice: last.duration_ms !== null && last.duration_ms !== undefined,
      authorName: last.author_name,
      at: last.created_at,
    } : null,
    unread: Number(since?.n || 0),
  };
}

module.exports = { summarise, preview };
