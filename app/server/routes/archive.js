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
    putAway: await putAwayFor(req.principal.id),
  });
});

/**
 * Everything the office has put away, gathered in the one place called Archive.
 *
 * WHY THIS WAS MISSING AND WHY IT MATTERED. The screen called Archive showed
 * two things: messages somebody had kept, and documents put away. Everything
 * else that could be archived — a room, a conversation, a project, a task —
 * went somewhere else or nowhere, so a principal who archived a project could
 * not find it afterwards and reasonably concluded it had been lost. A place
 * named Archive that is not where archived things go is worse than no such
 * place, because it answers the question wrongly instead of not at all.
 *
 * SCOPED TO THE PRINCIPAL'S OWN ROOMS, matching kept items, which file into
 * the space owner's archive rather than the keeper's. An assistant's own
 * private rooms are not their principal's to see, and this must not become the
 * screen that shows them.
 *
 * ARCHIVED IS NOT DELETED, so every row carries where it came from and enough
 * to go and find it. A shelf you cannot reach onto is a bin.
 */
async function putAwayFor(ownerId) {
  const rooms = await db.prepare(`
    SELECT id, name, archived_at FROM spaces
     WHERE owner_id = ? AND archived_at IS NOT NULL
     ORDER BY archived_at DESC LIMIT 100
  `).all(ownerId);

  const conversations = await db.prepare(`
    SELECT t.id, t.name, t.archived_at, s.id AS space_id, s.name AS space_name
      FROM threads t JOIN spaces s ON s.id = t.space_id
     WHERE s.owner_id = ? AND t.archived_at IS NOT NULL
     ORDER BY t.archived_at DESC LIMIT 100
  `).all(ownerId);

  // Both spellings. The column is the current one; status = 'archived' is what
  // projects used before it existed, and a project put away that way is still
  // put away — reading only the new column would have emptied the shelf for
  // everybody who had already used the old one.
  const projects = await db.prepare(`
    SELECT p.id, p.name, p.archived_at, p.status, s.id AS space_id, s.name AS space_name
      FROM projects p JOIN spaces s ON s.id = p.space_id
     WHERE s.owner_id = ? AND (p.archived_at IS NOT NULL OR p.status = 'archived')
     ORDER BY p.archived_at DESC, p.created_at DESC LIMIT 100
  `).all(ownerId);

  // Top-level only: a step is archived with its task, and listing both would
  // show the same act twice under two names.
  const tasks = await db.prepare(`
    SELECT t.id, t.title, t.archived_at, t.status, s.id AS space_id, s.name AS space_name
      FROM tasks t JOIN spaces s ON s.id = t.space_id
     WHERE s.owner_id = ? AND t.archived_at IS NOT NULL AND t.parent_task_id IS NULL
     ORDER BY t.archived_at DESC LIMIT 100
  `).all(ownerId);

  return {
    rooms: rooms.map((r) => ({ id: r.id, name: r.name, archivedAt: r.archived_at })),
    conversations: conversations.map((t) => ({
      id: t.id, name: t.name, archivedAt: t.archived_at,
      spaceId: t.space_id, spaceName: t.space_name,
    })),
    projects: projects.map((p) => ({
      id: p.id, name: p.name, archivedAt: p.archived_at,
      spaceId: p.space_id, spaceName: p.space_name,
      // So a screen can say why it is here when the old spelling put it here.
      byStatus: !p.archived_at && p.status === 'archived',
    })),
    tasks: tasks.map((t) => ({
      id: t.id, name: t.title, archivedAt: t.archived_at,
      // Whether the work was ever finished, which is exactly what a status
      // value spelling of "archived" would have destroyed.
      status: t.status,
      spaceId: t.space_id, spaceName: t.space_name,
    })),
  };
}

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
