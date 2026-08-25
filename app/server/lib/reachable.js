const db = require('./db');

/**
 * Who you can reach, asked once.
 *
 * WHY THIS EXISTS. "Who may I address" and "who may I hand something to" were
 * two different queries in two files, and they disagreed. The picker offered
 * everybody you support, everybody who supports you, AND your accepted peer
 * connections; the check behind handing a note looked only at memberships. So
 * a peer you had deliberately connected with appeared in the list and was
 * refused the moment you chose them — the product offering something and then
 * denying it, which reads as broken because it is.
 *
 * Two queries answering one question will always drift. This is the question,
 * written once. Anything that offers a person and anything that acts on that
 * choice must both come through here, or the same bug grows back.
 */

// The ways two accounts are joined in Kairos. Kept as one SQL fragment rather
// than several calls: it is used as a subquery for listing and as an existence
// check for permission, and those must be the same set.
//
// THE FOURTH CLAUSE IS EASY TO FORGET AND WAS. Two assistants who work for the
// same principal are colleagues — they cover the same diary, and the direct
// line already puts them in one room precisely because "two assistants
// covering the same principal need to see each other's traffic". Without this
// they could not @ each other or hand each other a note, which is nonsense for
// two people on the same team. The pad's own hand-check used to carry this
// clause and lost it when the query moved here; the test that caught it is
// broom.js, asking whether one assistant is offered the other.
const REACHABLE_IDS = `
  SELECT owner_id AS id FROM memberships WHERE member_user_id = ? AND status = 'active'
  UNION SELECT member_user_id FROM memberships WHERE owner_id = ? AND status = 'active'
  UNION SELECT m2.member_user_id
    FROM memberships m1
    JOIN memberships m2 ON m2.owner_id = m1.owner_id
   WHERE m1.member_user_id = ? AND m1.status = 'active'
     AND m2.status = 'active' AND m2.member_user_id IS NOT NULL
  UNION SELECT addressee_id FROM connections WHERE requester_id = ? AND status = 'accepted'
  UNION SELECT requester_id FROM connections WHERE addressee_id = ? AND status = 'accepted'
`;

/** Params for REACHABLE_IDS — the same id, once per clause, in one place. */
const idsParams = (userId) => [userId, userId, userId, userId, userId];

/** Can these two act on each other at all? */
async function canReach(userId, otherId) {
  if (!userId || !otherId || userId === otherId) return false;
  const row = await db.prepare(`
    SELECT 1 AS ok FROM (${REACHABLE_IDS}) r WHERE r.id = ? LIMIT 1
  `).get(...idsParams(userId), otherId);
  return !!row;
}

/**
 * People who have been asked to work with you and have not answered.
 *
 * NOT reachable — an invitation is not a relationship, and until it is
 * accepted there is no link between the two accounts at all. They are
 * returned so a screen can SAY that, which is the whole point: "Nobody shares
 * an office with you yet" is a lie when three people are sitting on an
 * invitation, and it is the lie that sends somebody hunting for a bug in the
 * wrong place.
 */
async function pendingWith(userId, email) {
  const mine = await db.prepare(`
    SELECT u.id, u.name, m.invited_email
      FROM memberships m
      LEFT JOIN users u ON lower(u.email) = lower(m.invited_email)
     WHERE m.owner_id = ? AND m.status = 'invited'
     ORDER BY m.created_at DESC
  `).all(userId);

  const theirs = await db.prepare(`
    SELECT u.id, u.name
      FROM memberships m
      JOIN users u ON u.id = m.owner_id
     WHERE lower(m.invited_email) = ? AND m.status = 'invited'
     ORDER BY m.created_at DESC
  `).all(String(email || '').toLowerCase());

  return [
    ...mine.map((p) => ({
      id: p.id || null,
      name: p.name || p.invited_email,
      // Which way the asking went, because the thing to do about it differs:
      // one you can chase, the other you can accept.
      direction: 'you-asked-them',
    })),
    ...theirs.map((p) => ({ id: p.id, name: p.name, direction: 'they-asked-you' })),
  ];
}

module.exports = { canReach, pendingWith, REACHABLE_IDS, idsParams };
