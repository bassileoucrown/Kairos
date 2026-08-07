# Kairos — Landing Page & Waitlist

The public landing page and waitlist signup for **Kairos by Exousia** — the scheduling OS for those whose time matters most.

## What's here

- `public/` — the landing page (static HTML/CSS/JS, no build step)
- `server.js` — a small Express server that serves the site and a working waitlist API
- `lib/waitlistStore.js` — waitlist persistence (JSON file on disk, dedupes by email)
- `data/waitlist.json` — created automatically at runtime; not committed (see `.gitignore`)

## Running locally

```bash
npm install
npm start
```

Then open `http://localhost:3000`.

## Waitlist API

- `POST /api/waitlist` — body: `{ email, name?, role, source? }`. Validates the email, dedupes by
  address, and returns `{ created, position, total }`. Includes a honeypot field (`company`) and
  basic per-IP rate limiting.
- `GET /api/waitlist/count` — returns `{ count }`, used by the page for the live social-proof line.

## Notes for future iterations

Per the Kairos technology stack decisions, the product itself is planned on Supabase (Postgres +
Row Level Security) with Vercel hosting. This landing page intentionally uses a minimal
file-backed store so it runs anywhere with zero configuration; when the product build begins,
swap `lib/waitlistStore.js` for a Supabase table (or export `data/waitlist.json` into one) without
touching the frontend or API contract.
