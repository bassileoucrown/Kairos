const express = require('express');
const { requireAuth } = require('../lib/auth');
const {
  listMeetingTypes, createMeetingType, updateMeetingType, deleteMeetingType, handle,
} = require('../lib/scheduling');

// A principal managing their own meeting types. The delegated equivalents are
// in routes/pa.js; both go through lib/scheduling.js.
const router = express.Router();
router.use(requireAuth);

router.get('/', handle((req, res) => {
  res.json({ meetingTypes: listMeetingTypes(req.user.id) });
}));

router.post('/', handle((req, res) => {
  res.status(201).json({ meetingType: createMeetingType(req.user.id, req.body) });
}));

router.patch('/:id', handle((req, res) => {
  res.json({ meetingType: updateMeetingType(req.user.id, req.params.id, req.body) });
}));

router.delete('/:id', handle((req, res) => {
  deleteMeetingType(req.user.id, req.params.id);
  res.status(204).end();
}));

module.exports = router;
