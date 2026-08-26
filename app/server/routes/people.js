const crypto = require('crypto');
const { asyncRouter } = require('../lib/asyncRouter');
const db = require('../lib/db');
const { requireAuth } = require('../lib/auth');
const reachable = require('../lib/reachable');
const { pairLine } = require('../lib/pairLine');

/**
 * Clicking somebody's name.
 *
 * WHAT WAS MISSING. Names were everywhere in Kairos — on every message, every
 * note, every task — and none of them did anything. A principal reading "Ngozi
 * Bello" above a line about the Thursday dinner had no way to say a word back
 * to Ngozi without leaving the page, finding the right room, and hoping she was
 * in it. The name is where the intention starts, so it is where the verbs
 * belong.
 *
 * WHAT THIS ANSWERS, AND WHAT IT WILL NOT. A name is not an excuse to hand out
 * a directory. This returns what somebody already had in front of them — the
 * name they just read and the handle they could already @ — plus the state of
 * their own working relationship with that person, which is theirs to know. It
 * does NOT return an email address, a phone number, or anything from anybody's
 * vault, and it answers about a stranger with the same 404 a missing account
 * gets: whether a given person holds a Kairos account is not a fact this
 * endpoint will confirm to somebody with no connection to them.
 *
 * REACHABILITY IS THE GATE, through lib/reachable.js — the same function that
 * decides who fills the mention picker and who a pad note may be handed to.
 * That is deliberate: three answers to "who can I reach" would drift, and this
 * codebase has been bitten by that shape three times already.
 */
const router = asyncRouter();
router.use(requireAuth);

async function loadPerson(req, res, next) {
  if (req.params.userId === req.user.id) {
    // Your own name is not a menu. Refused plainly rather than returned with
    // every verb pointing at yourself.
    return res.status(400).json({ error: 'That is you.' });
  }
  if (!await reachable.canReach(req.user.id, req.params.userId)) {
    return res.status(404).json({ error: 'No such person.' });
  }
  const row = await db.prepare('SELECT id, name, slug, account_category FROM users WHERE id = ?')
    .get(req.params.userId);
  if (!row) return res.status(404).json({ error: 'No such person.' });
  req.person = row;
  next();
}

/**
 * How the two of you are connected, in the words the office would use.
 *
 * A principal wants to know what an assistant may do on their behalf — that is
 * the question they have been asking since the day they added them — and an
 * assistant wants to know whose diary they are looking at. Both are read from
 * the memberships table rather than guessed from account_category, because the
 * title somebody chose at signup is not the same fact as what they were granted.
 */
async function standing(viewerId, personId) {
  const theyWorkForMe = await db.prepare(`
    SELECT role, can_manage_scheduling FROM memberships
     WHERE owner_id = ? AND member_user_id = ? AND status = 'active' LIMIT 1
  `).get(viewerId, personId);
  if (theyWorkForMe) {
    return {
      relation: 'assistant',
      role: theyWorkForMe.role,
      // The remit, said plainly. A delegate handling scheduling only must not
      // be drawn the same way as a chief of staff, and the principal is the
      // person who needs that distinction in front of them.
      canManageScheduling: !!theyWorkForMe.can_manage_scheduling,
    };
  }

  const iWorkForThem = await db.prepare(`
    SELECT role FROM memberships
     WHERE owner_id = ? AND member_user_id = ? AND status = 'active' LIMIT 1
  `).get(personId, viewerId);
  if (iWorkForThem) return { relation: 'principal', role: iWorkForThem.role };

  const sameOffice = await db.prepare(`
    SELECT 1 AS ok FROM memberships m1
      JOIN memberships m2 ON m2.owner_id = m1.owner_id
     WHERE m1.member_user_id = ? AND m1.status = 'active'
       AND m2.member_user_id = ? AND m2.status = 'active'
     LIMIT 1
  `).get(viewerId, personId);
  if (sameOffice) return { relation: 'colleague' };

  return { relation: 'connection' };
}

/**
 * The card behind a name.
 *
 * Includes what is OUTSTANDING between the two of you, which is the thing an
 * office actually wants when it clicks a name: not a profile, but "where are we
 * with this person". Counted rather than listed — the numbers are the glance,
 * and the lists already have screens of their own.
 */
router.get('/:userId', loadPerson, async (req, res) => {
  const me = req.user.id;
  const them = req.person.id;

  const owed = await db.prepare(`
    SELECT COUNT(*) AS n FROM pad_items
     WHERE state = 'open' AND author_user_id = ? AND assignee_id = ?
  `).get(me, them);
  const owing = await db.prepare(`
    SELECT COUNT(*) AS n FROM pad_items
     WHERE state = 'open' AND author_user_id = ? AND assignee_id = ?
  `).get(them, me);
  // Only tasks in a space the viewer can actually see. A count that included a
  // space they have no access to would leak the existence of work in it.
  const theirTasks = await db.prepare(`
    SELECT COUNT(*) AS n FROM tasks t
     WHERE t.assignee_id = ? AND t.status != 'done'
       AND EXISTS (
         SELECT 1 FROM space_members sm WHERE sm.space_id = t.space_id AND sm.user_id = ?
       )
  `).get(them, me);

  const line = await pairLine(me, them, { create: false });

  res.json({
    person: {
      id: req.person.id,
      name: req.person.name,
      handle: req.person.slug,
      ...await standing(me, them),
    },
    between: {
      // Lines you handed them that are still open.
      youHandedThem: Number(owed?.n || 0),
      // Lines they handed you that are still open.
      theyHandedYou: Number(owing?.n || 0),
      // Live tasks of theirs, in rooms you can see.
      theirOpenTasks: Number(theirTasks?.n || 0),
    },
    // Null until somebody opens one; see lib/pairLine.js for why a room is not
    // created merely by looking at a name.
    directThreadId: line?.threadId || null,
  });
});

/**
 * The room for the two of you, made on demand.
 *
 * A POST, and that is the point: reading a card must not create anything. A
 * GET that quietly minted a room would give every principal an empty
 * conversation with everyone they have ever glanced at.
 */
router.post('/:userId/direct', loadPerson, async (req, res) => {
  const line = await pairLine(req.user.id, req.person.id, { create: true });
  if (!line) return res.status(500).json({ error: 'That room could not be opened.' });
  res.status(201).json({ threadId: line.threadId, spaceId: line.spaceId });
});

/**
 * Hand them something, from wherever their name was.
 *
 * The pad already has this verb; what it did not have was a way to reach it
 * from the moment you think of it. "Ngozi — chase the visa people" is a thought
 * that happens while reading a message from Ngozi, and making somebody navigate
 * to the pad, write it, then find her in a dropdown is how it ends up not
 * written at all.
 *
 * Deliberately thin: it composes pad.add and the same reachability check the
 * pad's own hand route uses, rather than reimplementing either.
 */
router.post('/:userId/hand', loadPerson, async (req, res) => {
  const pad = require('../lib/pad');
  const body = String(req.body?.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Write something first.' });

  const result = await pad.add({
    authorUserId: req.user.id,
    ownerId: req.body?.ownerId || req.user.id,
    body,
    // Private plus an assignee: the two of you, and nobody else. Handing
    // somebody a line is not the same as putting it on the office pad, and
    // defaulting to the wider of the two would be the wrong way round.
    visibility: 'private',
    assigneeId: req.person.id,
  });
  if (!result.ok) return res.status(result.status).json({ error: result.error });

  await pad.knock({
    toUserId: req.person.id,
    ownerId: result.item.ownerId,
    author: req.user,
    subject: `${req.user.name} handed you something`,
    line: 'has passed you a note on the pad.',
  });
  await pad.tell({ item: result.item, author: req.user, ownerId: result.item.ownerId });

  res.status(201).json({ item: result.item });
});

module.exports = router;
