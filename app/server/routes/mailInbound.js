const crypto = require('crypto');
const { asyncRouter } = require('../lib/asyncRouter');
const db = require('../lib/db');
const mailbox = require('../lib/mailbox');
const connectors = require('../lib/connectors');

// Mail arriving from the outside world.
//
// THIS IS THE MOST EXPOSED ROUTE IN THE PRODUCT and it deserves saying plainly.
// Everything else here is reached by somebody signed in, or by a token handed
// to one driver for one journey. This is a door the public internet can post
// through, and what comes through it ends up in front of a principal.
//
// FOUR THINGS STAND IN FRONT OF IT, and they fail differently on purpose:
//
//   THE PROVIDER'S SIGNATURE. Without INBOUND_EMAIL_SECRET the route refuses
//   everything — not "accepts anything", which is what an unconfigured webhook
//   usually degrades into. A deployment that has not set it has the feature
//   off, and says so.
//
//   A PER-ACCOUNT TOKEN in the recipient address. Knowing the domain is not
//   enough; you have to know the account. It can be rolled without touching
//   anything else.
//
//   THE SENDER IS NOT TRUSTED AS WRITTEN. A From header is a claim, not a
//   fact. It is recorded as what the message said, and an unknown sender lands
//   in quarantine rather than in the working inbox.
//
//   NOTHING ARRIVING HERE CAN ACT. It becomes a message a person reads. It
//   creates no task, moves no meeting, files no record and never touches the
//   vault — so the worst a forged message achieves is wasting an assistant's
//   minute, which is the same as any other unwanted email.

const router = asyncRouter();

/**
 * Constant-time comparison of the provider's signature.
 *
 * Not `===`, which returns as soon as two bytes differ and so leaks the secret
 * a byte at a time to anybody willing to measure. The lengths are checked
 * first because timingSafeEqual throws on a mismatch, and that throw would
 * itself be the leak.
 */
function signatureOk(given) {
  const want = String(process.env.INBOUND_EMAIL_SECRET || '');
  if (!want) return false;
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(want);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** in+<token>@domain — the account, not the To header, decides where it lands. */
function tokenFrom(to) {
  const m = /(?:^|[<,\s])in\+([A-Za-z0-9_-]{16,})@/.exec(String(to || ''));
  return m ? m[1] : null;
}

router.post('/', async (req, res) => {
  if (!connectors.isConfigured('inbound_email')) {
    return res.status(503).json({
      error: 'Inbound mail is not configured for this deployment.',
      code: 'not_configured',
    });
  }
  if (!signatureOk(req.get('x-kairos-inbound-secret'))) {
    // Says nothing about which part was wrong.
    return res.status(401).json({ error: 'No.' });
  }

  const { to, from, fromName, subject, body, messageId, receivedAt } = req.body || {};
  const token = tokenFrom(to) || tokenFrom(req.body?.envelopeTo);
  if (!token) return res.status(400).json({ error: 'No account in the address.' });

  const account = await db.prepare(
    "SELECT * FROM mail_accounts WHERE inbound_token = ? AND status = 'live'",
  ).get(token);
  // A wrong token and a paused account answer the same way: anything else
  // tells whoever is probing which tokens are real.
  if (!account) return res.status(404).json({ error: 'No such mailbox.' });

  const result = await mailbox.deliver({
    account,
    fromName,
    fromEmail: from,
    toEmail: to,
    subject,
    body,
    externalId: messageId,
    at: receivedAt || new Date().toISOString(),
  });
  if (!result.ok) return res.status(result.status).json({ error: result.error });

  // 200 for a duplicate as well as a delivery. A provider that gets anything
  // else retries, and retrying a message we already have is how one forward
  // becomes forty.
  res.json({ ok: true, quarantined: !!result.quarantined, duplicate: !!result.duplicate });
});

module.exports = { router };
