const db = require('./db');
const { knock } = require('./knock');
const { formatForEmail } = require('./format');

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
 * ONE NUDGE, THIRTY MINUTES OUT, and both halves of that are deliberate. A
 * meeting has no "overdue": telling somebody their four o'clock started an
 * hour ago is a report of a failure. And thirty minutes is the last moment the
 * warning is still worth acting on — long enough to wind up what you are
 * doing and be somewhere, short enough that it is not forgotten again by the
 * time it matters. When somebody has to travel, the itinerary's own cascade
 * already carries that; this is about the meeting, not the journey.
 *
 * The principal only. Their assistants have the same appointment on their own
 * screens, and buzzing three people for one four o'clock is how an office
 * learns to ignore the buzz.
 */
const APPOINTMENT_LEAD_MS = 30 * 60 * 1000;

async function sweepAppointments(now) {
  const rows = await db.prepare(`
    SELECT b.*, u.name AS owner_name, u.timezone AS owner_timezone,
           mt.name AS meeting_name
    FROM bookings b
    JOIN users u ON u.id = b.owner_id
    LEFT JOIN meeting_types mt ON mt.id = b.meeting_type_id
    WHERE b.status = 'confirmed' AND b.reminder_stage IS NULL
  `).all();

  let sent = 0;
  for (const b of rows) {
    const start = new Date(b.start_at).getTime();
    if (Number.isNaN(start)) continue;
    // Not yet worth saying, or already begun — a booking created after its own
    // start time (a PA writing up what happened) must not buzz about it.
    if (start - now > APPOINTMENT_LEAD_MS || start <= now) continue;

    const mins = Math.max(1, Math.round((start - now) / 60000));
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
    await db.prepare('UPDATE bookings SET reminder_stage = ? WHERE id = ?').run('soon', b.id);
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

async function runReminderSweep(now = Date.now()) {
  return {
    tasks: await sweepTasks(now),
    stages: await sweepStages(now),
    appointments: await sweepAppointments(now),
    essentials: await sweepEssentials(now),
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
  runReminderSweep, startReminderSweep, dueBand, expiryBand, leadFor,
  LEAD_MS, SWEEP_INTERVAL_MS, APPOINTMENT_LEAD_MS, DOC_SOON_DAYS, DOC_URGENT_DAYS,
};
