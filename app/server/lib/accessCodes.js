const crypto = require('crypto');
const db = require('./db');
const { isAssistantRole, roleLabel } = require('./roles');

// How a principal brings on an assistant without an email.
//
// The emailed invitation is still there and still the better path when it
// works. But it needs a working mailbox and a configured provider, and a
// principal has no view of either — so onboarding stalls on infrastructure
// nobody in the room can fix. A code read down the phone needs neither.
//
// Three decisions carry the security of this, and all three are deliberate.
//
// The handle is required as well as the code. Not the code alone: two
// principals will eventually choose the same phrase, and a bare global code
// is a bearer token guessable against every account in the system at once.
// Requiring the handle means an attacker must already know who they are
// targeting, and the collision problem disappears rather than being papered
// over with a uniqueness check that would itself leak which codes are live.
//
// It is armed, not standing. Off by default, live for a window the principal
// chooses, spent after a set number of joins. A credential to an executive's
// calendar that exists only in the hour it is needed cannot leak six months
// later out of an old message.
//
// Every failure answers identically. A wrong code, an unknown handle, an
// expired code and a spent one are one message, because the differences
// between them are exactly what a guesser needs.

const MIN_LENGTH = 6;
const MAX_LENGTH = 40;

/** Accepts "thursday lagos 91", "THURSDAY-LAGOS-91", " Thursday-Lagos-91 ". */
function normalizeCode(input) {
  return String(input || '').trim().toUpperCase().replace(/\s+/g, '-');
}

function codeProblem(code) {
  if (!code) return 'Choose a code.';
  if (code.length < MIN_LENGTH) return `A code needs at least ${MIN_LENGTH} characters.`;
  if (code.length > MAX_LENGTH) return `A code can be at most ${MAX_LENGTH} characters.`;
  if (!/^[A-Z0-9][A-Z0-9-]*[A-Z0-9]$/.test(code)) {
    return 'Use letters, numbers and hyphens only.';
  }
  return null;
}

/** Windows a principal can pick from, in hours. Anything longer is a standing credential. */
const WINDOWS = [
  { id: '1h', label: 'One hour', hours: 1 },
  { id: '24h', label: 'A day', hours: 24 },
  { id: '7d', label: 'A week', hours: 168 },
];

function windowHours(id) {
  return (WINDOWS.find((w) => w.id === id) || WINDOWS[1]).hours;
}

function isLive(row, now = new Date()) {
  if (!row || row.revoked_at) return false;
  if (new Date(row.expires_at) <= now) return false;
  return Number(row.uses_spent) < Number(row.uses_allowed);
}

/** The principal's current code, live or not — they are entitled to see their own. */
async function currentFor(ownerId) {
  const row = await db.prepare(`
    SELECT * FROM access_codes WHERE owner_id = ? AND revoked_at IS NULL
    ORDER BY created_at DESC LIMIT 1
  `).get(ownerId);
  if (!row) return null;

  const now = new Date();
  const live = isLive(row, now);
  return {
    code: row.code,
    role: row.role,
    roleLabel: roleLabel(row.role),
    live,
    expiresAt: row.expires_at,
    minutesLeft: Math.max(0, Math.round((new Date(row.expires_at) - now) / 60000)),
    usesAllowed: Number(row.uses_allowed),
    usesSpent: Number(row.uses_spent),
    usesLeft: Math.max(0, Number(row.uses_allowed) - Number(row.uses_spent)),
    // Why it stopped working, for the principal only. The person redeeming
    // never learns which of these applied.
    endedBecause: live ? null
      : (new Date(row.expires_at) <= now ? 'expired' : 'used up'),
    createdAt: row.created_at,
  };
}

/**
 * Arm a code. Replaces whatever was there — a principal has one live code at
 * a time, because two would mean two different remits in circulation with no
 * way to tell which somebody was given.
 */
async function arm({ ownerId, code, role, window: windowId, uses }) {
  const clean = normalizeCode(code);
  const problem = codeProblem(clean);
  if (problem) return { error: problem };
  if (!isAssistantRole(role)) return { error: 'Choose what the code grants.' };

  const count = Math.min(10, Math.max(1, Math.round(Number(uses) || 2)));
  const hours = windowHours(windowId);
  const now = new Date();

  await db.prepare('UPDATE access_codes SET revoked_at = ? WHERE owner_id = ? AND revoked_at IS NULL')
    .run(now.toISOString(), ownerId);
  await db.prepare(`
    INSERT INTO access_codes (id, owner_id, code, role, expires_at, uses_allowed, uses_spent, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?)
  `).run(
    crypto.randomUUID(), ownerId, clean, role,
    new Date(now.getTime() + hours * 3600 * 1000).toISOString(),
    count, now.toISOString(),
  );

  return { code: await currentFor(ownerId) };
}

async function turnOff(ownerId) {
  await db.prepare('UPDATE access_codes SET revoked_at = ? WHERE owner_id = ? AND revoked_at IS NULL')
    .run(new Date().toISOString(), ownerId);
}

function sameCode(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

/**
 * Join a principal, given their handle and their live code.
 *
 * The single neutral failure is the point. An attacker who could tell "no such
 * handle" from "wrong code" from "expired" learns which principals are on
 * Kairos and which are mid-onboarding, and can stop guessing codes for the
 * ones that would not have worked anyway.
 */
async function redeem({ viewerId, handle, code }) {
  const NEUTRAL = { error: "That handle and code don't match a live invitation." };

  const slug = String(handle || '').trim().replace(/^@+/, '').toLowerCase();
  const clean = normalizeCode(code);
  if (!slug || !clean) return NEUTRAL;

  const owner = await db.prepare('SELECT id, name, slug FROM users WHERE slug = ?').get(slug);
  if (!owner) return NEUTRAL;
  // Answered plainly: you already know this account exists, it is yours.
  if (owner.id === viewerId) return { error: 'That is your own handle.' };

  const row = await db.prepare(`
    SELECT * FROM access_codes WHERE owner_id = ? AND revoked_at IS NULL
    ORDER BY created_at DESC LIMIT 1
  `).get(owner.id);
  if (!isLive(row)) return NEUTRAL;
  if (!sameCode(row.code, clean)) return NEUTRAL;

  const existing = await db.prepare(`
    SELECT * FROM memberships WHERE owner_id = ? AND member_user_id = ? AND status != 'revoked'
  `).get(owner.id, viewerId);
  if (existing) {
    // Also plain: the code was right, so they have already proved they were
    // meant to be here. Pretending otherwise would just be confusing.
    return { error: `You already have access to ${owner.name}.` };
  }

  const viewer = await db.prepare('SELECT email FROM users WHERE id = ?').get(viewerId);
  const now = new Date().toISOString();
  await db.prepare(`
    INSERT INTO memberships (id, owner_id, member_user_id, invited_email, role, status, invite_token, created_at)
    VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
  `).run(crypto.randomUUID(), owner.id, viewerId, viewer.email, row.role,
    crypto.randomBytes(24).toString('hex'), now);
  await db.prepare('UPDATE access_codes SET uses_spent = uses_spent + 1 WHERE id = ?').run(row.id);

  return { owner: { id: owner.id, name: owner.name, handle: owner.slug }, role: row.role };
}

module.exports = {
  WINDOWS, MIN_LENGTH, MAX_LENGTH,
  normalizeCode, codeProblem, currentFor, arm, turnOff, redeem,
};
