const db = require('./db');
const { todayInZone, addCalendarDays, dayOfWeek, zonedTimeToUtc } = require('./timezone');
const { visibleThreads, listVisibleSpaces } = require('./spaceAccess');

// The week that has not happened yet, and the things nobody has looked at.
//
// WHY THIS IS THE HALF THAT WAS MISSING. lib/weeklyReport.js answers "what did
// the office do", which is a record. A principal reading on Monday morning is
// not mainly checking up on last week — they are asking what is coming and
// what has been dropped. A report that only looks backwards leaves them to
// work that out by opening six screens, which is the work the report exists to
// save.
//
// WHAT "HAS NOT RECEIVED PROPER ATTENTION" MEANS HERE, because a vague phrase
// becomes an arbitrary list. One rule, applied to four kinds of thing:
//
//     it is OPEN, it is DATED, and nothing has happened to it for longer
//     than the thing's own patience.
//
// All three clauses matter. Open, or it is finished. Dated, or nobody ever
// promised anything and "neglected" is just an opinion. And silent for longer
// than its patience — a task set this morning is not neglected, the same task
// untouched for a week with Friday's deadline on it is.
//
// EVERY THRESHOLD IS NAMED AND JUSTIFIED BELOW rather than being a number
// somebody picked. If they are wrong they should be argued with, which needs
// them stated.
//
// IT IS SCOPED TO THE READER, like stillOpen and for the same reason: a list
// of neglected things the reader cannot open reads as the app being broken
// rather than as a door being shut.
//
// MOVEMENTS ARE DELIBERATELY ABSENT. They are gated by lib/movement.js — the
// principal and whoever arranged it, nobody else — and an office report that
// counted them would tell a Chief of Staff that a journey exists, which is
// most of what the gate is protecting. A safety record does not appear in a
// management report.

// A task set today and untouched is somebody thinking. Three working days
// later with a deadline on it, it is a task nobody has picked up.
const TASK_UNSTARTED_DAYS = 3;
// A stage is a spine, not a conversation, so it is slower by nature. A week of
// silence in the room that belongs to a dated stage is the point at which
// somebody should be asked.
const STAGE_SILENT_DAYS = 7;
// A record filed for a decision is a question to a person. Two working days is
// generous for "did you see this".
const RECORD_UNANSWERED_DAYS = 3;
// An assistant proposing a flight has stopped work until the answer comes.
// This is the shortest patience in the file on purpose: it is the one where
// the delay costs money.
const PROPOSAL_UNANSWERED_DAYS = 2;

// Enough to act on in one sitting. A list longer than this is not a report,
// it is a backlog, and it needs a different screen.
const SHOWN = 6;

/**
 * Monday to Sunday of the week AHEAD, in the principal's zone.
 *
 * Deliberately built the same way as weeklyReport.weekWindow rather than
 * calling it with a negative `back`: that function's contract is "weeks ago",
 * and a caller passing -1 to mean "next week" is the kind of cleverness that
 * reads as a bug six months later. The duplication is four lines and the
 * clarity is worth more.
 */
function aheadWindow(timeZone, now = new Date()) {
  const zone = timeZone || 'UTC';
  const today = todayInZone(zone, now);
  const since = (dayOfWeek(today) + 6) % 7;
  const monday = addCalendarDays(today, -since + 7);
  const nextMonday = addCalendarDays(monday, 7);
  const sunday = addCalendarDays(monday, 6);
  const fmt = (d) => `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
  return {
    startAt: zonedTimeToUtc(monday.year, monday.month, monday.day, 0, 0, zone).toISOString(),
    endAt: zonedTimeToUtc(nextMonday.year, nextMonday.month, nextMonday.day, 0, 0, zone).toISOString(),
    startDate: fmt(monday),
    endDate: fmt(sunday),
    timeZone: zone,
  };
}

const daysAgo = (n, now) => new Date(now.getTime() - n * 86400000).toISOString();

/**
 * What is coming, and what is not ready for it.
 *
 * `viewerId` decides what is visible; `ownerId` decides whose week it is.
 * Those are different questions and conflating them is how a report ends up
 * either leaking or empty.
 */
async function weekAhead(ownerId, viewerId, { now = new Date() } = {}) {
  const owner = await db.prepare('SELECT id, name, timezone FROM users WHERE id = ?').get(ownerId);
  if (!owner) return null;
  const window = aheadWindow(owner.timezone, now);
  const nowIso = now.toISOString();

  const reader = viewerId || ownerId;
  // TWO SCOPES, because they answer different questions and using one for both
  // is wrong in both directions. A record lives in a THREAD, and a thread can
  // be closed to somebody who is in the space. A task or a stage lives in a
  // SPACE and has no thread of its own — scoping those by visible threads
  // would hide every task in a space that happens to have no threads yet.
  const threadIds = (await visibleThreads(reader)).map((t) => t.id);
  const spaceIds = (await listVisibleSpaces(reader)).map((s) => s.id);
  const inSpaces = spaceIds.length ? `(${spaceIds.map(() => '?').join(',')})` : null;

  const [appointments, travelling, tasksDue, stagesDue, expiring] = await Promise.all([
    // Confirmed appointments only. A pending request is not yet a commitment
    // and is already counted as something waiting, in stillOpen.
    db.prepare(`
      SELECT COUNT(*) AS n FROM bookings
       WHERE owner_id = ? AND status = 'confirmed' AND start_at >= ? AND start_at < ?
    `).get(ownerId, window.startAt, window.endAt).then((r) => Number(r?.n || 0)),

    // Days away, from the trips already confirmed. Trips are dated by day
    // rather than by instant, so this compares dates.
    db.prepare(`
      SELECT id, name, destination, starts_on, ends_on FROM trips
       WHERE owner_id = ? AND status != 'cancelled'
         AND starts_on <= ? AND ends_on >= ?
       ORDER BY starts_on
    `).all(ownerId, window.endDate, window.startDate),

    inSpaces ? db.prepare(`
      SELECT t.id, t.title, t.due_at, t.status, u.name AS assignee
        FROM tasks t
        JOIN spaces s ON s.id = t.space_id
        LEFT JOIN users u ON u.id = t.assignee_id
       WHERE s.owner_id = ? AND t.space_id IN ${inSpaces} AND t.status != 'done'
         AND t.due_at IS NOT NULL AND t.due_at >= ? AND t.due_at < ?
       ORDER BY t.due_at
    `).all(ownerId, ...spaceIds, nowIso, window.endAt) : [],

    inSpaces ? db.prepare(`
      SELECT st.id, st.name, st.due_at, st.status, p.name AS project_name, p.id AS project_id
        FROM project_stages st
        JOIN projects p ON p.id = st.project_id
        JOIN spaces s ON s.id = p.space_id
       WHERE s.owner_id = ? AND p.space_id IN ${inSpaces}
         AND st.status != 'done' AND p.status = 'active'
         AND st.due_at IS NOT NULL AND st.due_at >= ? AND st.due_at < ?
       ORDER BY st.due_at
    `).all(ownerId, ...spaceIds, nowIso, window.endAt) : [],

    // Documents and vehicle papers that lapse while the week is running. The
    // same expiry the vault and the fleet already judge, asked forward.
    db.prepare(`
      SELECT label, expires_on FROM essentials
       WHERE owner_id = ? AND expires_on IS NOT NULL
         AND expires_on >= ? AND expires_on <= ?
       ORDER BY expires_on
    `).all(ownerId, window.startDate, window.endDate),
  ]);

  return {
    window,
    appointments,
    trips: travelling.map((t) => ({
      id: t.id, name: t.name, destination: t.destination,
      startsOn: t.starts_on, endsOn: t.ends_on,
    })),
    tasksDue: tasksDue.slice(0, SHOWN).map((t) => ({
      id: t.id, title: t.title, dueAt: t.due_at, status: t.status, assignee: t.assignee || null,
    })),
    moreTasksDue: Math.max(0, tasksDue.length - SHOWN),
    stagesDue: stagesDue.slice(0, SHOWN).map((s) => ({
      id: s.id, name: s.name, dueAt: s.due_at, status: s.status,
      projectId: s.project_id, projectName: s.project_name,
    })),
    moreStagesDue: Math.max(0, stagesDue.length - SHOWN),
    expiring: expiring.map((e) => ({ label: e.label, expiresOn: e.expires_on })),
    neglected: await neglected(ownerId, { threadIds, spaceIds }, now),
  };
}

/**
 * Open, dated, and silent for longer than its patience.
 *
 * Four kinds, each with its own threshold and each carrying a `why` in plain
 * words — because a list headed "needs attention" that does not say WHY an
 * item is on it cannot be argued with, and the first thing a reader does with
 * a list they cannot argue with is stop reading it.
 */
async function neglected(ownerId, { threadIds, spaceIds }, now) {
  const inThreads = threadIds.length ? `(${threadIds.map(() => '?').join(',')})` : null;
  const inSpaces = spaceIds.length ? `(${spaceIds.map(() => '?').join(',')})` : null;
  const out = [];

  // 1. Set, dated, and never picked up. 'open' is the status a task is born
  //    with; anything else means somebody has at least touched it.
  const cold = inSpaces ? await db.prepare(`
    SELECT t.id, t.title, t.due_at, t.created_at, u.name AS assignee, t.space_id
      FROM tasks t
      JOIN spaces s ON s.id = t.space_id
      LEFT JOIN users u ON u.id = t.assignee_id
     WHERE s.owner_id = ? AND t.space_id IN ${inSpaces} AND t.status = 'open'
       AND t.due_at IS NOT NULL AND t.created_at < ?
     ORDER BY t.due_at LIMIT 20
  `).all(ownerId, ...spaceIds, daysAgo(TASK_UNSTARTED_DAYS, now)) : [];
  for (const t of cold) {
    out.push({
      kind: 'task',
      id: t.id,
      title: t.title,
      href: `/tasks`,
      dueAt: t.due_at,
      why: `Set ${plural(sinceDays(t.created_at, now), 'day')} ago and not started`
        + (t.assignee ? ` — ${t.assignee}` : ' — nobody assigned'),
    });
  }

  // 2. A dated stage whose room has gone quiet. The stage is the promise; the
  //    thread is where the work would be visible if it were happening.
  const silent = inSpaces ? await db.prepare(`
    SELECT st.id, st.name, st.due_at, p.id AS project_id, p.name AS project_name,
           (SELECT MAX(m.created_at) FROM messages m
             JOIN threads th ON th.id = m.thread_id
            WHERE th.stage_id = st.id) AS last_said
      FROM project_stages st
      JOIN projects p ON p.id = st.project_id
      JOIN spaces s ON s.id = p.space_id
     WHERE s.owner_id = ? AND p.space_id IN ${inSpaces} AND p.status = 'active'
       AND st.status IN ('not_started', 'active') AND st.due_at IS NOT NULL
     ORDER BY st.due_at LIMIT 20
  `).all(ownerId, ...spaceIds) : [];
  for (const s of silent) {
    // No message at all counts as silent from when the stage was made, which
    // is the worst case rather than an exemption from the rule.
    if (s.last_said && s.last_said >= daysAgo(STAGE_SILENT_DAYS, now)) continue;
    out.push({
      kind: 'stage',
      id: s.id,
      title: `${s.project_name} — ${s.name}`,
      href: `/projects/${s.project_id}`,
      dueAt: s.due_at,
      why: s.last_said
        ? `Nothing said in that room for ${plural(sinceDays(s.last_said, now), 'day')}`
        : 'Nothing has ever been said in that room',
    });
  }

  // 3. A record filed as a question that nobody answered.
  const unanswered = inThreads ? await db.prepare(`
    SELECT m.id, m.body, m.created_at, m.record_type, t.id AS thread_id, t.name AS thread_name
      FROM messages m
      JOIN threads t ON t.id = m.thread_id
     WHERE m.register = 'record' AND m.record_status = 'open'
       AND m.created_at < ? AND m.thread_id IN ${inThreads}
     ORDER BY m.created_at LIMIT 20
  `).all(daysAgo(RECORD_UNANSWERED_DAYS, now), ...threadIds) : [];
  for (const r of unanswered) {
    out.push({
      kind: 'record',
      id: r.id,
      title: `${r.thread_name}: ${String(r.body || '').slice(0, 80)}`,
      // The deep link the report already uses, so this lands on the record
      // itself rather than the foot of a long room.
      href: `/threads/${r.thread_id}#m-${r.id}`,
      dueAt: null,
      why: `Filed ${plural(sinceDays(r.created_at, now), 'day')} ago and nobody has answered`,
    });
  }

  // 4. A proposal the principal has not decided. The assistant is blocked and
  //    the report is the only place that fact currently shows up.
  const waiting = await db.prepare(`
    SELECT id, title, start_at, proposed_at FROM itinerary_items
     WHERE owner_id = ? AND status = 'proposed'
       AND proposed_at IS NOT NULL AND proposed_at < ?
     ORDER BY start_at LIMIT 20
  `).all(ownerId, daysAgo(PROPOSAL_UNANSWERED_DAYS, now));
  for (const i of waiting) {
    out.push({
      kind: 'proposal',
      id: i.id,
      title: i.title,
      href: '/itinerary',
      dueAt: i.start_at,
      why: `Proposed ${plural(sinceDays(i.proposed_at, now), 'day')} ago and still waiting on a decision`,
    });
  }

  // Oldest hurt first: something dated and past is worse than something dated
  // and coming, and undated goes last because there is no promise to have
  // broken. Sorting here rather than in four queries keeps one ordering rule.
  out.sort((a, b) => {
    if (a.dueAt && b.dueAt) return a.dueAt < b.dueAt ? -1 : 1;
    if (a.dueAt) return -1;
    if (b.dueAt) return 1;
    return 0;
  });
  return { items: out.slice(0, SHOWN * 2), total: out.length };
}

function sinceDays(iso, now) {
  return Math.max(0, Math.floor((now.getTime() - Date.parse(iso)) / 86400000));
}
function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

module.exports = { weekAhead, aheadWindow, neglected };
