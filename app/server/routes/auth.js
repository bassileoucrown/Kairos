const express = require('express');
const { asyncRouter } = require('../lib/asyncRouter');
const crypto = require('crypto');
const db = require('../lib/db');
const devices = require('../lib/devices');
const { BRAND_SHORT, BRAND_FULL } = require('../lib/brand');
const {
  hashPassword, verifyPassword, createSession, destroySession,
  setSessionCookie, clearSessionCookie, parseCookies, slugify, SESSION_COOKIE,
} = require('../lib/auth');
const { isValidTimeZone } = require('../lib/timezone');
const { isHouseholdStaff } = require('../lib/household');
const {
  handleProblem, everHeldBy, isProvisional, provisionalHandle,
} = require('../lib/handles');
const { limit, clear, clientIp } = require('../lib/rateLimit');
const { DEFAULT_PLAN } = require('../lib/plans');
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
    // Whether that slug is a handle this person actually chose, or the
    // provisional one their account was created with. The profile step reads
    // it to decide whether to put anything in the field at all — an empty box
    // is the whole point, and pre-filling it with `new-3f9c1a20` would be as
    // much of a suggestion as pre-filling it with their name was.
    handleChosen: !isProvisional(u.slug),
    timezone: u.timezone,
    onboardingStep: u.onboarding_step,
    accountCategory: u.account_category,
    // Whether an exact handle resolves to this person's name for somebody not
    // connected to them. Carried on the user so the setting screen can show
    // its real state rather than assuming the default.
    discoverable: u.discoverable === undefined ? true : !!u.discoverable,
    // Whether this account can open the pilot screen. Read from the same
    // ANNOUNCEMENT_AUTHORS list the faults and feedback endpoints read, so the
    // rail and the endpoints cannot disagree about who the operator is — and
    // so an account somebody has got into cannot promote itself, since there
    // is nothing in the database to flip.
    canOperate: require('../lib/announcements').canPublish(u),
  };
}

async function uniqueSlugFromName(name) {
  const base = slugify(name) || 'user';
  let candidate = base;
  let n = 1;
  // everHeldBy rather than a live lookup, because a handle somebody released
  // still belongs to them — handing it to the next Adaeze Okonkwo who signs up
  // would give her every @ada-okonkwo ever written about the first one. See
  // lib/handles.js.
  //
  // Also skips anything reserved or too short — a name like "Ed" or "API"
  // would otherwise be auto-assigned a handle nobody is allowed to hold.
  while (handleProblem(candidate) || await everHeldBy(candidate)) {
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

  const existing = await db.prepare('SELECT id, name, email, kept_by FROM users WHERE email = ?')
    .get(normalizedEmail);
  // A PRINCIPAL WHOSE RECORD IS ALREADY BEING HELD FOR THEM.
  //
  // The likeliest way a principal "joins Kairos" is to go to the signup page
  // and type their own address — and until now that met "an account with that
  // email already exists", which is true, unhelpful, and reads as somebody
  // having taken their name. Their assistant has been keeping their diary for
  // a month and the product just told them to go away.
  //
  // So this is the claim, arriving at the moment they actually ask for it. The
  // link goes to that address and nowhere else, which is the same rule the
  // forgotten-password route follows and the reason the assistant cannot use
  // it. Nothing here discloses more than the plain 409 already did: that an
  // account exists at an address the person typing has just claimed as theirs.
  if (existing && existing.kept_by) {
    const token = crypto.randomBytes(32).toString('hex');
    const now = new Date();
    await db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(existing.id);
    await db.prepare('INSERT INTO password_resets (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(token, existing.id, now.toISOString(), new Date(now.getTime() + RESET_TOKEN_TTL_MS).toISOString());
    await sendEmail({
      ownerId: existing.id, toEmail: existing.email, category: 'transactional',
      subject: `Your ${BRAND_FULL} account is waiting for you`,
      body: `Hi ${existing.name},\n\nSomeone has been keeping your diary on ${BRAND_FULL} `
        + `on your behalf, and the record is held for you rather than owned by them.\n\n`
        + `Set a password here and it becomes yours — everything already in it comes with `
        + `you, and they stay on as your assistant (valid for 1 hour):\n\n/reset-password/${token}\n\n`
        + `If you were not expecting this, you can ignore it. Nothing changes until you set a password.`,
    });
    return res.status(409).json({
      error: 'Somebody is already keeping this account for you. Check your email — '
        + 'setting a password makes it yours, and everything in it comes with you.',
      claimable: true,
      emailDeliveryConfigured: emailConfigured(),
    });
  }
  if (existing) {
    return res.status(409).json({ error: 'An account with that email already exists.' });
  }

  const id = crypto.randomUUID();
  // NOT derived from their name, and not theirs yet. Signing up used to take
  // @adaeze-okonkwo on this person's behalf and write it into handle_history —
  // where a handle stays FOREVER — so a name nobody had chosen was spent
  // permanently, and picking @ada a minute later burnt the first one for
  // everybody. They now carry a provisional handle until they choose, on the
  // profile step, from an empty field. See lib/handles.js.
  let slug = provisionalHandle();
  // A collision is a four-billion-to-one event, not an impossibility.
  while (await db.prepare('SELECT id FROM users WHERE slug = ?').get(slug)) {
    slug = provisionalHandle();
  }
  const passwordHash = hashPassword(String(password));

  await db.prepare(`
    INSERT INTO users (id, email, password_hash, name, slug, timezone, email_verified, onboarding_step, account_category, plan, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, 'profile', ?, ?, ?)
  `).run(id, normalizedEmail, passwordHash, String(name).trim(), slug, tz, category,
    // Written explicitly rather than left to the column default. The default
    // exists to grandfather rows that already existed when the column was
    // added; letting it also catch new signups would make DEFAULT_PLAN inert
    // and quietly put everybody on the founding plan forever.
    DEFAULT_PLAN,
    new Date().toISOString());
  // NOT remembered. handle_history is the record of what somebody has held for
  // good, and a provisional handle is precisely the thing nobody has chosen.
  // Writing it here would spend a row of that history on a name that is about
  // to be thrown away. The real one is written by claimHandle when they pick
  // it, which is the only place a handle is ever assigned.
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
  // Stamp the device at the moment it signs in, so a session that is never
  // used again still shows where it came from.
  await devices.stamp(session.id, req);
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
  // A KEPT PRINCIPAL CANNOT SIGN IN, and the check is here rather than resting
  // on the stored hash being unusable. The hash is a sentinel no password can
  // produce, so verifyPassword already refuses — but that is one library's
  // behaviour standing between an unclaimed record and whoever knows the
  // address on it, and a record holding somebody's passport deserves a stated
  // rule rather than a fortunate one. Said in the same words as a wrong
  // password, because which addresses have unclaimed records is not something
  // a stranger gets to enumerate.
  if (!user || user.kept_by || !verifyPassword(String(password), user.password_hash)) {
    return res.status(401).json({ error: 'Incorrect email or password.' });
  }

  // Second factor at sign-in, only if this account asks for it there.
  //
  // The default is not to. A code at the front door protects everything but is
  // paid on every login, and that friction is what makes people turn two-factor
  // off — an account with it off protects nothing. Spending the code on the
  // vault instead puts the cost where the value is: a stolen password reaches a
  // calendar and still cannot read a passport number. A principal who wants it
  // at both sets scope to login_and_vault. See lib/stepUp.js.
  //
  // An enrolment that was never confirmed is not protection and is not treated
  // as such.
  const second = await db.prepare(`
    SELECT * FROM user_totp WHERE user_id = ? AND confirmed_at IS NOT NULL AND scope = 'login_and_vault'
  `).get(user.id);
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
  // Stamp the device at the moment it signs in, so a session that is never
  // used again still shows where it came from.
  await devices.stamp(session.id, req);
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
  // AND THIS IS ALSO HOW A KEPT PRINCIPAL CLAIMS THEIR RECORD. Setting a
  // password on an account an assistant has been holding makes it theirs:
  // kept_by clears, the sentinel hash is replaced, and they can sign in. The
  // assistant is not evicted — the membership written when the record was
  // created is what keeps them, so the diary, the trips and the papers carry
  // over with nobody re-entering anything.
  //
  // Deliberately the ordinary reset flow rather than a claim flow of its own.
  // A second way to set a password is a second place to get it wrong, and the
  // link already goes to the principal's own address and nowhere else.
  await db.prepare('UPDATE users SET password_hash = ?, kept_by = NULL WHERE id = ?').run(passwordHash, reset.user_id);
  await db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(reset.user_id);
  // Resetting a password should end every existing session, on this device
  // and anywhere else it was signed in.
  await db.prepare('DELETE FROM sessions WHERE user_id = ?').run(reset.user_id);

  res.json({ ok: true });
});

// uniqueSlugFromName is exported so a kept principal gets its handle by the
// same rule a signup does — including the part that skips a handle somebody
// once held. Two ways of minting a handle would eventually hand one out twice.
module.exports = { router, publicUser, uniqueSlugFromName };
