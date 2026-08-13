const db = require('./db');
const { ASSISTANT_ROLES } = require('./roles');

// The household: a driver, a cook, a housekeeper, a nanny.
//
// Deliberately not a role on `memberships`. `requirePaAccess` grants on any
// active membership whatever the role, and five other queries do the same, so
// a household role added to that table would have handed a cook the approval
// queue, contacts, briefs and the ordinary tier of the essentials vault at six
// call sites at once — none of which would have looked wrong in review. A
// separate table means no existing query can include them by accident. The
// same reasoning as private spaces: structural, rather than a flag somebody
// could flip later without noticing what it touched.
//
// `job_title` is free text and carries no access whatever. A driver and a chef
// see exactly the same thing: what was addressed to them.

/** Suggestions only — the field accepts anything, because households differ. */
const COMMON_TITLES = [
  'Driver', 'Chef', 'Housekeeper', 'Nanny', 'Estate Manager',
  'Security', 'Gardener', 'Butler', 'Personal Trainer',
];

const FULL_ACCESS_ROLES = new Set(
  Object.entries(ASSISTANT_ROLES).filter(([, r]) => r.fullAccess).map(([id]) => id),
);

/**
 * Who may run the roster: the principal, and nobody else.
 *
 * Hiring and dismissing household staff is the same kind of act as appointing
 * an assistant, which is already owner-only — it decides who is inside the
 * house, not who is on the calendar.
 */
async function requireHouseholdOwner(req, res, next) {
  const owner = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.ownerId);
  if (!owner) return res.status(404).json({ error: 'Principal not found.' });
  if (owner.id !== req.user.id) {
    return res.status(403).json({ error: 'Only the principal can change their household.' });
  }
  req.principal = owner;
  next();
}

/**
 * Who may give an instruction: the principal and their full-access assistants.
 *
 * Not a `delegate`. That remit is scheduling, and it was made narrow on
 * purpose — telling the driver where to be at seven is running the household,
 * not filling a diary slot.
 */
async function requireHouseholdInstruct(req, res, next) {
  const owner = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.ownerId);
  if (!owner) return res.status(404).json({ error: 'Principal not found.' });

  if (owner.id === req.user.id) {
    req.principal = owner;
    req.householdRole = 'owner';
    return next();
  }

  const membership = await db.prepare(`
    SELECT * FROM memberships
    WHERE owner_id = ? AND member_user_id = ? AND status = 'active'
  `).get(owner.id, req.user.id);

  if (!membership || !FULL_ACCESS_ROLES.has(membership.role)) {
    return res.status(403).json({ error: "You don't have access to this household." });
  }
  req.principal = owner;
  req.householdRole = membership.role;
  next();
}

function serializeMember(m) {
  return {
    id: m.id,
    name: m.name || m.member_name || m.invited_email,
    jobTitle: m.job_title,
    email: m.invited_email,
    status: m.status,
    hasAccount: !!m.member_user_id,
    createdAt: m.created_at,
  };
}

function serializeInstruction(i, extra = {}) {
  return {
    id: i.id,
    body: i.body,
    dueAt: i.due_at,
    status: i.status,
    acknowledgedAt: i.acknowledged_at,
    doneAt: i.done_at,
    createdAt: i.created_at,
    authorName: i.author_name || null,
    memberName: i.member_name || null,
    memberJobTitle: i.job_title || null,
    principalName: i.principal_name || null,
    replyCount: Number(i.reply_count || 0),
    ...extra,
  };
}

/**
 * How many instructions this principal has sent that nobody has confirmed
 * seeing. The number worth putting on Today: an unread instruction to the
 * driver is a missed flight, and it is silent until it is too late.
 */
async function unacknowledgedCount(ownerId) {
  const row = await db.prepare(`
    SELECT COUNT(*) AS n FROM household_instructions
    WHERE owner_id = ? AND status = 'open'
  `).get(ownerId);
  return Number(row?.n || 0);
}

/** Whether this user is household staff anywhere — drives their landing page. */
async function isHouseholdStaff(userId) {
  const row = await db.prepare(`
    SELECT 1 FROM household_members WHERE member_user_id = ? AND status = 'active' LIMIT 1
  `).get(userId);
  return !!row;
}

module.exports = {
  COMMON_TITLES,
  requireHouseholdOwner,
  requireHouseholdInstruct,
  serializeMember,
  serializeInstruction,
  unacknowledgedCount,
  isHouseholdStaff,
};
