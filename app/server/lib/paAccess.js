const db = require('./db');

// A PA route is scoped to a principal (:ownerId in the URL). Access is
// granted to the principal themselves (self-service — a solo user can use
// their own Approval Queue without ever inviting anyone) or to a user with
// an active 'pa'/'delegate' membership on that principal's account.
async function requirePaAccess(req, res, next) {
  const ownerId = req.params.ownerId;
  const owner = await db.prepare('SELECT * FROM users WHERE id = ?').get(ownerId);
  if (!owner) return res.status(404).json({ error: 'Principal not found.' });

  if (ownerId === req.user.id) {
    req.principal = owner;
    req.paRole = 'owner';
    req.membership = null;
    return next();
  }

  const membership = await db.prepare(`
    SELECT * FROM memberships WHERE owner_id = ? AND member_user_id = ? AND status = 'active'
  `).get(ownerId, req.user.id);
  if (!membership) {
    return res.status(403).json({ error: "You don't have PA access to this account." });
  }
  req.principal = owner;
  req.paRole = membership.role;
  req.membership = membership;
  next();
}

/**
 * Extra gate for the principal's *bookable hours and meeting types* — who can
 * reach them, and when.
 *
 * On by default for every assistant, because this is the most PA-shaped job in
 * the product: approving a Tier 3 booking while being unable to set the hours
 * that produced the slot makes no sense. But some principals treat their own
 * hours as personal, so it can be revoked per assistant from Members.
 *
 * Deliberately narrower than "can act as PA": profile, members, and
 * integrations stay owner-only whatever this says, since those are identity
 * and access rather than scheduling.
 */
function requireSchedulingAccess(req, res, next) {
  if (req.paRole === 'owner') return next();
  if (!req.membership?.can_manage_scheduling) {
    return res.status(403).json({
      error: `${req.principal.name} hasn't given you access to their availability and meeting types.`,
    });
  }
  next();
}

/**
 * Everyone in a principal's office, as a set of user ids.
 *
 * The office is the principal plus their active assistants — exactly the set
 * requirePaAccess admits, gathered rather than tested one at a time. Briefs and
 * instructions belong to an office rather than to a space, so this is the
 * audience an @ in one of them can reach: naming somebody outside it would
 * promise to tell a person who cannot open the thing they were named in.
 *
 * The space equivalent lives in spaceAccess.spaceAudience. Two functions
 * because they are two different rooms, not one rule spelled twice — a space
 * has members of its own, and an office does not.
 */
async function officeAudience(ownerId) {
  const rows = await db.prepare(`
    SELECT member_user_id AS id FROM memberships
     WHERE owner_id = ? AND status = 'active' AND member_user_id IS NOT NULL
  `).all(ownerId);
  return new Set([ownerId, ...rows.map((r) => r.id)]);
}

module.exports = { requirePaAccess, requireSchedulingAccess, officeAudience };
