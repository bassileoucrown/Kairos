const { asyncRouter } = require('../lib/asyncRouter');
const { requireAuth } = require('../lib/auth');
const catchUp = require('../lib/catchUp');

// What happened while you were away. See lib/catchUp.js for what counts as
// away and why it is measured rather than asked.

const router = asyncRouter();
router.use(requireAuth);

router.get('/', async (req, res) => {
  // An explicit window is allowed so somebody can look back deliberately —
  // "what did I miss last week" is a fair question even from a person who was
  // never away. Clamped by the library rather than trusted from the URL.
  const asked = req.query.since ? String(req.query.since) : null;
  const win = await catchUp.windowFor(req.user.id, { since: asked });

  if (!win) {
    return res.json({ away: false, since: null, rooms: [], diary: [], tasks: [], records: [], empty: true });
  }
  const built = await catchUp.build(req.user.id, { since: win.since });
  res.json({
    away: win.measured,
    ...built,
    // Said by the server because only the server knows the difference between
    // "you missed nothing" and "you were never gone" — two states a screen
    // must not describe with the same sentence.
    empty: catchUp.isEmpty(built),
  });
});

/** Read it, done with it. */
router.post('/seen', async (req, res) => {
  await catchUp.clear(req.user.id);
  res.json({ ok: true });
});

module.exports = { router };
