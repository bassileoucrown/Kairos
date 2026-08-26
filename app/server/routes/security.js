const express = require('express');
const { asyncRouter } = require('../lib/asyncRouter');
const crypto = require('crypto');
const db = require('../lib/db');
const { requireAuth, verifyPassword } = require('../lib/auth');
const { encrypt, decrypt, isConfigured } = require('../lib/secretBox');
const { isConfigured: pushIsConfigured, problem: pushProblem } = require('../lib/webPush');
const { SCOPES, verifyStepUp } = require('../lib/stepUp');
const totp = require('../lib/totp');
const { BRAND_FULL } = require('../lib/brand');
const { limit, clear, clientIp } = require('../lib/rateLimit');
const devices = require('../lib/devices');
const securityQuestion = require('../lib/securityQuestion');
const capabilities = require('../lib/capabilities');

// Two-factor authentication, and the record of who looked at what.
//
// This exists because of what the app is about to hold. Once a passport
// number is in the database, a password is the entire perimeter, and every
// other precaution — encryption at rest, masked fields, access logs — is
// downstream of an attacker simply signing in.

const router = asyncRouter();
router.use(requireAuth);

const codeLimiter = limit({
  limit: 10,
  windowMs: 15 * 60 * 1000,
  keys: (req) => [`2fa:${req.user.id}`, `2fa-ip:${clientIp(req)}`],
  message: 'Too many attempts. Wait a few minutes and try again.',
});

async function totpRow(userId) {
  return db.prepare('SELECT * FROM user_totp WHERE user_id = ?').get(userId);
}

router.get('/', async (req, res) => {
  const row = await totpRow(req.user.id);
  const remaining = await db.prepare(
    'SELECT COUNT(*) AS n FROM user_recovery_codes WHERE user_id = ? AND used_at IS NULL',
  ).get(req.user.id);
  res.json({
    twoFactor: {
      // Enrolled but unconfirmed is NOT protected — the phone may never have
      // scanned it. Saying "enabled" there would be a lie that matters.
      enabled: !!row?.confirmed_at,
      pending: !!row && !row.confirmed_at,
      recoveryCodesRemaining: remaining?.n || 0,
      // Where the code is demanded. The default spends it on the vault rather
      // than the front door — see lib/stepUp.js.
      scope: row?.scope || 'vault',
      scopes: Object.entries(SCOPES).map(([id, s2]) => ({ id, label: s2.label, hint: s2.hint })),
    },
    // A deployment with no key cannot hold sensitive fields at all, and says
    // so rather than accepting them and storing them in the clear.
    encryptionConfigured: isConfigured(),
    // Whether this deployment can reach a phone that is not open. Answered
    // from the same environment the sender will read, so the card offering to
    // make the keys and the feature using them cannot disagree.
    pushConfigured: pushIsConfigured(),
    pushProblem: pushProblem(),
  });
});

// Step one: generate a secret and show it. Not yet in force.
router.post('/2fa/setup', async (req, res) => {
  if (!isConfigured()) {
    return res.status(503).json({
      error: 'Two-factor authentication needs ENCRYPTION_KEY to be set on this deployment.',
    });
  }
  const existing = await totpRow(req.user.id);
  if (existing?.confirmed_at) {
    return res.status(409).json({ error: 'Two-factor authentication is already on.' });
  }

  const secret = totp.generateSecret();
  const now = new Date().toISOString();
  await db.prepare('DELETE FROM user_totp WHERE user_id = ?').run(req.user.id);
  await db.prepare('INSERT INTO user_totp (user_id, secret_enc, confirmed_at, created_at) VALUES (?, ?, NULL, ?)')
    .run(req.user.id, encrypt(secret), now);

  res.json({
    secret,
    uri: totp.provisioningUri({ secret, account: req.user.email, issuer: BRAND_FULL }),
  });
});

// Step two: prove the phone has it. Only now is the account protected.
router.post('/2fa/confirm', codeLimiter, async (req, res) => {
  const row = await totpRow(req.user.id);
  if (!row) return res.status(404).json({ error: 'Start the setup first.' });
  if (row.confirmed_at) return res.status(409).json({ error: 'Already confirmed.' });

  const secret = decrypt(row.secret_enc);
  if (!secret || !totp.verify(secret, req.body?.code)) {
    return res.status(400).json({ error: 'That code is not right. Check the app and try again.' });
  }
  clear(`2fa:${req.user.id}`);

  const now = new Date().toISOString();
  await db.prepare('UPDATE user_totp SET confirmed_at = ? WHERE user_id = ?').run(now, req.user.id);

  // Issued once, shown once, stored only as hashes.
  const codes = totp.generateRecoveryCodes();
  await db.prepare('DELETE FROM user_recovery_codes WHERE user_id = ?').run(req.user.id);
  for (const code of codes) {
    await db.prepare(
      'INSERT INTO user_recovery_codes (id, user_id, code_hash, used_at, created_at) VALUES (?, ?, ?, NULL, ?)',
    ).run(crypto.randomUUID(), req.user.id, totp.hashRecoveryCode(code), now);
  }

  res.json({
    ok: true,
    recoveryCodes: codes,
    note: 'Save these now. Each works once, and they are not shown again.',
  });
});

// Moving where the code is demanded is itself a security decision, so it costs
// one. Otherwise somebody who has taken a live session could quietly weaken the
// account's front door and the owner would never be asked.
router.post('/2fa/scope', codeLimiter, async (req, res) => {
  const row = await totpRow(req.user.id);
  if (!row?.confirmed_at) return res.status(404).json({ error: 'Two-factor is not on.' });

  const { scope } = req.body || {};
  if (!Object.prototype.hasOwnProperty.call(SCOPES, scope)) {
    return res.status(400).json({ error: 'Unknown setting.' });
  }
  const step = await verifyStepUp(req, { code: req.body?.code, password: req.body?.password });
  if (!step.ok) return res.status(step.status).json({ error: step.error, needs: step.needs });

  await db.prepare('UPDATE user_totp SET scope = ? WHERE user_id = ?').run(scope, req.user.id);
  res.json({ scope });
});

// Turning it off is a security decision, so it costs a password and a code —
// exactly what an attacker who has stolen a session does not have.
router.post('/2fa/disable', codeLimiter, async (req, res) => {
  const { password, code } = req.body || {};
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!password || !verifyPassword(String(password), user.password_hash)) {
    return res.status(401).json({ error: 'That password is not correct.' });
  }
  const row = await totpRow(req.user.id);
  if (!row?.confirmed_at) return res.status(409).json({ error: 'Two-factor is not on.' });

  const secret = decrypt(row.secret_enc);
  if (!secret || !totp.verify(secret, code)) {
    return res.status(400).json({ error: 'That code is not right.' });
  }

  await db.prepare('DELETE FROM user_totp WHERE user_id = ?').run(req.user.id);
  await db.prepare('DELETE FROM user_recovery_codes WHERE user_id = ?').run(req.user.id);
  res.status(204).end();
});

// What has been looked at on this account.
//
// Shown to the principal about their own data, which is the point: this reads
// as "here is who opened your passport", not as surveillance of staff.
router.get('/access-log', async (req, res) => {
  const rows = await db.prepare(`
    SELECT l.*, u.name AS actor_name
    FROM access_log l
    JOIN users u ON u.id = l.actor_id
    WHERE l.subject_owner_id = ?
    ORDER BY l.created_at DESC
    LIMIT 100
  `).all(req.user.id);

  res.json({
    entries: rows.map((r) => ({
      id: r.id,
      actorName: r.actor_name,
      action: r.action,
      field: r.field,
      at: r.created_at,
      // Their own activity is noise on this screen; theirs is the account.
      isSelf: r.actor_id === req.user.id,
    })),
  });
});



// ---------------------------------------------------------------------------
// Where this account is signed in.
//
// Multi-device always worked — a session is a row and nothing limited how many
// — but there was no way to see them and no way to end one from anywhere but
// the device itself. A lost phone therefore held a live session for the rest
// of its thirty days, and the only lever was a password reset.
// ---------------------------------------------------------------------------

// Guessing the security question has to cost something too, or an unlocked
// phone gets unlimited tries at evicting everybody else.
// Setting the question is a separate bucket from using it. Sharing one meant
// a principal who set a question and then signed two devices out had spent
// most of a budget sized for guessing — the same trap as the login limiter,
// where a success clears the account key and never the address key, so honest
// use on a shared address quietly runs the counter down.
const questionLimiter = limit({
  limit: 10,
  windowMs: 15 * 60 * 1000,
  keys: (req) => [`question:${req.user.id}`, `question-ip:${clientIp(req)}`],
  message: 'Too many attempts. Wait a few minutes and try again.',
});

const revokeLimiter = limit({
  limit: 10,
  windowMs: 15 * 60 * 1000,
  keys: (req) => [`revoke:${req.user.id}`, `revoke-ip:${clientIp(req)}`],
  message: 'Too many attempts. Wait a few minutes and try again.',
});

router.get('/sessions', async (req, res) => {
  const question = await securityQuestion.state(req.user.id);
  res.json({
    sessions: await devices.list(req.user.id, req.sessionId),
    // What the screen must ask for before it can revoke anything.
    guard: question.isSet
      ? { needs: 'answer', question: question.question }
      : { needs: 'password', question: null },
    // Named here rather than assumed, so the screen can say what it cannot do
    // instead of quietly showing an address and calling it a place.
    approximateLocation: capabilities.list('settings')
      .find((c) => c.id === 'session_location') || null,
  });
});

// End one device.
router.post('/sessions/:handle/revoke', revokeLimiter, async (req, res) => {
  const check = await securityQuestion.verify(req.user.id, {
    answer: req.body?.answer,
    password: req.body?.password,
  });
  if (!check.ok) return res.status(401).json({ error: check.error, needs: check.needs });

  // Ending the session you are holding is Sign out, and it lives in the
  // account menu. Refusing here means nobody signs themselves out by accident
  // while trying to evict a stolen phone.
  const target = await devices.findByHandle(req.user.id, req.params.handle);
  if (target && target.id === req.sessionId) {
    return res.status(400).json({ error: 'That is this device. Use Sign out instead.' });
  }

  // 404 rather than 403 for a handle that is not this account's: whether a
  // given session exists is not something to confirm to somebody guessing.
  if (!(await devices.revoke(req.user.id, req.params.handle))) {
    return res.status(404).json({ error: 'No such session.' });
  }
  clear(`revoke:${req.user.id}`);
  res.json({ sessions: await devices.list(req.user.id, req.sessionId) });
});

// End everything except this device.
router.post('/sessions/revoke-others', revokeLimiter, async (req, res) => {
  const check = await securityQuestion.verify(req.user.id, {
    answer: req.body?.answer,
    password: req.body?.password,
  });
  if (!check.ok) return res.status(401).json({ error: check.error, needs: check.needs });

  const ended = await devices.revokeOthers(req.user.id, req.sessionId);
  clear(`revoke:${req.user.id}`);
  res.json({ ended, sessions: await devices.list(req.user.id, req.sessionId) });
});

// Keeping this device signed in.
//
// Guarded by the same question as revoking, and for a reason that is not
// obvious: somebody holding an unlocked phone already has the session, so
// trusting it grants them no new reach — but it would turn thirty days of
// access into an indefinite amount, which is exactly the move an intruder
// wants. Withdrawing trust needs no guard, because it only ever reduces.
router.post('/sessions/trust', revokeLimiter, async (req, res) => {
  const wanted = req.body?.trusted !== false;

  if (wanted) {
    const check = await securityQuestion.verify(req.user.id, {
      answer: req.body?.answer,
      password: req.body?.password,
    });
    if (!check.ok) return res.status(401).json({ error: check.error, needs: check.needs });
    clear(`revoke:${req.user.id}`);
  }

  if (!(await devices.setTrust(req.user.id, req.sessionId, wanted))) {
    return res.status(400).json({ error: 'There is no session to trust.' });
  }
  res.json({ sessions: await devices.list(req.user.id, req.sessionId) });
});

// ---------------------------------------------------------------------------
// The security question itself.
// ---------------------------------------------------------------------------

router.get('/question', async (req, res) => {
  res.json({ question: await securityQuestion.state(req.user.id) });
});

// Setting or changing it costs the password. It guards a control, so it is a
// security setting, and a security setting somebody can change just by having
// the tab open protects nothing.
router.post('/question', questionLimiter, async (req, res) => {
  const { question, answer, password } = req.body || {};

  const row = await db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  if (!password || !verifyPassword(String(password), row.password_hash)) {
    return res.status(401).json({ error: 'Enter your password to change this.', needs: 'password' });
  }

  const problem = securityQuestion.problem(question, answer);
  if (problem) return res.status(400).json({ error: problem });

  await securityQuestion.set(req.user.id, question, answer);
  clear(`question:${req.user.id}`);
  res.json({ question: await securityQuestion.state(req.user.id) });
});

module.exports = router;
