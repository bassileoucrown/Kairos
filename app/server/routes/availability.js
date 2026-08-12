const express = require('express');
const { requireAuth } = require('../lib/auth');
const { listAvailability, replaceAvailability, handle } = require('../lib/scheduling');

// A principal editing their own hours. The identical operations, scoped to a
// principal an assistant supports, live in routes/pa.js — both call the same
// functions in lib/scheduling.js so the rules can't drift apart.
const router = express.Router();
router.use(requireAuth);

router.get('/', handle((req, res) => {
  res.json({ rules: listAvailability(req.user.id) });
}));

router.put('/', handle((req, res) => {
  res.json({ rules: replaceAvailability(req.user.id, req.body?.rules) });
}));

module.exports = router;
