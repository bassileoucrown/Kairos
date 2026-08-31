const db = require('./db');
const aiModel = require('./aiModel');
const connectors = require('./connectors');

// Writing up a meeting, from whatever the office actually has.
//
// WHAT A MINUTE IS FOR HERE. A principal takes six meetings a day and
// remembers four of them by Friday. The assistant who sat in the room is the
// only person who can say what was agreed, and until now the only way to
// record it was to type the whole thing from memory into a box. Most people
// do not, and the meeting evaporates.
//
// THREE SOURCES, BECAUSE OFFICES DIFFER AND SO DO MEETINGS.
//
//   NOTES, always. Whatever was typed on the booking before and during. Every
//   office has these and they need nothing configured.
//
//   A DICTATION, afterwards. Somebody walks out and says what happened for
//   ninety seconds. This is the one most likely to actually get used, because
//   it costs the person nothing at the moment they are least willing to type.
//
//   A RECORDING, during, and only when somebody deliberately turned it on.
//   Never a default, never silent — see recordingState below.
//
// The draft is assembled from whichever of the three exist. An office with
// only notes gets a thinner minute rather than an error.
//
// THE MODEL NEVER FILES ANYTHING. It returns text; a person reads it, edits
// it, and files it. That is not a policy written in a prompt, it is the shape
// of the code: draftFrom returns a string and touches no table, and file() is
// only ever reached from a route a human called. "AI must never auto send or
// pretend" has to be a property of the design, because a rule a model is
// merely told is a rule it can be talked out of.

const MAX_MATERIAL = 24000;

/**
 * Everything the office holds about this meeting that may go into a draft.
 *
 * NOTES ONLY, NOT THE VAULT. What comes back here goes to a model, so the list
 * of what is gathered is deliberately short and explicit rather than "whatever
 * relates to this booking". See lib/aiModel.js READABLE for the same idea
 * applied at the other end.
 */
async function material(booking) {
  const notes = await db.prepare(`
    SELECT n.body, n.kind, n.created_at, u.name AS author
      FROM booking_notes n
      LEFT JOIN users u ON u.id = n.author_user_id
     WHERE n.booking_id = ? AND n.kind != 'minute'
     ORDER BY n.created_at
  `).all(booking.id);

  const parts = [];
  parts.push(`Meeting with ${booking.booker_name || 'a visitor'}`
    + `${booking.booker_company ? ` of ${booking.booker_company}` : ''}`
    + ` on ${String(booking.start_at).slice(0, 16).replace('T', ' ')} UTC.`);

  if (booking.purpose) parts.push(`What it was for: ${booking.purpose}`);

  for (const n of notes) {
    parts.push(`[${n.kind === 'dictation' ? 'Said afterwards' : 'Note'}`
      + `${n.author ? ` by ${n.author}` : ''}] ${n.body}`);
  }

  // Truncated at a stated size rather than sent whole. A model call is
  // metered, and an office that pasted a forty-page contract into a note
  // should get a draft and a warning, not a bill.
  const text = parts.join('\n\n');
  return {
    text: text.length > MAX_MATERIAL ? `${text.slice(0, MAX_MATERIAL)}\n\n[…material truncated]` : text,
    truncated: text.length > MAX_MATERIAL,
    // Said out loud so a screen can explain a thin draft rather than letting
    // somebody conclude the feature is broken.
    noteCount: notes.length,
    hasDictation: notes.some((n) => n.kind === 'dictation'),
  };
}

const SHAPE = [
  'Write the minutes of this meeting, as the office\'s own record.',
  '',
  'Use exactly these headings, and omit any heading you have nothing for:',
  '',
  'Present — who was there, if the material says.',
  'Discussed — what was covered, in short paragraphs.',
  'Decided — what was actually settled. Each on its own line.',
  'To do — each action on its own line, starting with the person who owns it',
  '  where the material names one, and the date if one was given.',
  '',
  'Do not add a heading of your own, a summary line, or anything about what',
  'you did. Do not guess at an attendee, a figure or a decision that is not in',
  'the material.',
].join('\n');

/**
 * A draft minute. Returns text and writes nothing.
 *
 * Throws NotConfigured when there is no model, rather than falling back to a
 * template and calling it a draft — see the top of lib/aiModel.js for why that
 * distinction is worth an error.
 */
async function draftFrom(booking, authorId) {
  const m = await material(booking);
  const voice = await aiModel.voiceSample(authorId, 6);
  const text = await aiModel.draft({
    instruction: SHAPE,
    material: m.text,
    voice,
    maxTokens: 2000,
  });
  return { text, material: m };
}

// --- Recording ----------------------------------------------------------------

// off      — nobody asked for one. The default, and the only default.
// on       — somebody turned it on, in the room, with the notice shown.
// stopped  — it ran and was stopped. There may be audio to transcribe.
//
// THERE IS NO 'auto'. A recording that starts because a meeting started is the
// version of this feature that gets an office sued, and a principal whose
// counterparties learn their meetings are taped by default has lost more than
// the feature is worth. Somebody presses it, every time.
const RECORDING_STATES = new Set(['off', 'on', 'stopped']);

/**
 * Whether this deployment can record and transcribe at all, and what to say.
 *
 * Audio is large and it is a principal's own voice, so it needs the encrypted
 * store rather than a row in the database — the same requirement lib/
 * voiceNotes.js has, one order of magnitude bigger. Until both connectors are
 * set the honest answer is that the feature is not available here, which is
 * how every other unconfigured capability in this app behaves.
 */
function recordingAvailable() {
  const store = connectors.isConfigured('storage');
  const transcribe = connectors.isConfigured('transcription');
  if (store && transcribe) return { available: true };
  return {
    available: false,
    // Named individually: "not configured" tells a deployer nothing about
    // which of the two to go and set.
    why: !store && !transcribe
      ? 'Recording needs the encrypted store and the transcription route, and neither is configured for this deployment.'
      : !store
        ? 'Recording needs the encrypted store, which is not configured for this deployment.'
        : 'Recording needs the transcription route, which is not configured for this deployment.',
  };
}

/**
 * The notice everybody in the room is entitled to, in one place.
 *
 * WRITTEN ONCE AND SHOWN BOTH PLACES — on the button that starts a recording
 * and on the meeting afterwards — because a consent notice that exists only at
 * the moment of pressing is a notice the person being recorded never saw.
 */
const CONSENT_NOTICE = 'Everyone in this meeting must be told it is being recorded, '
  + 'before it starts. Kairos shows that this meeting was recorded, and by whom, '
  + 'on the meeting itself.';

async function setRecording(booking, state, userId) {
  if (!RECORDING_STATES.has(state)) return { ok: false, status: 400, error: 'Not a recording state.' };
  if (state === 'on') {
    const can = recordingAvailable();
    if (!can.available) return { ok: false, status: 503, error: can.why, code: 'not_configured' };
  }
  const now = new Date().toISOString();
  await db.prepare(`
    UPDATE bookings SET recording_state = ?,
                        recording_started_at = CASE WHEN ? = 'on' THEN ? ELSE recording_started_at END,
                        recording_by = CASE WHEN ? = 'on' THEN ? ELSE recording_by END
     WHERE id = ?
  `).run(state, state, now, state, userId, booking.id);
  return { ok: true, state };
}

module.exports = {
  material, draftFrom, SHAPE, MAX_MATERIAL,
  recordingAvailable, setRecording, RECORDING_STATES, CONSENT_NOTICE,
};
