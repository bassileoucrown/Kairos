const { asyncRouter } = require('../lib/asyncRouter');
const { requireAuth } = require('../lib/auth');
const { requirePaAccess } = require('../lib/paAccess');
const { buildReport } = require('../lib/weeklyReport');

// The week just gone, on the office's side of the desk.
//
// See lib/weeklyReport.js for what is counted and what deliberately is not.

const router = asyncRouter();
router.use(requireAuth);

/**
 * WHO SEES WHOSE LINE.
 *
 * The principal sees the whole office, because it is their office. An
 * assistant sees their own row and nobody else's — including a Chief of Staff,
 * who in many households does manage the others, but who has not been given
 * that power here by anyone and should not acquire it as a side effect of a
 * reporting screen. If a principal wants their Chief of Staff to see the rest,
 * that is a decision they should make deliberately, and it is not this.
 */
router.get('/:ownerId', requirePaAccess, async (req, res) => {
  const isOwner = req.paRole === 'owner';
  // Clamped, and not merely for tidiness: `back` reaches into a date
  // calculation and a query, and an unbounded number from the URL is an
  // invitation to ask for the week fifty thousand years ago.
  const raw = Number.parseInt(req.query.week, 10);
  const back = Number.isFinite(raw) ? Math.min(Math.max(raw, 0), 52) : 1;

  const report = await buildReport(req.principal.id, {
    back,
    onlyUserId: isOwner ? null : req.user.id,
  });
  if (!report) return res.status(404).json({ error: 'Not found.' });

  res.json({
    ...report,
    // Said plainly on the screen rather than left to be inferred from a short
    // list: an assistant seeing one row should know it is the rule and not a
    // sign that they are the only person working here.
    scope: isOwner ? 'office' : 'self',
    canSeeEveryone: isOwner,
  });
});

module.exports = { router };
