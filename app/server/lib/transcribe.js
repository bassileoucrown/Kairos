// Turning a recording into words.
//
// A ROUTE, NOT A VENDOR. TRANSCRIPTION_ENDPOINT is whatever the office has
// agreed to send a principal's voice to — a hosted provider, or a Whisper
// process on their own hardware. That choice is theirs and it is not a small
// one: audio of a principal in a private meeting is among the most sensitive
// material this product will ever hold, and an office that will not hand it to
// a third party can point this at a box in their own building.
//
// SO THERE IS NO DEFAULT. Unset means unavailable, said plainly, rather than
// quietly falling back to somebody convenient. See lib/connectors.js.
//
// THE REQUEST SHAPE is multipart with the audio under `file`, which is what
// OpenAI's transcription API, Groq's, and every self-hosted Whisper wrapper
// accept. The response is read leniently — `text`, or `{ text }`, or
// `{ results: [{ transcript }] }` — because that is the one place providers
// differ and a rigid reader would break on a version bump.

const TIMEOUT_MS = 180000;

function config() {
  const endpoint = (process.env.TRANSCRIPTION_ENDPOINT || '').trim();
  const key = (process.env.TRANSCRIPTION_KEY || '').trim();
  const model = (process.env.TRANSCRIPTION_MODEL || 'whisper-1').trim();
  const missing = [];
  if (!endpoint) missing.push('TRANSCRIPTION_ENDPOINT');
  if (!key) missing.push('TRANSCRIPTION_KEY');
  return { endpoint, key, model, missing };
}

function isConfigured() {
  return config().missing.length === 0;
}

/** Whatever shape came back, as text. Null when there is nothing usable. */
function textFrom(payload) {
  if (typeof payload === 'string') return payload.trim() || null;
  if (!payload || typeof payload !== 'object') return null;
  if (typeof payload.text === 'string') return payload.text.trim() || null;
  if (typeof payload.transcript === 'string') return payload.transcript.trim() || null;
  if (Array.isArray(payload.results)) {
    const joined = payload.results
      .map((r) => r?.transcript || r?.text || '')
      .filter(Boolean).join(' ').trim();
    return joined || null;
  }
  return null;
}

/**
 * Send audio, get words.
 *
 * Throws with a code rather than returning null on failure, because the three
 * ways this goes wrong want three different sentences on the screen: not
 * configured, refused by the provider, and came back empty.
 */
async function transcribe(bytes, { filename = 'meeting.webm', mimeType = 'audio/webm' } = {}) {
  const c = config();
  if (c.missing.length) {
    throw Object.assign(new Error(`Transcription is not configured: ${c.missing.join(', ')}.`), {
      code: 'not_configured', missing: c.missing,
    });
  }

  const form = new FormData();
  form.append('file', new Blob([bytes], { type: mimeType }), filename);
  form.append('model', c.model);

  const res = await fetch(c.endpoint, {
    method: 'POST',
    headers: { authorization: `Bearer ${c.key}` },
    body: form,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 300);
    throw Object.assign(new Error(`Transcription refused (${res.status}): ${detail}`), {
      code: 'transcription_failed', status: res.status,
    });
  }

  const raw = await res.text();
  let payload = raw;
  try { payload = JSON.parse(raw); } catch { /* some routes return plain text */ }
  const text = textFrom(payload);
  if (!text) {
    throw Object.assign(new Error('The recording came back with no words in it.'), {
      code: 'transcription_empty',
    });
  }
  return text;
}

module.exports = { isConfigured, config, transcribe, textFrom, TIMEOUT_MS };
