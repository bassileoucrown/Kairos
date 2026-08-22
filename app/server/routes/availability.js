const express = require('express');
const { asyncRouter } = require('../lib/asyncRouter');
const { requireAuth } = require('../lib/auth');
const {
  replaceAvailability, getAvailability, setBookingWindow, handle,
} = require('../lib/scheduling');

// A principal editing their own hours. The identical operations, scoped to a
// principal an assistant supports, live in routes/pa.js — both call the same
// functions in lib/scheduling.js so the rules can't drift apart.
const router = asyncRouter();
router.use(requireAuth);

router.get('/', handle(async (req, res) => {
  res.json(await getAvailability(req.user.id));
}));

router.put('/', handle(async (req, res) => {
  // The window is validated before the hours are rewritten, so a bad window
  // cannot leave somebody with their week replaced and their range unchanged.
  await setBookingWindow(req.user.id, req.body?.windowDays);
  await replaceAvailability(req.user.id, req.body?.rules);
  res.json(await getAvailability(req.user.id));
}));

module.exports = router;
