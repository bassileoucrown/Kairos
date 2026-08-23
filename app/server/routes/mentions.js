const crypto = require('crypto');
const { asyncRouter } = require('../lib/asyncRouter');
const { requireAuth } = require('../lib/auth');
const { requirePaAccess } = require('../lib/paAccess');
const db = require('../lib/db');
const mentions = require('../lib/mentions');
const { sendEmail } = require('../lib/email');
const { limit, clientIp } = require('../lib/rateLimit');
const { resolveAccess, spaceAudience } = require('../lib/spaceAccess');

const router = asyncRouter();

function likeFor(q) {
  return `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
}

function normalizeQuery(raw) {
  return String(raw || '').trim().toLowerCase().replace(/^@+/, '');
}

/**
 * The picker inside a space, where "who can I address" has a narrower answer.
 *
 * Authorised by access to the SPACE, not by PA access to its owner: you can be
 * a member of a space belonging to somebody who is not your principal, and in
 * that thread the people worth naming are the ones in the room with you. The
 * owner-scoped route below would refuse you, correctly and uselessly.
 *
 * PEOPLE are the space's audience. Nobody else, because an @ that reaches
 * outside the room would either notify a person who cannot open the thread or
 * quietly fail to notify anybody. Membership is not a secret within a space —
 * everyone here can already see the member list.
 *
 * CONTACTS are the owner's, and are offered only to someone who may already
 * read them. A member who is not the owner's assistant sees no contact list
 * here; the office's address book is not a side effect of being added to a
 * thread.
 */
router.get('/space/:spaceId/lookup', requireAuth, async (req, res) => {
  const access = await resolveAccess(req.params.spaceId, req.user.id);
  // Same as everywhere else in spaces: invisible and non-existent look alike.
  if (!access) return res.status(404).json({ error: 'Thread not found.' });

  const q = normalizeQuery(req.query.q);
  const like = likeFor(q);
  const audience = [...await spaceAudience(access.space)].filter((id) => id !== req.user.id);

  let people = [];
  if (audience.length > 0) {
    const holes = audience.map(() => '?').join(',');
    people = await db.prepare(`
      SELECT id, name, slug, email FROM users
       WHERE id IN (${holes})
         AND (? = '' OR lower(name) LIKE ? ESCAPE '\\' OR lower(slug) LIKE ? ESCAPE '\\')
       ORDER BY name
       LIMIT 10
    `).all(...audience, q, like, like);
  }

  const mayReadContacts = access.space.owner_id === req.user.id || await db.prepare(
    "SELECT 1 FROM memberships WHERE owner_id = ? AND member_user_id = ? AND status = 'active'",
  ).get(access.space.owner_id, req.user.id);

  const contacts = mayReadContacts ? await db.prepare(`
    SELECT id, name, email, handle FROM contacts
     WHERE owner_id = ?
       AND handle IS NOT NULL
       AND (? = '' OR lower(name) LIKE ? ESCAPE '\\' OR lower(handle) LIKE ? ESCAPE '\\')
     ORDER BY name
     LIMIT 10
  `).all(access.space.owner_id, q, like, like) : [];

  // On the address, never on the handle — a contact's is derived from their
  // name and a user's is whatever they chose, so the two strings differ for
  // one and the same person. Used to suppress the duplicate below and
  // deliberately not returned.
  const addressable = new Set(people.map((p) => String(p.email || '').toLowerCase()));

  res.json({
    people: people.map((p) => ({
      handle: p.slug, name: p.name, kind: 'person', notified: true,
    })),
    // Dropped before mapping, while the address is still there to compare on.
    // Somebody already in the room is offered once, as a person, not a second
    // time as a record about themselves.
    contacts: contacts
      .filter((c) => !addressable.has(String(c.email || '').toLowerCase()))
      .map((c) => ({
        handle: c.handle,
        name: c.name || c.email,
        kind: 'contact',
        notified: false,
        // No invitation offered from inside a thread. Connecting to somebody
        // is an act of the office, and belongs where the office's contacts are
        // managed rather than as a button beside a half-typed sentence.
        canInvite: false,
        contactId: c.id,
      })),
  });
});

/**
 * What the @ picker offers, in two groups, because they are two things.
 *
 * PEOPLE can be told. They have an account and a relationship with the caller
 * already — the same rule handles have always followed, so this list can never
 * become a directory of strangers.
 *
 * CONTACTS cannot. They are records this office keeps, and naming one in a
 * sentence tells nobody anything. The picker says so rather than leaving it to
 * be discovered when nobody turns up.
 */
router.get('/:ownerId/lookup', requireAuth, requirePaAccess, async (req, res) => {
  const q = normalizeQuery(req.query.q);
  const like = likeFor(q);

  // Everyone the caller may address: their principals and the people who
  // support them, plus accepted peer connections.
  const people = await db.prepare(`
    SELECT DISTINCT u.id, u.name, u.slug, u.email
      FROM users u
     WHERE u.id IN (
       SELECT owner_id FROM memberships WHERE member_user_id = ? AND status = 'active'
       UNION SELECT member_user_id FROM memberships WHERE owner_id = ? AND status = 'active'
       UNION SELECT addressee_id FROM connections WHERE requester_id = ? AND status = 'accepted'
       UNION SELECT requester_id FROM connections WHERE addressee_id = ? AND status = 'accepted'
     )
       AND u.id != ?
       AND (? = '' OR lower(u.name) LIKE ? ESCAPE '\\' OR lower(u.slug) LIKE ? ESCAPE '\\')
     ORDER BY u.name
     LIMIT 10
  `).all(req.user.id, req.user.id, req.user.id, req.user.id, req.user.id, q, like, like);

  const contacts = await db.prepare(`
    SELECT id, name, email, handle
      FROM contacts
     WHERE owner_id = ?
       AND handle IS NOT NULL
       AND (? = '' OR lower(name) LIKE ? ESCAPE '\\' OR lower(handle) LIKE ? ESCAPE '\\')
     ORDER BY name
     LIMIT 10
  `).all(req.principal.id, q, like, like);

  // Matched on the address, not the handle.
  //
  // A contact's handle is derived from their name (tunde-bakare) while a
  // user's is whatever they chose at signup (tunde, or t-bakare). Comparing
  // those two strings answers a different question and always said "not
  // connected" — so somebody already reachable was still offered an
  // invitation. The email is the same person in both tables.
  const addressable = new Set(people.map((p) => String(p.email || '').toLowerCase()));

  res.json({
    // The address is used above and deliberately not returned: the picker has
    // no use for it, and a list of addresses is not something to hand out.
    people: people.map((p) => ({
      handle: p.slug, name: p.name, kind: 'person', notified: true,
    })),
    contacts: contacts.map((c) => ({
      handle: c.handle,
      name: c.name || c.email,
      kind: 'contact',
      notified: false,
      // Whether it is worth offering to connect to them. A contact who is
      // already addressable is not — they are in the list above.
      canInvite: !addressable.has(String(c.email || '').toLowerCase()),
      contactId: c.id,
    })),
  });
});

// Sending one of these is an outward act with somebody's address on it, so it
// is limited per caller as well as per address.
const inviteLimiter = limit({
  limit: 20,
  windowMs: 60 * 60 * 1000,
  keys: (req) => [`connect:${req.user.id}`, `connect-ip:${clientIp(req)}`],
  message: 'Too many invitations for one hour. Try again later.',
});

/**
 * Invite a contact to connect.
 *
 * THE ANSWER IS THE SAME WHETHER OR NOT THEY HAVE AN ACCOUNT, and that is the
 * design rather than an accident. Kairos deliberately refuses to confirm
 * whether an address belongs to somebody — it is the whole enumeration attack,
 * and the same reasoning already governs the connection request and the
 * password reset. So this looks the address up, and:
 *
 *   they have an account   -> a connection request they will see in Kairos
 *   they do not            -> an email inviting them to join
 *
 * and says the same sentence back either way. The office gets one button that
 * always does the useful thing, and learns nothing it did not already know.
 */
router.post('/:ownerId/contacts/:contactId/invite', requireAuth, requirePaAccess, inviteLimiter, async (req, res) => {
  const contact = await db.prepare('SELECT * FROM contacts WHERE id = ? AND owner_id = ?')
    .get(req.params.contactId, req.principal.id);
  if (!contact) return res.status(404).json({ error: 'No such contact.' });

  const note = String(req.body?.note || '').trim().slice(0, 280);
  const same = () => res.status(202).json({
    ok: true,
    message: `Invitation sent to ${contact.name || contact.email}.`,
  });

  const person = await db.prepare('SELECT id, name, slug FROM users WHERE email = ?')
    .get(String(contact.email).trim().toLowerCase());

  if (!person || person.id === req.user.id) {
    await sendEmail({
      ownerId: req.principal.id, toEmail: contact.email, category: 'invite',
      subject: `${req.user.name} would like to connect on Kairos`,
      body: `${req.user.name} keeps your details on Kairos and would like to be able to reach you there.`
        + (note ? `\n\n"${note}"` : '')
        + '\n\nKairos is where they keep their diary and arrangements. Join and they can reach you directly: /signup',
    });
    return same();
  }

  const existing = await db.prepare(`
    SELECT * FROM connections
     WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)
  `).get(req.user.id, person.id, person.id, req.user.id);

  if (existing && existing.status === 'accepted') {
    // Safe to say plainly: the caller can already address them, so this
    // confirms nothing they did not know.
    return res.status(409).json({ error: `You are already connected to @${person.slug}.` });
  }
  if (existing && existing.status === 'pending') return same();

  if (existing) {
    await db.prepare("UPDATE connections SET status = 'pending', note = ?, requester_id = ?, addressee_id = ?, created_at = ?, responded_at = NULL WHERE id = ?")
      .run(note, req.user.id, person.id, new Date().toISOString(), existing.id);
  } else {
    await db.prepare(`
      INSERT INTO connections (id, requester_id, addressee_id, status, note, created_at)
      VALUES (?, ?, ?, 'pending', ?, ?)
    `).run(crypto.randomUUID(), req.user.id, person.id, note, new Date().toISOString());
  }

  await sendEmail({
    ownerId: req.principal.id, toEmail: contact.email, category: 'invite',
    subject: `${req.user.name} would like to connect on Kairos`,
    body: `${req.user.name} would like to be able to reach you on Kairos.`
      + (note ? `\n\n"${note}"` : '')
      + '\n\nAccept or decline it from your Connections screen.',
  });

  return same();
});

module.exports = router;
