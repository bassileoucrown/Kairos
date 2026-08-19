import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';

// Everything Kairos talks to, in one list, driven by the registry rather than
// hand-written per provider. See server/lib/connectors.js.
//
// The screen keeps two facts apart that a single "available" flag would have
// merged, because they are different sentences and one of them is an apology:
//
//   not configured here  — our work outstanding. Nothing for you to do.
//   configured, not connected — yours to finish, and there is a button.
//
// A connector above the account's plan is shown rather than hidden. Somebody
// deciding whether to move up should be able to see what moving up gets them,
// and a list that quietly omits things is a list nobody trusts to be complete.

const KIND_NOTE = {
  deployment: 'Set up once for everyone — nothing to connect per account.',
  account: 'Connected by each principal, to their own account.',
};

function Row({ c, onConnect, onDisconnect, busy }) {
  const state = c.connected ? 'connected'
    : !c.configured ? 'unconfigured'
      : 'ready';

  return (
    <div className="card connector">
      <div className="connector-head">
        <span className="name">{c.label}</span>
        <span className={`pill${state === 'connected' ? '' : ' is-off'}`}>
          {state === 'connected' ? 'Connected'
            : state === 'unconfigured' ? 'Not configured here'
              : 'Ready to connect'}
        </span>
        {!c.includedInPlan && <span className="connector-plan">{c.plan.replace('_', ' ')}</span>}
      </div>

      <p className="meta">{c.what}</p>
      <p className="hint">{KIND_NOTE[c.kind]}</p>

      {state === 'unconfigured' && c.needs.length > 0 && (
        <p className="hint connector-needs">
          Waiting on {c.needs.join(', ')} being set on this deployment.
        </p>
      )}

      {c.kind === 'account' && (
        <div className="code-actions">
          {c.connected ? (
            <button className="btn btn-danger btn-sm" type="button" disabled={busy}
              onClick={() => onDisconnect(c.id)}>Disconnect</button>
          ) : (
            <button className="btn btn-sm" type="button" disabled={busy}
              onClick={() => onConnect(c.id)}>Connect</button>
          )}
        </div>
      )}
    </div>
  );
}

export default function ConnectorsPanel({ ownerId }) {
  const [data, setData] = useState(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  function load() {
    return api.get(`/connectors/${ownerId}`).then(setData).catch((e) => setError(e.message));
  }
  useEffect(() => { if (ownerId) load(); }, [ownerId]);

  async function connect(id) {
    setBusy(id); setError(''); setNote('');
    try { await api.post(`/connectors/${ownerId}/${id}/connect`); await load(); }
    // Expected until each one is real. It is a status, not a failure, so it is
    // not dressed up as one.
    catch (e) { setNote(e.message); } finally { setBusy(''); }
  }

  async function disconnect(id) {
    setBusy(id); setError(''); setNote('');
    try { await api.del(`/connectors/${ownerId}/${id}`); await load(); }
    catch (e) { setError(e.message); } finally { setBusy(''); }
  }

  if (!data) return <p className="hint">Loading…</p>;

  const account = data.connectors.filter((c) => c.kind === 'account');
  const deployment = data.connectors.filter((c) => c.kind === 'deployment');

  return (
    <div>
      {error && <div className="alert alert-error">{error}</div>}
      {note && <div className="alert alert-warning">{note}</div>}

      <p className="tz-note" style={{ marginBottom: 16 }}>
        Each of these is designed and honestly stubbed: the shape is in place and every
        one is waiting on a specific credential rather than on a decision. Nothing here
        pretends to work.
      </p>

      <h3 className="ess-heading">Your accounts</h3>
      {account.map((c) => (
        <Row key={c.id} c={c} busy={busy === c.id} onConnect={connect} onDisconnect={disconnect} />
      ))}

      <h3 className="ess-heading">Set up for the whole deployment</h3>
      {deployment.map((c) => (
        <Row key={c.id} c={c} busy={busy === c.id} onConnect={connect} onDisconnect={disconnect} />
      ))}
    </div>
  );
}
