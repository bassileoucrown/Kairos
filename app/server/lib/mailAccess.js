const crypto = require('crypto');
const db = require('./db');

// What an assistant may do with a principal's correspondence.
//
// ONE GATE, AND EVERY MAIL ROUTE GOES THROUGH IT. The rest of this product has
// taught the same lesson three times over: an access rule written out at each
// call site is a rule with as many versions as call sites, and the one that
// drifts is the one nobody looks at. Mail is the worst place for that to
// happen, so there is exactly one function that answers the question and every
// route asks it.
//
// THE PRINCIPAL IS NOT A GRANT. An owner reading their own correspondence
// needs no row in a table, and making them have one would mean a principal
// could be locked out of their own mail by an editing mistake.
//
// SENDING IS DELIBERATELY NOT A BOOLEAN. It has three states — see SEND_MODES
// — because "may they send" collapses two very different acts: writing as
// somebody, and writing on their behalf with the recipient told. An office
// that can only grant all-or-nothing grants all.

const SEND_MODES = ['draft', 'on_behalf', 'as'];

// Everything an owner may do with their own mail, spelled out rather than
// special-cased at each check, so a route reads the same for both cases.
const FULL = Object.freeze({
  view: true, organise: true, draft: true, delete: true,
  purge: true, sendMode: 'as', isOwner: true, scopeTier: null,
});

/**
 * What this viewer may do with this account. Null when the answer is nothing.
 *
 * Returns a shape rather than a boolean because six different routes want six
 * different parts of the answer, and handing each of them a yes/no would mean
 * each working the rest out again.
 */
async function accessFor(account, viewerId) {
  if (!account || !viewerId) return null;
  if (account.owner_id === viewerId) return FULL;

  const g = await db.prepare(`
    SELECT * FROM mail_grants
     WHERE account_id = ? AND member_user_id = ? AND revoked_at IS NULL
     ORDER BY created_at DESC LIMIT 1
  `).get(account.id, viewerId);
  if (!g || !g.may_view) return null;

  return {
    view: !!g.may_view,
    organise: !!g.may_organise,
    draft: !!g.may_draft,
    delete: !!g.may_delete,
    // NEVER for an assistant, however trusted. Purging is the one act with no
    // way back, and the tombstone a delete leaves is the principal's only
    // route to finding out that something once existed. See lib/mailbox.js.
    purge: false,
    sendMode: SEND_MODES.includes(g.send_mode) ? g.send_mode : 'draft',
    scopeTier: g.scope_tier || null,
    isOwner: false,
  };
}

/**
 * Which correspondents this viewer's grant covers.
 *
 * A NARROWER GRANT IS AN OFFICE DECISION, NOT A SECURITY BOUNDARY, and the
 * comment matters because the difference decides how hard it has to be. The
 * boundary is at ingest — what is not in Kairos cannot be reached however the
 * grants read. This is a junior assistant being pointed at the professional
 * correspondence and away from the family's, which is about doing the job
 * well rather than about keeping a secret.
 */
const TIER_ORDER = ['professional', 'close', 'inner_circle'];

function tierAllows(scopeTier, contactTier) {
  if (!scopeTier) return true;
  const limit = TIER_ORDER.indexOf(scopeTier);
  const at = TIER_ORDER.indexOf(contactTier || 'professional');
  if (limit < 0) return true;
  return at <= limit;
}

/**
 * The accounts this person may open, principals' own included.
 *
 * A SECOND ANSWER TO THE SAME QUESTION accessFor answers, and kept on purpose.
 * This is the list query — it must not load every mailbox in order to throw
 * most of them away — while accessFor stays the authority, and the route runs
 * every row through it before returning. So the two can only ever disagree by
 * this being NARROWER, never wider. Sabotaging accessFor to admit anyone left
 * the list empty and opened the direct route, which is the failure showing up
 * in the safe direction and is exactly why both exist.
 */
async function accountsFor(ownerId, viewerId) {
  if (ownerId === viewerId) {
    return db.prepare('SELECT * FROM mail_accounts WHERE owner_id = ? ORDER BY created_at')
      .all(ownerId);
  }
  return db.prepare(`
    SELECT a.* FROM mail_accounts a
      JOIN mail_grants g ON g.account_id = a.id
     WHERE a.owner_id = ? AND g.member_user_id = ?
       AND g.revoked_at IS NULL AND g.may_view = 1
     ORDER BY a.created_at
  `).all(ownerId, viewerId);
}

/**
 * Give somebody a grant, or change one.
 *
 * ONLY THE PRINCIPAL, enforced by the route rather than here, and the reason
 * is worth stating: an assistant who could grant sending to a colleague could
 * grant it to themselves through that colleague. Correspondence sent as a
 * principal is the most impersonating thing this product can do, and the only
 * person who may hand that out is the person being impersonated.
 *
 * WRITTEN TO THE ACCESS LOG, beside the vault reveals, because "who was
 * allowed to write as me, and when" is exactly the question asked afterwards.
 */
async function setGrant({ account, memberUserId, grantedBy, permissions = {} }) {
  const mode = SEND_MODES.includes(permissions.sendMode) ? permissions.sendMode : 'draft';
  const now = new Date().toISOString();

  await db.prepare(`
    UPDATE mail_grants SET revoked_at = ?
     WHERE account_id = ? AND member_user_id = ? AND revoked_at IS NULL
  `).run(now, account.id, memberUserId);

  const id = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO mail_grants
      (id, account_id, owner_id, member_user_id, may_view, may_organise, may_draft,
       may_delete, send_mode, scope_tier, granted_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, account.id, account.owner_id, memberUserId,
    permissions.view === false ? 0 : 1,
    permissions.organise === false ? 0 : 1,
    permissions.draft === false ? 0 : 1,
    permissions.delete === false ? 0 : 1,
    mode, permissions.scopeTier || null, grantedBy, now);

  const who = await db.prepare('SELECT name FROM users WHERE id = ?').get(memberUserId);
  await db.prepare(`
    INSERT INTO access_log (id, actor_id, subject_owner_id, essential_id, action, field, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(crypto.randomUUID(), grantedBy, account.owner_id, account.id, 'mail_grant',
    `${who?.name || 'somebody'} — ${account.address} — ${mode}`, now);

  return id;
}

async function revokeGrant({ account, memberUserId, actorId }) {
  const now = new Date().toISOString();
  await db.prepare(`
    UPDATE mail_grants SET revoked_at = ?
     WHERE account_id = ? AND member_user_id = ? AND revoked_at IS NULL
  `).run(now, account.id, memberUserId);
  const who = await db.prepare('SELECT name FROM users WHERE id = ?').get(memberUserId);
  await db.prepare(`
    INSERT INTO access_log (id, actor_id, subject_owner_id, essential_id, action, field, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(crypto.randomUUID(), actorId, account.owner_id, account.id, 'mail_revoke',
    `${who?.name || 'somebody'} — ${account.address}`, now);
}

async function grantsFor(accountId) {
  return db.prepare(`
    SELECT g.*, u.name, u.email FROM mail_grants g
      JOIN users u ON u.id = g.member_user_id
     WHERE g.account_id = ? AND g.revoked_at IS NULL
     ORDER BY u.name
  `).all(accountId);
}

module.exports = {
  SEND_MODES, TIER_ORDER, FULL,
  accessFor, accountsFor, setGrant, revokeGrant, grantsFor, tierAllows,
};
