const { asyncRouter } = require('../lib/asyncRouter');
const { requireAuth } = require('../lib/auth');
const { requirePaAccess } = require('../lib/paAccess');
const connectors = require('../lib/connectors');
const plans = require('../lib/plans');

const router = asyncRouter();
router.use(requireAuth);

// The catalogue, and honest refusals until each one is real.

router.get('/:ownerId', requirePaAccess, async (req, res) => {
  const state = await plans.stateFor(req.principal.id);
  const list = await connectors.listFor(req.principal.id, {
    allows: (needed) => rankAllows(state.plan, needed),
  });
  res.json({ connectors: list, plan: state.plan, planLabel: state.label });
});

/** A connector's plan is a plan name, not a feature key, so compare directly. */
function rankAllows(have, need) {
  const h = plans.PLANS[have];
  const n = plans.PLANS[need];
  if (!h || !n) return true;
  return h.rank >= n.rank;
}

router.post('/:ownerId/:id/connect', requirePaAccess, async (req, res) => {
  const spec = connectors.get(req.params.id);
  if (!spec) return res.status(404).json({ error: 'Not found.' });

  if (spec.kind === 'deployment') {
    return res.status(400).json({
      error: `${spec.label} is set up once for the whole deployment, not per account. `
        + 'There is nothing here for you to connect.',
    });
  }

  if (!connectors.isConfigured(spec.id)) {
    // The distinction that matters: this is our work outstanding, not theirs.
    return res.status(501).json({
      error: `${spec.label} is not configured on this deployment yet. `
        + `It needs ${spec.env.join(' and ')} set before anybody can connect it.`,
      needs: spec.env,
    });
  }

  return res.status(501).json({
    error: `Credentials for ${spec.label} are configured, but the exchange itself is not built yet.`,
  });
});

router.delete('/:ownerId/:id', requirePaAccess, async (req, res) => {
  if (!connectors.get(req.params.id)) return res.status(404).json({ error: 'Not found.' });
  await connectors.disconnect(req.principal.id, req.params.id);
  res.status(204).end();
});

module.exports = router;
