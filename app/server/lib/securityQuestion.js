const crypto = require('crypto');
const db = require('./db');

// The thing you know, for the moment the thing you have is gone.
//
// Signing another device out is the one control whose whole purpose is a lost
// phone — and gating it on two-factor would have meant the emergency it exists
// for is the emergency in which it cannot be used, because the authenticator
// was on the phone. So this gate asks for something carried in the principal's
// head, which travels to whatever device they can borrow.
//
// IT ALSO CLOSES A HOLE. Without a gate, somebody holding an unlocked phone
// could sign every other device out and buy themselves quiet time. They have
// the session; they do not have the answer.
//
// WHY A SECURITY QUESTION IS ACCEPTABLE HERE AND NOT ELSEWHERE
//
// Security questions are rightly distrusted, and the reason is always the same
// one: used for account RECOVERY, a guessable answer hands over the account.
// This grants nothing. It ends sessions. Somebody who guesses the answer can
// log the principal out — an irritation, not a breach — and can never read a
// passport number with it. The blast radius is what makes the mechanism fit.
//
// The principal writes their own question. A list of stock questions is a list
// of the guessable ones: first school, mother's maiden name, street you grew up
// on — all findable, several of them printed in a bio.

const SCRYPT_KEYLEN = 64;

/**
 * The comparison form.
 *
 * Case and surrounding space are noise: somebody typing an answer one-handed at
 * an airport gate should not fail on a capital letter, and this gate is worth
 * nothing if the person it is for cannot pass it. Internal spacing is collapsed
 * for the same reason — "St Marys" and "St  Marys" are the same answer.
 */
function normalise(answer) {
  return String(answer || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function hash(answer) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(normalise(answer), salt, SCRYPT_KEYLEN).toString('hex');
  return `${salt}:${derived}`;
}

function matches(answer, stored) {
  if (!stored) return false;
  const [salt, expected] = String(stored).split(':');
  if (!salt || !expected) return false;
  const actual = crypto.scryptSync(normalise(answer), salt, SCRYPT_KEYLEN).toString('hex');
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(actual, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Why this question and answer are unusable, or null. Prose — a person reads it. */
function problem(question, answer) {
  const q = String(question || '').trim();
  const a = normalise(answer);
  if (!q) return 'Write a question.';
  if (q.length < 8) return 'Make the question a little longer, so you recognise it later.';
  if (q.length > 200) return 'That question is too long.';
  if (!a) return 'Write the answer.';
  if (a.length < 3) return 'Make the answer at least 3 characters.';
  if (a.length > 200) return 'That answer is too long.';
  // An answer sitting inside its own question defeats the point, and somebody
  // does it by accident more often than you would think.
  if (q.toLowerCase().includes(a)) return 'The answer is written inside the question — choose another.';
  return null;
}

/** What the principal has set, never including the answer. */
async function state(userId) {
  const row = await db.prepare('SELECT security_question, security_answer_hash FROM users WHERE id = ?')
    .get(userId);
  return {
    isSet: !!row?.security_answer_hash,
    question: row?.security_question || null,
  };
}

async function set(userId, question, answer) {
  await db.prepare('UPDATE users SET security_question = ?, security_answer_hash = ? WHERE id = ?')
    .run(String(question).trim(), hash(answer), userId);
}

async function clear(userId) {
  await db.prepare('UPDATE users SET security_question = NULL, security_answer_hash = NULL WHERE id = ?')
    .run(userId);
}

/**
 * Whether this person may perform a guarded action.
 *
 * Falls back to the account password where no question is set, and that is
 * deliberate rather than lax. Every account that existed before this shipped
 * has no question, and an emergency control that refuses because a setting is
 * missing is worse than no control at all. The password is equally unavailable
 * to somebody holding an already-signed-in phone, so the protection this exists
 * for holds either way.
 *
 * Returns { ok } or { ok: false, error, needs }.
 */
async function verify(userId, { answer, password }) {
  const row = await db.prepare('SELECT password_hash, security_answer_hash FROM users WHERE id = ?')
    .get(userId);
  if (!row) return { ok: false, error: 'No such account.', needs: 'password' };

  if (row.security_answer_hash) {
    if (!answer) return { ok: false, error: 'Answer your security question to continue.', needs: 'answer' };
    if (!matches(answer, row.security_answer_hash)) {
      return { ok: false, error: 'That is not the answer.', needs: 'answer' };
    }
    return { ok: true };
  }

  const { verifyPassword } = require('./auth');
  if (!password) {
    return {
      ok: false,
      needs: 'password',
      error: 'Enter your password to continue. Set a security question to use that instead.',
    };
  }
  if (!verifyPassword(String(password), row.password_hash)) {
    return { ok: false, error: 'Incorrect password.', needs: 'password' };
  }
  return { ok: true };
}

module.exports = { normalise, problem, state, set, clear, verify, hash, matches };
