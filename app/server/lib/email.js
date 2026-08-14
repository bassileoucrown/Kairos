const crypto = require('crypto');
const db = require('./db');
const { emailFrom } = require('./brand');
const { activeProvider } = require('./emailProviders');

// Swappable email delivery. Every email is always recorded in the `emails`
// table — that's the dev-mode outbox (see routes/emails.js) and doubles as
// the Communications Engine's history. If a provider is configured (see
// lib/emailProviders.js — SendGrid or Resend, whichever key is set) we also
// attempt a real send; otherwise this is a no-op and the outbox is the only
// record, which is enough to develop and test every flow that sends mail
// without a real provider.
async function sendEmail({ ownerId = null, sentByUserId = null, toEmail, subject, body, category = 'transactional', relatedBookingId = null }) {
  const id = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO emails (id, owner_id, sent_by_user_id, to_email, subject, body, category, related_booking_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, ownerId, sentByUserId, toEmail, subject, body, category, relatedBookingId, new Date().toISOString());

  let provider = null;
  try { provider = activeProvider(); }
  catch (err) {
    // A misconfigured EMAIL_PROVIDER must not swallow the message. It is
    // already recorded above, and saying why out loud beats failing silently.
    console.error(`Email not sent — ${err.message}`);
    await db.prepare('UPDATE emails SET delivery_status = ?, delivery_error = ? WHERE id = ?')
      .run('failed', err.message, id);
    return { id };
  }

  if (provider) {
    // fetch does not throw on 4xx or 5xx. Without checking the status, a
    // rejected message — the commonest being "you can only send to your own
    // address until you verify a domain" — was recorded as sent, never
    // arrived, and left nothing behind to explain why. An invitation that
    // silently goes nowhere is worse than one that fails loudly: the person
    // waiting for it has no idea they are waiting.
    let status = 'sent';
    let failure = null;
    try {
      // The endpoint is overridable per provider so the delivery-failure path
      // can be exercised against a stand-in. There is no other way to test
      // "the provider said no" without a provider, and that is the path most
      // worth testing.
      const res = await fetch(provider.endpoint(), {
        method: 'POST',
        headers: provider.headers(provider.key),
        body: provider.body({ from: emailFrom(), to: toEmail, subject, text: body }),
      });
      if (!provider.accepts(res.status)) {
        const detail = await res.text().catch(() => '');
        const message = provider.errorMessage(detail);
        status = 'failed';
        failure = `${provider.label} ${res.status}: ${String(message).slice(0, 300)}`;
      }
    } catch (err) {
      status = 'failed';
      failure = err.message;
    }

    if (failure) {
      console.error(`Email to ${toEmail} was NOT delivered — ${failure}`);
    }
    await db.prepare('UPDATE emails SET delivery_status = ?, delivery_error = ? WHERE id = ?')
      .run(status, failure, id);
  } else {
    // No provider configured — the in-app Outbox (routes/emails.js) covers
    // this for a logged-in user checking their own mail, but that doesn't
    // help someone who's locked out (e.g. mid password reset) and can't log
    // in to see it. Print it here too, since the server console isn't
    // public — unlike showing the link in a response body, which would be a
    // real account-takeover hole for the forgot-password flow.
    console.log(`\n----- [dev] email to ${toEmail} -----\nSubject: ${subject}\n\n${body}\n----------------------------------------\n`);
  }

  return { id };
}

module.exports = { sendEmail };
