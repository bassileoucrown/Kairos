const crypto = require('crypto');
const db = require('./db');
const objectStore = require('./objectStore');
const transcribe = require('./transcribe');
const secretBox = require('./secretBox');

// Capturing what was said in the room.
//
// THE STATE MACHINE CAME FIRST AND THIS IS THE REST OF IT. lib/minutes.js has
// held `off | on | stopped` from the start, along with the consent notice and
// the refusal when the deployment cannot record. What it could not do was take
// any audio. This does — and every rule below exists because a meeting
// recording is the most dangerous artifact this product will ever hold.
//
// CONSENT IS A PRECONDITION, NOT A CHECKBOX. Audio is refused unless the
// meeting is already in the `on` state, which somebody had to press, having
// been shown the notice. There is deliberately no way to upload audio for a
// meeting nobody turned recording on for — that would make the state machine
// decorative and the notice a lie.
//
// THE AUDIO EXPIRES; THE TRANSCRIPT IS WHAT LASTS. Words are what a minute is
// written from, and they are a thousandth of the size. Audio kept past its
// usefulness is a liability nobody revisits until it leaks, so it is deleted
// on a clock — the same reasoning as lib/voiceNotes.js, at a much larger size.
//
// IT IS ENCRYPTED BEFORE IT LEAVES THIS PROCESS. The object store is somebody
// else's disk, even when it is the office's own, so what lands there is a
// ciphertext this deployment's ENCRYPTION_KEY opens and nothing else does. A
// bucket left public is then an embarrassment rather than a catastrophe.
//
// AND IT IS NEVER THE MINUTE. A transcript is office material — the raw thing
// a minute is written FROM, in the same drawer as a dictation. A machine
// transcript filed as the record of a meeting is a record nobody checked.

const MAX_BYTES = 200 * 1024 * 1024;
const RETENTION_DAYS = Number(process.env.RECORDING_RETENTION_DAYS || 30);
const ALLOWED_MIME = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav'];

function baseMime(mime) {
  return String(mime || '').split(';')[0].trim().toLowerCase();
}

/**
 * Everything that has to be true before a word of this works, and which piece
 * is missing. Three separate requirements, named separately, because "not
 * configured" sends an operator hunting through five files.
 */
function readiness() {
  const missing = [];
  if (!secretBox.isConfigured()) missing.push('ENCRYPTION_KEY');
  missing.push(...objectStore.config().missing);
  missing.push(...transcribe.config().missing);
  return { available: missing.length === 0, missing };
}

function problem({ bytes, mimeType }) {
  if (!ALLOWED_MIME.includes(baseMime(mimeType))) return 'That audio format is not supported.';
  if (!bytes) return 'The recording came through empty.';
  if (bytes > MAX_BYTES) {
    return `A recording can be at most ${Math.round(MAX_BYTES / (1024 * 1024))} MB.`;
  }
  return null;
}

/** Where one meeting's audio lives in the bucket. */
function keyFor(bookingId, id) {
  return `recordings/${bookingId}/${id}`;
}

/**
 * Take the audio, keep it, and turn it into words.
 *
 * ONE FUNCTION RATHER THAN THREE ROUTES, because the three steps are only ever
 * done together and a half-finished capture — audio stored, never transcribed,
 * nobody told — is the state that leaves a principal's voice sitting in a
 * bucket for no reason at all. If the transcription fails, the audio is
 * removed again before the error is raised.
 */
async function capture({ booking, base64, mimeType = 'audio/webm', durationMs = 0, userId }) {
  const ready = readiness();
  if (!ready.available) {
    return {
      ok: false,
      status: 503,
      code: 'not_configured',
      error: `Recording is not configured for this deployment: ${ready.missing.join(', ')}.`,
    };
  }

  // THE CONSENT GATE. Not "was a box ticked" — was this meeting actually put
  // into the recording state by a person who saw the notice.
  if (booking.recording_state !== 'on') {
    return {
      ok: false,
      status: 409,
      code: 'not_recording',
      error: 'This meeting is not being recorded. Somebody has to turn recording on, '
        + 'having told the room, before any audio can be kept.',
    };
  }

  const raw = Buffer.from(String(base64 || ''), 'base64');
  const wrong = problem({ bytes: raw.length, mimeType });
  if (wrong) return { ok: false, status: 400, code: 'bad_audio', error: wrong };

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const objectKey = keyFor(booking.id, id);

  // Encrypted here, so the bytes that cross the wire to the store are already
  // unreadable. secretBox works on strings; base64 is what it is handed.
  const sealed = Buffer.from(secretBox.encrypt(raw.toString('base64')), 'utf8');
  await objectStore.put(objectKey, sealed, 'application/octet-stream');

  let text;
  try {
    text = await transcribe.transcribe(raw, { mimeType, filename: `${id}.webm` });
  } catch (err) {
    // NOTHING IS KEPT FOR NOTHING. Audio whose transcript failed has no reason
    // to sit in a bucket, and leaving it there is how a store fills up with
    // recordings nobody knows the provenance of.
    await objectStore.del(objectKey).catch(() => {});
    return {
      ok: false,
      status: err.code === 'not_configured' ? 503 : 502,
      code: err.code || 'transcription_failed',
      error: err.message,
    };
  }

  const expiresAt = new Date(Date.now() + RETENTION_DAYS * 86400000).toISOString();
  await db.prepare(`
    INSERT INTO booking_recordings
      (id, booking_id, owner_id, object_key, mime_type, bytes, duration_ms,
       transcript, captured_by, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, booking.id, booking.owner_id, objectKey, baseMime(mimeType), raw.length,
    Math.max(0, Math.round(Number(durationMs) || 0)), text, userId, now, expiresAt);

  // The transcript joins the notes and dictations a minute is written from —
  // see lib/minutes.js. It is filed as its own kind so a reader can always
  // tell which sentences a person wrote and which a machine heard.
  await db.prepare(`
    INSERT INTO booking_notes (id, booking_id, owner_id, author_user_id, kind, body, created_at)
    VALUES (?, ?, ?, ?, 'transcript', ?, ?)
  `).run(crypto.randomUUID(), booking.id, booking.owner_id, userId, text, now);

  return { ok: true, id, bytes: raw.length, words: text.split(/\s+/).length };
}

/** What was captured for a meeting. Never the audio — only that it exists. */
async function forBooking(bookingId) {
  const rows = await db.prepare(
    'SELECT * FROM booking_recordings WHERE booking_id = ? ORDER BY created_at',
  ).all(bookingId);
  return rows.map((r) => ({
    id: r.id,
    bytes: r.bytes,
    durationMs: r.duration_ms,
    capturedBy: r.captured_by,
    createdAt: r.created_at,
    // Said, so a principal knows the audio is on a clock and the words are not.
    expiresAt: r.expires_at,
    audioGone: !r.object_key,
    words: r.transcript ? r.transcript.split(/\s+/).length : 0,
  }));
}

/**
 * The audio itself, decrypted, for whoever is entitled to it.
 *
 * The caller decides who that is — this is the vault's shape, not its gate.
 */
async function openAudio(recordingId) {
  const row = await db.prepare('SELECT * FROM booking_recordings WHERE id = ?').get(recordingId);
  if (!row || !row.object_key) return null;
  const sealed = await objectStore.get(row.object_key);
  if (!sealed) return null;
  const plain = secretBox.decrypt(sealed.toString('utf8'));
  if (plain === null) return null;
  return { bytes: Buffer.from(plain, 'base64'), mimeType: row.mime_type };
}

/**
 * Delete audio that has served its purpose, keeping the transcript.
 *
 * Run from the sweep. The row stays with object_key cleared, so a principal
 * asking "was this meeting recorded" still gets yes — the fact of a recording
 * is part of the record even after the audio has gone.
 */
async function sweepExpired(now = new Date()) {
  const due = await db.prepare(
    'SELECT id, object_key FROM booking_recordings WHERE object_key IS NOT NULL AND expires_at <= ?',
  ).all(now.toISOString());
  let removed = 0;
  for (const r of due) {
    try {
      await objectStore.del(r.object_key);
      await db.prepare('UPDATE booking_recordings SET object_key = NULL WHERE id = ?').run(r.id);
      removed += 1;
    } catch { /* try again next sweep rather than losing the row */ }
  }
  return removed;
}

module.exports = {
  readiness, capture, forBooking, openAudio, sweepExpired,
  MAX_BYTES, RETENTION_DAYS, ALLOWED_MIME, keyFor, problem,
};
