const db = require('./db');
const aiModel = require('./aiModel');
const catchUp = require('./catchUp');
const { weekAhead } = require('./weekAhead');
const { visibleThreads } = require('./spaceAccess');

// The seven things AI Assist can do, and the one shape they all share.
//
// EVERY ONE OF THEM IS THE SAME MOVE: gather what Kairos already holds, hand
// it to a model as material, and return words or proposals that a person then
// acts on. Nothing here writes to a table. That is not a policy, it is the
// shape of the file — these functions take ids and return strings and arrays,
// and none of them is passed anything it could save with.
//
// WHY THAT MATTERS MORE HERE THAN IN lib/minutes.js. A minute is one document
// somebody reads before filing. These reach further: into a thread's records,
// into the task list, into correspondence. The further a suggestion reaches,
// the more it matters that a person is standing between the suggestion and the
// act — so the gap is kept structural rather than remembered.
//
// WHAT IS DELIBERATELY NOT HERE. The arrival alarm, the check calls, the
// expiry engine, the car-that-no-longer-fits: all of those stay deterministic
// rules elsewhere in this codebase, and none of them will ever be moved into
// this file. A model that is right ninety-seven times in a hundred is WORSE
// than a rule that is right every time for "has the principal arrived",
// because the three failures are silent and somebody is relying on them.
// Judgement belongs here; safety does not.
//
// AND NOTHING HERE RANKS PEOPLE. A model quietly deciding which contacts
// matter would build a hidden hierarchy of humans inside a product whose whole
// promise is that the principal decides. Triage sorts MESSAGES by what they
// need, never correspondents by what they are worth.

/** Every ask this file offers, so a screen can list them without guessing. */
const ASKS = Object.freeze([
  'catch_up', 'meeting_brief', 'minute_tasks',
  'triage', 'reply', 'week_ahead', 'record_candidates',
]);

/**
 * A model answer that has to come back as a list rather than as prose.
 *
 * PARSED DEFENSIVELY AND FAILING LOUDLY. Three of the seven want structure —
 * proposed tasks, a triage verdict per thread, candidate records — and a model
 * asked for JSON will sometimes wrap it in a code fence or add a sentence in
 * front. Stripping those is fair. Guessing at a half-parsed answer is not: a
 * malformed reply becomes an error the screen can show, never a shorter list
 * that looks complete.
 */
async function askForList({ instruction, material, shape, maxTokens = 1500 }) {
  const text = await aiModel.draft({
    instruction: `${instruction}\n\nAnswer with JSON only, in exactly this shape:\n${shape}\n`
      + 'No prose before or after it. An empty list is a valid answer and is better '
      + 'than an invented one.',
    material,
    maxTokens,
  });

  const fenced = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = fenced.search(/[[{]/);
  if (start < 0) throw new BadShape();
  try {
    const parsed = JSON.parse(fenced.slice(start));
    return Array.isArray(parsed) ? parsed : (parsed.items || []);
  } catch {
    throw new BadShape();
  }
}

class BadShape extends Error {
  constructor() {
    super('The answer came back in a shape Kairos could not read. Nothing has been saved.');
    this.name = 'BadShape';
    this.code = 'bad_shape';
  }
}

// --- 1. What happened while you were away --------------------------------------

/**
 * The catch-up, as four paragraphs instead of forty rows.
 *
 * THE HIGHEST-VALUE ASK IN THIS FILE, and it is worth saying why: it is read
 * every morning, by every returning principal, and lib/catchUp.js has already
 * done all the gathering. The list it produces is correct and exhausting —
 * this is the same information with the shape a person needed.
 */
async function catchUpBrief(userId) {
  // Null when this person has not been away, which is not an error: there is
  // simply no window to summarise.
  const window = await catchUp.windowFor(userId);
  const data = window ? await catchUp.build(userId, { since: window.since }) : null;
  if (!data || catchUp.isEmpty(data)) {
    // GUARDING THE EARLY RETURN, NOT THE FUNCTION. Placed here rather than at
    // the top because draft() checks the vault BEFORE it checks the key, so a
    // top-level key check would make the vault guard unreachable on every
    // deployment without a model — which is every test environment there is.
    // The rule: the honest "no model here" belongs on paths that never reach
    // draft(); every other path lets draft() answer in its own order.
    aiModel.requireConfigured();
    return { text: '', empty: true };
  }

  const lines = [];
  for (const r of data.rooms || []) {
    lines.push(`[Room] ${r.spaceName ? `${r.spaceName} — ` : ''}${r.name}: `
      + `${r.unread} unread. Last: ${r.lastMessage?.body || ''}`);
  }
  for (const p of data.principals || []) {
    lines.push(`[For ${p.name}] ${JSON.stringify(p).slice(0, 600)}`);
  }

  const text = await aiModel.draft({
    instruction: [
      'Write what happened while this person was away, for them to read in under a minute.',
      '',
      'Three short paragraphs at most, in this order: what changed, what needs them',
      'now, and what can wait. Name people and rooms. Do not list everything — the',
      'list is already on the screen beside this; say what it MEANS.',
      '',
      'If something is only waiting because nobody has answered it, say who it is',
      'waiting on.',
    ].join('\n'),
    material: lines.join('\n'),
    maxTokens: 700,
  });
  return { text, empty: false, since: window.since };
}

// --- 2. The brief before a meeting ----------------------------------------------

/**
 * What an assistant would hand the principal in the car.
 *
 * Everything here is already in Kairos: who they are, when you last met, what
 * was minuted, what is still owed. The value is not the retrieval, it is that
 * nobody has time to do the retrieval at 8:40 for a nine o'clock.
 */
async function meetingBrief(booking, ownerId) {
  const contact = await db.prepare(
    'SELECT * FROM contacts WHERE owner_id = ? AND lower(email) = lower(?)',
  ).get(ownerId, booking.booker_email || '');

  const past = await db.prepare(`
    SELECT b.id, b.start_at, b.status, mt.name AS meeting_name
      FROM bookings b LEFT JOIN meeting_types mt ON mt.id = b.meeting_type_id
     WHERE b.owner_id = ? AND lower(b.booker_email) = lower(?) AND b.id != ?
     ORDER BY b.start_at DESC LIMIT 5
  `).all(ownerId, booking.booker_email || '', booking.id);

  const minutes = past.length ? await db.prepare(`
    SELECT body, created_at FROM booking_notes
     WHERE booking_id IN (${past.map(() => '?').join(',')}) AND kind = 'minute'
     ORDER BY created_at DESC LIMIT 4
  `).all(...past.map((b) => b.id)) : [];

  const parts = [
    `Meeting: ${booking.booker_name || 'a visitor'} on `
      + `${String(booking.start_at).slice(0, 16).replace('T', ' ')} UTC.`,
    contact ? `Known to the office. Notes: ${contact.notes || '(none)'}` : 'Not in the address book.',
    past.length
      ? `Met before: ${past.map((b) => String(b.start_at).slice(0, 10)).join(', ')}`
      : 'First meeting.',
  ];
  for (const m of minutes) parts.push(`[Minutes ${String(m.created_at).slice(0, 10)}] ${m.body}`);

  const text = await aiModel.draft({
    instruction: [
      'Write the briefing note for whoever is walking into this meeting.',
      '',
      'Use these headings, omitting any you have nothing for:',
      'Who they are. Where we left it. Outstanding. Worth knowing.',
      '',
      'Short. Nothing invented — if the material does not say when you last met,',
      'do not guess at it.',
    ].join('\n'),
    material: parts.join('\n\n'),
    maxTokens: 800,
  });
  return { text, from: { pastMeetings: past.length, minutes: minutes.length, known: !!contact } };
}

// --- 3. The actions inside a minute ---------------------------------------------

/**
 * Turn what a minute says was agreed into tasks somebody can be given.
 *
 * PROPOSALS, NOT TASKS. The gap between "the minute mentions an action" and
 * "the office is now tracking it" is a person pressing something, because a
 * task appearing in somebody's list because a model read a sentence is how the
 * task list stops being believed.
 */
async function tasksFromMinute(minuteBody) {
  const items = await askForList({
    instruction: [
      'Read these minutes and list the actions somebody agreed to do.',
      'Only what the minutes actually say was agreed — not what would be sensible.',
      'If a person is named as owning it, give their name exactly as written.',
      'If a date is given, give it as YYYY-MM-DD; otherwise leave it null.',
    ].join('\n'),
    material: minuteBody,
    shape: '[{"title": "...", "owner": "name or null", "dueOn": "YYYY-MM-DD or null"}]',
    maxTokens: 900,
  });
  return items
    .filter((i) => i && typeof i.title === 'string' && i.title.trim())
    .slice(0, 20)
    .map((i) => ({
      title: String(i.title).trim().slice(0, 200),
      owner: i.owner ? String(i.owner).slice(0, 80) : null,
      dueOn: /^\d{4}-\d{2}-\d{2}$/.test(String(i.dueOn || '')) ? i.dueOn : null,
    }));
}

// --- 4. Triage of correspondence -------------------------------------------------

const TRIAGE = ['needs_principal', 'assistant_can_answer', 'can_wait', 'no_action'];

/**
 * What each piece of correspondence needs, and why.
 *
 * SORTS MESSAGES, NEVER PEOPLE. The verdict is about what this message needs
 * doing to it. Nothing here scores a correspondent, and the categories are
 * deliberately about ACTION rather than importance for that reason.
 */
async function triage(threads) {
  // Nothing to sort is a real answer, but only once we know the feature is
  // actually available — otherwise an empty mailbox reports a working triage
  // on a deployment that has no model. See catchUpBrief for why the guard is
  // on the early return rather than at the top.
  if (!threads.length) { aiModel.requireConfigured(); return []; }
  const material = threads.map((t) => [
    `id: ${t.id}`,
    `from: ${t.correspondentName || t.correspondentEmail}`,
    `subject: ${t.subject}`,
    `latest: ${String(t.latest || '').slice(0, 800)}`,
  ].join('\n')).join('\n---\n');

  const items = await askForList({
    instruction: [
      'For each piece of correspondence, say what it needs.',
      '',
      'needs_principal — only the principal can answer this.',
      'assistant_can_answer — an assistant can deal with it.',
      'can_wait — real, but not this week.',
      'no_action — nothing is required.',
      '',
      'Give a short reason in the office\'s own words. Judge what the message',
      'needs, not how important the sender is.',
    ].join('\n'),
    material,
    shape: '[{"id": "...", "verdict": "one of the four", "why": "one short sentence"}]',
    maxTokens: 1200,
  });

  const known = new Set(threads.map((t) => t.id));
  return items
    // An id the model invented refers to nothing, and letting it through would
    // put a verdict on a thread that does not exist.
    .filter((i) => i && known.has(i.id) && TRIAGE.includes(i.verdict))
    .map((i) => ({ id: i.id, verdict: i.verdict, why: String(i.why || '').slice(0, 200) }));
}

// --- 5. A reply that sounds like them ---------------------------------------------

/**
 * A draft in the principal's own voice.
 *
 * voiceSample is what makes this not sound generic, and it is worth saying why
 * it is samples rather than an instruction: telling a model to "sound human"
 * produces the average of everybody, while showing it six things this person
 * actually wrote produces this person. Somebody who writes three lines with no
 * greeting gets back three lines with no greeting.
 */
async function reply({ instruction, context, asUserId }) {
  const voice = await aiModel.voiceSample(asUserId, 6);
  const text = await aiModel.draft({
    instruction: [
      'Write the reply described below.',
      'No subject line, no signature, no explanation of what you have written —',
      'the words go straight into a box somebody will edit.',
      '',
      `What is wanted: ${instruction}`,
    ].join('\n'),
    material: context,
    voice,
    maxTokens: 900,
  });
  return { text, inVoice: voice.length > 0 };
}

// --- 6. The week ahead, read rather than listed -------------------------------------

/**
 * The sentence a Chief of Staff would say about next week.
 *
 * lib/weekAhead.js already produces the numbers and the neglect list. This is
 * the observation on top of them — where the week is tight, what collides,
 * what lapses at the wrong moment.
 */
async function weekAheadRead(ownerId, viewerId) {
  const ahead = await weekAhead(ownerId, viewerId);
  if (!ahead) { aiModel.requireConfigured(); return { text: '', empty: true }; }

  const parts = [
    `Week of ${ahead.window.startDate} to ${ahead.window.endDate}.`,
    `${ahead.appointments} appointments.`,
    ahead.trips.length
      ? `Away: ${ahead.trips.map((t) => `${t.name} ${t.startsOn}–${t.endsOn}`).join('; ')}`
      : 'Not travelling.',
    ahead.expiring.length
      ? `Lapsing: ${ahead.expiring.map((e) => `${e.label} on ${e.expiresOn}`).join('; ')}`
      : '',
    ...ahead.tasksDue.map((t) => `Task due ${String(t.dueAt).slice(0, 10)}: ${t.title}`),
    ...ahead.stagesDue.map((s) => `Stage due ${String(s.dueAt).slice(0, 10)}: ${s.projectName} — ${s.name}`),
    ...ahead.neglected.items.map((n) => `Untouched: ${n.title} — ${n.why}`),
  ].filter(Boolean);

  const text = await aiModel.draft({
    instruction: [
      'Say what is worth knowing about the week ahead, in two short paragraphs.',
      '',
      'Lead with where it is tight or where two things collide. Say what would',
      'have to move if something slipped. Do not restate the counts — they are',
      'on the screen beside this.',
    ].join('\n'),
    material: parts.join('\n'),
    maxTokens: 600,
  });
  return { text, empty: false, window: ahead.window };
}

// --- 7. Something in this room looks like a decision ---------------------------------

const RECORD_TYPES = ['decision', 'approval', 'blocker', 'signoff'];

/**
 * Lines in a conversation that read like they belong in the formal record.
 *
 * THE MOST CAREFULLY FENCED ASK IN THIS FILE. A record in Kairos moves a
 * project stage — an open Blocker forces 'blocked', an accepted Sign-off
 * forces 'done'. So a model that could file one could move a project, and this
 * returns candidates that name an existing message and nothing else. Promoting
 * is still the same deliberate act it always was.
 */
async function recordCandidates(threadId) {
  const rows = await db.prepare(`
    SELECT m.id, m.body, u.name AS author FROM messages m
      LEFT JOIN users u ON u.id = m.author_id
     WHERE m.thread_id = ? AND m.register = 'note'
     ORDER BY m.created_at DESC LIMIT 40
  `).all(threadId);
  if (!rows.length) { aiModel.requireConfigured(); return []; }

  const items = await askForList({
    instruction: [
      'Which of these lines record something actually settled — a decision made,',
      'an approval given, a blocker raised, or a sign-off?',
      '',
      'Only lines that settle something. Discussion, questions and suggestions are',
      'not decisions. Most conversations contain none, and none is the right answer',
      'far more often than one.',
    ].join('\n'),
    material: rows.map((m) => `id: ${m.id}\n${m.author || 'Someone'}: ${m.body}`).join('\n---\n'),
    shape: '[{"id": "...", "recordType": "decision|approval|blocker|signoff", "why": "..."}]',
    maxTokens: 900,
  });

  const known = new Map(rows.map((m) => [m.id, m]));
  return items
    .filter((i) => i && known.has(i.id) && RECORD_TYPES.includes(i.recordType))
    .map((i) => ({
      messageId: i.id,
      body: known.get(i.id).body,
      recordType: i.recordType,
      why: String(i.why || '').slice(0, 200),
    }));
}

module.exports = {
  ASKS, TRIAGE, RECORD_TYPES, BadShape,
  catchUpBrief, meetingBrief, tasksFromMinute, triage, reply, weekAheadRead, recordCandidates,
  askForList,
};
