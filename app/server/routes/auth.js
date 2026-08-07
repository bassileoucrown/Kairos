const express = require('express');
const crypto = require('crypto');
const db = require('../lib/db');
const {
  hashPassword, verifyPassword, createSession, destroySession,
  setSessionCookie, clearSessionCookie, parseCookies, slugify, SESSION_COOKIE,
} = require('../lib/auth');
const { isValidTimeZone } = require('../lib/timezone');
const { sendEmail } = require('../lib/email');

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

// Simple in-memory throttle so the reset-request endpoint can't be used to
// spam an arbitrary inbox — keyed by the normalized email, not IP, since
// the goal is protecting the recipient, not just this server.
const resetRequestTimestamps = new Map();
function isResetRateLimited(email) {
  const now = Date.now();
  const window = 60 * 60 * 1000;
  const timestamps = (resetRequestTimestamps.get(email) || []).filter((t) => now - t < window);
  timestamps.push(now);
  resetRequestTimestamps.set(email, timestamps);
  return timestamps.length > 3;
}

const router = express.Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function publicUser(u) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    slug: u.slug,
    timezone: u.timezone,
    onboardingStep: u.onboarding_step,
  };
}

function uniqueSlugFromName(name) {
  const base = slugify(name) || 'user';
  let candidate = base;
  let n = 1;
  const exists = db.prepare('SELECT 1 FROM users WHERE slug = ?');
  while (exists.get(candidate)) {
    n += 1;
    candidate = `${base}-${n}`;
  }
  return candidate;
}

router.post('/signup', (req, res) => {
  const { email, password, name, timezone } = req.body || {};

  if (!email || !EMAIL_RE.test(String(email).trim())) {
    return res.status(400).json({ error: 'Please provide a valid email address.' });
  }
  if (!password || String(password).length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'Please provide your name.' });
  }
  const tz = timezone && isValidTimeZone(timezone) ? timezone : 'UTC';

  const normalizedEmail = String(email).trim().toLowerCase();
  const existing = db.prepare('SELECT 1 FROM users WHERE email = ?').get(normalizedEmail);
  if (existing) {
    return res.status(409).json({ error: 'An account with that email already exists.' });
  }

  const id = crypto.randomUUID();
  const slug = uniqueSlugFromName(name);
  const passwordHash = hashPassword(String(password));

  db.prepare(`
    INSERT INTO users (id, email, password_hash, name, slug, timezone, email_verified, onboarding_step, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, 'profile', ?)
  `).run(id, normalizedEmail, passwordHash, String(name).trim(), slug, tz, new Date().toISOString());
  // MVP note: email_verified is set to 1 immediately — there is no email
  // delivery configured yet. Wire up real verification before this ships
  // past a private beta.

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  const session = createSession(id);
  setSessionCookie(res, session);
  res.status(201).json({ user: publicUser(user) });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).trim().toLowerCase());
  if (!user || !verifyPassword(String(password), user.password_hash)) {
    return res.status(401).json({ error: 'Incorrect email or password.' });
  }
  const session = createSession(user.id);
  setSessionCookie(res, session);
  res.json({ user: publicUser(user) });
});

router.post('/logout', (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  const sid = cookies[SESSION_COOKIE];
  if (sid) destroySession(sid);
  clearSessionCookie(res);
  res.status(204).end();
});

router.get('/me', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not signed in.' });
  res.json({ user: publicUser(req.user) });
});

// Deliberately returns the same response whether or not the email matches
// an account — never confirm account existence to an unauthenticated
// caller. The reset link itself is only ever sent to that address (via
// sendEmail, logged to the Outbox and the dev console), never returned
// here, since exposing it in the response would let anyone reset any
// account's password without owning the inbox.
router.post('/forgot-password', (req, res) => {
  const { email } = req.body || {};
  if (!email || !EMAIL_RE.test(String(email).trim())) {
    return res.status(400).json({ error: 'Please provide a valid email address.' });
  }
  const normalizedEmail = String(email).trim().toLowerCase();

  if (isResetRateLimited(normalizedEmail)) {
    return res.status(429).json({ error: 'Too many reset requests for this address. Please try again later.' });
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(normalizedEmail);
  if (user) {
    const token = crypto.randomBytes(32).toString('hex');
    const now = new Date();
    const expires = new Date(now.getTime() + RESET_TOKEN_TTL_MS);
    db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(user.id);
    db.prepare('INSERT INTO password_resets (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(token, user.id, now.toISOString(), expires.toISOString());

    sendEmail({
      ownerId: user.id, toEmail: user.email, category: 'transactional',
      subject: 'Reset your Kairos password',
      body: `Hi ${user.name},\n\nSomeone requested a password reset for this account. If that was you, set a new password here (valid for 1 hour):\n\n/reset-password/${token}\n\nIf you didn't request this, you can ignore this email.`,
    });
  }

  res.json({ ok: true });
});

router.get('/reset-password/:token', (req, res) => {
  const reset = db.prepare('SELECT * FROM password_resets WHERE id = ?').get(req.params.token);
  const valid = !!reset && new Date(reset.expires_at).getTime() > Date.now();
  res.json({ valid });
});

router.post('/reset-password/:token', (req, res) => {
  const { password } = req.body || {};
  if (!password || String(password).length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  const reset = db.prepare('SELECT * FROM password_resets WHERE id = ?').get(req.params.token);
  if (!reset || new Date(reset.expires_at).getTime() <= Date.now()) {
    return res.status(400).json({ error: 'This reset link is invalid or has expired.' });
  }

  const passwordHash = hashPassword(String(password));
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, reset.user_id);
  db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(reset.user_id);
  // Resetting a password should end every existing session, on this device
  // and anywhere else it was signed in.
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(reset.user_id);

  res.json({ ok: true });
});

module.exports = { router, publicUser };
