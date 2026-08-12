const crypto = require('crypto');

// Encryption for the fields that would hurt to lose.
//
// A passport number sitting in a database column is a passport number in
// every backup, every dump, every screenshot of a query result. AES-256-GCM
// with a key held outside the database means a stolen copy of the data is not
// a stolen identity — the attacker needs the running server's environment too.
//
// GCM rather than CBC because it authenticates as well as encrypts: a
// tampered ciphertext fails to open rather than decrypting to plausible
// rubbish. The stored form is `v1:<iv>:<tag>:<ciphertext>`, all base64, with
// the version prefix so a future key rotation or algorithm change can tell
// old rows from new ones.
//
// The bargain, stated plainly because it cannot be undone: LOSE THE KEY AND
// THE DATA IS GONE. There is no recovery path, by design — a recovery path is
// just a second key, usually a worse-kept one. Back the key up somewhere that
// is not this application.

const VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';

function loadKey() {
  const raw = (process.env.ENCRYPTION_KEY || '').trim();
  if (!raw) return null;
  // Accept hex or base64 — whichever the operator's key generator produced.
  const buf = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (buf.length !== 32) {
    throw new Error(
      'ENCRYPTION_KEY must be 32 bytes — 64 hex characters, or base64 of 32 bytes. '
      + "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
    );
  }
  return buf;
}

const KEY = loadKey();

/** Whether this deployment can hold encrypted fields at all. */
function isConfigured() {
  return !!KEY;
}

function encrypt(plaintext) {
  if (!KEY) throw new Error('ENCRYPTION_KEY is not set, so sensitive values cannot be stored.');
  if (plaintext === null || plaintext === undefined || plaintext === '') return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join(':');
}

/**
 * Returns null rather than throwing when a value cannot be opened — a row
 * encrypted under a key we no longer have should read as "unavailable", not
 * take down the page that happens to list it.
 */
function decrypt(stored) {
  if (!stored) return null;
  if (!KEY) return null;
  const parts = String(stored).split(':');
  if (parts.length !== 4 || parts[0] !== VERSION) return null;
  try {
    const [, iv, tag, data] = parts;
    const decipher = crypto.createDecipheriv(ALGORITHM, KEY, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(data, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
}

/**
 * What a sensitive value looks like when it is NOT being revealed: enough to
 * confirm you have the right one, never enough to use. Every screen shows
 * this until someone deliberately asks for the rest.
 */
function mask(plaintext) {
  const s = String(plaintext || '');
  if (!s) return '';
  if (s.length <= 4) return '•'.repeat(s.length);
  return `•••• ${s.slice(-4)}`;
}

module.exports = { encrypt, decrypt, mask, isConfigured };
