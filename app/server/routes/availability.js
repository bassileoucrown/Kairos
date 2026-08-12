const express = require('express');
const { asyncRouter } = require('../lib/asyncRouter');
const { requireAuth } = require('../lib/auth');
const { listAvailability, replaceAvailability, handle } = require('../lib/scheduling');

// A principal editing their own hours. The identical operations, scoped to a
// principal an assistant supports, live in routes/pa.js — both call the same
// functions in lib/scheduling.js so the rules can't drift apart.
const router = asyncRouter();
router.use(requireAuth);

router.get('/', handle(async (req, res) => {
  res.json({ rules: await listAvailability(req.user.id) });
}));

router.put('/', handle(async (req, res) => {
  res.json({ rules: await replaceAvailability(req.user.id, req.body?.rules) });
}));

module.exports = router;
