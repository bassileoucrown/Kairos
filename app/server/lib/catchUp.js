const db = require('./db');
const { summariseMany } = require('./threadSummary');
const { visibleThreads } = require('./spaceAccess');

// What happened while you were away.
//
// WHY THIS IS THE FEATURE A PA NOTICES. Everything in Kairos is arranged
// around the present — today's diary, the open queue, the live list. That is
// right for somebody at their desk and useless for somebody who has just come
// back from four days out, whose actual question is not "what is true now" but
// "what did I miss". Answering it today means opening six screens and doing
// the subtraction by eye, which is exactly the work an office assistant should
// not be doing.
//
// AWAY IS MEASURED, NOT ASKED. The app already knows when somebody last used
// it, so it can say "since Thursday" rather than offering a date picker
// nobody wants to fill in. A gap shorter than AWAY_AFTER_MS is not an absence
// — stepping out for lunch should not produce a report — so the screen says
// there is nothing to catch up on and means it.
//
// NOTHING HERE IS A SECOND SOURCE OF TRUTH. Unread comes from the same
// per-thread numbers the rail and the space list use; the diary half reads
// booking_events, which the weekly report also reads. This screen is a
// different QUESTION over the same records, not a different answer.

// Three hours.
//
// This was eight, which was really "an overnight" — a threshold that only
// makes sense for one principal in one timezone. An assistant covering three
// offices can lose a morning in three hours: a cancellation, the rebooking
// that followed it, and a decision filed against a thread they are working
// under. Being told about it at six because the gap did not clear eight
// hours is being told too late to act.
//
// The cost of being wrong is asymmetric, which is what settles it. A gap
// counted as an absence when nothing happened costs nothing — isEmpty()
// makes that screen say there is nothing to catch up on. A gap NOT counted
// when something did happen costs the thing that was missed. So the
// threshold should sit near the point where a busy office can turn over,
// not near the point where a person can sleep.
const AWAY_AFTER_MS = 3 * 60 * 60 * 1000;

// Nobody wants a report of a month. Past this the question stops being "what
// did I miss" and becomes "where do I start", which is what the live screens
// are already for.
const MAX_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Note that this person is here, and remember the gap if there was one.
 *
 * THE ORDER MATTERS. `away_since` is stamped from the OLD last_seen_at before
 * it is overwritten — capture the gap first, then close it. Written the other
 * way round, by the time anybody opened the screen the app would think they
 * had been away no time at all, which is the bug this shape exists to avoid.
 *
 * Called on the way through a request rather than at sign-in: a PA who leaves
 * the tab open for a week never signs in again, and would otherwise never be
 * told they had missed anything.
 */
async function touch(userId, now = Date.now()) {
  const row = await db.prepare('SELECT last_seen_at, away_since FROM users WHERE id = ?').get(userId);
  const at = new Date(now).toISOString();
  const last = row?.last_seen_at ? Date.parse(row.last_seen_at) : null;

  // A real absence, and not one already recorded — re-stamping on every
  // request during the gap would keep moving the start of it forward.
  if (last && now - last >= AWAY_AFTER_MS && !row?.away_since) {
    await db.prepare('UPDATE users SET away_since = ?, last_seen_at = ? WHERE id = ?')
      .run(row.last_seen_at, at, userId);
    return;
  }
  await db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run(at, userId);
}

/** Done with it — until the next real absence. */
async function clear(userId) {
  await db.prepare('UPDATE users SET away_since = NULL WHERE id = ?').run(userId);
}

/** The window this person is being caught up on, or null when they were here. */
async function windowFor(userId, { since = null, now = Date.now() } = {}) {
  if (since) return { since, measured: false };
  const row = await db.prepare('SELECT away_since FROM users WHERE id = ?').get(userId);
  if (!row?.away_since) return null;
  const floor = new Date(now - MAX_WINDOW_MS).toISOString();
  return { since: row.away_since < floor ? floor : row.away_since, measured: true };
}

/**
 * Everything that happened to this person's work in that window.
 *
 * Scoped to the VIEWER, not to a principal. An assistant with three principals
 * has been away from all three at once, and a catch-up that made them pick one
 * first would be asking them to guess where the news is.
 */
async function build(userId, { since, now = Date.now() } = {}) {
  const nowIso = new Date(now).toISOString();

  // ---- Rooms with something new in them --------------------------------
  const threads = await visibleThreads(userId);
  const summaries = await summariseMany(threads.map((t) => t.id), userId);
  const rooms = [];
  if (threads.length) {
    const marks = threads.map(() => '?').join(',');
    const named = await db.prepare(`
      SELECT t.id, t.name, s.name AS space_name
      FROM threads t JOIN spaces s ON s.id = t.space_id
      WHERE t.id IN (${marks})
    `).all(...threads.map((t) => t.id));
    const byId = new Map(named.map((n) => [n.id, n]));
    for (const t of threads) {
      const sum = summaries.get(t.id);
      if (!sum?.unread) continue;
      const n = byId.get(t.id);
      rooms.push({
        threadId: t.id,
        name: n?.name || 'A conversation',
        spaceName: n?.space_name || '',
        unread: sum.unread,
        lastMessage: sum.lastMessage,
      });
    }
    rooms.sort((a, b) => b.unread - a.unread);
  }

  // ---- The offices this person acts for ---------------------------------
  const principals = await db.prepare(`
    SELECT u.id, u.name FROM users u WHERE u.id = ?
    UNION
    SELECT u.id, u.name FROM memberships m JOIN users u ON u.id = m.owner_id
    WHERE m.member_user_id = ? AND m.status = 'active'
  `).all(userId, userId);
  const ids = principals.map((p) => p.id);
  const pMarks = ids.map(() => '?').join(',');

  // ---- The diary, as it changed ----------------------------------------
  //
  // From booking_events rather than from the bookings, because a booking
  // carries only its current state: "cancelled" does not say when, or by whom,
  // or whether it happened while you were out. Somebody else's actions only —
  // being shown your own week back is not news.
  const diary = ids.length ? await db.prepare(`
    SELECT e.kind, e.at, e.owner_id, b.booker_name, b.start_at,
           u.name AS actor_name, o.name AS owner_name
    FROM booking_events e
    JOIN bookings b ON b.id = e.booking_id
    LEFT JOIN users u ON u.id = e.actor_user_id
    JOIN users o ON o.id = e.owner_id
    WHERE e.owner_id IN (${pMarks}) AND e.at >= ? AND e.at < ?
      AND (e.actor_user_id IS NULL OR e.actor_user_id != ?)
    ORDER BY e.at DESC
    LIMIT 40
  `).all(...ids, since, nowIso, userId) : [];

  // ---- Work put on you --------------------------------------------------
  const tasks = await db.prepare(`
    SELECT t.id, t.title, t.due_at, t.priority, s.name AS space_name, u.name AS from_name
    FROM tasks t
    JOIN spaces s ON s.id = t.space_id
    LEFT JOIN users u ON u.id = t.created_by
    WHERE t.assignee_id = ? AND t.created_by != ? AND t.status != 'done'
      AND t.created_at >= ? AND t.created_at < ?
    ORDER BY t.due_at IS NULL, t.due_at ASC
  `).all(userId, userId, since, nowIso);

  // ---- Decisions filed in your absence ----------------------------------
  //
  // The formal register, which is the half somebody coming back most needs:
  // a decision taken while you were out is a thing you are now working under
  // whether or not you saw it happen.
  const records = await db.prepare(`
    SELECT m.id, m.body, m.record_type, m.record_status, m.created_at,
           u.name AS author_name, t.name AS thread_name, t.id AS thread_id
    FROM messages m
    JOIN threads t ON t.id = m.thread_id
    JOIN spaces s ON s.id = t.space_id
    LEFT JOIN space_members sm ON sm.space_id = s.id AND sm.user_id = ?
    JOIN users u ON u.id = m.author_id
    WHERE m.register = 'record' AND m.author_id != ?
      AND m.created_at >= ? AND m.created_at < ?
      AND (s.owner_id = ? OR sm.user_id IS NOT NULL)
    ORDER BY m.created_at DESC
    LIMIT 25
  `).all(userId, userId, since, nowIso, userId);

  return {
    since,
    until: nowIso,
    principals: principals.map((p) => ({ id: p.id, name: p.name })),
    rooms,
    diary: diary.map((d) => ({
      kind: d.kind,
      at: d.at,
      who: d.booker_name,
      startAt: d.start_at,
      byName: d.actor_name || null,
      ownerName: d.owner_name,
      ownerId: d.owner_id,
    })),
    tasks: tasks.map((t) => ({
      id: t.id, title: t.title, dueAt: t.due_at, priority: t.priority,
      spaceName: t.space_name, fromName: t.from_name || null,
    })),
    records: records.map((r) => ({
      id: r.id,
      threadId: r.thread_id,
      threadName: r.thread_name,
      body: String(r.body || '').slice(0, 200),
      recordType: r.record_type,
      recordStatus: r.record_status,
      authorName: r.author_name,
      at: r.created_at,
    })),
  };
}

/** True when there is genuinely nothing to report, so the screen can say so. */
function isEmpty(c) {
  return !c.rooms.length && !c.diary.length && !c.tasks.length && !c.records.length;
}

module.exports = { touch, clear, windowFor, build, isEmpty, AWAY_AFTER_MS, MAX_WINDOW_MS };
