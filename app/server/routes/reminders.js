const { asyncRouter } = require('../lib/asyncRouter');
const { requireAuth } = require('../lib/auth');
const { requirePaAccess } = require('../lib/paAccess');
const reminders = require('../lib/appointmentReminders');

// Reminders a person sets for themselves, on one appointment.
//
// SCOPED UNDER A PRINCIPAL, like the rest of the diary, so requirePaAccess
// decides who may reach the appointment at all — and then the row is written
// against req.user rather than the principal. That split is the feature: an
// assistant with access to the diary can set a reminder, and what they set is
// theirs, not the principal's.
//
// A subject the caller cannot see answers 404 rather than 403, the same as
// everywhere else here. Being told "you may not set a reminder on that" is
// being told the meeting exists.

const router = asyncRouter();
router.use(requireAuth);

router.get('/presets', async (req, res) => {
  res.json({ presets: reminders.PRESETS, defaultMinutes: reminders.DEFAULT_MINUTES });
});

/** What I have set, and what everyone else in the office has, on one thing. */
router.get('/:ownerId/:kind/:subjectId', requirePaAccess, async (req, res) => {
  const { kind, subjectId } = req.params;
  const subject = await reminders.resolveSubject(kind, subjectId, req.principal.id, req.user.id);
  if (!subject) return res.status(404).json({ error: 'Appointment not found.' });

  res.json({
    appointment: { id: subject.id, title: subject.title, startAt: subject.startAt },
    mine: await reminders.mine(req.user.id, kind, subjectId),
    others: (await reminders.forSubject(kind, subjectId)).filter((r) => r.userId !== req.user.id),
    presets: reminders.PRESETS,
    defaultMinutes: reminders.DEFAULT_MINUTES,
  });
});

router.put('/:ownerId/:kind/:subjectId', requirePaAccess, async (req, res) => {
  const { kind, subjectId } = req.params;
  const problem = reminders.problem(req.body?.minutes);
  if (problem) return res.status(400).json({ error: problem });

  const subject = await reminders.resolveSubject(kind, subjectId, req.principal.id, req.user.id);
  if (!subject) return res.status(404).json({ error: 'Appointment not found.' });

  // A reminder for a meeting that has already started is a reminder that can
  // never fire, and saying so now is better than a row that quietly does
  // nothing. Refused rather than silently accepted.
  if (new Date(subject.startAt).getTime() <= Date.now()) {
    return res.status(400).json({ error: 'That appointment has already started.' });
  }

  const saved = await reminders.set(
    req.user.id, req.principal.id, kind, subjectId, Number(req.body.minutes),
  );
  res.json({ reminder: saved });
});

router.delete('/:ownerId/:kind/:subjectId', requirePaAccess, async (req, res) => {
  const { kind, subjectId } = req.params;
  const subject = await reminders.resolveSubject(kind, subjectId, req.principal.id, req.user.id);
  if (!subject) return res.status(404).json({ error: 'Appointment not found.' });
  await reminders.clear(req.user.id, kind, subjectId);
  res.status(204).end();
});

module.exports = router;
