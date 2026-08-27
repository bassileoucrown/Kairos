const db = require('./db');
const { todayInZone, addCalendarDays, dayOfWeek, zonedTimeToUtc } = require('./timezone');
const { isAssistantRole, roleLabel } = require('./roles');

// What the office did last week.
//
// WHAT THIS IS FOR. A principal engages a PA, an EA, or a Chief of Staff and
// then has no way to see the shape of what they do — because the whole point
// of the job is that the principal does not have to watch it happen. The work
// is real and it is invisible, and both of those facts are problems: the
// assistant's effort goes unseen, and the principal cannot tell a quiet week
// from a week where something was dropped.
//
// EVERY NUMBER HERE IS ALREADY IN THE DATABASE. Nothing new is recorded to
// build this, and that is deliberate — an activity log written specially for a
// report is a log that measures what the report wanted rather than what
// happened, and it invites recording more about people than the product needs.
// This reads the trails the app already keeps because the app already needed
// them: who approved a booking, who completed a task, who confirmed a
// document.
//
// IT ALSO REPORTS WHAT DID NOT HAPPEN. A list of completed things is a
// flattering document and a useless one. The tail of the report is what was
// still open when the week ended — overdue work, requests nobody answered —
// because that is the half a principal is actually reading for.
//
// WHAT IT IS NOT. It is not a productivity score and must not become one.
// There are no totals across people, no ranking, and no derived rate: an
// assistant who spent the week on one difficult negotiation would come bottom
// of any such table, and a product that encourages a principal to read it that
// way is a product that makes offices worse.

// Titles come from lib/roles.js, which is where they are defined for the
// invite form, the members list and onboarding. This file briefly kept its own
// copy of the same four labels — which is the drift shape this codebase keeps
// getting bitten by, and would have shown a principal one title on the Team
// screen and a different one in the report the first time a label was edited.

/**
 * The week that just ended, in the principal's own timezone.
 *
 * MONDAY TO SUNDAY, and in THEIR zone rather than the server's. A report
 * headed "last week" that starts on Sunday evening because the server is in
 * UTC and the office is in Lagos would put Sunday night's work in the wrong
 * week every single time — and the person reading it has no way to know that
 * is why the numbers look odd.
 *
 * `back` is how many weeks to step back: 0 is the week in progress, 1 is the
 * one just finished, which is what a Monday morning report means.
 */
function weekWindow(timeZone, back = 1, now = new Date()) {
  const zone = timeZone || 'UTC';
  const today = todayInZone(zone, now);
  // Sunday is 0, so Monday-as-the-start needs Sunday treated as day seven.
  const since = (dayOfWeek(today) + 6) % 7;
  const monday = addCalendarDays(today, -since - 7 * back);
  const nextMonday = addCalendarDays(monday, 7);

  return {
    // Midnight local, expressed as the instant the database stores.
    startAt: zonedTimeToUtc(monday.year, monday.month, monday.day, 0, 0, zone).toISOString(),
    endAt: zonedTimeToUtc(nextMonday.year, nextMonday.month, nextMonday.day, 0, 0, zone).toISOString(),
    startDate: `${monday.year}-${String(monday.month).padStart(2, '0')}-${String(monday.day).padStart(2, '0')}`,
    endDate: (() => {
      const sunday = addCalendarDays(monday, 6);
      return `${sunday.year}-${String(sunday.month).padStart(2, '0')}-${String(sunday.day).padStart(2, '0')}`;
    })(),
    timeZone: zone,
  };
}

/** Everyone acting for this principal, and the principal themselves. */
async function officeOf(ownerId) {
  const rows = await db.prepare(`
    SELECT m.member_user_id AS id, m.role, u.name, u.email
    FROM memberships m
    JOIN users u ON u.id = m.member_user_id
    WHERE m.owner_id = ? AND m.status = 'active' AND m.member_user_id IS NOT NULL
    ORDER BY u.name
  `).all(ownerId);
  return rows.filter((r) => isAssistantRole(r.role));
}

/** One number per person, from a query that returns { who, n }. */
function tally(rows) {
  return new Map(rows.map((r) => [r.who, Number(r.n || 0)]));
}

/**
 * The diary half: what each assistant did to the principal's appointments.
 *
 * Read from booking_events rather than from the bookings themselves, because a
 * booking carries only its current state — "declined" tells you a request was
 * turned down and not who turned it down or when. The event trail was written
 * for the audit and answers this exactly.
 *
 * Anything Kairos did on its own, or the booker did from their link, has no
 * actor and is skipped: this is a report about the office, and an appointment
 * a stranger cancelled at midnight is not somebody's work.
 */
async function diaryWork(ownerId, window) {
  return db.prepare(`
    SELECT actor_user_id AS who, kind, COUNT(*) AS n
    FROM booking_events
    WHERE owner_id = ? AND actor_user_id IS NOT NULL
      AND at >= ? AND at < ?
    GROUP BY actor_user_id, kind
  `).all(ownerId, window.startAt, window.endAt);
}

async function buildReport(ownerId, { back = 1, now = new Date(), onlyUserId = null } = {}) {
  const owner = await db.prepare('SELECT id, name, timezone FROM users WHERE id = ?').get(ownerId);
  if (!owner) return null;
  const window = weekWindow(owner.timezone, back, now);
  const { startAt, endAt } = window;

  let office = await officeOf(ownerId);
  // Narrowed to one person when the caller is not entitled to the rest. Who
  // that is — the principal and their Chief of Staff see everyone, anybody
  // else sees themselves — is decided in routes/report.js, where the caller's
  // standing is known. This function is told the answer rather than working it
  // out, so there is one place to change it and one place to get it wrong.
  if (onlyUserId) office = office.filter((m) => m.id === onlyUserId);
  const ids = office.map((m) => m.id);

  if (!ids.length) {
    return { window, principal: { id: owner.id, name: owner.name }, people: [], stillOpen: await stillOpen(ownerId) };
  }
  const marks = ids.map(() => '?').join(',');

  const [diary, tasksDone, tasksSet, lines, records, docsAdded, docsConfirmed, reveals, houseNotes, keptThings] =
    await Promise.all([
      diaryWork(ownerId, window),

      // Finished, not merely assigned. completed_at is stamped when the task
      // is marked done and cleared when it is reopened, so a task closed and
      // reopened twice counts once — for the week it was actually finished in.
      db.prepare(`
        SELECT t.assignee_id AS who, COUNT(*) AS n
        FROM tasks t JOIN spaces s ON s.id = t.space_id
        WHERE s.owner_id = ? AND t.assignee_id IN (${marks})
          AND t.status = 'done' AND t.completed_at >= ? AND t.completed_at < ?
        GROUP BY t.assignee_id
      `).all(ownerId, ...ids, startAt, endAt).then(tally),

      // Work handed to somebody else. Excludes what they set themselves,
      // which is a to-do list rather than an act of delegation.
      db.prepare(`
        SELECT t.created_by AS who, COUNT(*) AS n
        FROM tasks t JOIN spaces s ON s.id = t.space_id
        WHERE s.owner_id = ? AND t.created_by IN (${marks})
          AND (t.assignee_id IS NULL OR t.assignee_id != t.created_by)
          AND t.created_at >= ? AND t.created_at < ?
        GROUP BY t.created_by
      `).all(ownerId, ...ids, startAt, endAt).then(tally),

      db.prepare(`
        SELECT m.author_id AS who, COUNT(*) AS n
        FROM messages m JOIN threads t ON t.id = m.thread_id JOIN spaces s ON s.id = t.space_id
        WHERE s.owner_id = ? AND m.author_id IN (${marks})
          AND m.created_at >= ? AND m.created_at < ?
        GROUP BY m.author_id
      `).all(ownerId, ...ids, startAt, endAt).then(tally),

      // Kept apart from ordinary messages: filing a decision into the formal
      // record is a different act from saying something in a room, and it is
      // the one worth a principal's attention.
      db.prepare(`
        SELECT m.author_id AS who, COUNT(*) AS n
        FROM messages m JOIN threads t ON t.id = m.thread_id JOIN spaces s ON s.id = t.space_id
        WHERE s.owner_id = ? AND m.author_id IN (${marks}) AND m.register = 'record'
          AND m.created_at >= ? AND m.created_at < ?
        GROUP BY m.author_id
      `).all(ownerId, ...ids, startAt, endAt).then(tally),

      db.prepare(`
        SELECT created_by AS who, COUNT(*) AS n FROM essentials
        WHERE owner_id = ? AND created_by IN (${marks}) AND created_at >= ? AND created_at < ?
        GROUP BY created_by
      `).all(ownerId, ...ids, startAt, endAt).then(tally),

      // "I held the document and this is what it says", with the date they
      // said it — the single most valuable thing an assistant does to a vault.
      db.prepare(`
        SELECT verified_by AS who, COUNT(*) AS n FROM essentials
        WHERE owner_id = ? AND verified_by IN (${marks}) AND verified_at >= ? AND verified_at < ?
        GROUP BY verified_by
      `).all(ownerId, ...ids, startAt, endAt).then(tally),

      // Shown to the principal without being asked for. Somebody looking at
      // their own passport numbers is unremarkable; a pattern of it is exactly
      // what a custody product should surface without being interrogated.
      db.prepare(`
        SELECT actor_id AS who, COUNT(*) AS n FROM access_log
        WHERE subject_owner_id = ? AND actor_id IN (${marks}) AND action = 'reveal'
          AND created_at >= ? AND created_at < ?
        GROUP BY actor_id
      `).all(ownerId, ...ids, startAt, endAt).then(tally),

      db.prepare(`
        SELECT author_id AS who, COUNT(*) AS n FROM household_instructions
        WHERE owner_id = ? AND author_id IN (${marks}) AND created_at >= ? AND created_at < ?
        GROUP BY author_id
      `).all(ownerId, ...ids, startAt, endAt).then(tally),

      db.prepare(`
        SELECT kept_by AS who, COUNT(*) AS n FROM kept_items
        WHERE owner_id = ? AND kept_by IN (${marks}) AND kept_at >= ? AND kept_at < ?
        GROUP BY kept_by
      `).all(ownerId, ...ids, startAt, endAt).then(tally),
    ]);

  const diaryBy = new Map();
  for (const row of diary) {
    const got = diaryBy.get(row.who) || {};
    got[row.kind] = Number(row.n || 0);
    diaryBy.set(row.who, got);
  }

  const people = office.map((m) => {
    const d = diaryBy.get(m.id) || {};
    const diarySummary = {
      approved: d.approved || 0,
      declined: d.declined || 0,
      moved: (d.rescheduled || 0) + (d.relengthened || 0),
      calledOff: d.cancelled || 0,
      putIn: d.booked || 0,
    };
    const counts = {
      ...diarySummary,
      tasksDone: tasksDone.get(m.id) || 0,
      tasksSet: tasksSet.get(m.id) || 0,
      messages: lines.get(m.id) || 0,
      records: records.get(m.id) || 0,
      documentsAdded: docsAdded.get(m.id) || 0,
      documentsConfirmed: docsConfirmed.get(m.id) || 0,
      documentsRevealed: reveals.get(m.id) || 0,
      houseInstructions: houseNotes.get(m.id) || 0,
      keptToArchive: keptThings.get(m.id) || 0,
    };
    return {
      id: m.id,
      name: m.name,
      role: m.role,
      roleLabel: roleLabel(m.role),
      counts,
      // Said explicitly rather than left to the screen to work out by summing:
      // "nothing recorded" and "a quiet week" read differently, and only the
      // server knows the difference between no activity and no access.
      quiet: Object.values(counts).every((n) => n === 0),
    };
  });

  return {
    window,
    principal: { id: owner.id, name: owner.name },
    people,
    stillOpen: await stillOpen(ownerId),
  };
}

/**
 * What the week did not finish.
 *
 * Counted as it stands NOW rather than as it stood at midnight on Sunday, and
 * that is the honest version: a report read on Monday about work that is still
 * outstanding on Monday is actionable, whereas one listing what was overdue
 * three days ago sends somebody chasing things that have since been done.
 */
async function stillOpen(ownerId) {
  const now = new Date().toISOString();
  const [waiting, overdue, unanswered] = await Promise.all([
    db.prepare("SELECT COUNT(*) AS n FROM bookings WHERE owner_id = ? AND status = 'pending'")
      .get(ownerId).then((r) => Number(r?.n || 0)),
    db.prepare(`
      SELECT COUNT(*) AS n FROM tasks t JOIN spaces s ON s.id = t.space_id
      WHERE s.owner_id = ? AND t.status != 'done' AND t.due_at IS NOT NULL AND t.due_at < ?
    `).get(ownerId, now).then((r) => Number(r?.n || 0)),
    db.prepare(`
      SELECT COUNT(*) AS n FROM messages m
      JOIN threads t ON t.id = m.thread_id JOIN spaces s ON s.id = t.space_id
      WHERE s.owner_id = ? AND m.register = 'record' AND m.record_status = 'open'
    `).get(ownerId).then((r) => Number(r?.n || 0)),
  ]);
  return { approvalsWaiting: waiting, tasksOverdue: overdue, recordsOpen: unanswered };
}

module.exports = { buildReport, weekWindow, officeOf };
