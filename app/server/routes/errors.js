const { asyncRouter } = require('../lib/asyncRouter');
const { requireAuth } = require('../lib/auth');
const { canPublish } = require('../lib/announcements');
const errorReports = require('../lib/errorReports');
const { limit, clientIp } = require('../lib/rateLimit');

const router = asyncRouter();

/**
 * Where faults are reported, and where an operator reads them.
 *
 * Reading is gated the same way notices are — ANNOUNCEMENT_AUTHORS — because
 * the same reasoning applies: there is no request that can add somebody to
 * that list and nothing in the database to flip, so an account somebody has
 * got into cannot promote itself onto it.
 */
function requireOperator(req, res, next) {
  if (!canPublish(req.user)) {
    // 404 rather than 403. Whether this deployment keeps an operator screen at
    // all is not a fact an ordinary account needs confirmed.
    return res.status(404).json({ error: 'No such endpoint.' });
  }
  return next();
}

// Open, so it is rate-limited by address. A page stuck in a render loop would
// otherwise report itself thousands of times in a minute.
const reportLimiter = limit({
  limit: 20,
  windowMs: 60 * 1000,
  keys: (req) => [`errreport:${clientIp(req)}`],
  message: 'Too many reports.',
});

/**
 * The browser reporting its own faults.
 *
 * Deliberately not behind requireAuth: attachUser has already put req.user in
 * place when there is a session, and the errors most worth hearing about are
 * the ones on the sign-in page, where by definition nobody is signed in yet.
 */
router.post('/', reportLimiter, async (req, res) => {
  const { message, stack, url } = req.body || {};
  // 204 either way. A client that is already broken gains nothing from being
  // argued with about the shape of its complaint.
  if (message) {
    await errorReports.record({ message, stack }, { req, kind: 'client', url });
  }
  res.status(204).end();
});

router.get('/', requireAuth, requireOperator, async (req, res) => {
  res.json({
    faults: await errorReports.summary({}),
    notifying: errorReports.isNotifyConfigured(),
  });
});

router.get('/:fingerprint', requireAuth, requireOperator, async (req, res) => {
  const occurrences = await errorReports.detail(req.params.fingerprint);
  if (occurrences.length === 0) return res.status(404).json({ error: 'Not found.' });
  res.json({ occurrences });
});

router.delete('/:fingerprint', requireAuth, requireOperator, async (req, res) => {
  await errorReports.clear(req.params.fingerprint);
  res.status(204).end();
});

module.exports = router;
