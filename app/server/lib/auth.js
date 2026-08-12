const crypto = require('crypto');
const db = require('./db');

const SESSION_COOKIE = 'kairos_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  // A stored value that isn't in `salt:hash` form is not a password that
  // happens to be wrong — it is a row this code cannot interpret, from a
  // migration, a restore, or a hand-edit. Throwing turns a failed login into a
  // 500, which tells an attacker that this account is unusual and tells the
  // account holder nothing. Refuse the login instead.
  if (typeof stored !== 'string') return false;
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const check = crypto.scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(check, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function createSession(userId) {
  const id = crypto.randomBytes(32).toString('hex');
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_TTL_MS);
  await db.prepare('INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(id, userId, now.toISOString(), expires.toISOString());
  return { id, expiresAt: expires };
}

async function destroySession(sessionId) {
  await db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}

async function getUserBySession(sessionId) {
  if (!sessionId) return null;
  const session = await db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
  if (!session) return null;
  if (new Date(session.expires_at).getTime() < Date.now()) {
    await destroySession(sessionId);
    return null;
  }
  return await db.prepare('SELECT * FROM users WHERE id = ?').get(session.user_id) || null;
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  header.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    out[key] = decodeURIComponent(val);
  });
  return out;
}

async function requireAuth(req, res, next) {
  const cookies = parseCookies(req.headers.cookie);
  const user = await getUserBySession(cookies[SESSION_COOKIE]);
  if (!user) {
    return res.status(401).json({ error: 'Not signed in.' });
  }
  req.user = user;
  next();
}

async function attachUser(req, res, next) {
  const cookies = parseCookies(req.headers.cookie);
  req.user = await getUserBySession(cookies[SESSION_COOKIE]);
  next();
}

function setSessionCookie(res, session) {
  const isProd = process.env.NODE_ENV === 'production';
  const parts = [
    `${SESSION_COOKIE}=${session.id}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Expires=${session.expiresAt.toUTCString()}`,
  ];
  if (isProd) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT`);
}

function slugify(input) {
  return String(input)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 60);
}

module.exports = {
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  getUserBySession,
  parseCookies,
  requireAuth,
  attachUser,
  setSessionCookie,
  clearSessionCookie,
  slugify,
  SESSION_COOKIE,
};
