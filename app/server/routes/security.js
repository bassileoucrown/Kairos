const express = require('express');
const { asyncRouter } = require('../lib/asyncRouter');
const crypto = require('crypto');
const db = require('../lib/db');
const { requireAuth, verifyPassword } = require('../lib/auth');
const { encrypt, decrypt, isConfigured } = require('../lib/secretBox');
const { SCOPES, verifyStepUp } = require('../lib/stepUp');
const totp = require('../lib/totp');
const { BRAND_FULL } = require('../lib/brand');
const { limit, clear, clientIp } = require('../lib/rateLimit');

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

module.exports = router;
