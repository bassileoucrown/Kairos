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

  // SETTLE THE ABSENCE BEFORE READING IT.
  //
  // requireAuth calls touch() fire-and-forget, deliberately: no ordinary
  // request should wait on a bookkeeping write. But THIS request is the one
  // that reads what that write produces, and coming back to the app is
  // exactly when the two race — the first request back is often this one, so
  // the handler could read away_since before the write recording the gap had
  // landed and answer "you were never gone" to somebody who had just been
  // gone all afternoon. Refreshing would then fix it, which is the worst
  // shape of bug: right on the second look and wrong on the first.
  //
  // Awaiting it here costs one write on one screen. The touch already in
  // flight is harmless either way round — whichever lands second sees a gap
  // of nothing and only moves last_seen_at, leaving away_since alone.
  await catchUp.touch(req.user.id);

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
