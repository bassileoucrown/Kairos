const crypto = require('crypto');
const { requirePlan } = require('../lib/plans');
const { asyncRouter } = require('../lib/asyncRouter');
const db = require('../lib/db');
const { requireAuth } = require('../lib/auth');
const { requirePaAccess } = require('../lib/paAccess');
const access = require('../lib/mailAccess');
const mailbox = require('../lib/mailbox');
const connectors = require('../lib/connectors');

// Correspondence an assistant handles on a principal's behalf.
//
// TWO GATES IN THIS FILE AND THEY ARE NOT THE SAME. requirePaAccess answers
// "is this person part of this office at all", which is the ordinary door.
// mailAccess.accessFor answers "what may they do with THIS mailbox", which is
// the one that matters — being an assistant does not put somebody in the
// principal's correspondence, and an office may run three mailboxes with three
// different people in each.
//
// GRANTS ARE THE PRINCIPAL'S ALONE. Not the Chief of Staff's, not an
// assistant's for a colleague — because an assistant who could grant sending
// to a colleague could grant it to themselves through that colleague, and
// writing as somebody is the most impersonating thing this product does.

const router = asyncRouter();
router.use(requireAuth);

/** Load the account and work out what the caller may do with it. */
async function loadAccount(req, res, next) {
  const row = await db.prepare('SELECT * FROM mail_accounts WHERE id = ? AND owner_id = ?')
    .get(req.params.accountId, req.principal.id);
  if (!row) return res.status(404).json({ error: 'Not found.' });
  const may = await access.accessFor(row, req.user.id);
  // Not yours to see and not there answer identically, as everywhere else.
  if (!may) return res.status(404).json({ error: 'Not found.' });
  req.account = row;
  req.may = may;
  return next();
}

const onlyPrincipal = (req, res, nextFn) => (req.principal.id === req.user.id
  ? nextFn()
  : res.status(403).json({
    error: 'Only the principal decides who handles their correspondence.',
  }));

function serializeAccount(a, may) {
  return {
    id: a.id,
    kind: a.kind,
    address: a.address,
    label: a.label,
    status: a.status,
    // Said per account, so a screen can hide what this person cannot do rather
    // than offering a button the server will refuse.
    may: {
      view: may.view, organise: may.organise, draft: may.draft,
      delete: may.delete, purge: may.purge, sendMode: may.sendMode,
      // Two acts belong to the principal alone — admitting a new
      // correspondent, and taking one correspondence out of the office's
      // sight. The screen needs to know which it is talking to so it does not
      // offer either to somebody the server would refuse.
      isOwner: !!may.isOwner,
    },
  };
}

// --- The mailboxes ---------------------------------------------------------------

router.get('/:ownerId/accounts', requirePaAccess, async (req, res) => {
  const rows = await access.accountsFor(req.principal.id, req.user.id);
  const out = [];
  for (const a of rows) {
    const may = await access.accessFor(a, req.user.id);
    if (may) out.push(serializeAccount(a, may));
  }
  res.json({
    accounts: out,
    // Whether mail can actually arrive here. A screen that offered a
    // forwarding address the deployment cannot receive on would be worse than
    // one that says the feature is not configured — see lib/connectors.js.
    inbound: {
      available: connectors.isConfigured('inbound_email'),
      domain: process.env.INBOUND_EMAIL_DOMAIN || null,
    },
  });
});

router.post('/:ownerId/accounts', requirePaAccess, requirePlan('mail'), async (req, res) => onlyPrincipal(req, res, async () => {
  const { kind, address, label } = req.body || {};
  const kinds = new Set(['delegated', 'forwarded', 'gmail', 'graph']);
  if (!kinds.has(kind)) return res.status(400).json({ error: 'Not a kind of mailbox.' });
  if (!String(address || '').includes('@')) {
    return res.status(400).json({ error: 'That is not an address.' });
  }
  // gmail and graph need an OAuth connector that is not built. Refused with the
  // reason rather than accepted into a state that silently never syncs.
  if (kind === 'gmail' || kind === 'graph') {
    return res.status(503).json({
      error: 'Syncing a Gmail or Outlook mailbox needs a connector that is not configured '
        + 'for this deployment. A delegated or forwarded address works today.',
      code: 'not_configured',
    });
  }

  const row = {
    id: crypto.randomUUID(),
    owner_id: req.principal.id,
    kind,
    address: String(address).trim().toLowerCase(),
    label: String(label || '').trim(),
    inbound_token: mailbox.token(),
    created_at: new Date().toISOString(),
  };
  await db.prepare(`
    INSERT INTO mail_accounts (id, owner_id, kind, address, label, inbound_token, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(row.id, row.owner_id, row.kind, row.address, row.label, row.inbound_token, row.created_at);
  res.status(201).json({ account: serializeAccount(row, access.FULL) });
}));

/** Where to forward mail so it lands here. The principal's own to hand out. */
router.get('/:ownerId/accounts/:accountId/inbound', requirePaAccess, loadAccount,
  async (req, res) => onlyPrincipal(req, res, async () => {
    const domain = process.env.INBOUND_EMAIL_DOMAIN;
    res.json({
      // Null rather than a plausible-looking address, so nobody sets up a
      // forwarding rule pointing at a domain that does not receive.
      address: domain ? `in+${req.account.inbound_token}@${domain}` : null,
      configured: connectors.isConfigured('inbound_email'),
    });
  }));

router.post('/:ownerId/accounts/:accountId/roll', requirePaAccess, loadAccount,
  async (req, res) => onlyPrincipal(req, res, async () => {
    const next = mailbox.token();
    await db.prepare('UPDATE mail_accounts SET inbound_token = ? WHERE id = ?')
      .run(next, req.account.id);
    res.json({ ok: true });
  }));

// --- Who handles it ---------------------------------------------------------------

router.get('/:ownerId/accounts/:accountId/grants', requirePaAccess, loadAccount,
  async (req, res) => onlyPrincipal(req, res, async () => {
    const rows = await access.grantsFor(req.account.id);
    res.json({
      grants: rows.map((g) => ({
        userId: g.member_user_id, name: g.name, email: g.email,
        view: !!g.may_view, organise: !!g.may_organise,
        draft: !!g.may_draft, delete: !!g.may_delete,
        sendMode: g.send_mode, scopeTier: g.scope_tier || null,
      })),
      sendModes: access.SEND_MODES,
    });
  }));

router.put('/:ownerId/accounts/:accountId/grants/:userId', requirePaAccess, loadAccount,
  async (req, res) => onlyPrincipal(req, res, async () => {
    const member = await db.prepare(`
      SELECT member_user_id FROM memberships
       WHERE owner_id = ? AND member_user_id = ? AND status = 'active'
    `).get(req.principal.id, req.params.userId);
    if (!member) return res.status(400).json({ error: 'That is not somebody in this office.' });
    await access.setGrant({
      account: req.account,
      memberUserId: req.params.userId,
      grantedBy: req.user.id,
      permissions: req.body || {},
    });
    res.status(201).json({ ok: true });
  }));

router.delete('/:ownerId/accounts/:accountId/grants/:userId', requirePaAccess, loadAccount,
  async (req, res) => onlyPrincipal(req, res, async () => {
    await access.revokeGrant({
      account: req.account, memberUserId: req.params.userId, actorId: req.user.id,
    });
    res.status(204).end();
  }));

// --- The correspondence -------------------------------------------------------------

router.get('/:ownerId/accounts/:accountId/threads', requirePaAccess, loadAccount,
  async (req, res) => {
    res.json({
      threads: await mailbox.threads(req.account.id, {
        state: req.query.state || null,
        quarantined: req.query.quarantined === '1',
        // The viewer, so the list is filtered by the one gate rather than by
        // this route's own idea of who sees what. See lib/mailAccess.js.
        may: req.may,
      }),
    });
  });

/**
 * The thread's own tier, for the gate.
 *
 * Looked up rather than joined into the row because this route fetches one
 * thread by id and a second small query is cheaper to read than a join that
 * exists for one caller.
 */
async function tierOf(thread) {
  const c = await db.prepare('SELECT relationship_tier FROM contacts WHERE owner_id = ? AND email = ?')
    .get(thread.owner_id, thread.correspondent_email);
  return c?.relationship_tier || null;
}

router.get('/:ownerId/accounts/:accountId/threads/:threadId', requirePaAccess, loadAccount,
  async (req, res) => {
    const t = await db.prepare('SELECT * FROM mail_threads WHERE id = ? AND account_id = ?')
      .get(req.params.threadId, req.account.id);
    if (!t) return res.status(404).json({ error: 'Not found.' });
    // NOT FOUND RATHER THAN FORBIDDEN, deliberately. "You may not read this"
    // confirms that a correspondence with that id exists in this principal's
    // mailbox, which is most of what somebody guessing wanted to know.
    if (!access.maySeeThread(t, req.may, await tierOf(t))) {
      return res.status(404).json({ error: 'Not found.' });
    }
    res.json({
      thread: mailbox.serializeThread(t),
      messages: await mailbox.messagesIn(t.id),
    });
  });

router.patch('/:ownerId/accounts/:accountId/threads/:threadId', requirePaAccess, loadAccount,
  async (req, res) => {
    if (!req.may.organise) {
      return res.status(403).json({ error: 'You may read this correspondence, not file it.' });
    }
    const t = await db.prepare('SELECT * FROM mail_threads WHERE id = ? AND account_id = ?')
      .get(req.params.threadId, req.account.id);
    if (!t) return res.status(404).json({ error: 'Not found.' });
    if (!access.maySeeThread(t, req.may, await tierOf(t))) {
      return res.status(404).json({ error: 'Not found.' });
    }

    // ADMITTING A CORRESPONDENT IS THE PRINCIPAL'S, and this is the line that
    // makes private-by-default mean anything. Quarantine is no longer a tray
    // the office works through — it is the boundary, and an assistant who
    // could release from it could admit anyone to everything that follows.
    if (req.body?.releaseQuarantine && !req.may.isOwner) {
      return res.status(403).json({
        error: 'Only the principal can let a new correspondent through to the office.',
        code: 'principal_only',
      });
    }
    // Same for taking a thread out of the office's sight, or putting it back.
    if (req.body?.visibility !== undefined && !req.may.isOwner) {
      return res.status(403).json({
        error: 'Only the principal decides which correspondence the office sees.',
        code: 'principal_only',
      });
    }

    const result = await mailbox.organise(t.id, req.body || {});
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    res.json({ threads: await mailbox.threads(req.account.id, { may: req.may }) });
  });

router.delete('/:ownerId/accounts/:accountId/threads/:threadId', requirePaAccess, loadAccount,
  async (req, res) => {
    if (!req.may.delete) {
      return res.status(403).json({ error: 'You may read this correspondence, not delete it.' });
    }
    const t = await db.prepare('SELECT * FROM mail_threads WHERE id = ? AND account_id = ?')
      .get(req.params.threadId, req.account.id);
    if (!t) return res.status(404).json({ error: 'Not found.' });
    // A thread they cannot see is a thread they cannot destroy. Without this
    // the gate would guard reading and leave the most damaging verb open.
    if (!access.maySeeThread(t, req.may, await tierOf(t))) {
      return res.status(404).json({ error: 'Not found.' });
    }
    await mailbox.remove({ thread: t, actorId: req.user.id, ownerId: req.principal.id });
    res.status(204).end();
  });

/** The envelope too. The principal only — see lib/mailAccess.js. */
router.delete('/:ownerId/accounts/:accountId/threads/:threadId/purge', requirePaAccess, loadAccount,
  async (req, res) => {
    if (!req.may.purge) {
      return res.status(403).json({
        error: 'Only the principal can remove the record that a message existed.',
      });
    }
    const t = await db.prepare('SELECT * FROM mail_threads WHERE id = ? AND account_id = ?')
      .get(req.params.threadId, req.account.id);
    if (!t) return res.status(404).json({ error: 'Not found.' });
    await mailbox.purge({ thread: t, actorId: req.user.id, ownerId: req.principal.id });
    res.status(204).end();
  });

/** What has been deleted from this account, for the principal to read. */
router.get('/:ownerId/accounts/:accountId/deleted', requirePaAccess, loadAccount,
  async (req, res) => {
    const rows = await db.prepare(`
      SELECT t.*, u.name AS deleted_by_name FROM mail_threads t
        LEFT JOIN users u ON u.id = t.deleted_by
       WHERE t.account_id = ? AND t.deleted_at IS NOT NULL
       ORDER BY t.deleted_at DESC LIMIT 100
    `).all(req.account.id);
    res.json({
      deleted: rows.map((t) => mailbox.serializeThread(t, {
        deletedByName: t.deleted_by_name || null,
      })),
    });
  });

module.exports = { router };
