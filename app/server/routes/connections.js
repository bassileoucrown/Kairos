const { asyncRouter } = require('../lib/asyncRouter');
const { requirePlan } = require('../lib/plans');
const crypto = require('crypto');
const db = require('../lib/db');
const { BRAND_FULL } = require('../lib/brand');
const { requireAuth } = require('../lib/auth');
const { sendEmail } = require('../lib/email');
const { limit, clientIp } = require('../lib/rateLimit');
const { normalizeHandle, handleProblem } = require('../lib/handles');
const {
  findBetween, ensurePeerLine, closePeerLine, listConnections, serialize,
} = require('../lib/connections');

const router = asyncRouter();
router.use(requireAuth);

// There is no search and no directory, so a request costs an exact handle —
// which people hand out in email signatures. The limit is what stops that
// being turned into an enumeration tool anyway: sixty guesses an hour is
// plenty for a person typing a colleague's name and useless for a script
// walking the alphabet.
const requestLimiter = limit({
  limit: 20,
  windowMs: 60 * 60 * 1000,
  keys: (req) => [`conn:${req.user.id}`, `conn-ip:${clientIp(req)}`],
  message: 'Too many connection requests. Try again later.',
});

router.get('/', async (req, res) => {
  res.json(await listConnections(req.user.id));
});

// A HARDER LIMIT THAN A REQUEST, deliberately. A request costs the sender
// something — the other person sees it and can decline — so twenty an hour is
// self-limiting. A lookup costs nothing and returns a fact, which is exactly
// the shape somebody automates. Thirty an hour is generous for a person
// typing a colleague's name from a signature and useless for walking a list.
const lookupLimiter = limit({
  limit: 30,
  windowMs: 60 * 60 * 1000,
  keys: (req) => [`look:${req.user.id}`, `look-ip:${clientIp(req)}`],
  message: 'Too many lookups. Try again later.',
});

/**
 * Who is behind an exact handle, for somebody not yet connected to them.
 *
 * THIS IS A DELIBERATE REVERSAL and it is worth saying so plainly, because the
 * rest of this file argues the other way. Requests answer neutrally — "if that
 * handle belongs to someone" — so that nobody can walk the alphabet and learn
 * who is on Kairos, which for a product holding this market's data is itself
 * worth knowing to the wrong person.
 *
 * But carried into lookup, that rule makes connections pointless. You type a
 * colleague's handle, get a shrug, and have no idea whether you mistyped it or
 * whether they are simply not here. Nobody builds a network they cannot see
 * the edge of, and an office that cannot confirm its counterpart is on Kairos
 * goes back to email.
 *
 * THREE THINGS MAKE THE TRADE DEFENSIBLE:
 *
 *   IT IS THE PERSON'S OWN CHOICE. Discoverable is on by default because the
 *   network has to work, and any principal who would rather be invisible turns
 *   it off — after which they answer exactly as a stranger does. The opt-out
 *   is real, not cosmetic.
 *
 *   IT COSTS AN EXACT HANDLE. There is still no search and no directory. You
 *   have to already know what to type.
 *
 *   IT IS RATE LIMITED HARDER THAN SENDING. See above.
 *
 * WHAT COMES BACK IS A NAME AND A HANDLE. Not an email, not a company, not a
 * photograph — enough to answer "is this the right person" and nothing that
 * would make the endpoint worth harvesting for its own sake.
 */
router.get('/lookup', lookupLimiter, async (req, res) => {
  const handle = normalizeHandle(req.query?.handle);
  // Every negative answers identically: malformed, absent, not discoverable,
  // and yourself. Anything else turns the shape of the refusal into the fact
  // the refusal was meant to hide.
  const nobody = () => res.json({ found: false });

  if (handleProblem(handle)) return nobody();
  const person = await db.prepare(
    'SELECT id, name, slug, discoverable FROM users WHERE slug = ?',
  ).get(handle);
  if (!person || !person.discoverable) return nobody();
  if (person.id === req.user.id) {
    return res.json({ found: true, self: true, name: person.name, handle: person.slug });
  }

  // Whether you are already connected, so the screen can say "you already know
  // them" rather than offering to send a request that would be refused.
  const existing = await findBetween(req.user.id, person.id);
  return res.json({
    found: true,
    name: person.name,
    handle: person.slug,
    status: existing ? existing.status : null,
  });
});

router.post('/', requestLimiter, requirePlan('peer_connections'), async (req, res) => {
  const handle = normalizeHandle(req.body?.handle);
  const note = String(req.body?.note || '').trim().slice(0, 280);

  // The neutral answer, used for every outcome that would otherwise reveal
  // whether a handle belongs to somebody. Same reasoning as password reset:
  // the honest-sounding "no such user" is the whole enumeration attack.
  const neutral = () => res.status(202).json({
    ok: true,
    message: 'Request sent. If that handle belongs to someone, they will see it.',
  });

  if (handleProblem(handle)) return neutral();

  const person = await db.prepare('SELECT id, name, email, slug FROM users WHERE slug = ?').get(handle);
  if (!person) return neutral();

  // These three are safe to answer plainly: in every one of them the caller
  // already knows this person exists, so precision leaks nothing and silence
  // would just be confusing.
  if (person.id === req.user.id) {
    return res.status(400).json({ error: 'That is your own handle.' });
  }
  const existing = await findBetween(req.user.id, person.id);
  if (existing && existing.status === 'accepted') {
    return res.status(409).json({ error: `You are already connected to @${person.slug}.` });
  }
  if (existing && existing.status === 'pending') {
    return existing.requester_id === req.user.id
      ? res.status(409).json({ error: 'You have already asked. It is with them.' })
      : res.status(409).json({ error: `@${person.slug} has already asked to connect with you.` });
  }

  const now = new Date().toISOString();
  if (existing) {
    // A previously declined or ended connection can be asked again — people
    // fall out of touch and back into it. Reusing the row keeps the pair
    // unique in either direction.
    await db.prepare(`
      UPDATE connections SET requester_id = ?, addressee_id = ?, status = 'pending',
                             note = ?, created_at = ?, responded_at = NULL
      WHERE id = ?
    `).run(req.user.id, person.id, note, now, existing.id);
  } else {
    await db.prepare(`
      INSERT INTO connections (id, requester_id, addressee_id, status, note, created_at)
      VALUES (?, ?, ?, 'pending', ?, ?)
    `).run(crypto.randomUUID(), req.user.id, person.id, note, now);
  }

  await sendEmail({
    ownerId: person.id, toEmail: person.email, category: 'connection',
    subject: `@${req.user.slug} would like to connect on ${BRAND_FULL}`,
    body: `${req.user.name} (@${req.user.slug}) asked to open a line with you on ${BRAND_FULL}.`
      + `${note ? `\n\nThey said: "${note}"` : ''}`
      + '\n\nA connection lets the two of you talk. It gives them no access to your principal, '
      + 'your calendar or anything else.\n\nSee it: /connections',
  });

  neutral();
});

/** Loads a connection this caller is actually part of, or 404. */
async function loadConnection(req, res, next) {
  const row = await db.prepare(`
    SELECT * FROM connections
    WHERE id = ? AND (requester_id = ? OR addressee_id = ?)
  `).get(req.params.id, req.user.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Connection not found.' });
  req.connection = row;
  next();
}

router.post('/:id/accept', loadConnection, async (req, res) => {
  if (req.connection.addressee_id !== req.user.id) {
    return res.status(403).json({ error: 'Only the person asked can accept.' });
  }
  if (req.connection.status !== 'pending') {
    return res.status(409).json({ error: 'That request is no longer open.' });
  }
  await db.prepare("UPDATE connections SET status = 'accepted', responded_at = ? WHERE id = ?")
    .run(new Date().toISOString(), req.connection.id);
  await ensurePeerLine(req.connection);

  const fresh = await db.prepare('SELECT * FROM connections WHERE id = ?').get(req.connection.id);
  res.json({ connection: await serialize(fresh, req.user.id) });
});

router.post('/:id/decline', loadConnection, async (req, res) => {
  if (req.connection.addressee_id !== req.user.id) {
    return res.status(403).json({ error: 'Only the person asked can decline.' });
  }
  // Declined rather than deleted, so the same person cannot immediately ask
  // again in a loop. The requester gets no notification — the request simply
  // stops being listed. Being told outright that a peer refused you is a
  // sting with no use attached.
  await db.prepare("UPDATE connections SET status = 'declined', responded_at = ? WHERE id = ?")
    .run(new Date().toISOString(), req.connection.id);
  res.status(204).end();
});

// Either side can end it, and it ends for both. Space membership goes with
// it, so the line closes rather than lingering as a room nobody meant to
// leave open.
router.delete('/:id', loadConnection, async (req, res) => {
  await closePeerLine(req.connection);
  await db.prepare("UPDATE connections SET status = 'ended', responded_at = ? WHERE id = ?")
    .run(new Date().toISOString(), req.connection.id);
  res.status(204).end();
});

module.exports = router;
