const express = require('express');
const { asyncRouter } = require('../lib/asyncRouter');
const crypto = require('crypto');
const db = require('../lib/db');
const { BRAND_SHORT, BRAND_FULL } = require('../lib/brand');
const {
  hashPassword, verifyPassword, createSession, destroySession,
  setSessionCookie, clearSessionCookie, parseCookies, slugify, SESSION_COOKIE,
} = require('../lib/auth');
const { isValidTimeZone } = require('../lib/timezone');
const { isHouseholdStaff } = require('../lib/household');
const { handleProblem } = require('../lib/handles');
const { limit, clear, clientIp } = require('../lib/rateLimit');
const totp = require('../lib/totp');
const { isConfigured: emailConfigured } = require('../lib/emailProviders');
const { decrypt } = require('../lib/secretBox');
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

const router = asyncRouter();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ACCOUNT_CATEGORIES = new Set(['principal', 'pa', 'ea', 'chief_of_staff']);
// The assistant titles that differ in name only. See routes/invites.js.
const EQUAL_ACCESS_ROLES = new Set(['pa', 'ea', 'chief_of_staff']);

// Signup is open, and that is a deliberate position rather than an omission.
//
// A deployment-wide code used to guard account creation. It is gone, because
// it guarded the wrong thing: an account on its own reaches nothing. Every
// screen in Kairos is scoped to a principal, and a stranger who signs up sees
// their own empty calendar and no trace of anybody else — no directory, no
// handle that resolves, no space, no membership. The compartments are the
// security, not the front door.
//
// What actually needs guarding is the step where somebody gains access to a
// principal's account, and that now has its own gate: lib/accessCodes.js,
// where the principal sets the code, decides what it grants, and it is live
// only for the window they choose.

function publicUser(u) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    slug: u.slug,
    timezone: u.timezone,
    onboardingStep: u.onboarding_step,
    accountCategory: u.account_category,
  };
}

async function uniqueSlugFromName(name) {
  const base = slugify(name) || 'user';
  let candidate = base;
  let n = 1;
  const exists = db.prepare('SELECT 1 FROM users WHERE slug = ?');
  // Also skips anything reserved or too short — a name like "Ed" or "API"
  // would otherwise be auto-assigned a handle nobody is allowed to hold.
  while (handleProblem(candidate) || await exists.get(candidate)) {
    n += 1;
    candidate = `${base}-${n}`;
  }
  return candidate;
}

router.post('/signup', async (req, res) => {
  const { email, password, name, timezone, accountCategory } = req.body || {};

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
  const category = ACCOUNT_CATEGORIES.has(accountCategory) ? accountCategory : 'principal';

  const normalizedEmail = String(email).trim().toLowerCase();

  const existing = await db.prepare('SELECT 1 FROM users WHERE email = ?').get(normalizedEmail);
  if (existing) {
    return res.status(409).json({ error: 'An account with that email already exists.' });
  }

  const id = crypto.randomUUID();
  const slug = await uniqueSlugFromName(name);
  const passwordHash = hashPassword(String(password));

  await db.prepare(`
    INSERT INTO users (id, email, password_hash, name, slug, timezone, email_verified, onboarding_step, account_category, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, 'profile', ?, ?)
  `).run(id, normalizedEmail, passwordHash, String(name).trim(), slug, tz, category, new Date().toISOString());
  // MVP note: email_verified is set to 1 immediately — there is no email
  // delivery configured yet. Wire up real verification before this ships
  // past a private beta.

  // Correct any invitation that is already waiting for this address.
  //
  // Invitations usually go out before the invitee has an account, so there was
  // nothing to read a title from and it defaulted to PA. This is the moment
  // that changes: they have just said what they are. Doing it here rather
  // than at acceptance means the invite banner they see thirty seconds from
  // now already reads correctly.
  //
  // Only among the three titles that carry identical access. A `delegate`
  // invitation is deliberately narrower, and letting someone widen it by
  // describing themselves differently would be escalation — the principal
  // decides remit, the person decides only what they are called.
  if (EQUAL_ACCESS_ROLES.has(category)) {
    await db.prepare(`
      UPDATE memberships SET role = ?
      WHERE invited_email = ? AND status = 'invited' AND role IN ('pa', 'ea', 'chief_of_staff')
    `).run(category, normalizedEmail);
  }

  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  const session = await createSession(id);
  setSessionCookie(res, session);
  res.status(201).json({ user: publicUser(user) });
});

// Guessing has to cost something.
//
// Counted against the account being attacked AND the address attacking, so
// neither hammering one account nor spraying many gets through. Without this,
// a password is not a perimeter — it is a puzzle with unlimited attempts, and
// everything else this app does to protect identity documents is decoration.
const loginLimiter = limit({
  limit: 8,
  windowMs: 15 * 60 * 1000,
  keys: (req) => [
    `login:${String(req.body?.email || '').trim().toLowerCase()}`,
    `login-ip:${clientIp(req)}`,
  ],
  message: 'Too many sign-in attempts. Wait a few minutes and try again.',
});

router.post('/login', loginLimiter, async (req, res) => {
  const { email, password, code } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }
  const user = await db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).trim().toLowerCase());
  if (!user || !verifyPassword(String(password), user.password_hash)) {
    return res.status(401).json({ error: 'Incorrect email or password.' });
  }

  // Second factor, if this account has one confirmed. An enrolment that was
  // never confirmed is not protection and is not treated as such.
  const second = await db.prepare('SELECT * FROM user_totp WHERE user_id = ? AND confirmed_at IS NOT NULL')
    .get(user.id);
  if (second) {
    if (!code) {
      // Deliberately after the password check: this only tells someone who
      // already has the right password, which they could learn anyway.
      return res.status(401).json({ error: 'Enter your authentication code.', needsCode: true });
    }
    const secret = decrypt(second.secret_enc);
    const codeOk = secret && totp.verify(secret, code);
    const recovery = codeOk ? null : await db.prepare(`
      SELECT * FROM user_recovery_codes
       WHERE user_id = ? AND code_hash = ? AND used_at IS NULL
    `).get(user.id, totp.hashRecoveryCode(code));

    if (!codeOk && !recovery) {
      return res.status(401).json({ error: 'That code is not right.', needsCode: true });
    }
    // Recovery codes are single use — that is the entire point of them.
    if (recovery) {
      await db.prepare('UPDATE user_recovery_codes SET used_at = ? WHERE id = ?')
        .run(new Date().toISOString(), recovery.id);
    }
  }

  clear(`login:${String(email).trim().toLowerCase()}`);
  const session = await createSession(user.id);
  setSessionCookie(res, session);
  res.json({ user: publicUser(user) });
});

router.post('/logout', async (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  const sid = cookies[SESSION_COOKIE];
  if (sid) await destroySession(sid);
  clearSessionCookie(res);
  res.status(204).end();
});

router.get('/me', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not signed in.' });
  // Household staff land on their instructions rather than a dashboard built
  // for running somebody's diary. Carried on /me so the shell doesn't have to
  // ask a second question on every page load.
  res.json({ user: { ...publicUser(req.user), isHouseholdStaff: await isHouseholdStaff(req.user.id) } });
});

// Deliberately returns the same response whether or not the email matches
// an account — never confirm account existence to an unauthenticated
// caller. The reset link itself is only ever sent to that address (via
// sendEmail, logged to the Outbox and the dev console), never returned
// here, since exposing it in the response would let anyone reset any
// account's password without owning the inbox.
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body || {};
  if (!email || !EMAIL_RE.test(String(email).trim())) {
    return res.status(400).json({ error: 'Please provide a valid email address.' });
  }
  const normalizedEmail = String(email).trim().toLowerCase();

  if (isResetRateLimited(normalizedEmail)) {
    return res.status(429).json({ error: 'Too many reset requests for this address. Please try again later.' });
  }

  const user = await db.prepare('SELECT * FROM users WHERE email = ?').get(normalizedEmail);
  if (user) {
    const token = crypto.randomBytes(32).toString('hex');
    const now = new Date();
    const expires = new Date(now.getTime() + RESET_TOKEN_TTL_MS);
    await db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(user.id);
    await db.prepare('INSERT INTO password_resets (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(token, user.id, now.toISOString(), expires.toISOString());

    await sendEmail({
      ownerId: user.id, toEmail: user.email, category: 'transactional',
      subject: `Reset your ${BRAND_FULL} password`,
      body: `Hi ${user.name},\n\nSomeone requested a password reset for this account. If that was you, set a new password here (valid for 1 hour):\n\n/reset-password/${token}\n\nIf you didn't request this, you can ignore this email.`,
    });
  }

  // Whether this deployment can deliver email at all is a property of the
  // server, not of any account, so reporting it leaks nothing — and without it
  // the page cheerfully tells people to check an inbox that will never receive
  // anything.
  res.json({ ok: true, emailDeliveryConfigured: emailConfigured() });
});

router.get('/reset-password/:token', async (req, res) => {
  const reset = await db.prepare('SELECT * FROM password_resets WHERE id = ?').get(req.params.token);
  const valid = !!reset && new Date(reset.expires_at).getTime() > Date.now();
  res.json({ valid });
});

router.post('/reset-password/:token', async (req, res) => {
  const { password } = req.body || {};
  if (!password || String(password).length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  const reset = await db.prepare('SELECT * FROM password_resets WHERE id = ?').get(req.params.token);
  if (!reset || new Date(reset.expires_at).getTime() <= Date.now()) {
    return res.status(400).json({ error: 'This reset link is invalid or has expired.' });
  }

  const passwordHash = hashPassword(String(password));
  await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, reset.user_id);
  await db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(reset.user_id);
  // Resetting a password should end every existing session, on this device
  // and anywhere else it was signed in.
  await db.prepare('DELETE FROM sessions WHERE user_id = ?').run(reset.user_id);

  res.json({ ok: true });
});

module.exports = { router, publicUser };
