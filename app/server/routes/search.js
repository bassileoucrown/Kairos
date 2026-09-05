const { asyncRouter } = require('../lib/asyncRouter');
const { requireAuth } = require('../lib/auth');
const { requirePaAccess } = require('../lib/paAccess');
const { limit, clientIp } = require('../lib/rateLimit');
const search = require('../lib/search');

// One question, asked of everything the person asking is allowed to see.
//
// SCOPED TO A PRINCIPAL LIKE EVERY OTHER PA ROUTE. There is no "search all my
// principals" here, and that is not an omission: an assistant covering three
// principals asking one question across all three would produce a screen that
// mixes three people's affairs, and the first time that matters is the time it
// matters a lot. The switcher already says whose desk you are at; search
// answers for that desk.
//
// RATE LIMITED, and for a reason that is not load. A search box is the most
// efficient way anybody has ever built to enumerate a database — type a
// letter, read the count, type another. The gate in lib/search.js means the
// counts are honest rather than revealing, but a limit on top of it turns
// "walk the alphabet" from tedious into impossible, and costs a real user
// nothing: nobody types sixty distinct searches in an hour.

const router = asyncRouter();
router.use(requireAuth);

const searchLimiter = limit({
  limit: 90,
  windowMs: 60 * 60 * 1000,
  keys: (req) => [`search:${req.user.id}`, `search-ip:${clientIp(req)}`],
  message: 'That is a lot of searching in a short time. Try again shortly.',
});

router.get('/:ownerId', requirePaAccess, searchLimiter, async (req, res) => {
  const found = await search.run(req.query.q, {
    ownerId: req.principal.id,
    viewerId: req.user.id,
    paRole: req.paRole,
    isOwner: req.paRole === 'owner',
  });
  res.json({
    ...found,
    // Said so the screen can explain itself rather than looking broken on a
    // one-letter query.
    minimum: search.MIN_TERM,
    principal: { id: req.principal.id, name: req.principal.name },
  });
});

module.exports = router;
