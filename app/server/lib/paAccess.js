const db = require('./db');

// A PA route is scoped to a principal (:ownerId in the URL). Access is
// granted to the principal themselves (self-service — a solo user can use
// their own Approval Queue without ever inviting anyone) or to a user with
// an active 'pa'/'delegate' membership on that principal's account.
function requirePaAccess(req, res, next) {
  const ownerId = req.params.ownerId;
  const owner = db.prepare('SELECT * FROM users WHERE id = ?').get(ownerId);
  if (!owner) return res.status(404).json({ error: 'Principal not found.' });

  if (ownerId === req.user.id) {
    req.principal = owner;
    req.paRole = 'owner';
    return next();
  }

  const membership = db.prepare(`
    SELECT * FROM memberships WHERE owner_id = ? AND member_user_id = ? AND status = 'active'
  `).get(ownerId, req.user.id);
  if (!membership) {
    return res.status(403).json({ error: "You don't have PA access to this account." });
  }
  req.principal = owner;
  req.paRole = membership.role;
  next();
}

module.exports = { requirePaAccess };
