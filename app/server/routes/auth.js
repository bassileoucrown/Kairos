const express = require('express');
const crypto = require('crypto');
const db = require('../lib/db');
const {
  hashPassword, verifyPassword, createSession, destroySession,
  setSessionCookie, clearSessionCookie, parseCookies, slugify, SESSION_COOKIE,
} = require('../lib/auth');
const { isValidTimeZone } = require('../lib/timezone');

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

module.exports = { router, publicUser };
