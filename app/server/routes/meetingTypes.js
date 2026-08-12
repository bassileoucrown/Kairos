const express = require('express');
const { asyncRouter } = require('../lib/asyncRouter');
const { requireAuth } = require('../lib/auth');
const {
  listMeetingTypes, createMeetingType, updateMeetingType, deleteMeetingType, handle,
} = require('../lib/scheduling');

// A principal managing their own meeting types. The delegated equivalents are
// in routes/pa.js; both go through lib/scheduling.js.
const router = asyncRouter();
router.use(requireAuth);

router.get('/', handle(async (req, res) => {
  res.json({ meetingTypes: await listMeetingTypes(req.user.id) });
}));

router.post('/', handle(async (req, res) => {
  res.status(201).json({ meetingType: await createMeetingType(req.user.id, req.body) });
}));

router.patch('/:id', handle(async (req, res) => {
  res.json({ meetingType: await updateMeetingType(req.user.id, req.params.id, req.body) });
}));

router.delete('/:id', handle(async (req, res) => {
  await deleteMeetingType(req.user.id, req.params.id);
  res.status(204).end();
}));

module.exports = router;
