const { asyncRouter } = require('../lib/asyncRouter');
const { requireAuth } = require('../lib/auth');
const { requirePaAccess } = require('../lib/paAccess');
const { requirePlan } = require('../lib/plans');
const visas = require('../lib/visas');

const router = asyncRouter();
router.use(requireAuth);

// The visa file. See lib/visas.js for why coverage is answered and
// requirement is not.

router.get('/:ownerId', requirePaAccess, async (req, res) => {
  res.json({
    visas: await visas.listFor(req.principal.id),
    kinds: Object.entries(visas.KINDS).map(([id, k]) => ({ id, label: k.label })),
    // Said up front so a screen never implies we know whether one is needed.
    rulesKnown: visas.rulesConfigured(),
    processingReviewedOn: visas.PROCESSING_REVIEWED,
  });
});

router.post('/:ownerId', requirePaAccess, requirePlan('trips'), async (req, res) => {
  const result = await visas.create({
    ownerId: req.principal.id,
    createdBy: req.user.id,
    ...req.body,
  });
  if (result.error) return res.status(400).json({ error: result.error });
  res.status(201).json(result);
});

// An entry spent, or given back when a trip is cancelled.
router.post('/:ownerId/:id/entry', requirePaAccess, async (req, res) => {
  const delta = req.body?.give_back ? -1 : 1;
  const visa = await visas.useEntry(req.principal.id, req.params.id, delta);
  if (!visa) return res.status(404).json({ error: 'Not found.' });
  res.json({ visa });
});

router.delete('/:ownerId/:id', requirePaAccess, async (req, res) => {
  await visas.remove(req.principal.id, req.params.id);
  res.status(204).end();
});

module.exports = router;
