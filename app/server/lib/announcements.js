const db = require('./db');
const { isHouseholdStaff } = require('./household');
const { knock } = require('./knock');

// Who may write to everyone.
//
// Read from the environment, not from a column. There is deliberately no way
// to grant yourself this from inside the app and nothing in the database to
// flip — the same reasoning as ENCRYPTION_KEY living outside the data it
// protects. Unset means nobody can post, and the app says so rather than
// pretending the feature is there.
const AUTHORS = new Set(
  String(process.env.ANNOUNCEMENT_AUTHORS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
);

const AUDIENCES = {
  everyone: 'Everyone',
  assistants: 'Assistants only',
  principals: 'Principals only',
  household: 'Household staff only',
};

const ASSISTANT_CATEGORIES = new Set(['pa', 'ea', 'chief_of_staff']);

function canPublish(user) {
  return !!user && AUTHORS.has(String(user.email || '').toLowerCase());
}

function isConfigured() {
  return AUTHORS.size > 0;
}

/**
 * Which audiences this person is in.
 *
 * Aimed rather than blasted. A notice for assistants is the thing a PA
 * actually wanted out of a community, and a principal does not need to read
 * it — so a channel nobody can mute stays worth reading.
 */
async function audiencesFor(user) {
  const list = ['everyone'];
  if (ASSISTANT_CATEGORIES.has(user.account_category)) list.push('assistants');
  if (user.account_category === 'principal') list.push('principals');
  if (await isHouseholdStaff(user.id)) list.push('household');
  return list;
}

function serialize(a, { read = false, isAuthor = false } = {}) {
  return {
    id: a.id,
    title: a.title,
    body: a.body,
    audience: a.audience,
    audienceLabel: AUDIENCES[a.audience] || a.audience,
    publishedAt: a.published_at,
    createdAt: a.created_at,
    authorName: a.author_name || null,
    read,
    // Only ever to the author. How many inboxes a notice reached is an
    // operational fact about the deployment, not something a reader of it has
    // any business being told.
    ...(isAuthor ? {
      readCount: Number(a.read_count || 0),
      announcedAt: a.announced_at || null,
      announcedCount: a.announced_count === null || a.announced_count === undefined
        ? null : Number(a.announced_count),
    } : {}),
  };
}

/** Published notices this person is meant to see, newest first. */
async function listFor(user) {
  const audiences = await audiencesFor(user);
  const placeholders = audiences.map(() => '?').join(',');

  const rows = await db.prepare(`
    SELECT a.*, u.name AS author_name,
      (SELECT COUNT(*) FROM announcement_reads r
        WHERE r.announcement_id = a.id AND r.user_id = ?) AS read_by_me
    FROM announcements a
    JOIN users u ON u.id = a.author_id
    WHERE a.published_at IS NOT NULL AND a.audience IN (${placeholders})
    ORDER BY a.published_at DESC
    LIMIT 50
  `).all(user.id, ...audiences);

  return rows.map((a) => serialize(a, { read: Number(a.read_by_me) > 0 }));
}

/** The nav badge. Counting is cheap; making people hunt for what is new is not. */
async function unreadCount(user) {
  const audiences = await audiencesFor(user);
  const placeholders = audiences.map(() => '?').join(',');
  const row = await db.prepare(`
    SELECT COUNT(*) AS n FROM announcements a
    WHERE a.published_at IS NOT NULL AND a.audience IN (${placeholders})
      AND NOT EXISTS (
        SELECT 1 FROM announcement_reads r
        WHERE r.announcement_id = a.id AND r.user_id = ?
      )
  `).get(...audiences, user.id);
  return Number(row?.n || 0);
}

// ---------------------------------------------------------------------------
// Telling people a notice exists
// ---------------------------------------------------------------------------
//
// A published notice used to wait on a screen until somebody happened to open
// Kairos and notice the badge. That is the right behaviour for a channel
// nobody can mute — and the wrong behaviour for the one notice that actually
// matters, which is always the one nobody has read yet.
//
// So publishing knocks, through lib/knock.js like every other knock in the
// product: an email and, for anybody whose phone has granted permission, a
// push. Not a third implementation of the same idea.
//
// IT IS THE SAME AUDIENCE, ASKED THE OTHER WAY ROUND. audiencesFor answers
// "which feeds is this person in"; this answers "who is in this feed". Both
// read the same four rules, and they have to agree — a notice that knocks
// somebody who cannot then find it on the screen is worse than one that knocks
// nobody. bnotice holds them to each other.
const AUDIENCE_MEMBERS = {
  everyone: '1 = 1',
  assistants: "u.account_category IN ('pa', 'ea', 'chief_of_staff')",
  principals: "u.account_category = 'principal'",
  household: "EXISTS (SELECT 1 FROM household_members hm"
    + " WHERE hm.member_user_id = u.id AND hm.status = 'active')",
};

/** Everybody a notice for this audience is meant to reach. */
async function recipientsFor(audience) {
  const rule = AUDIENCE_MEMBERS[audience] || AUDIENCE_MEMBERS.everyone;
  return await db.prepare(`SELECT u.id FROM users u WHERE ${rule}`).all();
}

/**
 * The first part of the notice, flattened onto one line.
 *
 * A push shows a title and a line, and "you have a new notice" wastes the
 * line — the reader already knows that from the fact their phone buzzed. The
 * opening words of the thing itself are what let somebody decide on a lock
 * screen whether this needs them now.
 */
function excerpt(body, max = 180) {
  const flat = String(body || '').replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 1).replace(/\s+\S*$/, '')}…`;
}

/**
 * Knock everybody the notice is aimed at. Returns how many were reached.
 *
 * THE AUTHOR IS NOT KNOCKED. knock() skips a person knocking on themselves,
 * but only when an author is passed — and no author is passed here, because a
 * notice comes from Kairos rather than from whoever happened to type it. So
 * the skip is done here instead.
 *
 * ONE AT A TIME, IN THE REQUEST. That is the same shape as the trip builder
 * telling a household, and it is fine at the scale this is for. It is not fine
 * at a few thousand recipients: each one is an HTTPS call to the mail provider
 * and another to the push service, and the publish request would outlive its
 * own timeout. When that day comes this loop becomes a queue; it is written in
 * one place so that is one change.
 *
 * knock() never throws, so one bad address cannot stop the rest.
 */
async function announce(row) {
  const people = (await recipientsFor(row.audience))
    .filter((p) => p.id !== row.author_id);

  for (const p of people) {
    await knock({
      toUserId: p.id,
      // No principal owns a broadcast. The emails row is filed against the
      // deployment rather than somebody's desk, which is what it is.
      ownerId: null,
      author: null,
      subject: row.title,
      line: excerpt(row.body),
      url: '/notices',
      // Its own category so the Outbox can tell a broadcast from the
      // transactional mail it sits beside.
      category: 'notice',
      // One line per notice. Publishing a correction should replace the
      // notification on the phone, not stack a second one under it.
      tag: `announcement-${row.id}`,
      cta: 'Open Kairos to read it.',
    });
  }
  return people.length;
}

module.exports = {
  AUDIENCES, canPublish, isConfigured, audiencesFor, listFor, unreadCount, serialize,
  recipientsFor, announce, excerpt,
};
