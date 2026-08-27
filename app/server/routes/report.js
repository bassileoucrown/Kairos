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
 * The principal sees the whole office, because it is their office. So does a
 * Chief of Staff, because running the office IS the post — a Chief of Staff
 * who cannot see whether the EA cleared last week's approvals is being asked
 * to run something with their eyes shut, and would end up asking each person
 * individually, which is worse for everybody including the people being asked.
 *
 * Everyone else sees their own row and nobody else's. A PA, an EA and a
 * delegate are not each other's supervisors, and a reporting screen is not the
 * place to quietly decide otherwise.
 *
 * THE LINE IS THE POST, NOT THE SCREEN. This grant follows from what a Chief
 * of Staff is engaged to do, which is why it lives here as a role rather than
 * as a per-person switch somebody has to find and set. If a principal wants a
 * Chief of Staff who cannot see the others, the answer is to appoint them EA —
 * the roles already mean different things everywhere else in the product.
 */
const SEES_THE_OFFICE = new Set(['owner', 'chief_of_staff']);

router.get('/:ownerId', requirePaAccess, async (req, res) => {
  const isOwner = req.paRole === 'owner';
  const seesEveryone = SEES_THE_OFFICE.has(req.paRole);
  // Clamped, and not merely for tidiness: `back` reaches into a date
  // calculation and a query, and an unbounded number from the URL is an
  // invitation to ask for the week fifty thousand years ago.
  const raw = Number.parseInt(req.query.week, 10);
  const back = Number.isFinite(raw) ? Math.min(Math.max(raw, 0), 52) : 1;

  const report = await buildReport(req.principal.id, {
    back,
    onlyUserId: seesEveryone ? null : req.user.id,
  });
  if (!report) return res.status(404).json({ error: 'Not found.' });

  res.json({
    ...report,
    // Said plainly on the screen rather than left to be inferred from a short
    // list: an assistant seeing one row should know it is the rule and not a
    // sign that they are the only person working here.
    scope: seesEveryone ? 'office' : 'self',
    canSeeEveryone: seesEveryone,
    // Whether this is their OWN office or one they are helping to run. The
    // screen says different things in each case, and only the server knows
    // which — a Chief of Staff reading the whole office should not be told
    // to go and invite people to a team that is not theirs.
    isPrincipal: isOwner,
  });
});

module.exports = { router };
