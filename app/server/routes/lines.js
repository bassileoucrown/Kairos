const { asyncRouter } = require('../lib/asyncRouter');
const { requireAuth } = require('../lib/auth');
const { linesFor } = require('../lib/lines');

/**
 * Every conversation this person has.
 *
 * One endpoint rather than three, because "who am I talking to" is one
 * question. The office room, the private lines with colleagues, and the peer
 * lines with other principals were reachable from three unrelated screens, and
 * none of them told you that anything had arrived in the others.
 *
 * See lib/lines.js for what counts as a line, and why project spaces do not.
 */
const router = asyncRouter();
router.use(requireAuth);

router.get('/', async (req, res) => {
  res.json({ lines: await linesFor(req.user.id) });
});

module.exports = router;
