const { asyncRouter } = require('../lib/asyncRouter');
const db = require('../lib/db');
const { requireAuth } = require('../lib/auth');
const { requirePaAccess } = require('../lib/paAccess');
const { canSee } = require('../lib/essentials');
const keep = require('../lib/keep');

// The archive: things kept out of conversations that have since moved on, or
// been deleted entirely.
//
// Documents put away are NOT here, deliberately. They stay in the essentials
// route, because reading one costs a step-up and is written to the access log,
// and those rules are hard-won and live in exactly one place. A second
// endpoint that served the same rows would be a second copy of the masking
// rule, and the copy that drifts is the one that leaks a passport number. The
// screen shows both under one heading; the server keeps them apart.

const router = asyncRouter();
router.use(requireAuth);

/**
 * WHO MAY READ AN ARCHIVE.
 *
 * The same bar as a sensitive essential, and for the same reason. What ends up
 * in here is whatever somebody thought was worth saving out of a room that was
 * about to close — account details, terms, an instruction about a family
 * matter — and it arrives stripped of the space membership that used to
 * protect it. A delegate engaged for scheduling could not open the room it
 * came from; the archive must not become the back door into it.
 *
 * So: the principal, or an assistant with a full remit. A scheduling delegate
 * gets the same answer they get for a passport — that there is nothing here
 * for them, rather than that something is being withheld.
 */
function mayRead(req) {
  return canSee('sensitive', { isOwner: req.paRole === 'owner', role: req.paRole });
}

router.get('/:ownerId', requirePaAccess, async (req, res) => {
  if (!mayRead(req)) {
    return res.json({
      principal: { id: req.principal.id, name: req.principal.name },
      canRead: false,
      kept: [],
    });
  }
  res.json({
    principal: { id: req.principal.id, name: req.principal.name },
    canRead: true,
    kept: await keep.forOwner(req.principal.id),
  });
});

/** Why this was worth keeping, added after the fact. */
router.patch('/:ownerId/:itemId', requirePaAccess, async (req, res) => {
  if (!mayRead(req)) return res.status(404).json({ error: 'Not found.' });
  const row = await db.prepare('SELECT * FROM kept_items WHERE id = ? AND owner_id = ?')
    .get(req.params.itemId, req.principal.id);
  if (!row) return res.status(404).json({ error: 'Not found.' });

  await db.prepare('UPDATE kept_items SET note = ? WHERE id = ?')
    .run(String(req.body?.note || '').trim(), row.id);
  res.json({ ok: true });
});

/**
 * Out of the archive for good.
 *
 * A REAL DELETE, and it has to be. This is the last copy of something the
 * office deliberately saved — there is no further tier to demote it to, and a
 * tombstone reading "something was kept here and then removed" in a store
 * built to hold identity documents would be worse than the gap. The confirming
 * is the screen's job, as it is for a space.
 */
router.delete('/:ownerId/:itemId', requirePaAccess, async (req, res) => {
  if (!mayRead(req)) return res.status(404).json({ error: 'Not found.' });
  const row = await db.prepare('SELECT * FROM kept_items WHERE id = ? AND owner_id = ?')
    .get(req.params.itemId, req.principal.id);
  if (!row) return res.status(404).json({ error: 'Not found.' });

  await db.prepare('DELETE FROM kept_items WHERE id = ?').run(row.id);
  res.status(204).end();
});

module.exports = { router };
