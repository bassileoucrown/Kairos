const db = require('./db');
const totp = require('./totp');
const { verifyPassword } = require('./auth');
const { decrypt } = require('./secretBox');

// Proving it is still you, at the moment you ask for something sensitive.
//
// Revealing a passport number used to cost the account password. That defends
// against a borrowed laptop and against nothing else — because the attacker
// this vault actually has to survive is the one who already knows the
// password. Phished, reused, leaked: they sign in as you, and a gate made of
// the same password opens for them on the first try. Re-asking for a secret
// the intruder already holds is theatre.
//
// So where two-factor is enrolled, the second gate asks for the second factor.
// Somebody who has taken the account still cannot read a BVN without the phone
// in your pocket. That is the property worth having, and it is the one the
// principal assumed they were buying by turning two-factor on.
//
// Where two-factor is NOT enrolled there is no second factor to ask for, so
// the password stands. The gate never gets weaker than it was.

// One step-up covers a few minutes of work.
//
// Without this a Chief of Staff at a check-in desk reads a passport, then a
// visa, then a known-traveller number, and types three codes — from an app
// that rotates every thirty seconds, so at least one of them means standing
// there waiting for the next. Friction that heavy does not make people more
// careful; it makes them turn two-factor off, which costs far more than it
// saves. The window is short, it is per-session, and every reveal inside it is
// still logged individually.
const GRACE_MS = Number(process.env.STEP_UP_GRACE_MS || 5 * 60 * 1000);

/** Whether this account has a confirmed second factor to ask for. */
async function twoFactorRow(userId) {
  return db.prepare('SELECT * FROM user_totp WHERE user_id = ? AND confirmed_at IS NOT NULL')
    .get(userId);
}

/** What the caller must present. Told plainly so the screen can ask for it. */
async function factorFor(userId) {
  return (await twoFactorRow(userId)) ? 'code' : 'password';
}

async function withinGrace(sessionId) {
  if (!sessionId) return false;
  const row = await db.prepare('SELECT stepped_up_at FROM sessions WHERE id = ?').get(sessionId);
  if (!row?.stepped_up_at) return false;
  return Date.now() - new Date(row.stepped_up_at).getTime() < GRACE_MS;
}

async function markStepUp(sessionId) {
  if (!sessionId) return;
  await db.prepare('UPDATE sessions SET stepped_up_at = ? WHERE id = ?')
    .run(new Date().toISOString(), sessionId);
}

/**
 * Checks a step-up for the current request.
 *
 * Returns `{ ok: true }`, or a `{ status, error, needs }` the caller can hand
 * straight back. `needs` is 'code' or 'password' so the screen asks for the
 * right thing rather than guessing.
 */
async function verifyStepUp(req, { code, password } = {}) {
  const userId = req.user.id;
  const second = await twoFactorRow(userId);

  if (await withinGrace(req.sessionId)) return { ok: true, fromGrace: true };

  if (second) {
    if (!code) {
      return {
        status: 401,
        needs: 'code',
        error: 'Enter the code from your authenticator app to reveal this.',
      };
    }
    const secret = decrypt(second.secret_enc);
    const codeOk = secret && totp.verify(secret, code);

    // A recovery code works here for the same reason it works at sign-in: the
    // phone goes in the river, and being locked out of your own passport
    // number is not a security outcome anybody wants.
    const recovery = codeOk ? null : await db.prepare(`
      SELECT * FROM user_recovery_codes
       WHERE user_id = ? AND code_hash = ? AND used_at IS NULL
    `).get(userId, totp.hashRecoveryCode(code));

    if (!codeOk && !recovery) {
      return { status: 401, needs: 'code', error: 'That code is not right.' };
    }
    if (recovery) {
      await db.prepare('UPDATE user_recovery_codes SET used_at = ? WHERE id = ?')
        .run(new Date().toISOString(), recovery.id);
    }
    await markStepUp(req.sessionId);
    return { ok: true };
  }

  // No second factor enrolled: the password is the only thing there is to ask
  // for, and asking for nothing would be worse.
  const me = await db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!password || !verifyPassword(String(password), me.password_hash)) {
    return {
      status: 401,
      needs: 'password',
      error: 'Enter your password to reveal this.',
    };
  }
  await markStepUp(req.sessionId);
  return { ok: true };
}

module.exports = { verifyStepUp, factorFor, GRACE_MS };
