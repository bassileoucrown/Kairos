const crypto = require('crypto');
const db = require('./db');
const { emailFrom } = require('./brand');

// Swappable email delivery. Every email is always recorded in the `emails`
// table — that's the dev-mode outbox (see routes/emails.js) and doubles as
// the Communications Engine's history. If RESEND_API_KEY is set, we also
// attempt a real send; otherwise this is a no-op and the outbox is the only
// record, which is enough to develop and test every flow that sends mail
// without a real provider.
async function sendEmail({ ownerId = null, sentByUserId = null, toEmail, subject, body, category = 'transactional', relatedBookingId = null }) {
  const id = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO emails (id, owner_id, sent_by_user_id, to_email, subject, body, category, related_booking_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, ownerId, sentByUserId, toEmail, subject, body, category, relatedBookingId, new Date().toISOString());

  if (process.env.RESEND_API_KEY) {
    // fetch does not throw on 4xx or 5xx. Without checking the status, a
    // rejected message — the commonest being "you can only send to your own
    // address until you verify a domain" — was recorded as sent, never
    // arrived, and left nothing behind to explain why. An invitation that
    // silently goes nowhere is worse than one that fails loudly: the person
    // waiting for it has no idea they are waiting.
    let status = 'sent';
    let failure = null;
    try {
      // Overridable so the delivery-failure path can be exercised against a
      // stand-in. There is no other way to test "the provider said no" without
      // a provider, and that is the path most worth testing.
      const endpoint = process.env.RESEND_ENDPOINT || 'https://api.resend.com/emails';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: emailFrom(),
          to: toEmail,
          subject,
          text: body,
        }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        let message = detail;
        try { message = JSON.parse(detail).message || detail; } catch { /* not JSON */ }
        status = 'failed';
        failure = `${res.status}: ${String(message).slice(0, 300)}`;
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
