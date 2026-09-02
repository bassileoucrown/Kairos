const { asyncRouter } = require('../lib/asyncRouter');
const { requireAuth } = require('../lib/auth');
const guide = require('../lib/guide');

const router = asyncRouter();
router.use(requireAuth);

// What a feature does and how to use it. See lib/guide.js for why this is on
// the server rather than typed into each screen.

router.get('/', async (req, res) => {
  res.json({ features: guide.list() });
});

router.get('/:id', async (req, res) => {
  const feature = guide.forFeature(String(req.params.id));
  // A screen asking about itself must never be able to fail the page it is on,
  // so an unknown id is an empty answer rather than an error. The client
  // renders nothing and the screen is exactly as it was.
  if (!feature) return res.json({ feature: null });
  res.json({ feature });
});

module.exports = router;
