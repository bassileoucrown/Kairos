const express = require('express');
const { asyncRouter } = require('../lib/asyncRouter');
const db = require('../lib/db');
const { requireAuth, verifyPassword, clearSessionCookie } = require('../lib/auth');
const { normalizeHandle, handleProblem } = require('../lib/handles');
const { isValidTimeZone } = require('../lib/timezone');
const { publicUser } = require('./auth');
const { summarizeAccount, deleteAccount } = require('../lib/accountDeletion');

const router = asyncRouter();

router.use(requireAuth);

router.patch('/', async (req, res) => {
  const { name, timezone, slug } = req.body || {};
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
    const handle = normalizeHandle(slug);
    const problem = handleProblem(handle);
    if (problem) return res.status(400).json({ error: problem });
    const taken = await db.prepare('SELECT 1 FROM users WHERE slug = ? AND id != ?').get(handle, req.user.id);
    if (taken) return res.status(409).json({ error: 'That handle is already taken.' });
    updates.push('slug = ?');
    values.push(handle);
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'Nothing to update.' });
  }

  values.push(req.user.id);
  await db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: publicUser(user) });
});

router.post('/onboarding-step', async (req, res) => {
  const { step } = req.body || {};
  // 'availability' is retired and kept only so an account halfway through the
  // old flow can still finish it. 'security_question' is the last step before
  // done: it is where the principal sets the answer that guards signing other
  // devices out, and it can be skipped straight to done.
  const allowed = ['profile', 'availability', 'meeting_type', 'security_question', 'done'];
  if (!allowed.includes(step)) {
    return res.status(400).json({ error: 'Invalid onboarding step.' });
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
