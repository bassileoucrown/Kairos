const { asyncRouter } = require('../lib/asyncRouter');
const { requireAuth } = require('../lib/auth');
const plans = require('../lib/plans');

const router = asyncRouter();
router.use(requireAuth);

// What this account may do, said once rather than discovered by being refused.
//
// `enforced` is reported alongside, because a screen that dims a button has to
// know whether the plan is currently a boundary or only a note — and while
// enforcement is off, nothing should be dimmed at all.
router.get('/', async (req, res) => {
  res.json(await plans.stateFor(req.user.id));
});

module.exports = router;
