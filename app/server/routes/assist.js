const { asyncRouter } = require('../lib/asyncRouter');
const db = require('../lib/db');
const { requireAuth } = require('../lib/auth');
const { requirePaAccess } = require('../lib/paAccess');
const assist = require('../lib/assist');
const aiModel = require('../lib/aiModel');
const mailAccess = require('../lib/mailAccess');
const mailbox = require('../lib/mailbox');
const { resolveAccess } = require('../lib/spaceAccess');
const plans = require('../lib/plans');

// The seven asks, as routes.
//
// NONE OF THESE WRITES ANYTHING. Every one returns words or proposals to a
// screen, and the act that follows — filing a minute, creating a task,
// promoting a record, sending a reply — is a separate request a person makes.
// That is checked by bassist.js rather than promised here.
//
// EVERY ONE REFUSES THE SAME WAY WITHOUT A KEY, through modelError below, so
// an office with no model configured is told once, in the same words, wherever
// they press. See lib/capabilities.js for how the screens learn that before
// somebody presses at all.

const router = asyncRouter();
router.use(requireAuth);

/** One place that turns a model failure into words a screen can show. */
function modelError(res, err) {
  if (err instanceof aiModel.VaultRefusal || err.code === 'vault_off_limits') {
    return res.status(400).json({ error: aiModel.REFUSAL, code: 'vault_off_limits' });
  }
  if (err.code === 'model_not_configured') {
    return res.status(503).json({ error: aiModel.UNAVAILABLE, code: 'model_not_configured' });
  }
  if (err.code === 'bad_shape') {
    return res.status(502).json({ error: err.message, code: 'bad_shape' });
  }
  console.error(`Assist failed — ${err.message}`);
  return res.status(502).json({
    error: 'That could not be written just now. Nothing has been saved; try again.',
    code: 'model_failed',
  });
}

const attempt = (res, fn) => fn().catch((err) => modelError(res, err));

/**
 * One ask, counted against what it costs us.
 *
 * A model call is invoiced per use, unlike everything on the plan ladder, so
 * it is metered rather than ranked — see METERED in lib/plans.js. Counted
 * AFTER the ask succeeds: a refusal because no key is configured cost nothing
 * and should not appear in the evidence as demand.
 *
 * The counting itself lives in lib/plans.js rather than here. It was written
 * out in this file and again in routes/itinerary.js, which is two answers to
 * one question — the drift shape this codebase keeps being bitten by.
 */
// CALLED AFTER THE ASK, NEVER BEFORE. Written the other way round first, and
// the effect was that an ask which refused for want of a key was counted as
// demand — inventing the very numbers this is here to collect. lib/assist.js
// throws on an unconfigured deployment, so anything above the await never ran.
const meter = (req) => plans.meterUse(req, 'ai_assist');

// --- 1. What happened while you were away -----------------------------------------
//
// NOT principal-scoped, deliberately, and for the same reason the catch-up
// screen is not: an assistant with three principals has been away from all
// three at once, and a brief that made them pick one first would be asking
// them to guess where the news is.
router.post('/catch-up', async (req, res) => attempt(res, async () => {
  const brief = await assist.catchUpBrief(req.user.id);
  await meter(req);
  res.json(brief);
}));

// --- 2. The brief before a meeting --------------------------------------------------
router.post('/:ownerId/meetings/:bookingId/brief', requirePaAccess,
  async (req, res) => attempt(res, async () => {
    const booking = await db.prepare('SELECT * FROM bookings WHERE id = ? AND owner_id = ?')
      .get(req.params.bookingId, req.principal.id);
    if (!booking) return res.status(404).json({ error: 'Not found.' });
    const brief = await assist.meetingBrief(booking, req.principal.id);
    await meter(req);
    res.json(brief);
  }));

// --- 3. The actions inside a minute --------------------------------------------------
router.post('/:ownerId/meetings/:bookingId/minute-tasks', requirePaAccess,
  async (req, res) => attempt(res, async () => {
    // The most recent minute on this meeting. booking_notes are never deleted,
    // so there is no tombstone to skip past here.
    const note = await db.prepare(`
      SELECT * FROM booking_notes
       WHERE booking_id = ? AND owner_id = ? AND kind = 'minute'
       ORDER BY created_at DESC LIMIT 1
    `).get(req.params.bookingId, req.principal.id);
    if (!note) {
      return res.status(400).json({ error: 'There are no minutes on this meeting yet.' });
    }
    // Proposals only. Creating them is POST /tasks, which a person calls.
    const tasks = await assist.tasksFromMinute(note.body);
    await meter(req);
    res.json({ tasks });
  }));

// --- 4. Triage of correspondence ------------------------------------------------------
router.post('/:ownerId/mail/:accountId/triage', requirePaAccess,
  async (req, res) => attempt(res, async () => {
    const account = await db.prepare('SELECT * FROM mail_accounts WHERE id = ? AND owner_id = ?')
      .get(req.params.accountId, req.principal.id);
    if (!account) return res.status(404).json({ error: 'Not found.' });
    // The mailbox's own gate, not the office's. Being an assistant does not
    // put somebody in the correspondence — see lib/mailAccess.js.
    const may = await mailAccess.accessFor(account, req.user.id);
    if (!may) return res.status(404).json({ error: 'Not found.' });

    // THROUGH THE SAME GATE AS THE SCREEN. Without `may` this listed every
    // open thread in the mailbox and handed it to a model — including the
    // correspondence the principal has kept out of the office's sight, which
    // is the one place it must never go. An ask is a new door onto old data,
    // and this is exactly the door a new privacy rule gets forgotten behind.
    const threads = await mailbox.threads(account.id, { state: 'open', may });
    const withText = [];
    for (const t of threads.slice(0, 25)) {
      const msgs = await mailbox.messagesIn(t.id);
      const last = [...msgs].reverse().find((m) => !m.deleted);
      withText.push({ ...t, latest: last?.body || '' });
    }
    const verdicts = await assist.triage(withText);
    await meter(req);
    res.json({ verdicts });
  }));

// --- 5. A reply that sounds like them ---------------------------------------------------
router.post('/:ownerId/reply', requirePaAccess,
  async (req, res) => attempt(res, async () => {
    const instruction = String(req.body?.instruction || '').trim();
    if (!instruction) return res.status(400).json({ error: 'Say what the reply should do.' });
    // Written in the PRINCIPAL's voice when drafting for them, which is the
    // whole point — an assistant drafting as themselves would just be writing.
    const asUserId = req.body?.asPrincipal === false ? req.user.id : req.principal.id;
    const drafted = await assist.reply({
      instruction,
      context: String(req.body?.context || '').slice(0, 12000),
      asUserId,
    });
    await meter(req);
    res.json(drafted);
  }));

// --- 6. The week ahead, read rather than listed --------------------------------------------
router.post('/:ownerId/week-ahead', requirePaAccess,
  async (req, res) => attempt(res, async () => {
    const read = await assist.weekAheadRead(req.principal.id, req.user.id);
    await meter(req);
    res.json(read);
  }));

// --- 7. Something in this room looks like a decision -----------------------------------------
router.post('/threads/:threadId/records', async (req, res) => attempt(res, async () => {
  // The thread's own access rule, resolved through its space exactly as
  // routes/threads.js does. A room somebody cannot open is a room they cannot
  // have read for them either — and asking a second way would be a second
  // answer to the same question.
  const thread = await db.prepare('SELECT id, space_id FROM threads WHERE id = ?')
    .get(req.params.threadId);
  if (!thread) return res.status(404).json({ error: 'Not found.' });
  const access = await resolveAccess(thread.space_id, req.user.id);
  if (!access) return res.status(404).json({ error: 'Not found.' });
  const candidates = await assist.recordCandidates(req.params.threadId);
  await meter(req);
  res.json({ candidates });
}));

module.exports = { router };
