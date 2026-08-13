const crypto = require('crypto');
const db = require('./db');
const secretBox = require('./secretBox');

// Voice on the direct line.
//
// Three decisions carry this, and each of them is about the recording being
// more sensitive than the typed message it replaces, not less.
//
// It requires ENCRYPTION_KEY, the same key the vault requires. Without a key
// the feature says so and refuses, exactly as the essentials vault does. The
// alternative — holding a principal's voice in plaintext because a key was
// inconvenient to set — is the one outcome worth refusing outright.
//
// It expires. Thirty days by default. An operational note has a useful life
// measured in hours, and audio kept past its usefulness is a liability nobody
// revisits until it leaks. When transcription lands, the text becomes the
// durable artifact and this deadline stops costing anything at all.
//
// It is capped hard. Two minutes, two megabytes. A direct line is for "the car
// is downstairs", not for dictating a memo — and an uncapped audio endpoint is
// an invitation to fill somebody else's database.

const MAX_SECONDS = 120;
const MAX_BYTES = 2 * 1024 * 1024;
const RETENTION_DAYS = Number(process.env.VOICE_RETENTION_DAYS || 30);

// What browsers actually produce from MediaRecorder. Chrome and Firefox give
// webm/opus; Safari gives mp4/aac. Anything else is refused rather than stored
// and served back as a type we never verified.
const ALLOWED_MIME = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg'];

/** The container type without the codecs parameter browsers append. */
function baseMime(mime) {
  return String(mime || '').split(';')[0].trim().toLowerCase();
}

/** Whether this deployment can hold a recording at all. */
function isAvailable() {
  return secretBox.isConfigured();
}

/**
 * The sentence shown wherever the microphone would otherwise be. Said in the
 * app's own voice rather than as an error, because for an operator who has not
 * set a key this is a configuration fact, not a fault.
 */
const UNAVAILABLE = 'Voice notes need an encryption key set on the server, so they are not '
  + 'available yet. A recording of a principal is at least as sensitive as anything in the '
  + 'vault, and it should not be stored without one.';

function problem({ bytes, durationMs, mimeType }) {
  if (!ALLOWED_MIME.includes(baseMime(mimeType))) {
    return 'That audio format is not supported.';
  }
  if (!bytes) return 'The recording came through empty.';
  if (bytes > MAX_BYTES) {
    return `A voice note can be at most ${Math.round(MAX_BYTES / (1024 * 1024))} MB.`;
  }
  if (durationMs > (MAX_SECONDS + 5) * 1000) {
    return `A voice note can be at most ${MAX_SECONDS / 60} minutes.`;
  }
  return null;
}

function serialize(row) {
  return {
    id: row.id,
    messageId: row.message_id,
    durationMs: Number(row.duration_ms),
    byteSize: Number(row.byte_size),
    mimeType: row.mime_type,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

/**
 * Stores a recording against a message that already exists.
 *
 * Takes base64 rather than a stream because it arrives inside the same JSON
 * body as the message it belongs to, and because what gets encrypted is a
 * string either way.
 */
async function attach({ messageId, threadId, authorId, base64, mimeType, durationMs }) {
  if (!isAvailable()) return { error: UNAVAILABLE, status: 503 };

  let buf;
  try { buf = Buffer.from(String(base64 || ''), 'base64'); }
  catch { return { error: 'The recording could not be read.', status: 400 }; }

  const bad = problem({ bytes: buf.length, durationMs: Number(durationMs) || 0, mimeType });
  if (bad) return { error: bad, status: 400 };

  const now = new Date();
  const row = {
    id: crypto.randomUUID(),
    message_id: messageId,
    thread_id: threadId,
    author_id: authorId,
    mime_type: baseMime(mimeType),
    // Clamped rather than trusted: the duration is whatever the browser
    // reported, and it decides nothing but what the player prints.
    duration_ms: Math.min(Math.max(0, Math.round(Number(durationMs) || 0)), MAX_SECONDS * 1000),
    byte_size: buf.length,
    audio: secretBox.encrypt(buf.toString('base64')),
    expires_at: new Date(now.getTime() + RETENTION_DAYS * 86400 * 1000).toISOString(),
    created_at: now.toISOString(),
  };

  await db.prepare(`
    INSERT INTO voice_notes (id, message_id, thread_id, author_id, mime_type, duration_ms, byte_size, audio, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.id, row.message_id, row.thread_id, row.author_id, row.mime_type,
    row.duration_ms, row.byte_size, row.audio, row.expires_at, row.created_at,
  );

  return { voice: serialize(row) };
}

/**
 * Metadata for a thread's messages — never the audio. Listing a thread must
 * not drag every recording in it across the wire.
 */
async function forThread(threadId) {
  const rows = await db.prepare('SELECT * FROM voice_notes WHERE thread_id = ?').all(threadId);
  const byMessage = new Map();
  for (const r of rows) byMessage.set(r.message_id, serialize(r));
  return byMessage;
}

/** The recording itself, decrypted, or null if it has gone. */
async function open(messageId) {
  const row = await db.prepare('SELECT * FROM voice_notes WHERE message_id = ?').get(messageId);
  if (!row) return null;
  // Past its expiry it is treated as already gone, whether or not the sweep
  // has reached it. A deadline that depends on a timer having fired is not a
  // deadline.
  if (new Date(row.expires_at) <= new Date()) return null;
  const plain = secretBox.decrypt(row.audio);
  if (plain === null) return null;
  return { buffer: Buffer.from(plain, 'base64'), mimeType: row.mime_type };
}

/** Drops recordings past their date. The messages they belonged to stay. */
async function sweepExpired() {
  const res = await db.prepare('DELETE FROM voice_notes WHERE expires_at <= ?')
    .run(new Date().toISOString());
  return res?.changes ?? 0;
}

const SWEEP_INTERVAL_MS = Number(process.env.VOICE_SWEEP_MS || 6 * 60 * 60 * 1000);
let timer = null;

function startVoiceExpiry() {
  if (timer) return;
  timer = setInterval(async () => {
    try { await sweepExpired(); }
    catch (err) { console.error('Voice expiry sweep failed:', err.message); }
  }, SWEEP_INTERVAL_MS);
  if (timer.unref) timer.unref();
}

module.exports = {
  MAX_SECONDS, MAX_BYTES, RETENTION_DAYS, ALLOWED_MIME, UNAVAILABLE,
  isAvailable, attach, forThread, open, sweepExpired, startVoiceExpiry,
};
