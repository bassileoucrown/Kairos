const db = require('./db');
const { knock } = require('./knock');
const movement = require('./movement');
const enRoute = require('./enRoute');
const { sendEmail } = require('./email');
const { formatForEmail } = require('./format');
const { buildReport, weekWindow } = require('./weeklyReport');

// Deadline reminders for tasks, project stages, appointments and expiring
// documents.
//
// Each item carries a reminder_stage (null -> due_soon -> overdue) so a nudge
// fires exactly once per threshold rather than on every sweep. Changing a due
// date, reassigning, or reopening clears it, because those genuinely deserve
// a fresh set of reminders.
//
// DELIVERY GOES THROUGH lib/knock.js, which is email AND push. It used to call
// sendEmail directly, so the one kind of notice whose entire purpose is
// reaching somebody who is busy with something else was the one kind that
// could not reach their phone. An email about a brief due in three hours,
// read tomorrow, is a record of a miss rather than a way to prevent one.
//
// With no mail provider configured the email half still lands in the Outbox
// tab and the server log — visible and testable rather than silently dropped.

// How much warning a task gets before its deadline, by how much missing it
// costs.
//
// A single 24-hour window treated a signature that has to reach a registry
// before Friday the same as a call that can be made in five minutes. The
// warning has to be long enough to still act on: told three days out you can
// clear an afternoon, told at the deadline you have already missed it, and
// "overdue" is a report of a failure rather than a chance to prevent one.
//
// Priority is the proxy because it is already on the task and already set by
// whoever assigned it — the person who knows what it costs.
const LEAD_MS = {
  high: 72 * 60 * 60 * 1000,
  normal: 24 * 60 * 60 * 1000,
  low: 8 * 60 * 60 * 1000,
};
const DUE_SOON_MS = LEAD_MS.normal;
const SWEEP_INTERVAL_MS = Number(process.env.REMINDER_SWEEP_MS || 15 * 60 * 1000);

/** The lead time for a priority, falling back to the ordinary one. */
function leadFor(priority) {
  return LEAD_MS[priority] || LEAD_MS.normal;
}

function dueBand(dueAt, now, priority = 'normal') {
  if (!dueAt) return null;
  const due = new Date(dueAt).getTime();
  if (Number.isNaN(due)) return null;
  if (due <= now) return 'overdue';
  if (due - now <= leadFor(priority)) return 'due_soon';
  return null;
}

/**
 * Only ever escalate, and never re-fire the band already sent.
 *
 * Something flagged overdue must not drop back to due_soon because a clock
 * ticked oddly, and a phone must not buzz every fifteen minutes for the same
 * deadline — which is how people turn a whole class of notification off.
 *
 * Takes the ladder rather than assuming two rungs, because a document's ladder
 * has three: a passport is worth mentioning six months out, worth acting on
 * one month out, and a different problem entirely once it has expired.
 */
function shouldSend(band, sent, ladder = ['due_soon', 'overdue']) {
  if (!band) return false;
  const now = ladder.indexOf(band);
  if (now === -1) return false;
  const already = ladder.indexOf(sent);
  // -1 covers both "nothing sent yet" and a stage name from an older build.
  return now > already;
}

async function sweepTasks(now) {
  const rows = await db.prepare(`
    SELECT t.*, u.email AS assignee_email, u.name AS assignee_name,
           s.name AS space_name, s.owner_id AS space_owner_id, p.name AS project_name
    FROM tasks t
    JOIN users u ON u.id = t.assignee_id
    JOIN spaces s ON s.id = t.space_id
    LEFT JOIN projects p ON p.id = t.project_id
    WHERE t.status != 'done' AND t.due_at IS NOT NULL AND t.assignee_id IS NOT NULL
  `).all();

  let sent = 0;
  for (const t of rows) {
    const band = dueBand(t.due_at, now, t.priority);
    if (!shouldSend(band, t.reminder_stage)) continue;

    const where = t.project_name ? `${t.space_name} › ${t.project_name}` : t.space_name;
    await knock({
      toUserId: t.assignee_id,
      // Filed under the space's owner so it shows in the right Outbox.
      ownerId: t.space_owner_id,
      category: 'transactional',
      // Not "due tomorrow" any more: the warning is three days for a high
      // priority and eight hours for a low one, and a subject line that names
      // the wrong day is worse than one that names none.
      subject: band === 'overdue' ? `Overdue: ${t.title}` : `Due soon: ${t.title}`,
      line: `${band === 'overdue' ? 'This task is now overdue' : 'This task is coming up'}: `
        + `${t.title}\n\nWhere: ${where}\nDue: ${formatForEmail(t.due_at, 'UTC')} (UTC)`,
      url: '/tasks',
      // One line per task. Told at three days and again at the deadline, the
      // second should replace the first rather than sit under it.
      tag: `task-${t.id}`,
    });
    await db.prepare('UPDATE tasks SET reminder_stage = ? WHERE id = ?').run(band, t.id);
    sent += 1;
  }
  return sent;
}

async function sweepStages(now) {
  const rows = await db.prepare(`
    SELECT st.*, u.email AS owner_email, u.name AS owner_name,
           p.name AS project_name, s.name AS space_name, s.owner_id AS space_owner_id
    FROM project_stages st
    JOIN users u ON u.id = st.owner_user_id
    JOIN projects p ON p.id = st.project_id
    JOIN spaces s ON s.id = p.space_id
    WHERE st.status != 'done' AND st.due_at IS NOT NULL AND st.owner_user_id IS NOT NULL
  `).all();

  let sent = 0;
  for (const st of rows) {
    const band = dueBand(st.due_at, now);
    if (!shouldSend(band, st.reminder_stage)) continue;

    await knock({
      toUserId: st.owner_user_id,
      ownerId: st.space_owner_id,
      category: 'transactional',
      subject: band === 'overdue'
        ? `Stage overdue: ${st.name}`
        : `Stage due soon: ${st.name}`,
      line: `The "${st.name}" stage of ${st.project_name} (${st.space_name}) is `
        + `${band === 'overdue' ? 'overdue' : 'due soon'}.\n\n`
        + `Due: ${formatForEmail(st.due_at, 'UTC')} (UTC)\nCurrent status: ${st.status}`,
      url: `/projects/${st.project_id}`,
      tag: `stage-${st.id}`,
    });
    await db.prepare('UPDATE project_stages SET reminder_stage = ? WHERE id = ?').run(band, st.id);
    sent += 1;
  }
  return sent;
}

/**
 * The meeting itself, before it starts.
 *
 * NOTHING SWEPT APPOINTMENTS AT ALL. A booking landed in the diary, the day
 * sheet drew it, and from then until the moment it began the app said nothing
 * — which is the exact case a scheduling product exists to cover. The office
 * knew the meeting was at four and never once said so out loud.
 *
 * TWO RUNGS, FOR TWO DIFFERENT PEOPLE, and that is the point of the split.
 *
 *   A DAY AHEAD, THE BOOKER. Somebody coming to see a principal has to plan
 *   around it, and may have to travel — a warning half an hour out is no use
 *   to them at all. They have no Kairos account, so this is email, and it
 *   carries the link that lets them move or cancel rather than making them
 *   write and ask. This was missing entirely: the office was told and the
 *   person coming was not, which is the wrong way round for the party with
 *   further to come.
 *
 *   HALF AN HOUR OUT, THE PRINCIPAL. The last moment the warning is still
 *   worth acting on — long enough to wind up what you are doing and be
 *   somewhere, short enough not to be forgotten again by the time it matters.
 *   Their own diary is the day-ahead view; they do not need an email about it.
 *
 * A meeting has no "overdue" rung: telling somebody their four o'clock started
 * an hour ago is a report of a failure rather than a chance to prevent one.
 *
 * The principal only, not their assistants — the same appointment is on their
 * screens too, and buzzing three people for one four o'clock is how an office
 * learns to ignore the buzz.
 */
const APPOINTMENT_LEAD_MS = 30 * 60 * 1000;
const BOOKER_LEAD_MS = 24 * 60 * 60 * 1000;
const APPOINTMENT_LADDER = ['day', 'soon'];

async function sweepAppointments(now) {
  const rows = await db.prepare(`
    SELECT b.*, u.name AS owner_name, u.timezone AS owner_timezone,
           mt.name AS meeting_name
    FROM bookings b
    JOIN users u ON u.id = b.owner_id
    LEFT JOIN meeting_types mt ON mt.id = b.meeting_type_id
    WHERE b.status = 'confirmed'
      AND (b.reminder_stage IS NULL OR b.reminder_stage != 'soon')
  `).all();

  let sent = 0;
  for (const b of rows) {
    const start = new Date(b.start_at).getTime();
    if (Number.isNaN(start)) continue;
    // Already begun — a booking written up after the fact (a PA recording what
    // happened this morning) must not announce itself.
    if (start <= now) continue;
    const until = start - now;

    const band = until <= APPOINTMENT_LEAD_MS ? 'soon'
      : until <= BOOKER_LEAD_MS ? 'day'
        : null;
    if (!shouldSend(band, b.reminder_stage, APPOINTMENT_LADDER)) continue;

    if (band === 'day') {
      // The person coming, not the office. No account, so email only — and it
      // carries the way to move or cancel, because "reply to ask" is how a
      // clashing diary becomes a no-show.
      if (!String(b.booker_email || '').trim()) {
        // Nobody to tell. Still stamped, or every sweep for the next
        // twenty-three hours reconsiders a booking with nowhere to send.
        await db.prepare('UPDATE bookings SET reminder_stage = ? WHERE id = ?').run('day', b.id);
        continue;
      }
      await sendEmail({
        ownerId: b.owner_id,
        toEmail: b.booker_email,
        category: 'transactional',
        subject: `Tomorrow: your meeting with ${b.owner_name}`,
        body: `Hi ${b.booker_name},\n\nThis is a reminder of your meeting with `
          + `${b.owner_name}.\n\nWhen: `
          + `${formatForEmail(b.start_at, b.booker_timezone || 'UTC')} `
          + `(${b.booker_timezone || 'UTC'})\n\n`
          + `Move or cancel it: /book/manage/${b.id}`,
      });
    } else {
      const mins = Math.max(1, Math.round(until / 60000));
      await knock({
        toUserId: b.owner_id,
        ownerId: b.owner_id,
        category: 'transactional',
        subject: `In ${mins} minutes: ${b.meeting_name || 'appointment'}`,
        line: `${b.meeting_name || 'An appointment'} with ${b.booker_name} starts at `
          + `${formatForEmail(b.start_at, b.owner_timezone || 'UTC')}.`,
        url: `/appointments/${b.owner_id}/${b.id}`,
        tag: `booking-${b.id}`,
      });
    }

    await db.prepare('UPDATE bookings SET reminder_stage = ? WHERE id = ?').run(band, b.id);
    sent += 1;
  }
  return sent;
}

/**
 * Documents that are about to stop working.
 *
 * THE COLUMN EXISTED AND NOTHING READ IT. essentials.reminder_stage was added,
 * and cleared correctly whenever an expiry date was edited, and never once
 * written — so the feature whose stated point is that "a passport under six
 * months' validity turns someone away at check-in" never mentioned a passport
 * to anybody. Half a mechanism is worse than none, because the half that
 * exists makes it look done.
 *
 * THREE RUNGS, because a document is not a task. Six months out is when a
 * passport can still be renewed calmly; one month out it is urgent and may
 * already be too late for some visas; expired is a different conversation.
 */
const DOC_LADDER = ['expiring', 'urgent', 'expired'];
const DOC_SOON_DAYS = 180;
const DOC_URGENT_DAYS = 30;

function expiryBand(expiresOn, now) {
  if (!expiresOn) return null;
  // Stored as YYYY-MM-DD. Read as the END of that day: a passport valid
  // through the 30th is not expired on the morning of the 30th.
  const end = new Date(`${expiresOn}T23:59:59Z`).getTime();
  if (Number.isNaN(end)) return null;
  const days = (end - now) / (24 * 60 * 60 * 1000);
  if (days < 0) return 'expired';
  if (days <= DOC_URGENT_DAYS) return 'urgent';
  if (days <= DOC_SOON_DAYS) return 'expiring';
  return null;
}

async function sweepEssentials(now) {
  const rows = await db.prepare(`
    SELECT e.*, u.name AS owner_name, c.name AS contact_name
    FROM essentials e
    JOIN users u ON u.id = e.owner_id
    LEFT JOIN contacts c ON c.id = e.subject_contact_id
    WHERE e.expires_on IS NOT NULL AND e.expires_on != ''
      -- Put away deliberately. See POST /:id/archive in routes/essentials.js:
      -- nudging about a passport somebody has already retired is how an office
      -- learns to ignore expiry mail.
      AND e.archived_at IS NULL
  `).all();

  let sent = 0;
  for (const e of rows) {
    const band = expiryBand(e.expires_on, now);
    if (!shouldSend(band, e.reminder_stage, DOC_LADDER)) continue;

    // WHOSE DOCUMENT, never WHAT IT SAYS. The value is the passport number,
    // and a notification is read by whoever is holding the phone. The label
    // and the date are enough to act on; the number stays behind a session.
    const whose = e.subject_contact_id ? (e.contact_name || 'someone in the party') : 'your';
    const what = e.label || e.field;
    await knock({
      toUserId: e.owner_id,
      ownerId: e.owner_id,
      category: 'transactional',
      subject: band === 'expired'
        ? `Expired: ${what}`
        : `${band === 'urgent' ? 'Expires soon' : 'Expires in months'}: ${what}`,
      line: `${whose === 'your' ? 'Your' : `${whose}'s`} ${what} `
        + `${band === 'expired' ? 'expired on' : 'expires on'} ${e.expires_on}.`,
      url: '/dashboard?tab=essentials',
      tag: `essential-${e.id}`,
    });
    await db.prepare('UPDATE essentials SET reminder_stage = ? WHERE id = ?').run(band, e.id);
    sent += 1;
  }
  return sent;
}

/**
 * The week just gone, to the principal, once.
 *
 * WHY IT RIDES ON THE SWEEP. There is no cron here — a free instance is
 * stopped when nobody is looking at it, which is most of Sunday night — so
 * anything that has to happen weekly has to happen on whatever pass the
 * outside clock next makes. See routes/sweep.js.
 *
 * WHICH MEANS THE GUARD IS THE WHOLE DESIGN. The sweep may run every fifteen
 * minutes or twice a day, so "is it Monday" is not a test: it would send the
 * same report ninety times. What is stamped is WHICH WEEK has been reported,
 * so the second pass of any Monday finds the week already done and says
 * nothing. The stamp is the week's own start date rather than a timestamp,
 * because "have we covered this week" is the actual question.
 *
 * A WEEK WITH NOTHING IN IT IS NOT REPORTED, and is still stamped. An office
 * that was on holiday should hear nothing, and should not hear about it again
 * on the next pass either — a mail saying "no activity" every Monday is how
 * somebody learns to filter the one that matters.
 */
async function sweepWeeklyReports() {
  // Only principals who actually have an office. A solo user has nobody to
  // report on, and a weekly mail about the empty set is spam.
  const owners = await db.prepare(`
    SELECT DISTINCT u.id, u.name, u.timezone, u.weekly_report_sent_for
    FROM users u
    JOIN memberships m ON m.owner_id = u.id
    WHERE m.status = 'active' AND m.member_user_id IS NOT NULL
  `).all();

  let sent = 0;
  for (const owner of owners) {
    const week = weekWindow(owner.timezone, 1);
    if (owner.weekly_report_sent_for === week.startDate) continue;

    const report = await buildReport(owner.id, { back: 1 });
    const busy = (report?.people || []).filter((p) => !p.quiet);
    const open = report?.stillOpen || {};
    const anythingOpen = Object.values(open).some((n) => n > 0);

    // Stamped whether or not anything is sent, so a quiet week is settled
    // rather than reconsidered on every pass for the next seven days.
    await db.prepare('UPDATE users SET weekly_report_sent_for = ? WHERE id = ?')
      .run(week.startDate, owner.id);
    if (!busy.length && !anythingOpen) continue;

    const lines = busy.map((p) => `${p.name} (${p.roleLabel})\n${describe(p.counts)}`);
    if (anythingOpen) {
      const tail = [
        open.approvalsWaiting ? `${open.approvalsWaiting} request(s) waiting on you` : null,
        open.tasksOverdue ? `${open.tasksOverdue} task(s) past their date` : null,
        open.recordsOpen ? `${open.recordsOpen} record(s) still open` : null,
      ].filter(Boolean);
      lines.push(`Still open right now:\n  ${tail.join('\n  ')}`);
    }

    await knock({
      toUserId: owner.id,
      ownerId: owner.id,
      category: 'transactional',
      subject: `Your office, ${week.startDate} to ${week.endDate}`,
      line: `What the people working with you did last week.\n\n${lines.join('\n\n')}`,
      url: '/report',
      // One per week per principal: a second copy replaces the first rather
      // than stacking under it.
      tag: `report-${owner.id}-${week.startDate}`,
    });
    sent += 1;
  }
  return sent;
}

/** One person's week, as lines somebody can read in a mail client. */
function describe(counts) {
  const say = [
    [counts.approved, 'request(s) approved'],
    [counts.declined, 'declined'],
    [counts.moved, 'meeting(s) moved'],
    [counts.calledOff, 'called off'],
    [counts.putIn, 'put in the diary'],
    [counts.tasksDone, 'task(s) finished'],
    [counts.tasksSet, 'task(s) handed out'],
    [counts.records, 'record(s) filed'],
    [counts.messages, 'message(s) written'],
    [counts.documentsConfirmed, 'document(s) confirmed'],
    [counts.documentsAdded, 'document(s) added'],
    [counts.documentsRevealed, 'document(s) looked at'],
    [counts.houseInstructions, 'instruction(s) to the house'],
    [counts.keptToArchive, 'thing(s) kept to the archive'],
  ].filter(([n]) => n > 0).map(([n, what]) => `  ${n} ${what}`);
  return say.join('\n');
}

/**
 * A principal who should have arrived and has not.
 *
 * THIS IS THE ONE ALARM IN THE PRODUCT THAT MIGHT MATTER WITHIN THE HOUR, and
 * it is built on an ABSENCE, which is why it needed a sweep rather than a
 * screen. Everything else here nudges about something that exists — a task, a
 * document, a meeting. This one fires because a button was NOT pressed on a
 * journey that should have finished half an hour ago.
 *
 * WHO IS TOLD IS THE MOVEMENT'S OWN RULE, NOT THE OFFICE'S. The principal and
 * whoever arranged it. Not the wider office, and not a Chief of Staff — an
 * alert saying "Adaeze has not arrived at the Lekki site" is a statement about
 * a principal's whereabouts and their failure to reach a place, which is
 * precisely the information lib/movement.js exists to keep narrow. A stand-in
 * holding a live grant is told too, because they are the person covering.
 *
 * ONCE. overdue_notified_at is stamped before anybody is told, so a sweep
 * every ten minutes does not become a message every ten minutes for the rest
 * of the day.
 */
async function sweepMovements(now) {
  const rows = await db.prepare(`
    SELECT m.*, u.name AS owner_name
      FROM movements m
      JOIN users u ON u.id = m.owner_id
     WHERE m.arrived_at IS NULL
       AND m.overdue_notified_at IS NULL
       AND m.expected_minutes > 0
  `).all();

  let sent = 0;
  for (const m of rows) {
    const late = movement.lateBy(m, now);
    if (late === null) continue;

    // Stamped FIRST. If telling somebody throws halfway through, the
    // alternative is this row being retried on every sweep forever — and an
    // alarm that cries wolf every ten minutes is an alarm somebody mutes,
    // which is worse than one that missed a person.
    await db.prepare('UPDATE movements SET overdue_notified_at = ? WHERE id = ?')
      .run(new Date(now).toISOString(), m.id);

    const grantees = await db.prepare(`
      SELECT DISTINCT grantee_user_id AS id FROM movement_grants
       WHERE movement_id = ? AND revoked_at IS NULL AND expires_at > ?
    `).all(m.id, new Date(now).toISOString());

    const tell = new Set([m.owner_id, m.arranged_by, ...grantees.map((g) => g.id)]
      .filter(Boolean));
    for (const toUserId of tell) {
      await knock({
        toUserId,
        ownerId: m.owner_id,
        // Nobody is behind this — it is the app noticing a clock.
        author: null,
        subject: `No arrival yet: ${m.title}`,
        line: toUserId === m.owner_id
          ? `has not been marked arrived at ${m.destination || 'the destination'}, `
            + `about ${late} minutes past when it should have.`
          : `${m.owner_name} has not been marked arrived at `
            + `${m.destination || 'the destination'}, about ${late} minutes late.`,
        url: '/movements',
        category: 'movement_overdue',
      });
      sent += 1;
    }
  }
  return sent;
}

/**
 * A check call that nobody answered.
 *
 * THE SAME IDEA AS THE ARRIVAL ALARM, MOVED EARLIER. An arrival alarm on a
 * ninety-minute run tells you something is wrong at the end of it. A check
 * call at the halfway point tells you inside a window somebody can act in,
 * which is the difference between a notification and a response.
 *
 * SAME AUDIENCE, for the same reason: who is being moved, and whether contact
 * has been lost with them, is the most sensitive thing this product holds
 * about a person. The principal, whoever arranged it, and anybody covering.
 */
async function sweepChecks(now) {
  const rows = await db.prepare(`
    SELECT c.*, m.title, m.owner_id, m.arranged_by, m.destination,
           u.name AS owner_name
      FROM movement_checks c
      JOIN movements m ON m.id = c.movement_id
      JOIN users u ON u.id = m.owner_id
     WHERE c.checked_at IS NULL
       AND c.missed_notified_at IS NULL
       AND m.arrived_at IS NULL
  `).all();

  let sent = 0;
  for (const c of rows) {
    const due = Date.parse(c.due_at);
    if (Number.isNaN(due)) continue;
    if (now < due + enRoute.CHECK_GRACE_MINUTES * 60000) continue;

    // Stamped first, as with the arrival alarm and for the same reason: an
    // alarm that repeats every ten minutes is one somebody mutes.
    await db.prepare('UPDATE movement_checks SET missed_notified_at = ? WHERE id = ?')
      .run(new Date(now).toISOString(), c.id);

    const grantees = await db.prepare(`
      SELECT DISTINCT grantee_user_id AS id FROM movement_grants
       WHERE movement_id = ? AND revoked_at IS NULL AND expires_at > ?
    `).all(c.movement_id, new Date(now).toISOString());

    for (const toUserId of new Set([c.owner_id, c.arranged_by, ...grantees.map((g) => g.id)]
      .filter(Boolean))) {
      await knock({
        toUserId,
        ownerId: c.owner_id,
        author: null,
        subject: `Missed check call: ${c.title}`,
        line: toUserId === c.owner_id
          ? `has a check call on "${c.title}" that nobody answered.`
          : `${c.owner_name} has a check call on "${c.title}" that nobody answered.`,
        url: '/movements',
        category: 'movement_check_missed',
      });
      sent += 1;
    }
  }
  return sent;
}

async function runReminderSweep(now = Date.now()) {
  return {
    tasks: await sweepTasks(now),
    stages: await sweepStages(now),
    appointments: await sweepAppointments(now),
    essentials: await sweepEssentials(now),
    movements: await sweepMovements(now),
    checks: await sweepChecks(now),
    weeklyReports: await sweepWeeklyReports(),
  };
}

let timer = null;
async function startReminderSweep() {
  if (timer) return;
  // unref so the sweep never holds the process open on its own.
  timer = setInterval(async () => {
    try { await runReminderSweep(); } catch (err) { console.error('Reminder sweep failed:', err.message); }
  }, SWEEP_INTERVAL_MS);
  if (timer.unref) timer.unref();
}

module.exports = {
  runReminderSweep, startReminderSweep, sweepWeeklyReports, sweepMovements, sweepChecks,
  dueBand, expiryBand, leadFor,
  LEAD_MS, SWEEP_INTERVAL_MS, APPOINTMENT_LEAD_MS, BOOKER_LEAD_MS,
  DOC_SOON_DAYS, DOC_URGENT_DAYS,
};
