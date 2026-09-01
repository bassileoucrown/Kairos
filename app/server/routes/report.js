const { asyncRouter } = require('../lib/asyncRouter');
const { requireAuth } = require('../lib/auth');
const { requirePaAccess } = require('../lib/paAccess');
const { buildReport } = require('../lib/weeklyReport');
const { weekAhead } = require('../lib/weekAhead');
const exporter = require('../lib/reportExport');

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

/**
 * The whole access decision, in one place, for the screen AND the file.
 *
 * THIS FUNCTION IS THE POINT. The export hands somebody a document they can
 * forward to anyone, so the one thing that must not happen is the export
 * deciding for itself who is in scope. When that decision lived only inside
 * the GET handler, adding a second route meant copying it — and a copied
 * access rule is a rule with two versions, one of which will be wrong. Both
 * routes call this and neither knows the rule.
 */
function scopeFor(req) {
  const seesEveryone = SEES_THE_OFFICE.has(req.paRole);
  // Clamped, and not merely for tidiness: `week` reaches into a date
  // calculation and a query, and an unbounded number from the URL is an
  // invitation to ask for the week fifty thousand years ago.
  const raw = Number.parseInt(req.query.week, 10);
  const back = Number.isFinite(raw) ? Math.min(Math.max(raw, 0), 52) : 1;

  // Narrowing to ONE person, for "give me just Ngozi's week". Only somebody
  // who may see everyone can ask for somebody else; for anyone else the
  // parameter is ignored rather than refused, because the answer they are
  // entitled to is the same either way and an error would only teach them
  // that the parameter exists.
  const asked = String(req.query.person || '').trim();
  const onlyUserId = seesEveryone ? (asked || null) : req.user.id;

  // A named stretch of days instead of a week counter. Passed through as the
  // caller typed it and validated where the timezone is known — this function
  // has no business knowing what a valid date is in Lagos.
  const from = String(req.query.from || '').trim() || null;
  const to = String(req.query.to || '').trim() || null;

  return {
    back,
    from,
    to,
    onlyUserId,
    seesEveryone,
    isOwner: req.paRole === 'owner',
    // WHO SEES THE CUSTODY TRAIL, which is a narrower question than who sees
    // the office. The counts already tell a Chief of Staff that three
    // documents were looked at; the trail says WHICH — that the passport was
    // revealed on Tuesday — and that is the principal's own record of their
    // own essentials. The principal set an access code so that "even if
    // someone accesses my account, my essentials are still protected"; a
    // report that hands the reveal history to everyone senior would undo
    // exactly that. So: the account holder, and nobody else.
    seesAccessTrail: req.paRole === 'owner',
    // 'self' whenever the document covers one line, however that came about —
    // by rule or by asking — because that is what the footer has to say.
    scope: seesEveryone && !asked ? 'office' : 'self',
  };
}

/** The one refusal both routes give, so they cannot word it differently. */
function badWindow(res) {
  return res.status(400).json({
    error: 'Those dates do not make a period. Give a start on or before the end, '
      + 'within a year of each other.',
    code: 'bad_window',
  });
}

router.get('/:ownerId', requirePaAccess, async (req, res) => {
  const { back, from, to, onlyUserId, seesEveryone, isOwner, scope, seesAccessTrail } = scopeFor(req);

  const report = await buildReport(req.principal.id, {
    back,
    from,
    to,
    withAccessTrail: seesAccessTrail,
    onlyUserId,
    // WHO IS READING, which is not the same as whose week this is. The open
    // records are links now, and a link to a room this reader cannot open
    // reads as the app being broken rather than as the door being shut.
    viewerId: req.user.id,
  });
  if (!report) return res.status(404).json({ error: 'Not found.' });
  if (report.badWindow) return badWindow(res);

  res.json({
    ...report,
    // The half that has not happened yet. Scoped to the READER, not to the
    // principal — a list of neglected things somebody cannot open reads as the
    // app being broken rather than as a door being shut.
    ahead: await weekAhead(req.principal.id, req.user.id),
    // Said plainly on the screen rather than left to be inferred from a short
    // list: an assistant seeing one row should know it is the rule and not a
    // sign that they are the only person working here.
    scope,
    canSeeEveryone: seesEveryone,
    // Whether this is their OWN office or one they are helping to run. The
    // screen says different things in each case, and only the server knows
    // which — a Chief of Staff reading the whole office should not be told
    // to go and invite people to a team that is not theirs.
    isPrincipal: isOwner,
  });
});

/**
 * The same report, as a file.
 *
 * Goes through scopeFor like the screen does, so a delegate who may see only
 * their own line downloads only their own line. This is the route where that
 * mattering is not theoretical: a file gets forwarded.
 */
router.get('/:ownerId/export', requirePaAccess, async (req, res) => {
  const { back, from, to, onlyUserId, scope, seesAccessTrail } = scopeFor(req);
  const format = req.query.format === 'csv' ? 'csv' : 'html';

  const report = await buildReport(req.principal.id, {
    back, from, to, onlyUserId, viewerId: req.user.id,
    // Through the same gate as the screen, which is the whole reason that
    // decision lives in scopeFor. A file gets forwarded, so the export is the
    // route where a copied access rule would do the most damage.
    withAccessTrail: seesAccessTrail,
  });
  if (!report) return res.status(404).json({ error: 'Not found.' });
  if (report.badWindow) return badWindow(res);

  // The document carries the week ahead too. A file is read away from the app,
  // often by somebody who cannot click through to anything, so leaving out the
  // half that says what is coming would make the export the weaker artifact.
  const full = { ...report, scope, ahead: await weekAhead(req.principal.id, req.user.id) };

  const body = format === 'csv' ? exporter.toCsv(full) : exporter.toHtml(full);
  res.setHeader('Content-Type', format === 'csv'
    ? 'text/csv; charset=utf-8'
    : 'text/html; charset=utf-8');
  // attachment, not inline: the browser must save this rather than render it
  // as a page inside the app's own origin.
  res.setHeader('Content-Disposition',
    `attachment; filename="${exporter.filename(full, format)}"`);
  res.send(body);
});

module.exports = { router };
