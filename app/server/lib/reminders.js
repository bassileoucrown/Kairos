const db = require('./db');
const { sendEmail } = require('./email');
const { formatForEmail } = require('./format');

// Deadline reminders for tasks and project stages.
//
// Each item carries a reminder_stage (null -> due_soon -> overdue) so a nudge
// fires exactly once per threshold rather than on every sweep. Changing a due
// date, reassigning, or reopening clears it, because those genuinely deserve
// a fresh set of reminders.
//
// Delivery goes through the same email service as everything else, so with no
// provider configured these still land in the Outbox tab and the server log —
// visible and testable rather than silently dropped.

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

// Only escalate. Something already flagged overdue shouldn't drop back to
// due_soon because a clock ticked oddly, and due_soon shouldn't re-fire.
function shouldSend(band, sent) {
  if (!band) return false;
  if (band === 'due_soon') return sent === null || sent === undefined;
  if (band === 'overdue') return sent !== 'overdue';
  return false;
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
    await sendEmail({
      // Filed under the space's owner so it shows in the right Outbox.
      ownerId: t.space_owner_id,
      toEmail: t.assignee_email,
      category: 'transactional',
      // Not "due tomorrow" any more: the warning is three days for a high
      // priority and eight hours for a low one, and a subject line that names
      // the wrong day is worse than one that names none.
      subject: band === 'overdue'
        ? `Overdue: ${t.title}`
        : `Due soon: ${t.title}`,
      body: `Hi ${t.assignee_name},\n\n${band === 'overdue' ? 'This task is now overdue' : 'This task is coming up'}: ${t.title}\n\nWhere: ${where}\nDue: ${formatForEmail(t.due_at, 'UTC')} (UTC)\n\nOpen your tasks: /tasks`,
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

    await sendEmail({
      ownerId: st.space_owner_id,
      toEmail: st.owner_email,
      category: 'transactional',
      subject: band === 'overdue'
        ? `Stage overdue: ${st.name}`
        : `Stage due tomorrow: ${st.name}`,
      body: `Hi ${st.owner_name},\n\nThe "${st.name}" stage of ${st.project_name} (${st.space_name}) is ${band === 'overdue' ? 'overdue' : 'due soon'}.\n\nDue: ${formatForEmail(st.due_at, 'UTC')} (UTC)\nCurrent status: ${st.status}`,
    });
    await db.prepare('UPDATE project_stages SET reminder_stage = ? WHERE id = ?').run(band, st.id);
    sent += 1;
  }
  return sent;
}

async function runReminderSweep(now = Date.now()) {
  return { tasks: await sweepTasks(now), stages: await sweepStages(now) };
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
  runReminderSweep, startReminderSweep, dueBand, leadFor, LEAD_MS, SWEEP_INTERVAL_MS,
};
