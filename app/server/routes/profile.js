const express = require('express');
const { asyncRouter } = require('../lib/asyncRouter');
const db = require('../lib/db');
const { requireAuth, verifyPassword, clearSessionCookie } = require('../lib/auth');
const {
  claimHandle, handleProblem, everHeldBy, normalizeHandle, isProvisional,
} = require('../lib/handles');
const { limit, clientIp } = require('../lib/rateLimit');
const { isValidTimeZone } = require('../lib/timezone');
const { publicUser } = require('./auth');
const { summarizeAccount, deleteAccount } = require('../lib/accountDeletion');

const router = asyncRouter();

router.use(requireAuth);

router.patch('/', async (req, res) => {
  const { name, timezone, slug, discoverable } = req.body || {};
  const updates = [];
  const values = [];

  if (name !== undefined) {
    if (!String(name).trim()) return res.status(400).json({ error: 'Name cannot be empty.' });
    updates.push('name = ?');
    values.push(String(name).trim());
  }
  if (timezone !== undefined) {
    if (!isValidTimeZone(timezone)) return res.status(400).json({ error: 'Unrecognized timezone.' });
    updates.push('timezone = ?');
    values.push(timezone);
  }
  // `slug` on the wire, a handle to everyone who sees it.
  if (slug !== undefined) {
    // claimHandle validates, checks that nobody else has ever held it, and
    // writes the history that keeps every @you already written pointing at you
    // after the change. See lib/handles.js for why the history is the fix
    // rather than rewriting old message bodies.
    const claim = await claimHandle(req.user.id, slug);
    if (claim.problem) {
      return res.status(claim.problem.includes('taken') ? 409 : 400).json({ error: claim.problem });
    }
    updates.push('slug = ?');
    values.push(claim.handle);
  }

  // Whether an exact handle resolves to your name for somebody who is not
  // connected to you. On by default because a network nobody can see the edge
  // of is not a network; off makes you answer exactly as a stranger does, which
  // is what makes the default honest rather than a dark pattern. See
  // routes/connections.js.
  if (discoverable !== undefined) {
    updates.push('discoverable = ?');
    values.push(discoverable ? 1 : 0);
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'Nothing to update.' });
  }

  values.push(req.user.id);
  await db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: publicUser(user) });
});

// Is this handle free, said before somebody presses the button.
//
// NOT A DIRECTORY, and the difference matters because lib/handles.js exists to
// keep one from forming. Three things hold that line. It needs an account, so
// probing the namespace costs a signup rather than a page load. It is
// throttled, so a signed-in account cannot enumerate. And it answers in
// exactly the words claimHandle answers in — "already taken", whether somebody
// holds it now or held it in 2023 — so it reveals nothing the submit button
// would not have revealed a second later.
//
// It exists because the alternative is worse manners, not better security:
// asking somebody to choose a name, letting them type it, and only then saying
// it was never available.
const handleCheckLimiter = limit({
  limit: 60,
  windowMs: 60 * 60 * 1000,
  keys: (req) => [`handle:${req.user.id}`, `handle-ip:${clientIp(req)}`],
  message: 'Too many checks. Try again in a little while.',
});

router.get('/handle-available', handleCheckLimiter, async (req, res) => {
  const handle = normalizeHandle(req.query.handle);
  const problem = handleProblem(handle);
  if (problem) return res.json({ handle, available: false, problem });
  const owner = await everHeldBy(handle);
  if (owner && owner !== req.user.id) {
    return res.json({ handle, available: false, problem: 'That handle is already taken.' });
  }
  res.json({ handle, available: true, problem: null });
});

router.post('/onboarding-step', async (req, res) => {
  const { step } = req.body || {};
  // 'availability' is retired and kept only so an account halfway through the
  // old flow can still finish it. 'security_question' is the last step before
  // done: it is where the principal sets the answer that guards signing other
  // devices out, and it can be skipped straight to done.
  const allowed = ['profile', 'connect', 'availability', 'meeting_type', 'security_question', 'done'];
  if (!allowed.includes(step)) {
    return res.status(400).json({ error: 'Invalid onboarding step.' });
  }
  // NOBODY LEAVES THE PROFILE STEP WITHOUT A HANDLE. The field being `required`
  // in the form is a courtesy, not a gate — the step is advanced by a request,
  // and a request can be made without the form. So the rule lives here, where
  // it cannot be walked around, and it reads the same fact the profile screen
  // reads rather than a second idea of "has chosen one".
  if (step !== 'profile') {
    const me = await db.prepare('SELECT slug FROM users WHERE id = ?').get(req.user.id);
    if (isProvisional(me?.slug)) {
      return res.status(400).json({ error: 'Choose a handle before going on.' });
    }
  }
  await db.prepare('UPDATE users SET onboarding_step = ? WHERE id = ?').run(step, req.user.id);
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: publicUser(user) });
});

// --- Closing the account -------------------------------------------------
//
// Available to anyone, principal or assistant — it is their account. What
// differs is the blast radius, which is why the confirmation screen is fed by
// a real count rather than generic warning copy.

router.get('/account-summary', async (req, res) => {
  res.json({ summary: await summarizeAccount(req.user.id) });
});

router.delete('/account', async (req, res) => {
  // The password, not a checkbox. This is the one irreversible action in the
  // product, and a session left open on someone's desk should not be enough
  // to trigger it.
  const { password } = req.body || {};
  if (!password) return res.status(400).json({ error: 'Enter your password to confirm.' });

  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user || !verifyPassword(String(password), user.password_hash)) {
    return res.status(401).json({ error: 'That password is not correct.' });
  }

  await deleteAccount(req.user.id);
  clearSessionCookie(res);
  res.status(204).end();
});

module.exports = router;
