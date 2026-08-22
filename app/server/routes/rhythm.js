const express = require('express');
const { asyncRouter } = require('../lib/asyncRouter');
const db = require('../lib/db');
const { requireAuth } = require('../lib/auth');
const { requirePaAccess } = require('../lib/paAccess');
const rhythm = require('../lib/rhythm');
const { warnMinutesFor } = require('../lib/availability');

// Two things about the shape of a day: the long read of how somebody works,
// and the short one of whether the meeting they are in is nearly over.
const router = asyncRouter();
router.use(requireAuth);

// What the diary says about how this principal works. See lib/rhythm.js for
// why this counts rather than predicts.
router.get('/:ownerId/pattern', requirePaAccess, async (req, res) => {
  res.json(await rhythm.read(req.principal.id));
});

/**
 * The meeting happening right now, if there is one, and when it ends.
 *
 * Deliberately tiny and deliberately dumb: it returns the times and lets the
 * browser count down. A server that pushed "eight minutes left" would have to
 * be asked every minute by every open tab, and would still be wrong for
 * whoever's clock had drifted. One request, two timestamps, and the counting
 * happens where the person is.
 */
router.get('/:ownerId/now', requirePaAccess, async (req, res) => {
  const now = new Date();
  // A window either side: what is running, and what is about to. Ending
  // recently matters too — somebody who opens the app a minute after a meeting
  // was due to end should still be told it is over.
  const from = new Date(now.getTime() - 15 * 60000).toISOString();
  const to = new Date(now.getTime() + 60 * 60000).toISOString();

  const rows = await db.prepare(`
    SELECT b.id, b.start_at, b.end_at, b.booker_name, b.video_room, mt.name AS meeting_type_name
    FROM bookings b JOIN meeting_types mt ON mt.id = b.meeting_type_id
    WHERE b.owner_id = ? AND b.status = 'confirmed' AND b.end_at > ? AND b.start_at < ?
    ORDER BY b.start_at ASC
  `).all(req.principal.id, from, to);

  const items = await db.prepare(`
    SELECT id, title, start_at, end_at FROM itinerary_items
    WHERE owner_id = ? AND status = 'confirmed' AND end_at IS NOT NULL
      AND end_at > ? AND start_at < ?
    ORDER BY start_at ASC
  `).all(req.principal.id, from, to);

  const running = [
    ...rows.map((b) => ({
      id: b.id,
      kind: 'booking',
      title: b.meeting_type_name,
      withWhom: b.booker_name,
      startAt: b.start_at,
      endAt: b.end_at,
    })),
    ...items.map((i) => ({
      id: i.id,
      kind: 'itinerary',
      title: i.title,
      withWhom: null,
      startAt: i.start_at,
      endAt: i.end_at,
    })),
  ].sort((a, b) => a.startAt.localeCompare(b.startAt));

  const owner = await db.prepare('SELECT warn_minutes, gap_minutes FROM users WHERE id = ?')
    .get(req.principal.id);

  res.json({
    now: now.toISOString(),
    warnMinutes: warnMinutesFor(owner),
    gapMinutes: Number(owner?.gap_minutes ?? 10),
    running,
  });
});

module.exports = router;
