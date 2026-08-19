const { asyncRouter } = require('../lib/asyncRouter');
const { requireAuth } = require('../lib/auth');
const capabilities = require('../lib/capabilities');

const router = asyncRouter();
router.use(requireAuth);

// What is not working yet, and where it will appear.
//
// One endpoint rather than a flag in each screen: a page that decides for
// itself keeps saying "coming soon" long after the credential is set. This and
// the feature read the same environment, so a notice disappears exactly when
// the thing behind it starts working.
router.get('/', async (req, res) => {
  const screen = req.query.screen ? String(req.query.screen) : null;
  res.json({ capabilities: capabilities.list(screen), screens: capabilities.SCREENS });
});

module.exports = router;
