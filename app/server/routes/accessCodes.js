const { asyncRouter } = require('../lib/asyncRouter');
const db = require('../lib/db');
const { requireAuth } = require('../lib/auth');
const { limit, clientIp } = require('../lib/rateLimit');
const { ASSISTANT_ROLES } = require('../lib/roles');
const { ensureDirectLine } = require('../lib/directLine');
const {
  WINDOWS, currentFor, arm, turnOff, redeem,
} = require('../lib/accessCodes');

const router = asyncRouter();
router.use(requireAuth);

// A code is a bearer credential to somebody's calendar and contacts, and the
// principal picks it, which means it will sometimes be short and memorable.
// Throttling is what makes that survivable: a person typing what they were
// told needs a handful of attempts; a script needs thousands.
const redeemLimiter = limit({
  limit: 10,
  windowMs: 60 * 60 * 1000,
  keys: (req) => [`redeem:${req.user.id}`, `redeem-ip:${clientIp(req)}`],
  message: 'Too many attempts. Wait a few minutes and try again.',
});

/** The principal's own code. Only ever their own — there is no lookup by anyone else. */
router.get('/', async (req, res) => {
  res.json({
    code: await currentFor(req.user.id),
    windows: WINDOWS,
    roles: Object.entries(ASSISTANT_ROLES).map(([id, r]) => ({
      id, label: r.label, description: r.description,
    })),
  });
});

router.post('/', async (req, res) => {
  const { code, role, window: windowId, uses } = req.body || {};
  const result = await arm({ ownerId: req.user.id, code, role, window: windowId, uses });
  if (result.error) return res.status(400).json({ error: result.error });
  res.status(201).json({ code: result.code });
});

router.delete('/', async (req, res) => {
  await turnOff(req.user.id);
  res.status(204).end();
});

// Joining. The one endpoint an assistant uses, and the only place in the app
// where a code means anything.
router.post('/redeem', redeemLimiter, async (req, res) => {
  const { handle, code } = req.body || {};
  const result = await redeem({ viewerId: req.user.id, handle, code });
  if (result.error) return res.status(400).json({ error: result.error });

  // They can talk to the principal from this moment, exactly as if they had
  // accepted an emailed invitation.
  await ensureDirectLine(result.owner.id);

  res.status(201).json({ joined: result.owner, role: result.role });
});

module.exports = router;
