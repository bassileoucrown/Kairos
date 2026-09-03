const db = require('./db');

// A person's handle.
//
// This is the existing `slug` column, promoted from "the last part of your
// booking URL" to "what you are called here". Same value, different standing:
// a principal is @ada, and their booking page happens to live at
// /book/@ada — not the other way round.
//
// Deliberately NOT a global directory. Kairos is built on compartments —
// drafts invisible to the principal, spaces that return 404 rather than 403 —
// and a handle that resolves for anyone would quietly undo that. A handle
// only means something inside a relationship that already exists; look one up
// that you have no connection to and you get nothing back, indistinguishable
// from a typo. Establishing a new relationship still goes through an email
// invitation, because that is an act and should feel like one.

const HANDLE_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

// Names nobody may claim: the app's own paths, the ones people would
// impersonate, and the ones we may want later. Cheaper to reserve now than to
// take back from someone who has printed it on a card.
const RESERVED = new Set([
  'admin', 'administrator', 'root', 'superuser', 'owner', 'system',
  'kairos', 'exousia', 'support', 'help', 'security', 'billing', 'legal',
  'api', 'app', 'www', 'mail', 'email', 'static', 'assets', 'public',
  'book', 'booking', 'bookings', 'login', 'logout', 'signup', 'signin',
  'today', 'itinerary', 'workspace', 'spaces', 'projects', 'tasks',
  'dashboard', 'settings', 'profile', 'account', 'accounts', 'team',
  'invite', 'invites', 'accept-invite', 'reset-password', 'forgot-password',
  'threads', 'members', 'essentials', 'pa', 'ea', 'me', 'you', 'null',
  'undefined', 'true', 'false', 'new', 'edit', 'delete',
]);

// A handle nobody chose, held only until they do.
//
// WHY AN ACCOUNT NEEDS ONE AT ALL. `users.slug` is NOT NULL UNIQUE, and it is
// read from the booking path, the mention resolver and half a dozen screens.
// An account has to have something in the column from the moment it exists.
//
// WHY IT IS NOT DERIVED FROM THEIR NAME ANY MORE. It used to be: sign up as
// Adaeze Okonkwo and the app took @adaeze-okonkwo for you, wrote it into
// handle_history, and offered it back on the profile screen as a suggestion.
// Two things were wrong with that. A handle held once is held FOR GOOD — see
// below — so a name nobody had chosen was being spent permanently on their
// behalf, and if they then picked @ada the first one was burnt for everybody,
// forever. And a pre-filled field is a decision already made: people accept
// what is in the box, which is exactly what this one should not be.
//
// SO IT IS DELIBERATELY NOT A NAME. `new-` and eight hex characters: unique,
// obviously provisional, and rejected by handleProblem below so that nobody —
// including whoever is carrying it — can ever claim it as their own. It is
// never written to handle_history, so it costs the namespace nothing.
const PROVISIONAL_RE = /^new-[0-9a-f]{8}$/;

function isProvisional(handle) {
  return PROVISIONAL_RE.test(String(handle || ''));
}

function provisionalHandle() {
  return `new-${require('crypto').randomBytes(4).toString('hex')}`;
}

/** Accepts "@ada", "ada", " @Ada " — all the ways someone might type one. */
function normalizeHandle(input) {
  return String(input || '').trim().replace(/^@+/, '').toLowerCase();
}

/**
 * Why a handle is unacceptable, or null if it is fine. Returns prose, since
 * every caller shows it to a person.
 */
function handleProblem(handle) {
  if (!handle) return 'Choose a handle.';
  if (handle.length < 3) return 'A handle needs at least 3 characters.';
  if (handle.length > 40) return 'A handle can be at most 40 characters.';
  if (!HANDLE_RE.test(handle)) {
    return 'Use letters, numbers and hyphens only, starting and ending with a letter or number.';
  }
  if (RESERVED.has(handle)) return 'That handle is reserved.';
  // The shape an unchosen account is carrying. Refused to everybody, including
  // the person currently holding one — which is what makes it provisional
  // rather than a default they could keep by never touching the field.
  if (isProvisional(handle)) return 'That handle is reserved.';
  return null;
}

/**
 * A HANDLE IS KEPT, NOT RENTED.
 *
 * Changing your handle used to break your own past. Every @you already written
 * — in a thread, a brief, an instruction — is stored as the text somebody
 * typed, and resolved when the page is drawn. So the moment the handle moved,
 * a year of messages stopped pointing at anybody: the words survived, but the
 * person in them became inert grey text, and nobody could be reached from the
 * conversation where they were named.
 *
 * Rewriting old message bodies on a rename was the obvious fix and the wrong
 * one — it edits what people wrote, including records that are supposed to be
 * frozen. So the handle is what moves and the history is what stays: every
 * handle anybody has ever held is written down here, and a mention that finds
 * no live holder asks this table who it used to mean.
 *
 * IT ALSO STOPS THE WORSE THING. Without a record of who held what, a released
 * handle is free for the taking — and whoever took @ada would silently inherit
 * every @ada written about somebody else, in offices they have never seen.
 * A handle held once is held for good: `claimHandle` refuses it to anybody
 * else, forever, and the only person who can take it back is the one who had
 * it. That is a small cost — one word out of forty characters' worth of
 * possibilities — against somebody's history quietly changing hands.
 */
async function rememberHandle(userId, handle) {
  const held = await db.prepare('SELECT id FROM handle_history WHERE handle = ? AND user_id = ?')
    .get(handle, userId);
  if (held) return;
  await db.prepare('INSERT INTO handle_history (id, user_id, handle, held_at) VALUES (?, ?, ?, ?)')
    .run(require('crypto').randomUUID(), userId, handle, new Date().toISOString());
}

/** Who has ever held this handle, live or not. Null if nobody ever has. */
async function everHeldBy(handle) {
  const live = await db.prepare('SELECT id FROM users WHERE slug = ?').get(handle);
  if (live) return live.id;
  const past = await db.prepare(
    'SELECT user_id FROM handle_history WHERE handle = ? ORDER BY held_at DESC LIMIT 1',
  ).get(handle);
  return past?.user_id || null;
}

/**
 * Take a handle for somebody, or say why not. Prose, because callers show it.
 *
 * The one place a handle is ever assigned — signup and the profile screen both
 * come through here, so the history cannot be written by one path and skipped
 * by the other.
 */
async function claimHandle(userId, rawHandle) {
  const handle = normalizeHandle(rawHandle);
  const problem = handleProblem(handle);
  if (problem) return { problem };
  const owner = await everHeldBy(handle);
  if (owner && owner !== userId) {
    // Deliberately the same sentence whether they hold it now or held it in
    // 2023. "Somebody used to have that" is a fact about a stranger's account,
    // and this app does not confirm those.
    return { problem: 'That handle is already taken.' };
  }
  await rememberHandle(userId, handle);
  return { handle };
}

/**
 * Resolve a handle to a person the caller already has a relationship with.
 *
 * Returns null for a handle that exists but is a stranger, exactly as for one
 * that does not exist at all — so this can never be used to test whether
 * somebody is on Kairos.
 */
async function resolveVisibleHandle(viewerId, rawHandle) {
  const handle = normalizeHandle(rawHandle);
  if (handleProblem(handle)) return null;

  let person = await db.prepare('SELECT id, name, slug, account_category FROM users WHERE slug = ?')
    .get(handle);
  // Nobody holds it now — so it is either a typo or somebody's old name. The
  // relationship check below is unchanged either way: an old handle opens no
  // door a current one would not have opened.
  if (!person) {
    const past = await db.prepare(`
      SELECT u.id, u.name, u.slug, u.account_category
      FROM handle_history h JOIN users u ON u.id = h.user_id
      WHERE h.handle = ? ORDER BY h.held_at DESC LIMIT 1
    `).get(handle);
    person = past || null;
  }
  if (!person) return null;
  if (person.id === viewerId) return person;

  // Connected if either supports the other, they share a space, or they have
  // accepted a peer connection. The last one is the only route to a handle
  // resolving for someone outside your own principal's orbit, and it took
  // both of them agreeing to it.
  const related = await db.prepare(`
    SELECT 1 FROM memberships
     WHERE status = 'active'
       AND ((owner_id = ? AND member_user_id = ?) OR (owner_id = ? AND member_user_id = ?))
    UNION ALL
    SELECT 1 FROM space_members a
      JOIN space_members b ON a.space_id = b.space_id
     WHERE a.user_id = ? AND b.user_id = ?
    UNION ALL
    SELECT 1 FROM connections
     WHERE status = 'accepted'
       AND ((requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?))
    LIMIT 1
  `).get(
    viewerId, person.id, person.id, viewerId,
    viewerId, person.id,
    viewerId, person.id, person.id, viewerId,
  );

  return related ? person : null;
}

module.exports = {
  normalizeHandle, handleProblem, resolveVisibleHandle,
  claimHandle, rememberHandle, everHeldBy, RESERVED,
  isProvisional, provisionalHandle,
};
