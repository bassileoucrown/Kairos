const path = require('path');
const express = require('express');
const waitlist = require('./lib/waitlistStore');

const app = express();
const PORT = process.env.PORT || 3000;

app.disable('x-powered-by');
app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Basic in-memory rate limiting: 5 submissions per IP per 10 minutes.
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX = 5;
const hits = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const timestamps = (hits.get(ip) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  timestamps.push(now);
  hits.set(ip, timestamps);
  return timestamps.length > RATE_LIMIT_MAX;
}

app.post('/api/waitlist', (req, res) => {
  const ip = req.ip;
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: 'Too many requests. Please try again later.' });
  }

  const { email, name, role, source, company } = req.body || {};

  // Honeypot: real users never fill the hidden "company" field.
  if (company) {
    return res.status(201).json({ position: 1, created: true });
  }

  if (!email || typeof email !== 'string' || !EMAIL_RE.test(email.trim())) {
    return res.status(400).json({ error: 'Please provide a valid email address.' });
  }

  waitlist
    .addEntry({ email, name, role, source })
    .then((result) => {
      res.status(result.created ? 201 : 200).json(result);
    })
    .catch((err) => {
      console.error('Failed to save waitlist entry:', err);
      res.status(500).json({ error: 'Something went wrong. Please try again.' });
    });
});

app.get('/api/waitlist/count', (req, res) => {
  res.json({ count: waitlist.count() });
});

app.listen(PORT, () => {
  console.log(`Kairos landing page running at http://localhost:${PORT}`);
});
