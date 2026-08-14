const crypto = require('crypto');
const { asyncRouter } = require('../lib/asyncRouter');
const db = require('../lib/db');
const { requireAuth } = require('../lib/auth');
const { requirePaAccess } = require('../lib/paAccess');
const concierge = require('../lib/concierge');

const router = asyncRouter();
router.use(requireAuth);

// The desk, and an honest account of why it is shut. See lib/concierge.js.

router.get('/:ownerId', requirePaAccess, async (req, res) => {
  const available = concierge.isAvailable();
  res.json({
    available,
    // Said in the response rather than baked into the client, for the same
    // reason /api/status reports storageDurable: whether something works is a
    // property of the deployment, and a screen that decides it for itself will
    // eventually be wrong on somebody's install.
    reason: available ? null : concierge.UNAVAILABLE_REASON,
    services: concierge.SERVICES,
    interest: await concierge.interestFor(req.principal.id),
  });
});

/**
 * "Tell me when this opens."
 *
 * The only thing this screen accepts, and it is real: a row, kept, that says
 * which parts of the desk this principal actually wants. The alternative
 * placeholder — a request box that takes "table for four at 8, my wife's
 * birthday" and answers with a friendly message — would be a lie told to
 * somebody at the exact moment they were relying on us.
 */
router.post('/:ownerId/interest', requirePaAccess, async (req, res) => {
  const { service, note } = req.body || {};
  if (!concierge.isService(service)) {
    return res.status(400).json({ error: 'That is not one of the services.' });
  }
  const existing = await db.prepare(
    'SELECT id FROM concierge_interest WHERE owner_id = ? AND service = ?',
  ).get(req.principal.id, service);
  // Saying it twice is not a second want.
  if (!existing) {
    await db.prepare(`
      INSERT INTO concierge_interest (id, owner_id, created_by, service, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(crypto.randomUUID(), req.principal.id, req.user.id, service,
      String(note || '').trim().slice(0, 500), new Date().toISOString());
  }
  res.status(201).json({ interest: await concierge.interestFor(req.principal.id) });
});

router.delete('/:ownerId/interest/:service', requirePaAccess, async (req, res) => {
  await db.prepare('DELETE FROM concierge_interest WHERE owner_id = ? AND service = ?')
    .run(req.principal.id, req.params.service);
  res.json({ interest: await concierge.interestFor(req.principal.id) });
});

/**
 * The shape a real request will take, refusing plainly until there is somebody
 * to hand it to.
 *
 * It exists now so that the refusal is a documented 501 with a reason rather
 * than a 404 that looks like a bug, and so the client has something to call
 * the day the desk opens.
 */
router.post('/:ownerId/requests', requirePaAccess, (req, res) => {
  if (!concierge.isAvailable()) {
    return res.status(501).json({ error: concierge.UNAVAILABLE_REASON });
  }
  res.status(501).json({
    error: 'A partner is configured, but handing requests to them is not built yet.',
  });
});

module.exports = router;
