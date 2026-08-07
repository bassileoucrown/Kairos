const crypto = require('crypto');
const db = require('./db');

// Swappable email delivery. Every email is always recorded in the `emails`
// table — that's the dev-mode outbox (see routes/emails.js) and doubles as
// the Communications Engine's history. If RESEND_API_KEY is set, we also
// attempt a real send; otherwise this is a no-op and the outbox is the only
// record, which is enough to develop and test every flow that sends mail
// without a real provider.
async function sendEmail({ ownerId = null, sentByUserId = null, toEmail, subject, body, category = 'transactional', relatedBookingId = null }) {
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO emails (id, owner_id, sent_by_user_id, to_email, subject, body, category, related_booking_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, ownerId, sentByUserId, toEmail, subject, body, category, relatedBookingId, new Date().toISOString());

  if (process.env.RESEND_API_KEY) {
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: process.env.EMAIL_FROM || 'Kairos <onboarding@resend.dev>',
          to: toEmail,
          subject,
          text: body,
        }),
      });
    } catch (err) {
      console.error('Email provider send failed (outbox record still saved):', err.message);
    }
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
